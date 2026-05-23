#!/usr/bin/env python3
"""Temporary: verify RotateLocalX attachments in Test 4 build/scene.glb vs project.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from pygltflib import GLTF2

from app.igltf_umi3d_proto import EXT_IGLTF_UMI3D_PROTO

PROJECT_DIR = Path(r"C:\IGLTF\Test 4")
GLB_PATH = PROJECT_DIR / "build" / "scene.glb"
PJ_PATH = PROJECT_DIR / "project.json"
ROTATE_HANDLER = "RotateLocalX"
EXPECTED_ANIMATED = 5


def _proto_attachments(node) -> list[dict]:
    if not node.extensions:
        return []
    block = node.extensions.get(EXT_IGLTF_UMI3D_PROTO)
    if not isinstance(block, dict):
        return []
    umi = block.get("umi3d")
    if not isinstance(umi, dict):
        return []
    atts = umi.get("attachments")
    return atts if isinstance(atts, list) else []


def scan_glb(glb_path: Path) -> list[dict]:
    gltf = GLTF2().load_binary(str(glb_path))
    rows: list[dict] = []
    for i, node in enumerate(gltf.nodes or []):
        for att in _proto_attachments(node):
            handler = str(att.get("scriptHandlerId") or "")
            if handler != ROTATE_HANDLER:
                continue
            props = att.get("serializedProps") or {}
            rows.append(
                {
                    "gltfNodeIndex": i,
                    "nodeName": node.name or f"node_{i}",
                    "attachmentId": att.get("attachmentId"),
                    "targetId": props.get("targetId"),
                    "angularVelocityX": props.get("angularVelocityX"),
                }
            )
    return rows


def scan_project_json(pj_path: Path) -> tuple[list[dict], list[dict]]:
    doc = json.loads(pj_path.read_text(encoding="utf-8"))
    assets = {a["assetId"]: a for a in doc.get("assets") or []}
    rotate_asset_ids = {
        aid
        for aid, a in assets.items()
        if (a.get("scriptExports") or [None])[0] == ROTATE_HANDLER
        or Path(a.get("relativePath", "")).stem == ROTATE_HANDLER
    }

    animated: list[dict] = []
    wheel_candidates: list[dict] = []

    for n in doc.get("scene", {}).get("nodes") or []:
        atts = n.get("interactionAttachments") or []
        rotate_atts = [a for a in atts if a.get("scriptAssetRef") in rotate_asset_ids]
        if rotate_atts:
            animated.append(
                {
                    "editorNodeId": n.get("id"),
                    "name": n.get("name"),
                    "sourceGltfNodeIndex": n.get("sourceGltfNodeIndex"),
                    "attachmentIds": [a.get("id") for a in rotate_atts],
                    "angularVelocityX": (rotate_atts[0].get("serializedProps") or {}).get("angularVelocityX"),
                }
            )
        # Heuristic: wheel assembly roots in Khronos Buggy (catalog nodes 17–24)
        sidx = n.get("sourceGltfNodeIndex")
        if isinstance(sidx, int) and 17 <= sidx <= 24:
            wheel_candidates.append(
                {
                    "name": n.get("name"),
                    "sourceGltfNodeIndex": sidx,
                    "hasRotateLocalX": bool(rotate_atts),
                }
            )

    wheel_candidates.sort(key=lambda r: r["sourceGltfNodeIndex"] or -1)
    return animated, wheel_candidates


def main() -> None:
    if not GLB_PATH.is_file():
        raise SystemExit(f"missing GLB: {GLB_PATH}")
    if not PJ_PATH.is_file():
        raise SystemExit(f"missing project.json: {PJ_PATH}")

    pj_rows, wheel_rows = scan_project_json(PJ_PATH)
    glb_rows = scan_glb(GLB_PATH)

    print(f"=== Test 4 wheel animation audit ===")
    print(f"GLB: {GLB_PATH}")
    print(f"project.json: {PJ_PATH}")
    print()

    print(f"project.json — RotateLocalX attachments: {len(pj_rows)} (expected {EXPECTED_ANIMATED})")
    for r in sorted(pj_rows, key=lambda x: x.get("sourceGltfNodeIndex") or -1):
        print(
            f"  editor {r['name']!r} catalogIdx={r['sourceGltfNodeIndex']} "
            f"vel={r['angularVelocityX']} att={r['attachmentIds'][0]}"
        )
    print()

    print(f"scene.glb — RotateLocalX proto attachments: {len(glb_rows)} (expected {EXPECTED_ANIMATED})")
    for r in sorted(glb_rows, key=lambda x: x["gltfNodeIndex"]):
        print(
            f"  gltf[{r['gltfNodeIndex']}] {r['nodeName']!r} targetId={r['targetId']} "
            f"vel={r['angularVelocityX']} att={r['attachmentId']}"
        )
    print()

    print("Buggy wheel assembly nodes (catalog sourceGltfNodeIndex 17–24):")
    for r in wheel_rows:
        flag = "ANIMATED" if r["hasRotateLocalX"] else "static"
        print(f"  {r['name']!r} catalogIdx={r['sourceGltfNodeIndex']} -> {flag}")
    animated_wheels = sum(1 for r in wheel_rows if r["hasRotateLocalX"])
    static_wheels = sum(1 for r in wheel_rows if not r["hasRotateLocalX"])
    print(f"  => {animated_wheels} animated, {static_wheels} without script in project.json")
    print()

    ok_pj = len(pj_rows) == EXPECTED_ANIMATED
    ok_glb = len(glb_rows) == EXPECTED_ANIMATED
    ok_match = len(pj_rows) == len(glb_rows)
    print("VERDICT:")
    print(f"  project.json count OK: {ok_pj}")
    print(f"  scene.glb count OK:    {ok_glb}")
    print(f"  counts match:          {ok_match}")

    if not (ok_pj and ok_glb and ok_match):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
