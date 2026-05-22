"""Merge editor scene into ``build/scene.glb`` (geometry merge + prototype interaction extension)."""

from __future__ import annotations

import copy
import math
from pathlib import Path

from fastapi import HTTPException
from pygltflib import GLTF2, Node, Scene

from app.gltf_merge import merge_embedded_glb_into
from app.build_scene_js import write_scene_js_bundle
from app.interactive_gltf_ext import EXT_INTERACTIVE_GLTF, interactive_gltf_root_extension_value
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


def _sorted_scene_child_ids(
    scene_nodes: list[SceneNode], parent_id: str, doc_order: dict[str, int]
) -> list[str]:
    ch = [n.id for n in scene_nodes if n.parentId == parent_id]
    return sorted(ch, key=lambda i: doc_order.get(i, 0))


def _preorder_editor_subtree(scene_nodes: list[SceneNode], root_id: str, doc_order: dict[str, int]) -> list[str]:
    out: list[str] = []

    def walk(eid: str) -> None:
        out.append(eid)
        for cid in _sorted_scene_child_ids(scene_nodes, eid, doc_order):
            walk(cid)

    walk(root_id)
    return out


def _catalogue_placement_ancestor_id(
    nodes_by_id: dict[str, SceneNode], start_parent_id: str | None, catalogue_asset_id: str
) -> str | None:
    """First ancestor row (walking parentId) with ``assetRef == catalogue_asset_id``."""
    cur = start_parent_id
    while cur:
        row = nodes_by_id.get(cur)
        if row is None:
            return None
        if row.assetRef == catalogue_asset_id:
            return row.id
        cur = row.parentId
    return None


def _mirror_host_placement_id(sn: SceneNode, nodes_by_id: dict[str, SceneNode]) -> str | None:
    """Stable catalogue placement owning mesh data for a mirror row (explicit or implicit upward walk)."""

    idx = sn.sourceGltfNodeIndex
    if idx is None or sn.sourceAssetRef is None:
        return None
    if sn.sourcePlacementId:
        p = nodes_by_id.get(sn.sourcePlacementId)
        if p is not None and p.assetRef == sn.sourceAssetRef:
            return p.id
    return _catalogue_placement_ancestor_id(nodes_by_id, sn.parentId, sn.sourceAssetRef)


def _list_interior_mirrors_hosted_by(
    scene_nodes: list[SceneNode],
    placement_id: str,
    catalog_asset_ref: str,
    nodes_by_id: dict[str, SceneNode],
) -> list[SceneNode]:
    out: list[SceneNode] = []
    doc_ix = {n.id: i for i, n in enumerate(scene_nodes)}
    for n in scene_nodes:
        if n.sourceAssetRef != catalog_asset_ref:
            continue
        if n.sourceGltfNodeIndex is None:
            continue
        if _mirror_host_placement_id(n, nodes_by_id) == placement_id:
            out.append(n)
    out.sort(key=lambda x: (doc_ix.get(x.id, 1_000_000_000), x.id))
    return out


def _placement_has_expanded_interior(
    scene_nodes: list[SceneNode],
    placement_id: str,
    placement_asset_ref: str,
    nodes_by_id: dict[str, SceneNode],
) -> bool:
    """True when at least one authored mirror resolves to ``placement_id``."""

    return bool(
        _list_interior_mirrors_hosted_by(scene_nodes, placement_id, placement_asset_ref, nodes_by_id),
    )


def _validate_expanded_interior(
    *,
    placement: SceneNode,
    scene_nodes: list[SceneNode],
    src_label: str,
    src: GLTF2,
    nodes_by_id: dict[str, SceneNode],
) -> None:
    """Ensure mirrored rows resolve to ``placement.assetRef`` and reference valid static nodes."""

    assert placement.assetRef is not None
    cat = placement.assetRef
    mirrors = _list_interior_mirrors_hosted_by(scene_nodes, placement.id, cat, nodes_by_id)
    nn = len(src.nodes or [])
    for n in mirrors:
        idx = n.sourceGltfNodeIndex
        if idx is None:
            continue
        if n.sourceAssetRef is None or n.sourceAssetRef != cat:
            raise HTTPException(
                status_code=400,
                detail=f"{src_label}: expanded node {n.name!r} must set sourceAssetRef to placement catalogue",
            )
        if idx < 0 or idx >= nn:
            raise HTTPException(status_code=400, detail=f"{src_label}: invalid sourceGltfNodeIndex on {n.name!r}")
        gn = src.nodes[idx]
        if gn.skin is not None:
            raise HTTPException(status_code=400, detail=f"{src_label}: skin not supported on interior node index {idx}")


def _gltf_node_local_mat4_cm(sn: Node) -> list[float]:
    if sn.matrix is not None and len(sn.matrix) == 16:
        return [float(x) for x in sn.matrix]
    t = (
        [float(sn.translation[i]) for i in range(3)]
        if sn.translation is not None
        else [0.0, 0.0, 0.0]
    )
    r_default = [0.0, 0.0, 0.0, 1.0]
    rvals = (
        [float(sn.rotation[i]) for i in range(4)] if sn.rotation is not None else r_default.copy()
    )
    svals = ([float(sn.scale[i]) for i in range(3)] if sn.scale is not None else [1.0, 1.0, 1.0])
    return _trs_to_mat4_cm(t, rvals, svals)


def _editor_delta_mat4_cm(enode: SceneNode) -> list[float]:
    t = enode.position
    q = _euler_xyz_three_js_to_quaternion(float(enode.rotation[0]), float(enode.rotation[1]), float(enode.rotation[2]))
    return _trs_to_mat4_cm(t, q, enode.scale)


def _emit_interior_mirror_clone_node(
    enf: SceneNode,
    *,
    src: GLTF2,
    mesh_base: int,
    child_gl_indices: list[int],
) -> Node:
    idx = enf.sourceGltfNodeIndex
    assert idx is not None and idx >= 0
    si = int(idx)
    sn = src.nodes[si]
    m_src = _gltf_node_local_mat4_cm(sn)
    m_delta = _editor_delta_mat4_cm(enf)
    m_fin = _mat4_mul_cm(m_delta, m_src)
    nm = enf.name or (sn.name or f"node_{si}")
    out_n = Node(matrix=[float(x) for x in m_fin], children=child_gl_indices, name=str(nm))
    if sn.mesh is not None:
        out_n.mesh = int(sn.mesh) + mesh_base
    return out_n


def _extend_needed_ids_for_interior_mirrors(
    scene_nodes: list[SceneNode],
    needed_ids: set[str],
    *,
    nodes_by_id: dict[str, SceneNode],
    glb_paths_by_asset: dict[str, Path],
) -> None:
    """Pull detached mirror chains into ``needed_ids`` until they intersect an existing authoring row."""

    for n in scene_nodes:
        if n.sourceGltfNodeIndex is None or not n.sourceAssetRef:
            continue
        hid = _mirror_host_placement_id(n, nodes_by_id)
        if hid is None:
            continue
        hp = nodes_by_id.get(hid)
        if hp is None or hp.assetRef is None or hp.assetRef not in glb_paths_by_asset:
            continue
        if not _placement_has_expanded_interior(scene_nodes, hid, hp.assetRef, nodes_by_id):
            continue
        cur: str | None = n.id
        while cur is not None:
            if cur in needed_ids:
                break
            needed_ids.add(cur)
            cur = nodes_by_id[cur].parentId


def _build_expanded_placement_nodes(
    *,
    scene_nodes: list[SceneNode],
    placement_id: str,
    placement_asset_ref: str,
    src: GLTF2,
    mesh_base: int,
    block_base: int,
    nodes_by_id: dict[str, SceneNode],
    doc_order: dict[str, int],
) -> tuple[list[Node], dict[str, int]]:
    """Emit one glTF node per editor subtree row (placement first = outer wrapper)."""

    preorder = _preorder_editor_subtree(scene_nodes, placement_id, doc_order)
    placement = nodes_by_id[placement_id]
    _validate_expanded_interior(
        placement=placement,
        scene_nodes=scene_nodes,
        src_label=str(placement.name or placement_id),
        src=src,
        nodes_by_id=nodes_by_id,
    )

    index_map = {eid: block_base + k for k, eid in enumerate(preorder)}
    chunk: list[Node] = []

    for eid in preorder:
        enf = nodes_by_id[eid]
        ch_editor = _sorted_scene_child_ids(scene_nodes, eid, doc_order)
        ch_gltf = [index_map[c] for c in ch_editor]

        if eid == placement_id:
            raw_outer = {
                "translation": _optional_translation(enf.position),
                "rotation": _optional_rotation(enf.rotation),
                "scale": _optional_scale(enf.scale),
            }
            outer_kw = {k: v for k, v in raw_outer.items() if v is not None}
            if enf.name:
                outer_kw["name"] = enf.name
            out_n = Node(**outer_kw)
            out_n.children = ch_gltf
            chunk.append(out_n)
            continue

        if enf.sourceGltfNodeIndex is not None:
            chunk.append(
                _emit_interior_mirror_clone_node(
                    enf,
                    src=src,
                    mesh_base=mesh_base,
                    child_gl_indices=ch_gltf,
                ),
            )
            continue

        grp_kw: dict = {}
        ot = _optional_translation(enf.position)
        rq = _optional_rotation(enf.rotation)
        sc = _optional_scale(enf.scale)
        if ot is not None:
            grp_kw["translation"] = ot
        if rq is not None:
            grp_kw["rotation"] = rq
        if sc is not None:
            grp_kw["scale"] = sc
        grp = Node(**grp_kw) if grp_kw else Node()
        grp.name = enf.name or "group"
        grp.children = ch_gltf
        chunk.append(grp)

    return chunk, index_map


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
    - Each placement applies editor TRS on an outer wrapper. Catalogue geometry is emitted either by cloning the
      **full opaque default‑scene subgraph** (legacy `_build_placed_catalog_nodes`), or — when authoring rows expose
      ``sourceAssetRef`` / ``sourceGltfNodeIndex`` under that placement — by emitting **one glTF ``Node`` per expanded
      editor tree row** with authoring TRS deltas composed against the catalogue source node matrices.
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

    _extend_needed_ids_for_interior_mirrors(
        doc.scene.nodes,
        needed_ids,
        nodes_by_id=nodes_by_id,
        glb_paths_by_asset=glb_paths_by_asset,
    )

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
        cur_en = nodes_by_id[eid]
        if cur_en.assetRef and cur_en.assetRef in glb_paths_by_asset:
            ap = glb_paths_by_asset[cur_en.assetRef]
            if _placement_has_expanded_interior(doc.scene.nodes, eid, str(cur_en.assetRef), nodes_by_id):
                preorder_n = len(_preorder_editor_subtree(doc.scene.nodes, eid, doc_order))
                cursor += preorder_n
            else:
                cursor += _placed_catalog_instance_node_count(gltf_by_path[ap])
        else:
            cursor += 1

    new_nodes: list[Node] = []
    for eid in ordered_ids:
        enode = nodes_by_id[eid]
        child_ids = [
            cid
            for cid in _sorted_scene_child_ids(doc.scene.nodes, enode.id, doc_order)
            if cid in needed_ids
        ]
        child_indices = [idx_outer[cid] for cid in child_ids]

        raw_outer: dict = {
            "translation": _optional_translation(enode.position),
            "rotation": _optional_rotation(enode.rotation),
            "scale": _optional_scale(enode.scale),
        }

        if is_mesh_instance(eid):
            assert enode.assetRef is not None
            asset_path = glb_paths_by_asset[enode.assetRef]
            src_inst = gltf_by_path[asset_path]
            mesh_base_here = mesh_base_by_path[asset_path]
            if _placement_has_expanded_interior(doc.scene.nodes, eid, str(enode.assetRef), nodes_by_id):
                base_abs = len(out.nodes) + len(new_nodes)
                chunk_e, mapping_e = _build_expanded_placement_nodes(
                    scene_nodes=doc.scene.nodes,
                    placement_id=eid,
                    placement_asset_ref=str(enode.assetRef),
                    src=src_inst,
                    mesh_base=mesh_base_here,
                    block_base=base_abs,
                    nodes_by_id=nodes_by_id,
                    doc_order=doc_order,
                )
                new_nodes.extend(chunk_e)
                idx_outer.update(mapping_e)
            else:
                outer_kw = {k: v for k, v in raw_outer.items() if v is not None}
                base_index = len(out.nodes) + len(new_nodes)
                chunk = _build_placed_catalog_nodes(
                    src_inst,
                    mesh_base_here,
                    outer_kw,
                    base_index=base_index,
                )
                new_nodes.extend(chunk)
        else:
            hid = _mirror_host_placement_id(enode, nodes_by_id)
            if (
                hid is not None
                and enode.sourceGltfNodeIndex is not None
                and enode.sourceAssetRef is not None
            ):
                hp = nodes_by_id.get(hid)
                if (
                    hp is not None
                    and hp.assetRef is not None
                    and hp.assetRef in glb_paths_by_asset
                    and hp.assetRef == enode.sourceAssetRef
                    and _placement_has_expanded_interior(doc.scene.nodes, hid, hp.assetRef, nodes_by_id)
                ):
                    host_path = glb_paths_by_asset[hp.assetRef]
                    src_inst = gltf_by_path[host_path]
                    mesh_base_here = mesh_base_by_path[host_path]
                    new_nodes.append(
                        _emit_interior_mirror_clone_node(
                            enode,
                            src=src_inst,
                            mesh_base=mesh_base_here,
                            child_gl_indices=child_indices,
                        ),
                    )
                    continue
            if child_indices:
                raw_outer["children"] = child_indices
            new_nodes.append(Node(**{k: v for k, v in raw_outer.items() if v is not None}))

    out.nodes.extend(new_nodes)

    assets_by_id = {a.assetId: a for a in doc.assets}
    ext_any = False
    for enode_a in doc.scene.nodes:
        att_list = _scene_node_attachments(enode_a)
        if not att_list:
            continue
        if enode_a.id not in idx_outer:
            continue
        entries: list[dict] = []
        gltf_idx = idx_outer[enode_a.id]
        for att in att_list:
            pa = assets_by_id.get(att.scriptAssetRef)
            if pa is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"scene node {enode_a.name!r} references unknown script asset {att.scriptAssetRef}",
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

    scene_js_path = build_dir / "scene.js"
    try:
        bundled_js = write_scene_js_bundle(base, doc, scene_js_path)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"scene.js bundle failed: {e}") from e

    if bundled_js:
        if out.extensions is None:
            out.extensions = {}
        out.extensions[EXT_INTERACTIVE_GLTF] = interactive_gltf_root_extension_value()
        if out.extensionsUsed is None:
            out.extensionsUsed = []
        if EXT_INTERACTIVE_GLTF not in out.extensionsUsed:
            out.extensionsUsed.append(EXT_INTERACTIVE_GLTF)
    else:
        try:
            scene_js_path.unlink(missing_ok=True)
        except OSError:
            pass

    out_path = build_dir / "scene.glb"
    try:
        out.save_binary(str(out_path))
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"failed to write build/scene.glb: {e}") from e

    return out_path
