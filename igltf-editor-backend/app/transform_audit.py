"""World/local transform audit from igltf-editor-project scene node snapshots."""

from __future__ import annotations

import math
from typing import Any, Literal

TransformSpace = Literal["local", "world", "both"]

TRANSFORM_CONVENTIONS: dict[str, Any] = {
    "coordinateSystem": {
        "handedness": "right-handed",
        "upAxis": "Y",
        "forwardAxis": "-Z",
        "lengthUnit": "meters",
    },
    "rotationOrder": "XYZ",
    "rotationUnits": "radians",
    "storage": {
        "position": "local",
        "rotation": "local",
        "scale": "local",
        "setNodeTransformSpace": "local or world; world values are converted to local under the parent",
    },
    "notes": [
        "Rotations are Tait-Bryan Euler angles in XYZ order, matching igltf-editor transformMath.ts and Three.js.",
        "World transforms are composed from the parent chain of local TRS values stored on each node.",
    ],
}


def _vec3(raw: Any, default: list[float] | None = None) -> list[float]:
    if not isinstance(raw, list) or len(raw) != 3:
        return list(default or [0.0, 0.0, 0.0])
    out: list[float] = []
    for v in raw:
        n = float(v)
        if not math.isfinite(n):
            n = 0.0
        out.append(n)
    return out


def _round6(n: float) -> float:
    return round(n, 6)


def _round_vec3(v: list[float]) -> list[float]:
    return [_round6(v[0]), _round6(v[1]), _round6(v[2])]


def _mat4_identity() -> list[list[float]]:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _mat4_multiply(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    out = [[0.0] * 4 for _ in range(4)]
    for r in range(4):
        for c in range(4):
            out[r][c] = sum(a[r][k] * b[k][c] for k in range(4))
    return out


def _mat4_from_trs(position: list[float], rotation_xyz: list[float], scale: list[float]) -> list[list[float]]:
    cx, sx = math.cos(rotation_xyz[0]), math.sin(rotation_xyz[0])
    cy, sy = math.cos(rotation_xyz[1]), math.sin(rotation_xyz[1])
    cz, sz = math.cos(rotation_xyz[2]), math.sin(rotation_xyz[2])

    # Three.js Euler 'XYZ' (intrinsic): R = Rz * Ry * Rx
    m00 = cy * cz
    m01 = cz * sx * sy - cx * sz
    m02 = sx * sz + cx * cz * sy
    m10 = cy * sz
    m11 = cx * cz + sx * sy * sz
    m12 = cx * sy * sz - cz * sx
    m20 = -sy
    m21 = cy * sx
    m22 = cx * cy

    sx_, sy_, sz_ = scale
    te = [
        m00 * sx_,
        m01 * sy_,
        m02 * sz_,
        0.0,
        m10 * sx_,
        m11 * sy_,
        m12 * sz_,
        0.0,
        m20 * sx_,
        m21 * sy_,
        m22 * sz_,
        0.0,
        position[0],
        position[1],
        position[2],
        1.0,
    ]
    return [
        [te[0], te[4], te[8], te[12]],
        [te[1], te[5], te[9], te[13]],
        [te[2], te[6], te[10], te[14]],
        [te[3], te[7], te[11], te[15]],
    ]


def _mat4_decompose_trs(m: list[list[float]]) -> tuple[list[float], list[float], list[float]]:
    px, py, pz = m[0][3], m[1][3], m[2][3]
    sx = math.sqrt(m[0][0] ** 2 + m[1][0] ** 2 + m[2][0] ** 2)
    sy = math.sqrt(m[0][1] ** 2 + m[1][1] ** 2 + m[2][1] ** 2)
    sz = math.sqrt(m[0][2] ** 2 + m[1][2] ** 2 + m[2][2] ** 2)
    if sx < 1e-12:
        sx = 1.0
    if sy < 1e-12:
        sy = 1.0
    if sz < 1e-12:
        sz = 1.0

    inv_sx, inv_sy, inv_sz = 1.0 / sx, 1.0 / sy, 1.0 / sz
    r00 = m[0][0] * inv_sx
    r01 = m[0][1] * inv_sy
    r02 = m[0][2] * inv_sz
    r10 = m[1][0] * inv_sx
    r11 = m[1][1] * inv_sy
    r12 = m[1][2] * inv_sz
    r20 = m[2][0] * inv_sx
    r21 = m[2][1] * inv_sy
    r22 = m[2][2] * inv_sz

    cy = math.sqrt(r00 * r00 + r10 * r10)
    if cy > 1e-12:
        cy = max(-1.0, min(1.0, cy))
        rot_y = math.acos(cy)
        if r20 < 0:
            rot_y = -rot_y
        rot_x = math.atan2(r21, r22)
        rot_z = math.atan2(r10, r00)
    else:
        rot_x = math.atan2(-r12, r11)
        rot_y = math.pi / 2 if r20 < 0 else -math.pi / 2
        rot_z = 0.0

    return (
        _round_vec3([px, py, pz]),
        _round_vec3([rot_x, rot_y, rot_z]),
        _round_vec3([sx, sy, sz]),
    )


def _matrix_to_column_major(m: list[list[float]]) -> list[float]:
    return [
        m[0][0],
        m[1][0],
        m[2][0],
        m[3][0],
        m[0][1],
        m[1][1],
        m[2][1],
        m[3][1],
        m[0][2],
        m[1][2],
        m[2][2],
        m[3][2],
        m[0][3],
        m[1][3],
        m[2][3],
        m[3][3],
    ]


def _nodes_by_id(nodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for raw in nodes:
        if isinstance(raw, dict) and isinstance(raw.get("id"), str):
            out[raw["id"]] = raw
    return out


def _local_trs(node: dict[str, Any]) -> dict[str, list[float]]:
    return {
        "position": _round_vec3(_vec3(node.get("position"), [0.0, 0.0, 0.0])),
        "rotation": _round_vec3(_vec3(node.get("rotation"), [0.0, 0.0, 0.0])),
        "scale": _round_vec3(_vec3(node.get("scale"), [1.0, 1.0, 1.0])),
    }


def compose_world_matrix(nodes: list[dict[str, Any]], node_id: str) -> list[list[float]] | None:
    by_id = _nodes_by_id(nodes)
    chain: list[dict[str, Any]] = []
    cur: str | None = node_id
    while cur:
        node = by_id.get(cur)
        if not node:
            return None
        chain.insert(0, node)
        parent = node.get("parentId")
        cur = parent if isinstance(parent, str) else None

    world = _mat4_identity()
    for node in chain:
        local = _local_trs(node)
        local_m = _mat4_from_trs(local["position"], local["rotation"], local["scale"])
        world = _mat4_multiply(world, local_m)
    return world


def get_world_trs(nodes: list[dict[str, Any]], node_id: str) -> dict[str, list[float]] | None:
    world_m = compose_world_matrix(nodes, node_id)
    if not world_m:
        return None
    pos, rot, scale = _mat4_decompose_trs(world_m)
    return {"position": pos, "rotation": rot, "scale": scale}


def build_transform_payload(
    node: dict[str, Any],
    nodes: list[dict[str, Any]],
    *,
    include_matrix: bool = True,
    transform_space: TransformSpace = "both",
) -> dict[str, Any]:
    local = _local_trs(node)
    out: dict[str, Any] = {"local": local}
    if transform_space in ("world", "both"):
        world = get_world_trs(nodes, str(node["id"]))
        if world:
            out["world"] = world
            if include_matrix:
                world_m = compose_world_matrix(nodes, str(node["id"]))
                if world_m:
                    out["worldMatrix"] = _matrix_to_column_major(world_m)
    return out


def collect_descendant_ids(nodes: list[dict[str, Any]], root_id: str) -> list[str]:
    by_parent: dict[str | None, list[str]] = {}
    for raw in nodes:
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
            continue
        pid = raw.get("parentId")
        key = pid if isinstance(pid, str) else None
        by_parent.setdefault(key, []).append(raw["id"])

    out: list[str] = []
    stack = [root_id]
    seen: set[str] = set()
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        out.append(nid)
        stack.extend(by_parent.get(nid, []))
    return out


def get_transform_conventions() -> dict[str, Any]:
    return dict(TRANSFORM_CONVENTIONS)
