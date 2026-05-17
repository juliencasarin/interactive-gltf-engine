from __future__ import annotations

import os
import sys
from pathlib import Path

KIT_ALLOWED_SUFFIXES = frozenset({".md", ".js", ".txt"})
_MAX_BYTES = int(os.environ.get("IGLTF_AUTHORING_READ_MAX_BYTES", "524288"))

APP_DIR = Path(__file__).resolve().parent


def resolve_authoring_kit_root() -> Path:
    raw = os.environ.get("IGLTF_AUTHORING_KIT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        bundle = exe_dir / "authoring_kit"
        if bundle.is_dir():
            return bundle.resolve()
    backend_root = APP_DIR.parent
    cand = backend_root / "authoring_kit"
    if cand.is_dir():
        return cand.resolve()
    # Installed wheel: authoring_kit sibling of site-packages/app
    sp = APP_DIR.parent
    cand2 = sp / "authoring_kit"
    if cand2.is_dir():
        return cand2.resolve()
    msg = (
        "authoring kit not found — set IGLTF_AUTHORING_KIT to an absolute folder path "
        "with js/ and md/ (expected next to igltf-editor-backend in dev or in site-packages when installed)."
    )
    raise FileNotFoundError(msg)


def _safe_rel_file_path(rel: str, kit_root: Path) -> Path:
    if not isinstance(rel, str) or "\x00" in rel:
        raise ValueError("invalid path")
    rel_path = Path(rel.strip().replace("\\", "/")).as_posix()
    if rel_path.startswith("/") or rel_path.startswith("../") or "/../" in f"/{rel_path}/":
        raise ValueError("path must be relative with no traversal")
    parts = Path(rel_path).parts
    if any(p == ".." for p in parts):
        raise ValueError("path must not contain '..'")

    cand = (kit_root / rel_path).resolve()
    cand.relative_to(kit_root.resolve())
    if cand.suffix.lower() not in KIT_ALLOWED_SUFFIXES:
        allowed = ", ".join(sorted(KIT_ALLOWED_SUFFIXES))
        raise ValueError(f"unsupported file extension; allowed {allowed}")
    if not cand.is_file():
        raise FileNotFoundError(f"no such file under authoring kit: {rel_path}")
    return cand


def list_framework_kit_files_rel(kit_root: Path) -> list[str]:
    out: list[str] = []
    for p in sorted(kit_root.rglob("*")):
        if p.is_file():
            suf = p.suffix.lower()
            if suf not in KIT_ALLOWED_SUFFIXES:
                continue
            rp = p.resolve().relative_to(kit_root.resolve()).as_posix()
            out.append(rp)
    out.sort()
    return out


def read_framework_kit_file(rel: str, kit_root: Path) -> tuple[str, int]:
    path = _safe_rel_file_path(rel, kit_root)
    size = path.stat().st_size
    if size > _MAX_BYTES:
        raise ValueError(f"file too large (max {_MAX_BYTES} bytes)")
    text = path.read_text(encoding="utf-8", errors="strict")
    return text, len(text.encode("utf-8"))
