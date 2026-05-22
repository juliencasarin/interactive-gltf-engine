"""Catalogue `.glb` interior manifest helpers (tiny graph smoke test)."""

from __future__ import annotations

from pygltflib import Asset, GLTF2, Node, Scene


def test_catalog_interior_manifest_two_nodes():
    gltf = GLTF2()
    gltf.asset = Asset(version="2.0")
    gltf.scene = 0
    gltf.scenes = [Scene(nodes=[0])]
    gltf.nodes = [Node(children=[1], name="Root"), Node(name="Leaf")]

    from app.gltf_interior_hierarchy import catalog_interior_manifest, parent_map_under_default_scene

    parents = parent_map_under_default_scene(gltf)
    assert parents[0] is None
    assert parents[1] == 0

    m = catalog_interior_manifest(gltf)
    assert m["preorderIndices"] == [0, 1]
    rows = {r["index"]: r for r in m["nodes"]}
    assert rows[1]["parentIndex"] == 0
