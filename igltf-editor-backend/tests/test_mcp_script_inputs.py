"""MCP script input introspection and set_script_inputs dispatch."""

from __future__ import annotations

import pytest

from app.editor_session import editor_session_hub
from app.mcp_scene_tools import (
    igltf_get_script_attachment_inputs,
    igltf_introspect_script_inputs,
    igltf_set_script_inputs,
)

SAMPLE_SCRIPT = """
export class DoorOpener {
  /** @igltfInput { "kind": "node" } */
  doorTarget = null

  /** @igltfInput { "kind": "object", "fields": { "speed": { "kind": "number" } } } */
  tuning = { speed: 1 }

  onLoaded() {}
}
"""


def _snapshot_with_script(*, source_text: str | None = None) -> dict:
    return {
        "format": "igltf-editor-project",
        "version": 2,
        "editorSettings": {"mcpAllowSceneEdition": True},
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
                    "id": "n-host",
                    "name": "Host",
                    "parentId": "root",
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1, 1, 1],
                    "interactionAttachments": [
                        {
                            "id": "att-1",
                            "scriptAssetRef": "script-door",
                            "serializedProps": {"tuning": {"speed": 2}},
                        }
                    ],
                },
                {
                    "id": "n-door",
                    "name": "Door",
                    "parentId": "root",
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1, 1, 1],
                },
            ]
        },
        "assets": [
            {
                "assetId": "script-door",
                "relativePath": "assets/DoorOpener.js",
                "name": "DoorOpener.js",
                "assetKind": "script",
                "scriptExports": ["DoorOpener"],
                **({"sourceText": source_text} if source_text is not None else {}),
            }
        ],
    }


@pytest.fixture(autouse=True)
def _clear_sessions() -> None:
    editor_session_hub._sessions.clear()
    yield
    editor_session_hub._sessions.clear()


def test_introspect_script_inputs_from_inline_source() -> None:
    pid = "script-inputs-read"
    editor_session_hub.apply_register_or_update(
        pid,
        {
            "revision": 1,
            "mcpAllowSceneEdition": True,
            "snapshot": _snapshot_with_script(source_text=SAMPLE_SCRIPT),
        },
    )
    out = igltf_introspect_script_inputs(pid, "script-door")
    assert "error" not in out
    assert out["exportName"] == "DoorOpener"
    fields = {row["field"]: row for row in out["fields"]}
    assert fields["doorTarget"]["inputKind"] == "node"
    assert fields["tuning"]["inputKind"] == "object"


def test_get_script_attachment_inputs_labels() -> None:
    pid = "script-inputs-att"
    editor_session_hub.apply_register_or_update(
        pid,
        {
            "revision": 2,
            "mcpAllowSceneEdition": True,
            "snapshot": _snapshot_with_script(source_text=SAMPLE_SCRIPT),
        },
    )
    out = igltf_get_script_attachment_inputs(pid, "n-host", "att-1")
    assert "error" not in out
    assert out["serializedProps"]["tuning"]["speed"] == 2
    tuning = next(f for f in out["fields"] if f["field"] == "tuning")
    assert "speed" in tuning["displayLabel"]


@pytest.mark.asyncio
async def test_set_script_inputs_requires_connected_editor() -> None:
    pid = "script-inputs-write"
    editor_session_hub.apply_register_or_update(
        pid,
        {
            "revision": 1,
            "mcpAllowSceneEdition": True,
            "snapshot": _snapshot_with_script(source_text=SAMPLE_SCRIPT),
        },
    )
    out = await igltf_set_script_inputs(
        pid,
        "n-host",
        "att-1",
        [{"field": "doorTarget", "value": {"nodeId": "n-door"}}],
    )
    assert "error" in out
    assert out["error"]["code"] in ("editor_not_connected", "mutation_blocked", "editor_not_connected")
