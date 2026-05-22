"""Bundle catalog scripts into ``build/scene.js`` (esbuild IIFE + ``globalThis`` exports)."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from fastapi import HTTPException

from app.models import ProjectAsset, ProjectDocumentV2

_SCRIPT_SUFFIXES = frozenset({".js", ".mjs", ".cjs"})


def _is_script_catalog_asset(a: ProjectAsset) -> bool:
    suf = Path(a.relativePath).suffix.lower()
    if suf in _SCRIPT_SUFFIXES:
        return True
    return a.assetKind == "script"


def collect_script_assets(doc: ProjectDocumentV2, workspace: Path) -> list[ProjectAsset]:
    """Script rows from ``assets[]`` with existing files under ``workspace``."""
    root = workspace.resolve()
    out: list[ProjectAsset] = []
    for a in doc.assets:
        if not _is_script_catalog_asset(a):
            continue
        suf = Path(a.relativePath).suffix.lower()
        if suf not in _SCRIPT_SUFFIXES:
            continue
        disk = (root / a.relativePath).resolve()
        try:
            disk.relative_to(root)
        except ValueError:
            continue
        if disk.is_file():
            out.append(a)
    out.sort(key=lambda x: x.assetId)
    return out


def toposort_script_assets(scripts: list[ProjectAsset]) -> list[ProjectAsset]:
    """Topological order (deps first). Tie-break by ``assetId``. Raises ``ValueError`` on cycle or bad ref."""
    ids = {a.assetId for a in scripts}
    id_to_asset = {a.assetId: a for a in scripts}

    for a in scripts:
        for d in a.scriptDependsOnAssetIds or []:
            if d not in ids:
                raise ValueError(
                    f"script asset {a.assetId!r} lists unknown dependency {d!r} in scriptDependsOnAssetIds",
                )
            if d == a.assetId:
                raise ValueError(f"script asset {a.assetId!r} must not depend on itself")

    in_degree: dict[str, int] = {}
    dependents: dict[str, list[str]] = defaultdict(list)

    for a in scripts:
        deps = a.scriptDependsOnAssetIds or []
        in_degree[a.assetId] = len(deps)
        for d in deps:
            dependents[d].append(a.assetId)

    ready = sorted([i for i in ids if in_degree[i] == 0])
    order_ids: list[str] = []

    while ready:
        u = ready.pop(0)
        order_ids.append(u)
        for v in sorted(dependents[u]):
            in_degree[v] -= 1
            if in_degree[v] == 0:
                ready.append(v)
                ready.sort()

    if len(order_ids) != len(ids):
        raise ValueError("cycle detected in scriptDependsOnAssetIds")

    return [id_to_asset[i] for i in order_ids]


def _esbuild_platform_tag() -> str:
    if os.name == "nt":
        return "win32-x64"
    if sys.platform == "darwin":
        machine = platform.machine().lower()
        return "darwin-arm64" if machine in ("arm64", "aarch64") else "darwin-x64"
    machine = platform.machine().lower()
    return "linux-arm64" if machine in ("arm64", "aarch64") else "linux-x64"


def backend_root() -> Path:
    """Directory containing ``pyproject.toml`` / bundled runtime files for this service."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "_internal"
    return Path(__file__).resolve().parent.parent


def resolve_esbuild_command(backend: Path) -> list[str]:
    """Return argv prefix to invoke esbuild (binary or shim)."""
    env_bin = os.environ.get("ESBUILD_BINARY")
    if env_bin:
        return [env_bin]

    plat = _esbuild_platform_tag()
    bin_name = "esbuild.exe" if os.name == "nt" else "esbuild"
    bundled = backend / "node_modules" / "@esbuild" / plat / bin_name
    if bundled.is_file():
        return [str(bundled)]

    bin_dir = backend / "node_modules" / ".bin"
    if os.name == "nt":
        shim = bin_dir / "esbuild.cmd"
    else:
        shim = bin_dir / "esbuild"
    if shim.is_file():
        return [str(shim)]

    raise FileNotFoundError(
        "esbuild not found — run `npm install` under igltf-editor-backend "
        "or set ESBUILD_BINARY to the esbuild executable",
    )


def write_scene_js_bundle(workspace: Path, doc: ProjectDocumentV2, out_path: Path) -> bool:
    """
    Emit ``scene.js`` next to ``scene.glb``.

    Returns ``True`` if a bundle was written, ``False`` if there are no script assets (caller may delete stale ``scene.js``).
    Raises ``HTTPException`` on validation or bundler errors.
    """
    scripts = collect_script_assets(doc, workspace)
    if not scripts:
        return False

    try:
        ordered = toposort_script_assets(scripts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    root = workspace.resolve()
    lines: list[str] = []
    for i, a in enumerate(ordered):
        disk = (root / a.relativePath).resolve()
        imp = json.dumps(disk.as_posix())
        lines.append(f"import * as __igltfNs{i} from {imp};")
        lines.append(f"Object.assign(globalThis, __igltfNs{i});")
    entry_source = "\n".join(lines) + "\n"

    backend = backend_root()
    try:
        esbuild_argv0 = resolve_esbuild_command(backend)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = out_path.with_suffix(out_path.suffix + ".tmp")

    with tempfile.TemporaryDirectory(prefix="igltf-scene-js-") as td_raw:
        td = Path(td_raw)
        entry_path = td / "__igltf_bundle_entry__.mjs"
        entry_path.write_text(entry_source, encoding="utf-8")

        cmd = [
            *esbuild_argv0,
            str(entry_path),
            "--bundle",
            "--format=iife",
            "--platform=neutral",
            "--legal-comments=none",
            "--external:/igltf-core/*",
            f"--outfile={tmp_out}",
        ]
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(backend),
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except (OSError, subprocess.TimeoutExpired) as e:
            raise HTTPException(status_code=500, detail=f"esbuild failed to start: {e}") from e

        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
            raise HTTPException(status_code=500, detail=f"esbuild bundle failed: {err}")

    try:
        shutil.move(str(tmp_out), str(out_path))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"failed to write {out_path.name}: {e}") from e

    return True
