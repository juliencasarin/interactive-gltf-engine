from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import HTTPException

from app.models import ProjectAsset, ProjectDocumentV2
from app.storage import assets_dir, project_dir, project_json_path, staging_dir


def _norm_rel(p: str) -> str:
    return p.lstrip("/").replace("\\", "/")


def apply_and_persist_project(project_id: str, body: ProjectDocumentV2) -> ProjectDocumentV2:
    """
    Promote _staging/* → assets/{assetId}.*, delete asset files not listed in body.assets,
    clear _staging, write normalized project.json.
    """
    try:
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    refs = {n.assetRef for n in body.scene.nodes if n.assetRef}
    cats = {a.assetId for a in body.assets}
    orphans = refs - cats
    if orphans:
        raise HTTPException(
            status_code=400,
            detail=f"scene references unknown asset ids (missing from assets[]): {sorted(orphans)}",
        )

    staging = staging_dir(project_id)
    a_dir = assets_dir(project_id)
    staging.mkdir(parents=True, exist_ok=True)
    a_dir.mkdir(parents=True, exist_ok=True)

    referenced_final: set[str] = set()
    normalized_assets: list[ProjectAsset] = []

    for a in body.assets:
        rel = _norm_rel(a.relativePath)
        if rel.startswith("_staging/"):
            src = (base / rel).resolve()
            try:
                src.relative_to(base.resolve())
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"invalid staging path: {rel}") from e
            if not src.is_file():
                raise HTTPException(status_code=400, detail=f"staging file missing: {rel}")
            ext = src.suffix.lower()
            if ext not in (".glb", ".gltf"):
                raise HTTPException(status_code=400, detail=f"invalid staging extension: {rel}")
            dest_rel = f"assets/{a.assetId}{ext}"
            dest = base / dest_rel
            if dest.exists():
                dest.unlink()
            shutil.move(str(src), str(dest))
            normalized_assets.append(
                ProjectAsset(
                    assetId=a.assetId,
                    relativePath=dest_rel,
                    name=a.name,
                    logicalFolder=a.logicalFolder,
                ),
            )
            referenced_final.add(dest_rel)
        elif rel.startswith("assets/"):
            disk = base / rel
            try:
                disk.resolve().relative_to(base.resolve())
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"invalid asset path: {rel}") from e
            if not disk.is_file():
                raise HTTPException(status_code=400, detail=f"asset missing on disk: {rel}")
            normalized_assets.append(a)
            referenced_final.add(rel)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"relativePath must start with _staging/ or assets/: got {rel}",
            )

    for f in a_dir.iterdir():
        if not f.is_file():
            continue
        rel = f"assets/{f.name}"
        if rel not in referenced_final:
            f.unlink()

    if staging.exists():
        for f in staging.iterdir():
            if f.is_file():
                f.unlink()

    out = ProjectDocumentV2(
        scene=body.scene,
        assets=normalized_assets,
        assetFolders=list(body.assetFolders or []),
    )
    project_json_path(project_id).write_text(out.model_dump_json(indent=2), encoding="utf-8")
    return out
