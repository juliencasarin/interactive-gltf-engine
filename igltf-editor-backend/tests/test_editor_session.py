"""Tests for live editor session + MCP scene tools."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.editor_session import editor_session_hub
from app.mcp_scene_tools import (
    build_scene_hierarchy,
    build_session_capabilities,
    igltf_get_descriptions,
    igltf_get_editor_session_status,
    igltf_list_scene_hierarchy,
    igltf_set_node_transform,
)


def _sample_snapshot(*, mcp_allow: bool = False) -> dict:
    return {
        "format": "igltf-editor-project",
        "version": 2,
        "editorSettings": {"mcpAllowSceneEdition": mcp_allow},
        "scene": {
            "nodes": [
                {
                    "id": "root",
                    "name": "Scene",
                    "parentId": None,
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1, 1, 1],
                },
                {
                    "id": "n1",
                    "name": "Chair",
                    "description": "Main seat",
                    "parentId": "root",
                    "position": [1, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1, 1, 1],
                    "assetRef": "a-glb",
                },
            ]
        },
        "assets": [
            {
                "assetId": "a-glb",
                "relativePath": "assets/Chair.glb",
                "name": "Chair.glb",
                "description": "Catalog chair",
                "assetKind": "gltf",
            }
        ],
    }


@pytest.fixture(autouse=True)
def _clear_editor_sessions() -> None:
    editor_session_hub._sessions.clear()
    yield
    editor_session_hub._sessions.clear()


def test_build_scene_hierarchy_tags() -> None:
    snap = _sample_snapshot()
    rows = build_scene_hierarchy(snap, include_descriptions=True)
    assert len(rows) == 2
    chair = next(r for r in rows if r["id"] == "n1")
    assert chair["nodeKind"] == "placement"
    assert chair["hasDescription"] is True
    assert chair["description"] == "Main seat"


def test_mcp_read_tools_require_live_session() -> None:
    out = igltf_list_scene_hierarchy("missing")
    assert "error" in out
    assert out["error"]["code"] == "no_live_session"


def test_mcp_read_tools_from_registered_snapshot() -> None:
    pid = "demo-session"
    editor_session_hub.apply_register_or_update(
        pid,
        {
            "revision": 3,
            "mcpAllowSceneEdition": True,
            "snapshot": _sample_snapshot(mcp_allow=True),
        },
    )
    status = igltf_get_editor_session_status(pid)
    assert status["connected"] is False
    assert status["revision"] == 3
    assert status["mcpAllowSceneEdition"] is True
    assert status["canReadLiveSession"] is True
    assert status["canMutateScene"] is False
    assert status["mutationBlockedReason"] == "editor_not_connected"

    tree = igltf_list_scene_hierarchy(pid)
    assert tree["revision"] == 3
    assert tree["sessionCapabilities"]["canMutateScene"] is False
    assert "mutationNotice" in tree
    assert any(n["id"] == "n1" and n["hasDescription"] for n in tree["nodes"])

    desc = igltf_get_descriptions(pid, node_ids=["n1"])
    assert desc["nodes"][0]["description"] == "Main seat"


def test_editor_session_websocket_register(
    igltf_app_client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    from app import storage

    ws = tmp_path / "wsproj"
    ws.mkdir(parents=True)
    (ws / "assets").mkdir()
    (ws / "_staging").mkdir()
    monkeypatch.setattr(storage, "resolve_project_root", lambda _pid: ws)
    monkeypatch.setattr(storage, "project_dir", lambda _pid: ws)

    with igltf_app_client.websocket_connect("/projects/demo/editor/session") as sock:
        hello = sock.receive_json()
        assert hello["type"] == "hello"
        sock.send_json(
            {
                "type": "session_register",
                "revision": 1,
                "mcpAllowSceneEdition": False,
                "snapshot": _sample_snapshot(),
            }
        )

    sess = editor_session_hub.get("demo")
    assert sess is not None
    assert sess.revision == 1
    assert sess.snapshot["scene"]["nodes"][1]["name"] == "Chair"


@pytest.mark.asyncio
async def test_mutation_blocked_when_scene_edition_disabled() -> None:
    pid = "mut-blocked"
    editor_session_hub.apply_register_or_update(
        pid,
        {
            "revision": 1,
            "mcpAllowSceneEdition": False,
            "snapshot": _sample_snapshot(mcp_allow=False),
        },
    )
    sess = editor_session_hub.get(pid)
    assert sess is not None
    sess.websocket = object()  # simulate connected editor

    caps = build_session_capabilities(sess)
    assert caps["canMutateScene"] is False
    assert caps["mutationBlockedReason"] == "mcp_scene_edition_disabled"
    assert caps["userAction"]

    out = await igltf_set_node_transform(pid, "n1", position=[0, 1, 0])
    assert "error" in out
    assert out["error"]["code"] == "mcp_scene_edition_disabled"
    assert out["error"].get("userMessage")
    assert out["error"].get("userAction")
    assert out["error"]["sessionCapabilities"]["canMutateScene"] is False
