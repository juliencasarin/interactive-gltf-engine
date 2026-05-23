from __future__ import annotations

import re
import shutil
from pathlib import Path

from fastapi import HTTPException

from app.models import ProjectAsset, ProjectDocumentV2
from app.project_fs_lock import project_fs_lock
from app.script_asset_naming import primary_export_class_name, sanitize_stem
from app.storage import assets_dir, project_dir, project_json_path, staging_dir

_STAGING_ASSET_EXTENSIONS = frozenset({".glb", ".gltf", ".js", ".mjs", ".cjs"})
_SCRIPT_SUFFIXES = frozenset({".js", ".mjs", ".cjs"})
_UUID_HEX_STEM = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _norm_rel(p: str) -> str:
    return p.lstrip("/").replace("\\", "/")


def _is_script_promotion(rel: str, asset: ProjectAsset) -> bool:
    ext = Path(rel).suffix.lower()
    if ext not in _SCRIPT_SUFFIXES:
        return False
    if asset.assetKind == "gltf":
        return False
    return asset.assetKind == "script" or asset.assetKind is None


def _staging_dest_conflict(
    body: ProjectDocumentV2, dest_rel: str, my_asset_id: str, staged_paths_so_far: set[str]
) -> None:
    n = _norm_rel(dest_rel)
    if n in staged_paths_so_far:
        raise HTTPException(
            status_code=409,
            detail=f"multiple staged assets resolve to the same path '{dest_rel}'",
        )
    for other in body.assets:
        ore = _norm_rel(other.relativePath)
        if ore.startswith("_staging/"):
            continue
        if ore == n and other.assetId != my_asset_id:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"staging target '{dest_rel}' already used by asset {other.assetId}"
                ),
            )


def _normalize_assets_row(
    base: Path,
    a: ProjectAsset,
    body: ProjectDocumentV2,
    staged_so_far: set[str],
    referenced_final: set[str],
) -> tuple[ProjectAsset, str]:
    rel = _norm_rel(a.relativePath)
    disk = (base / rel).resolve()
    disk.relative_to(base)
    if not disk.is_file():
        raise HTTPException(status_code=400, detail=f"asset missing on disk: {rel}")
    ext = disk.suffix.lower()

    if ext in _SCRIPT_SUFFIXES and _is_script_promotion(rel, a):
        try:
            source_text = disk.read_text(encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"cannot read asset: {rel}") from e
        cn = primary_export_class_name(source_text)
        sn = sanitize_stem(cn) if cn else None

        if (
            sn
            and _UUID_HEX_STEM.fullmatch(Path(rel).stem)
            and _norm_rel(f"assets/{sn}{ext}") != rel
        ):
            new_rel = f"assets/{sn}{ext}"
            nk = _norm_rel(new_rel)
            if nk in referenced_final:
                raise HTTPException(
                    status_code=409,
                    detail=f"duplicate migrated script path '{new_rel}'",
                )
            _staging_dest_conflict(body, new_rel, a.assetId, staged_so_far)
            dest_disk = (base / new_rel).resolve()
            dest_disk.relative_to(base)
            if dest_disk.is_file() and dest_disk != disk:
                raise HTTPException(
                    status_code=409,
                    detail=f"cannot migrate script to occupied path '{new_rel}'",
                )
            if dest_disk != disk:
                shutil.move(str(disk), str(dest_disk))
            return (
                ProjectAsset(
                    assetId=a.assetId,
                    relativePath=new_rel,
                    name=None,
                    logicalFolder=a.logicalFolder,
                    assetKind="script",
                    scriptRole=a.scriptRole or "interaction",
                    interactionKind=a.interactionKind or "event",
                    scriptExports=[sn],
                ),
                new_rel,
            )

        exports_final: list[str] = [sn] if sn else (list(a.scriptExports) if a.scriptExports else [])
        return (
            ProjectAsset(
                assetId=a.assetId,
                relativePath=rel,
                name=None,
                logicalFolder=a.logicalFolder,
                assetKind="script",
                scriptRole=a.scriptRole or "interaction",
                interactionKind=a.interactionKind or "event",
                scriptExports=exports_final,
            ),
            rel,
        )

    return a, rel


def apply_and_persist_project(project_id: str, body: ProjectDocumentV2) -> ProjectDocumentV2:
    """
    Promote _staging scripts → ``assets/{ClassName}.{ext}`` (single exported class).
    Migrate legacy ``assets/{uuid}.{js|mjs|cjs}`` when the parse succeeds.
    glTF staging still uses ``assets/{assetId}.{ext}``.
    """
    try:
        base = project_dir(project_id).resolve()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    refs: set[str] = set()
    for n in body.scene.nodes:
        if n.assetRef:
            refs.add(n.assetRef)
        if n.sourceAssetRef:
            refs.add(n.sourceAssetRef)
        for att in n.interactionAttachments or []:
            refs.add(att.scriptAssetRef)
    cats = {a.assetId for a in body.assets}
    orphans_ref = refs - cats
    if orphans_ref:
        raise HTTPException(
            status_code=400,
            detail=f"scene references unknown asset ids (missing from assets[]): {sorted(orphans_ref)}",
        )

    staging = staging_dir(project_id)
    a_dir = assets_dir(project_id)
    staging.mkdir(parents=True, exist_ok=True)
    a_dir.mkdir(parents=True, exist_ok=True)

    with project_fs_lock(project_id):
        referenced_final: set[str] = set()
        normalized_assets: list[ProjectAsset] = []
        staged_paths_so_far: set[str] = set()

        for a in body.assets:
            rel = _norm_rel(a.relativePath)

            if rel.startswith("assets/"):
                out, final_rel = _normalize_assets_row(
                    base, a, body, staged_paths_so_far, referenced_final
                )
                normalized_assets.append(out)
                referenced_final.add(_norm_rel(final_rel))

            elif rel.startswith("_staging/"):
                src = (base / rel).resolve()
                try:
                    src.relative_to(base)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=f"invalid staging path: {rel}") from e
                if not src.is_file():
                    raise HTTPException(status_code=400, detail=f"staging file missing: {rel}")
                ext = src.suffix.lower()
                if ext not in _STAGING_ASSET_EXTENSIONS:
                    raise HTTPException(status_code=400, detail=f"invalid staging extension: {rel}")

                if ext in _SCRIPT_SUFFIXES and _is_script_promotion(rel, a):
                    try:
                        source_text = src.read_text(encoding="utf-8")
                    except OSError as e:
                        raise HTTPException(status_code=400, detail=f"cannot read staging: {rel}") from e
                    cn = primary_export_class_name(source_text)
                    if cn is None or sanitize_stem(cn) != cn:
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                "staging script must expose exactly one `export class Name` "
                                "(Unity-style)."
                            ),
                        )
                    dest_rel = f"assets/{cn}{ext}"
                    _staging_dest_conflict(body, dest_rel, a.assetId, staged_paths_so_far)
                    nk = _norm_rel(dest_rel)
                    if nk in referenced_final:
                        raise HTTPException(
                            status_code=409,
                            detail=f"duplicate script path '{dest_rel}' after earlier rows",
                        )
                    staged_paths_so_far.add(nk)

                    dest = base / dest_rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if dest.resolve().is_file() and dest.resolve() != src.resolve():
                        raise HTTPException(
                            status_code=409,
                            detail=f"staging target '{dest_rel}' already exists on disk",
                        )
                    shutil.move(str(src), str(dest))
                    normalized_assets.append(
                        ProjectAsset(
                            assetId=a.assetId,
                            relativePath=dest_rel,
                            name=None,
                            logicalFolder=a.logicalFolder,
                            assetKind="script",
                            scriptRole=a.scriptRole or "interaction",
                            interactionKind=a.interactionKind or "event",
                            scriptExports=[cn],
                        ),
                    )
                    referenced_final.add(dest_rel)
                else:
                    dest_rel = f"assets/{a.assetId}{ext}"
                    _staging_dest_conflict(body, dest_rel, a.assetId, staged_paths_so_far)

                    dest = base / dest_rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if dest.exists():
                        dest.unlink()
                    shutil.move(str(src), str(dest))
                    normalized_assets.append(
                        ProjectAsset(
                            assetId=a.assetId,
                            relativePath=dest_rel,
                            name=a.name,
                            logicalFolder=a.logicalFolder,
                            assetKind=a.assetKind,
                            scriptRole=a.scriptRole,
                            interactionKind=a.interactionKind,
                            scriptExports=a.scriptExports,
                        ),
                    )
                    referenced_final.add(dest_rel)
                    staged_paths_so_far.add(_norm_rel(dest_rel))

            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"relativePath must start with _staging/ or assets/: got {rel}",
                )

        for f in a_dir.iterdir():
            if not f.is_file():
                continue
            r = _norm_rel(f"assets/{f.name}")
            if r not in {_norm_rel(x) for x in referenced_final}:
                f.unlink()

        if staging.exists():
            for sf in staging.iterdir():
                if sf.is_file():
                    sf.unlink()

        out = ProjectDocumentV2(
            scene=body.scene,
            assets=normalized_assets,
            assetFolders=list(body.assetFolders or []),
            editorSettings=body.editorSettings,
        )
        project_json_path(project_id).write_text(out.model_dump_json(indent=2), encoding="utf-8")
        return out
