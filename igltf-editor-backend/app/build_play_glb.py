"""Merge editor scene into ``build/scene.glb`` (geometry merge + prototype interaction extension)."""

from __future__ import annotations

import copy
import math
from pathlib import Path

from fastapi import HTTPException
from pygltflib import GLTF2, Node, Scene

from app.gltf_merge import merge_embedded_glb_into
from app.igltf_umi3d_proto import (
    EXT_IGLTF_UMI3D_PROTO,
    interaction_kind_str,
    script_handler_id,
    umi3d_proto_attachment_entry,
    umi3d_proto_node_extension,
)
from app.models import InteractionScriptAttachment, ProjectDocumentV2, SceneNode
from app.storage import project_dir, project_json_path


def _euler_xyz_three_js_to_quaternion(rx: float, ry: float, rz: float) -> list[float]:
    """Radian Euler XYZ (Three.js default) → glTF quaternion [x, y, z, w]."""
    c1, c2, c3 = math.cos(rx / 2), math.cos(ry / 2), math.cos(rz / 2)
    s1, s2, s3 = math.sin(rx / 2), math.sin(ry / 2), math.sin(rz / 2)
    qx = s1 * c2 * c3 + c1 * s2 * s3
    qy = c1 * s2 * c3 - s1 * c2 * s3
    qz = c1 * c2 * s3 + s1 * s2 * c3
    qw = c1 * c2 * c3 - s1 * s2 * s3
    return [qx, qy, qz, qw]


def _optional_translation(position: list[float]) -> list[float] | None:
    if all(abs(x) < 1e-12 for x in position):
        return None
    return list(position)


def _optional_rotation(rotation_rad: list[float]) -> list[float] | None:
    rx, ry, rz = rotation_rad
    if abs(rx) < 1e-12 and abs(ry) < 1e-12 and abs(rz) < 1e-12:
        return None
    return _euler_xyz_three_js_to_quaternion(rx, ry, rz)


def _optional_scale(scale: list[float]) -> list[float] | None:
    if all(abs(s - 1.0) < 1e-12 for s in scale):
        return None
    return list(scale)


def _cm_idx(row: int, col: int) -> int:
    return col * 4 + row


def _mat4_identity_cm() -> list[float]:
    return [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]


def _mat4_mul_cm(a: list[float], b: list[float]) -> list[float]:
    """4×4 column-major multiply: ``(a @ b)`` applied as ``a(b v)``."""

    def get(m: list[float], r: int, c: int) -> float:
        return m[_cm_idx(r, c)]

    out = [0.0] * 16
    for r in range(4):
        for c in range(4):
            out[_cm_idx(r, c)] = sum(get(a, r, k) * get(b, k, c) for k in range(4))
    return out


def _trs_to_mat4_cm(t: list[float], q: list[float], s: list[float]) -> list[float]:
    """glTF local TRS → column-major 4×4 (``T * R * S``)."""
    x, y, z, w = q
    sx, sy, sz = s
    tx, ty, tz = t

    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z

    r00 = 1.0 - 2.0 * (yy + zz)
    r01 = 2.0 * (xy + wz)
    r02 = 2.0 * (xz - wy)
    r10 = 2.0 * (xy - wz)
    r11 = 1.0 - 2.0 * (xx + zz)
    r12 = 2.0 * (yz + wx)
    r20 = 2.0 * (xz + wy)
    r21 = 2.0 * (yz - wx)
    r22 = 1.0 - 2.0 * (xx + yy)

    # Column-major for R * S
    m = [0.0] * 16
    m[_cm_idx(0, 0)] = r00 * sx
    m[_cm_idx(1, 0)] = r10 * sx
    m[_cm_idx(2, 0)] = r20 * sx
    m[_cm_idx(0, 1)] = r01 * sy
    m[_cm_idx(1, 1)] = r11 * sy
    m[_cm_idx(2, 1)] = r21 * sy
    m[_cm_idx(0, 2)] = r02 * sz
    m[_cm_idx(1, 2)] = r12 * sz
    m[_cm_idx(2, 2)] = r22 * sz
    m[_cm_idx(3, 3)] = 1.0

    # Multiply on left by translation T
    t_mat = _mat4_identity_cm()
    t_mat[_cm_idx(0, 3)] = tx
    t_mat[_cm_idx(1, 3)] = ty
    t_mat[_cm_idx(2, 3)] = tz
    return _mat4_mul_cm(t_mat, m)


def _default_scene_root_indices(gltf: GLTF2) -> list[int]:
    if not gltf.scenes or not gltf.nodes:
        return []
    si = 0 if gltf.scene is None else gltf.scene
    if si >= len(gltf.scenes):
        return []
    return list(gltf.scenes[si].nodes or [])


def _reachable_nodes_preorder(gltf: GLTF2) -> list[int]:
    """All node indices reachable from the default scene roots, preorder DFS."""
    roots = _default_scene_root_indices(gltf)
    seen: set[int] = set()
    out: list[int] = []

    def dfs(i: int) -> None:
        if i < 0 or i >= len(gltf.nodes) or i in seen:
            return
        seen.add(i)
        out.append(i)
        for c in gltf.nodes[i].children or []:
            dfs(c)

    for r in roots:
        dfs(r)
    return out


def _placed_catalog_instance_node_count(src: GLTF2) -> int:
    visit = _reachable_nodes_preorder(src)
    roots = _default_scene_root_indices(src)
    wrapper = 1 if len(roots) > 1 else 0
    return 1 + wrapper + len(visit)


def mesh_count_under_default_scene(gltf: GLTF2) -> int:
    """Number of nodes with ``mesh`` set under the default scene graph."""

    def sub(idx: int) -> int:
        n = gltf.nodes[idx]
        t = 1 if n.mesh is not None else 0
        for c in n.children or []:
            t += sub(c)
        return t

    return sum(sub(r) for r in _default_scene_root_indices(gltf))


def _validate_catalog_clone_source(label: str, gltf: GLTF2) -> None:
    visit = _reachable_nodes_preorder(gltf)
    if not visit:
        raise HTTPException(status_code=400, detail=f"{label}: empty default scene graph")
    if not any(gltf.nodes[i].mesh is not None for i in visit):
        raise HTTPException(status_code=400, detail=f"{label}: no mesh in default scene")
    for i in visit:
        if gltf.nodes[i].skin is not None:
            raise HTTPException(
                status_code=400,
                detail=f"{label}: skinned meshes are not supported in export yet (node {i})",
            )


def _clone_source_node(sn: Node, mesh_base: int) -> Node:
    """Copy TRS/matrix/mesh from a source node; drop ``camera`` / ``skin`` (invalid after merge)."""
    kw: dict = {}
    if sn.matrix is not None and len(sn.matrix) == 16:
        kw["matrix"] = [float(x) for x in sn.matrix]
    else:
        if sn.translation is not None:
            kw["translation"] = [float(x) for x in sn.translation]
        if sn.rotation is not None:
            kw["rotation"] = [float(x) for x in sn.rotation]
        if sn.scale is not None:
            kw["scale"] = [float(x) for x in sn.scale]
    if sn.mesh is not None:
        kw["mesh"] = int(sn.mesh) + mesh_base
    if sn.name:
        kw["name"] = sn.name
    return Node(**kw)


def _build_placed_catalog_nodes(
    src: GLTF2,
    mesh_base: int,
    outer_kw: dict,
    *,
    base_index: int,
) -> list[Node]:
    """Emit ``outer`` (editor TRS) plus a clone of the default scene subgraph (preorder)."""
    visit = _reachable_nodes_preorder(src)
    roots = _default_scene_root_indices(src)
    old_to_local = {old: i for i, old in enumerate(visit)}
    multi = len(roots) > 1

    clone_base = base_index + (2 if multi else 1)
    clones: list[Node] = []
    for old in visit:
        sn = src.nodes[old]
        clone = _clone_source_node(sn, mesh_base)
        clone.children = [clone_base + old_to_local[c] for c in (sn.children or [])]
        clones.append(clone)

    outer = Node(**outer_kw)
    chunk: list[Node] = [outer]
    if multi:
        chunk.append(Node(children=[clone_base + old_to_local[r] for r in roots]))
    chunk.extend(clones)

    outer.children = [base_index + 1 if multi else clone_base + old_to_local[roots[0]]]
    return chunk


def _scene_node_attachments(enode: SceneNode) -> list[InteractionScriptAttachment]:
    merged = list(enode.interactionAttachments or [])
    if enode.interactionScriptAssetRef:
        merged.append(
            InteractionScriptAttachment(
                id="legacy-single",
                scriptAssetRef=enode.interactionScriptAssetRef,
                serializedProps=enode.interactionSerializedProps,
            )
        )
    return merged


def build_scene_to_play_glb(project_id: str) -> Path:
    """
    Read persisted ``project.json``, emit ``build/scene.glb``.

    MVP rules mirror prior ``test.glb`` output; path is now under ``build/``.
    - Scene nodes may reference multiple catalog ``.glb`` assets; resources are merged into one buffer.
    - Each placement applies editor TRS on an outer node; the **full default scene subgraph** of that
      catalog asset (all meshes / hierarchy, multiple scene roots grouped when needed) is cloned under it.
    - Editor rotations use radian Euler XYZ (Three.js-style), encoded as glTF quaternions on outer nodes.
    - Interaction script attachments are serialized under ``nodes[i].extensions[EXT_IGLTF_UMI3D_PROTO]``
      (prototype UMI3D-shaped payload); see ``docs/umi3d-proto-extension-alignment.md``.
    """
    try:
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    pj = project_json_path(project_id)
    if not pj.is_file():
        raise HTTPException(status_code=400, detail="project.json missing — save the project first")

    try:
        doc = ProjectDocumentV2.model_validate_json(pj.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"invalid project.json: {e}") from e

    glb_paths_by_asset: dict[str, Path] = {}
    for a in doc.assets:
        suf = Path(a.relativePath).suffix.lower()
        if suf != ".glb":
            continue
        disk = (base / a.relativePath).resolve()
        try:
            disk.relative_to(base.resolve())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"invalid asset path: {a.relativePath}") from e
        if not disk.is_file():
            raise HTTPException(status_code=400, detail=f"missing .glb file: {a.relativePath}")
        glb_paths_by_asset[a.assetId] = disk

    targets = [n for n in doc.scene.nodes if n.assetRef and n.assetRef in glb_paths_by_asset]
    if not targets:
        raise HTTPException(
            status_code=400,
            detail="no scene node references a catalog .glb asset — add a model from Assets",
        )

    distinct_paths = sorted({glb_paths_by_asset[t.assetRef] for t in targets}, key=lambda p: str(p.resolve()))

    gltf_by_path: dict[Path, GLTF2] = {}
    for p in distinct_paths:
        try:
            gltf_by_path[p] = GLTF2().load_binary(str(p))
        except (OSError, ValueError) as e:
            raise HTTPException(status_code=500, detail=f"failed to load glb {p.name}: {e}") from e

    for p, gltf in gltf_by_path.items():
        _validate_catalog_clone_source(p.name, gltf)

    combined = copy.deepcopy(gltf_by_path[distinct_paths[0]])
    combined.animations = []
    mesh_base_by_path: dict[Path, int] = {distinct_paths[0]: 0}

    for p in distinct_paths[1:]:
        mesh_base_by_path[p] = len(combined.meshes or [])
        try:
            merge_embedded_glb_into(combined, gltf_by_path[p])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    nodes_by_id = {n.id: n for n in doc.scene.nodes}
    doc_order = {n.id: i for i, n in enumerate(doc.scene.nodes)}

    def depth_from_root(nid: str) -> int:
        d = 0
        cur: str | None = nid
        while cur:
            parent = nodes_by_id[cur].parentId
            if parent is None:
                break
            d += 1
            cur = parent
        return d

    needed_ids: set[str] = set()
    for t in targets:
        cur: str | None = t.id
        while cur:
            needed_ids.add(cur)
            cur = nodes_by_id[cur].parentId

    ordered_ids = sorted(needed_ids, key=lambda nid: (depth_from_root(nid), doc_order[nid]))

    roots = [nodes_by_id[nid] for nid in ordered_ids if nodes_by_id[nid].parentId not in needed_ids]
    if len(roots) != 1:
        raise HTTPException(
            status_code=400,
            detail="expected a single scene root spanning all placed models — check node parenting",
        )

    out = combined
    assert out.nodes is not None

    start = len(out.nodes)

    def is_mesh_instance(enode_id: str) -> bool:
        en = nodes_by_id[enode_id]
        return bool(en.assetRef and en.assetRef in glb_paths_by_asset)

    cursor = start
    idx_outer: dict[str, int] = {}
    for eid in ordered_ids:
        idx_outer[eid] = cursor
        cursor += (
            _placed_catalog_instance_node_count(gltf_by_path[glb_paths_by_asset[nodes_by_id[eid].assetRef]])
            if is_mesh_instance(eid)
            else 1
        )

    new_nodes: list[Node] = []
    for eid in ordered_ids:
        enode = nodes_by_id[eid]
        child_ids = [
            c.id
            for c in doc.scene.nodes
            if c.parentId == enode.id and c.id in needed_ids
        ]
        child_indices = [idx_outer[cid] for cid in child_ids]

        raw_outer: dict = {
            "translation": _optional_translation(enode.position),
            "rotation": _optional_rotation(enode.rotation),
            "scale": _optional_scale(enode.scale),
        }

        if is_mesh_instance(eid):
            asset_path = glb_paths_by_asset[nodes_by_id[eid].assetRef]
            outer_kw = {k: v for k, v in raw_outer.items() if v is not None}
            base_index = len(out.nodes) + len(new_nodes)
            chunk = _build_placed_catalog_nodes(
                gltf_by_path[asset_path],
                mesh_base_by_path[asset_path],
                outer_kw,
                base_index=base_index,
            )
            new_nodes.extend(chunk)
        else:
            if child_indices:
                raw_outer["children"] = child_indices
            new_nodes.append(Node(**{k: v for k, v in raw_outer.items() if v is not None}))

    out.nodes.extend(new_nodes)

    assets_by_id = {a.assetId: a for a in doc.assets}
    ext_any = False
    for nid in needed_ids:
        enode = nodes_by_id[nid]
        att_list = _scene_node_attachments(enode)
        if not att_list:
            continue
        entries: list[dict] = []
        gltf_idx = idx_outer[nid]
        for att in att_list:
            pa = assets_by_id.get(att.scriptAssetRef)
            if pa is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"scene node {enode.name!r} references unknown script asset {att.scriptAssetRef}",
                )
            rel = pa.relativePath.replace("\\", "/")
            merged_props = dict(att.serializedProps or {})
            merged_props.setdefault("targetId", str(gltf_idx))
            entries.append(
                umi3d_proto_attachment_entry(
                    attachment_id=att.id,
                    script_asset_ref=att.scriptAssetRef,
                    script_relative_path=rel,
                    script_handler_id=script_handler_id(pa),
                    interaction_kind=interaction_kind_str(pa),
                    serialized_props=merged_props,
                )
            )
        node = out.nodes[gltf_idx]
        if node.extensions is None:
            node.extensions = {}
        node.extensions[EXT_IGLTF_UMI3D_PROTO] = umi3d_proto_node_extension(gltf_idx, entries)
        ext_any = True

    if ext_any:
        if out.extensionsUsed is None:
            out.extensionsUsed = []
        if EXT_IGLTF_UMI3D_PROTO not in out.extensionsUsed:
            out.extensionsUsed.append(EXT_IGLTF_UMI3D_PROTO)

    scene_root_idx = idx_outer[roots[0].id]
    out.scenes = [Scene(nodes=[scene_root_idx])]
    out.scene = 0

    build_dir = base / "build"
    build_dir.mkdir(parents=True, exist_ok=True)
    out_path = build_dir / "scene.glb"
    try:
        out.save_binary(str(out_path))
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"failed to write build/scene.glb: {e}") from e

    return out_path
