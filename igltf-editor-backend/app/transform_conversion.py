"""Pure transform convention conversion helpers for MCP migration agents."""

from __future__ import annotations

import math
from typing import Any

from app.transform_audit import _mat4_decompose_trs, _mat4_from_trs, _mat4_multiply, _round_vec3, _vec3


def _quat_from_euler_xyz(rot: list[float]) -> tuple[float, float, float, float]:
    cx, sx = math.cos(rot[0] / 2), math.sin(rot[0] / 2)
    cy, sy = math.cos(rot[1] / 2), math.sin(rot[1] / 2)
    cz, sz = math.cos(rot[2] / 2), math.sin(rot[2] / 2)
    qw = cx * cy * cz + sx * sy * sz
    qx = sx * cy * cz - cx * sy * sz
    qy = cx * sy * cz + sx * cy * sz
    qz = cx * cy * sz - sx * sy * cz
    return qx, qy, qz, qw


def _euler_xyz_from_quat(qx: float, qy: float, qz: float, qw: float) -> list[float]:
    xx, yy, zz = qx * qx, qy * qy, qz * qz
    xy, xz, yz = qx * qy, qx * qz, qy * qz
    wx, wy, wz = qw * qx, qw * qy, qw * qz
    r = [
        [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0.0],
        [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0.0],
        [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
    _, rot, _ = _mat4_decompose_trs(r)
    return rot


def _flip_z_position(pos: list[float]) -> list[float]:
    return _round_vec3([pos[0], pos[1], -pos[2]])


def _unity_lh_to_gltf_trs(transform: dict[str, Any]) -> dict[str, list[float]]:
    pos = _vec3(transform.get("position"), [0.0, 0.0, 0.0])
    rot = _vec3(transform.get("rotation"), [0.0, 0.0, 0.0])
    scale = _vec3(transform.get("scale"), [1.0, 1.0, 1.0])

    pos_out = _flip_z_position(pos)
    qx, qy, qz, qw = _quat_from_euler_xyz(rot)
    # Unity LH Y-up -> glTF RH Y-up quaternion remap (position Z-flip conjugation)
    qx_out, qy_out, qz_out, qw_out = -qx, qy, -qz, qw
    rot_out = _euler_xyz_from_quat(qx_out, qy_out, qz_out, qw_out)
    return {"position": pos_out, "rotation": rot_out, "scale": _round_vec3(scale)}


def _gltf_to_unity_lh_trs(transform: dict[str, Any]) -> dict[str, list[float]]:
    pos = _vec3(transform.get("position"), [0.0, 0.0, 0.0])
    rot = _vec3(transform.get("rotation"), [0.0, 0.0, 0.0])
    scale = _vec3(transform.get("scale"), [1.0, 1.0, 1.0])

    pos_out = _flip_z_position(pos)
    qx, qy, qz, qw = _quat_from_euler_xyz(rot)
    qx_out, qy_out, qz_out, qw_out = -qx, qy, -qz, qw
    rot_out = _euler_xyz_from_quat(qx_out, qy_out, qz_out, qw_out)
    return {"position": pos_out, "rotation": rot_out, "scale": _round_vec3(scale)}


def convert_transform_convention(
    source: str,
    target: str,
    transform: dict[str, Any],
) -> dict[str, Any]:
    src = source.strip().lower().replace("-", "_")
    tgt = target.strip().lower().replace("-", "_")
    key = f"{src}->{tgt}"
    converters = {
        "unity_lh_y_up->gltf_rh_y_up": _unity_lh_to_gltf_trs,
        "gltf_rh_y_up->unity_lh_y_up": _gltf_to_unity_lh_trs,
    }
    fn = converters.get(key)
    if not fn:
        return {
            "error": {
                "code": "unsupported_conversion",
                "message": f"Unsupported conversion {source!r} -> {target!r}",
                "supported": list(converters.keys()),
            }
        }
    out = fn(transform)
    return {
        "source": source,
        "target": target,
        "input": transform,
        "output": out,
        "rotationOrder": "XYZ",
        "rotationUnits": "radians",
    }
