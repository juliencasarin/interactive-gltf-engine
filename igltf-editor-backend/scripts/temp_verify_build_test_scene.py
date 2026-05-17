#!/usr/bin/env python3
"""
Temporary check: build `build/scene.glb` from persisted `data/test/project.json` (legacy slug `test`)
and verify hierarchy + translations (delete this script when no longer needed).

Run from repo backend root:
  uv run python scripts/temp_verify_build_test_scene.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

# igltf-editor-backend root (parent of scripts/)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from pygltflib import GLTF2

from app.build_play_glb import build_scene_to_play_glb, mesh_count_under_default_scene
from app.igltf_umi3d_proto import EXT_IGLTF_UMI3D_PROTO
from app.storage import get_storage_root


def _approx_eq(a: list[float], b: list[float], eps: float = 1e-5) -> bool:
    return len(a) == len(b) and all(math.isclose(x, y, abs_tol=eps) for x, y in zip(a, b))


def _count_mesh_nodes_below(gltf: GLTF2, root_idx: int) -> int:
    """Nodes with ``mesh`` under ``root_idx`` (including ``root_idx``)."""

    def walk(i: int) -> int:
        n = gltf.nodes[i]
        c = 1 if n.mesh is not None else 0
        for ch in n.children or []:
            c += walk(ch)
        return c

    return walk(root_idx)


def main() -> None:
    data_root = _BACKEND_ROOT / "data"
    proj_dir = data_root / "test"
    pj = proj_dir / "project.json"
    if not pj.is_file():
        raise SystemExit(f"missing fixture: {pj}")

    # Pin storage to repo data/ so the script works regardless of env
    import os

    os.environ["STORAGE_ROOT"] = str(data_root.resolve())

    print(f"STORAGE_ROOT={get_storage_root()}")
    print(f"project.json={pj}")

    doc = json.loads(pj.read_text(encoding="utf-8"))

    duck_asset = "26473d05-3c7d-4cb0-bb02-5499f07a9ae1"
    buggy_asset = "2dd558b3-3435-49c9-9aa7-95fa9453628e"

    def _expected_mesh_count(asset_id: str) -> int:
        row = next(a for a in doc["assets"] if a["assetId"] == asset_id)
        glb = proj_dir / row["relativePath"]
        g = GLTF2().load_binary(str(glb))
        return mesh_count_under_default_scene(g)

    want_duck_meshes = _expected_mesh_count(duck_asset)
    want_buggy_meshes = _expected_mesh_count(buggy_asset)

    mesh_under_root = [
        n
        for n in doc["scene"]["nodes"]
        if n.get("parentId") == "root" and n.get("assetRef") in (duck_asset, buggy_asset)
    ]
    print(
        f"Mesh instances under root ({len(mesh_under_root)}): "
        f"{[(m['name'], m['assetRef'][:8]) for m in mesh_under_root]}"
    )

    out_path = build_scene_to_play_glb("test")
    print(f"Wrote {out_path} ({out_path.stat().st_size} bytes)")

    gltf = GLTF2().load_binary(str(out_path))
    assert gltf.nodes and gltf.scenes
    si = 0 if gltf.scene is None else gltf.scene
    scene = gltf.scenes[si]
    assert scene.nodes and len(scene.nodes) == 1, f"expected single scene root, got {scene.nodes}"

    root_idx = scene.nodes[0]
    root = gltf.nodes[root_idx]
    assert root.children and len(root.children) == len(mesh_under_root), (
        f"expected root with {len(mesh_under_root)} mesh children, got children={root.children}"
    )

    leaf_translations: list[list[float]] = []
    mesh_totals: list[int] = []

    for ci in root.children:
        outer = gltf.nodes[ci]
        assert outer.translation is not None and len(outer.translation) == 3, (
            f"outer {ci} missing translation (got {outer.translation!r})"
        )
        leaf_translations.append(list(float(x) for x in outer.translation))

        assert outer.children and len(outer.children) >= 1, (
            f"expected outer with at least one child (catalog subgraph), got {outer.children!r}"
        )
        sub_root = outer.children[0]
        mesh_totals.append(_count_mesh_nodes_below(gltf, sub_root))

    print(f"Root node index={root_idx}, children={root.children}")
    print(f"Outer translations in GLB: {leaf_translations}")
    print(f"Mesh node counts under each placement: {mesh_totals}")

    assert len(mesh_under_root) == len(leaf_translations) == len(mesh_totals)
    for i, d in enumerate(mesh_under_root):
        want = d["position"]
        got = leaf_translations[i]
        assert _approx_eq(got, want), f"leaf[{i}] ({d.get('name')}) translation mismatch: got {got}, want {want}"
        asset_ref = d["assetRef"]
        got_m = mesh_totals[i]
        if asset_ref == duck_asset:
            assert got_m == want_duck_meshes, (
                f"{d.get('name')}: expected {want_duck_meshes} mesh nodes (source catalog), got {got_m}"
            )
        elif asset_ref == buggy_asset:
            assert got_m == want_buggy_meshes, (
                f"{d.get('name')}: expected {want_buggy_meshes} mesh nodes (source catalog), got {got_m}"
            )

    assert EXT_IGLTF_UMI3D_PROTO in (gltf.extensionsUsed or [])
    duck1_outer_idx = root.children[0]
    d1ext = gltf.nodes[duck1_outer_idx].extensions or {}
    assert EXT_IGLTF_UMI3D_PROTO in d1ext, "Duck 1 outer node should carry prototype interaction extension"
    umi = d1ext[EXT_IGLTF_UMI3D_PROTO]["umi3d"]
    assert umi["attachments"][0]["scriptHandlerId"] == "OnEventInteraction"
    assert "targetId" in umi["attachments"][0]["serializedProps"]

    print("OK - outer transforms match project.json; full catalog subgraph mesh counts preserved.")


if __name__ == "__main__":
    main()
