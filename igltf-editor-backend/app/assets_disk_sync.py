from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import uuid
from functools import partial
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError

from app.models import ProjectAsset, ProjectDocumentV2, SceneNode
from app.project_fs_lock import project_fs_lock
from app.projects_registry import touch_saved_metadata
from app.script_asset_naming import primary_export_class_name, sanitize_stem
from app.storage import assets_dir, project_dir, project_json_path
from app.version_info import ENGINE_VERSION

logger = logging.getLogger(__name__)

_UUID_HEX_STEM = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

_TRACKED_SUFFIXES = frozenset({".glb", ".gltf", ".js", ".mjs", ".cjs"})
_SCRIPT_SUFFIXES = frozenset({".js", ".mjs", ".cjs"})


def _norm_rel(rel: str) -> str:
    return rel.lstrip("/").replace("\\", "/")


def _script_fingerprint(asset_path: Path) -> tuple[float, int]:
    stat = asset_path.stat()
    return (stat.st_mtime, stat.st_size)


def _infer_asset_meta(
    rel: str,
) -> tuple[Literal["gltf", "script"], Literal["interaction", "behaviour"] | None, list[str] | None]:
    """Return (assetKind, scriptRole|None, scriptExports|None)."""
    suf = Path(rel).suffix.lower()
    if suf in _SCRIPT_SUFFIXES:
        return "script", "interaction", []
    return "gltf", None, None


def _scrub_scene_refs_removed_assets(doc: ProjectDocumentV2, removed_asset_ids: set[str]) -> bool:
    if not removed_asset_ids:
        return False
    mutated = False

    nodes: list[SceneNode] = []
    for n in doc.scene.nodes:
        patched = False
        n2_dict = n.model_dump()
        if n2_dict.get("assetRef") and n2_dict["assetRef"] in removed_asset_ids:
            n2_dict["assetRef"] = None
            patched = True
        if n2_dict.get("sourceAssetRef") and n2_dict["sourceAssetRef"] in removed_asset_ids:
            n2_dict["sourceAssetRef"] = None
            n2_dict["sourceGltfNodeIndex"] = None
            n2_dict["sourcePlacementId"] = None
            patched = True
        if n2_dict.get("interactionScriptAssetRef") and n2_dict["interactionScriptAssetRef"] in removed_asset_ids:
            n2_dict["interactionScriptAssetRef"] = None
            patched = True
        atts = n2_dict.get("interactionAttachments") or []
        if atts:
            kept = [a for a in atts if a.get("scriptAssetRef") not in removed_asset_ids]
            if len(kept) != len(atts):
                n2_dict["interactionAttachments"] = kept or None
                patched = True
        if patched:
            mutated = True
            nodes.append(SceneNode.model_validate(n2_dict))
        else:
            nodes.append(n)

    doc.scene.nodes = nodes
    return mutated


def _scrub_script_dep_refs_removed_assets(doc: ProjectDocumentV2, removed_asset_ids: set[str]) -> bool:
    """Drop removed asset ids from ``scriptDependsOnAssetIds`` on remaining script rows."""
    if not removed_asset_ids:
        return False
    mutated = False
    new_assets: list[ProjectAsset] = []
    for a in doc.assets:
        deps = a.scriptDependsOnAssetIds
        if not deps:
            new_assets.append(a)
            continue
        kept = [x for x in deps if x not in removed_asset_ids]
        if len(kept) != len(deps):
            mutated = True
            patch = a.model_dump()
            patch["scriptDependsOnAssetIds"] = kept or None
            new_assets.append(ProjectAsset.model_validate(patch))
        else:
            new_assets.append(a)
    if mutated:
        doc.assets = new_assets
    return mutated


def _fingerprints_script_assets(doc: ProjectDocumentV2, workspace: Path) -> dict[str, tuple[float, int]]:
    out: dict[str, tuple[float, int]] = {}
    root = workspace.resolve()
    for a in doc.assets:
        rel = _norm_rel(a.relativePath)
        if not rel.startswith("assets/"):
            continue
        suf = Path(rel).suffix.lower()
        if suf not in _SCRIPT_SUFFIXES:
            continue
        p = (root / rel).resolve()
        try:
            p.relative_to(root)
        except ValueError:
            continue
        if p.is_file():
            out[a.assetId] = _script_fingerprint(p)
        else:
            out[a.assetId] = (0.0, 0)
    return out


def sync_assets_from_disk_locked(project_id: str) -> list[dict[str, Any]]:
    """
    Catalogue merge for top-level files under workspace ``assets/``.
    Writes ``project.json`` only when catalogue content or scrubbed refs change (not plain script edits).
    """
    with project_fs_lock(project_id):
        return _sync_assets_from_disk_inner(project_id)


def _sync_assets_from_disk_inner(project_id: str) -> list[dict[str, Any]]:
    pj = project_json_path(project_id)
    if not pj.is_file():
        return []

    try:
        doc = ProjectDocumentV2.model_validate_json(pj.read_text(encoding="utf-8"))
    except (ValidationError, json.JSONDecodeError, OSError) as e:
        logger.warning("disk sync skipped: invalid project.json for %s: %s", project_id, e)
        return []

    base = project_dir(project_id).resolve()
    adir = assets_dir(project_id)
    adir.mkdir(parents=True, exist_ok=True)

    before_fp = _fingerprints_script_assets(doc, base)
    events: list[dict[str, Any]] = []
    needs_write = False

    removed_ids: set[str] = set()
    stale_rows: list[ProjectAsset] = []
    for a in doc.assets:
        rel = _norm_rel(a.relativePath)
        suf = Path(rel).suffix.lower()
        if suf not in _TRACKED_SUFFIXES:
            continue
        if not rel.startswith("assets/"):
            continue
        disk = (base / rel).resolve()
        try:
            disk.relative_to(base)
        except ValueError:
            continue
        if not disk.is_file():
            stale_rows.append(a)

    if stale_rows:
        for x in stale_rows:
            removed_ids.add(x.assetId)
            events.append({"type": "asset_removed", "assetId": x.assetId, "relativePath": _norm_rel(x.relativePath)})
        doc.assets = [a for a in doc.assets if a.assetId not in removed_ids]
        needs_write = True
        _scrub_scene_refs_removed_assets(doc, removed_ids)
        _scrub_script_dep_refs_removed_assets(doc, removed_ids)

    ref_paths = {_norm_rel(a.relativePath) for a in doc.assets}
    known_asset_ids = {a.assetId for a in doc.assets}

    for src in sorted(adir.iterdir(), key=lambda p: p.name.lower()):
        if not src.is_file():
            continue
        suf = src.suffix.lower()
        if suf not in _TRACKED_SUFFIXES:
            continue
        fname = src.name
        rel_key = f"assets/{fname}"
        if rel_key in ref_paths:
            continue

        stem = src.stem
        human_stem = stem
        human_suf = src.suffix
        kind_val, sr_val, sx_val = _infer_asset_meta(rel_key)

        if _UUID_HEX_STEM.fullmatch(stem):
            asset_id = stem.lower()
            canon_name = f"{asset_id}{suf}"
            dest = adir / canon_name
            if asset_id in known_asset_ids:
                continue
            if kind_val == "script":
                try:
                    cn = primary_export_class_name(src.read_text(encoding="utf-8"))
                except OSError:
                    cn = None
                sn = sanitize_stem(cn) if cn else None
                if sn:
                    class_fname = f"{sn}{human_suf}"
                    class_dest = adir / class_fname
                    tgt_rel = f"assets/{class_fname}"
                    path_free = tgt_rel not in ref_paths and (
                        not class_dest.exists() or src.resolve() == class_dest.resolve()
                    )
                    if path_free:
                        if src.resolve() != class_dest.resolve():
                            shutil.move(str(src), str(class_dest))
                        rel_final = tgt_rel
                        entry = ProjectAsset(
                            assetId=asset_id,
                            relativePath=rel_final,
                            name=None,
                            assetKind="script",
                            scriptRole=sr_val,
                            interactionKind="event",
                            scriptExports=[sn],
                        )
                        evt_prior = {
                            "type": "asset_added",
                            "assetId": asset_id,
                            "relativePath": rel_final,
                        }
                        doc.assets = [*doc.assets, entry]
                        ref_paths.add(rel_final)
                        known_asset_ids.add(asset_id)
                        needs_write = True
                        events.append(evt_prior)
                        continue
            if src.resolve() != dest.resolve():
                if dest.exists() and dest.resolve() != src.resolve():
                    dest.unlink(missing_ok=True)
                shutil.move(str(src), str(dest))
            rel_final = f"assets/{canon_name}"
            entry = ProjectAsset(
                assetId=asset_id,
                relativePath=rel_final,
                name=None,
                assetKind=kind_val,
                scriptRole=sr_val,
                interactionKind=None if kind_val != "script" else "event",
                scriptExports=sx_val,
            )
            evt_prior = {
                "type": "asset_added",
                "assetId": asset_id,
                "relativePath": rel_final,
            }
        elif kind_val == "script":
            asset_id = str(uuid.uuid4())
            try:
                cn = primary_export_class_name(src.read_text(encoding="utf-8"))
            except OSError as e:
                logger.warning("disk sync script read failed %s: %s", src, e)
                continue
            sn = sanitize_stem(cn) if cn else None
            if not sn:
                dest_fname = f"{asset_id}{suf}"
                dest = adir / dest_fname
                shutil.move(str(src), str(dest))
                rel_final = f"assets/{dest_fname}"
                entry = ProjectAsset(
                    assetId=asset_id,
                    relativePath=rel_final,
                    name=None,
                    assetKind=kind_val,
                    scriptRole=sr_val,
                    interactionKind=None if kind_val != "script" else "event",
                    scriptExports=[],
                )
                evt_prior = {
                    "type": "asset_added",
                    "assetId": asset_id,
                    "relativePath": rel_final,
                    "priorNameOnDisk": f"{human_stem}{human_suf}",
                }
            else:
                class_fname = f"{sn}{human_suf}"
                dest = adir / class_fname
                tgt_rel = f"assets/{class_fname}"
                if tgt_rel in ref_paths or (dest.exists() and dest.resolve() != src.resolve()):
                    logger.warning(
                        "disk sync skip orphan script (%s): path %s taken",
                        f"{human_stem}{human_suf}",
                        tgt_rel,
                    )
                    continue
                shutil.move(str(src), str(dest))
                rel_final = tgt_rel
                entry = ProjectAsset(
                    assetId=asset_id,
                    relativePath=rel_final,
                    name=None,
                    assetKind="script",
                    scriptRole=sr_val,
                    interactionKind="event",
                    scriptExports=[sn],
                )
                evt_prior = {
                    "type": "asset_added",
                    "assetId": asset_id,
                    "relativePath": rel_final,
                    "priorNameOnDisk": f"{human_stem}{human_suf}",
                }
        else:
            asset_id = str(uuid.uuid4())
            dest_fname = f"{asset_id}{suf}"
            dest = adir / dest_fname
            shutil.move(str(src), str(dest))
            rel_final = f"assets/{dest_fname}"
            entry = ProjectAsset(
                assetId=asset_id,
                relativePath=rel_final,
                name=human_stem,
                assetKind=kind_val,
                scriptRole=sr_val,
                interactionKind=None,
                scriptExports=sx_val,
            )
            evt_prior = {
                "type": "asset_added",
                "assetId": asset_id,
                "relativePath": rel_final,
                "priorNameOnDisk": f"{human_stem}{human_suf}",
            }

        doc.assets = [*doc.assets, entry]
        ref_paths.add(rel_final)
        known_asset_ids.add(asset_id)
        needs_write = True
        events.append(evt_prior)

    after_fp = _fingerprints_script_assets(doc, base)
    for aid, meta_after in after_fp.items():
        if aid in removed_ids:
            continue
        meta_before = before_fp.get(aid)
        if meta_before is None:
            continue
        if meta_before != meta_after:
            a = next((x for x in doc.assets if x.assetId == aid), None)
            rel_final = _norm_rel(a.relativePath) if a else ""
            events.append({"type": "script_content_changed", "assetId": aid, "relativePath": rel_final})

    if needs_write:
        pj.write_text(doc.model_dump_json(indent=2), encoding="utf-8")
        try:
            touch_saved_metadata(project_id, engine_version=ENGINE_VERSION)
        except ValueError:
            logger.debug("touch_saved_metadata skipped (unknown registry id %s)", project_id)

    return events


async def sync_assets_from_disk_async(project_id: str) -> list[dict[str, Any]]:
    loop = asyncio.get_running_loop()
    fn = partial(sync_assets_from_disk_locked, project_id)
    return await loop.run_in_executor(None, fn)
