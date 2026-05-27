"""Tests for transform convention conversion helpers."""

from __future__ import annotations

from app.transform_conversion import convert_transform_convention


def test_unity_to_gltf_flips_z_on_position() -> None:
    out = convert_transform_convention(
        "unity_lh_y_up",
        "gltf_rh_y_up",
        {"position": [1.0, 2.0, 3.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]},
    )
    assert "error" not in out
    assert out["output"]["position"] == [1.0, 2.0, -3.0]


def test_unsupported_conversion_reports_error() -> None:
    out = convert_transform_convention("foo", "bar", {"position": [0, 0, 0]})
    assert "error" in out
    assert out["error"]["code"] == "unsupported_conversion"
