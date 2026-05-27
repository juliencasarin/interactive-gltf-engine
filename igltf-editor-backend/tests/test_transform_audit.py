"""Tests for snapshot-based transform audit (local/world TRS composition)."""

from __future__ import annotations

from app.transform_audit import (
    build_transform_payload,
    compose_world_matrix,
    get_transform_conventions,
    get_world_trs,
)


def _sample_nodes() -> list[dict]:
    return [
        {
            "id": "root",
            "parentId": None,
            "position": [0.0, 0.0, 0.0],
            "rotation": [0.0, 0.0, 0.0],
            "scale": [1.0, 1.0, 1.0],
        },
        {
            "id": "child",
            "parentId": "root",
            "position": [1.0, 0.0, 0.0],
            "rotation": [0.0, 0.0, 0.0],
            "scale": [1.0, 1.0, 1.0],
        },
    ]


def test_world_position_composes_parent_chain() -> None:
    nodes = _sample_nodes()
    world = get_world_trs(nodes, "child")
    assert world is not None
    assert world["position"] == [1.0, 0.0, 0.0]


def test_build_transform_payload_includes_local_and_world() -> None:
    nodes = _sample_nodes()
    child = nodes[1]
    payload = build_transform_payload(child, nodes, include_matrix=True, transform_space="both")
    assert payload["local"]["position"] == [1.0, 0.0, 0.0]
    assert payload["world"]["position"] == [1.0, 0.0, 0.0]
    assert isinstance(payload.get("worldMatrix"), list)
    assert len(payload["worldMatrix"]) == 16


def test_compose_world_matrix_missing_node_returns_none() -> None:
    assert compose_world_matrix(_sample_nodes(), "missing") is None


def test_get_transform_conventions_xyz_radians() -> None:
    conv = get_transform_conventions()
    assert conv["rotationOrder"] == "XYZ"
    assert conv["rotationUnits"] == "radians"
    assert conv["coordinateSystem"]["handedness"] == "right-handed"
