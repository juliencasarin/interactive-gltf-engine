"""Read-only helpers: default scene node tree for catalogue .glb (interior authoring)."""

from __future__ import annotations


def default_scene_roots(gltf) -> list[int]:
    """glTF default scene root node indices."""

    if not gltf.scenes or not gltf.nodes:
        return []
    si = 0 if gltf.scene is None else gltf.scene
    if si >= len(gltf.scenes):
        return []
    return list(gltf.scenes[si].nodes or [])


def reachable_nodes_preorder(gltf) -> list[int]:
    """Nodes reachable from the default scene, preorder DFS (matches ``build_play_glb`` exporter)."""

    roots = default_scene_roots(gltf)
    seen: set[int] = set()
    out: list[int] = []

    def dfs(i: int) -> None:
        if i < 0 or i >= len(gltf.nodes) or i in seen:
            return
        seen.add(i)
        out.append(i)
        node = gltf.nodes[i]
        for c in node.children or []:
            dfs(c)

    for r in roots:
        dfs(r)
    return out


def parent_map_under_default_scene(gltf) -> dict[int, int | None]:
    """``parent[i]`` is glTF parent index within the subgraph, ``None`` for scene roots."""

    visit_list = reachable_nodes_preorder(gltf)
    idx_ok = frozenset(visit_list)

    parent: dict[int, int | None] = {}

    for r in default_scene_roots(gltf):
        if r in idx_ok:
            parent[r] = None

    for i in visit_list:
        n = gltf.nodes[i]
        for c in n.children or []:
            if c in idx_ok:
                parent[c] = i

    for i in visit_list:
        parent.setdefault(i, None)

    return parent


def catalog_interior_manifest(gltf) -> dict:
    preorder = reachable_nodes_preorder(gltf)
    parents = parent_map_under_default_scene(gltf)
    roots = default_scene_roots(gltf)

    rows: list[dict] = []
    for idx in preorder:
        n = gltf.nodes[idx]
        name = getattr(n, "name", "") or ""
        rows.append(
            {
                "index": idx,
                "parentIndex": parents.get(idx),
                "name": name or f"node_{idx}",
                "hasMesh": n.mesh is not None,
                "hasSkin": n.skin is not None,
            },
        )

    return {
        "defaultSceneRoots": roots,
        "preorderIndices": preorder,
        "nodes": rows,
    }
