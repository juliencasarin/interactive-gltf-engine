"""Prototype glTF extension payload aligned loosely with UMI3D ``extensions.umi3d`` shape.

Normative naming TBD in interactive-gltf-specs; see ``docs/umi3d-proto-extension-alignment.md``.
"""

from __future__ import annotations

from typing import Any

from app.models import ProjectAsset

# Khronos-style vendor extension id (proto; rename when specifications freeze).
EXT_IGLTF_UMI3D_PROTO = "EXT_IGLTF_UMI3D_PROTO"

DEFAULT_HANDLER_BY_KIND: dict[str, str] = {
    "event": "OnEventInteraction",
    "link": "OnLinkInteraction",
    "form": "OnFormInteraction",
    "manipulation": "OnManipulationInteraction",
    "drawing": "OnDrawingInteraction",
}


def script_handler_id(asset: ProjectAsset | None) -> str:
    """Exported class name from catalog asset, or template default by ``interactionKind``."""
    if asset and asset.scriptExports:
        return asset.scriptExports[0]
    kind = (asset.interactionKind or "event").lower() if asset else "event"
    return DEFAULT_HANDLER_BY_KIND.get(kind, "OnEventInteraction")


def interaction_kind_str(asset: ProjectAsset | None) -> str:
    return (asset.interactionKind or "event").lower() if asset else "event"


def umi3d_proto_attachment_entry(
    *,
    attachment_id: str,
    script_asset_ref: str,
    script_relative_path: str,
    script_handler_id: str,
    interaction_kind: str,
    serialized_props: dict[str, Any] | None,
    event_hold: bool = False,
) -> dict[str, Any]:
    """One editor script attachment serialized for runtime loaders."""
    return {
        "attachmentId": attachment_id,
        "scriptAssetRef": script_asset_ref,
        "scriptRelativePath": script_relative_path.replace("\\", "/"),
        "scriptHandlerId": script_handler_id,
        "interactionKind": interaction_kind,
        "serializedProps": serialized_props if serialized_props is not None else {},
        "dto": {
            "interactionType": interaction_kind,
            "hold": bool(event_hold),
        },
    }


def umi3d_proto_node_extension(gltf_node_index: int, attachments: list[dict[str, Any]]) -> dict[str, Any]:
    """Value for ``nodes[i].extensions[EXT_IGLTF_UMI3D_PROTO]`` (SDK-style ``umi3d`` wrapper)."""
    return {
        "umi3d": {
            "protoVersion": 1,
            "gltfNodeIndex": gltf_node_index,
            "attachments": attachments,
        }
    }
