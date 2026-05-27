"""MCP tools for live scene read/write via editor session."""

from __future__ import annotations

from typing import Any

from app.editor_session import EditorSessionError, EditorSessionState, editor_session_hub
from app.transform_audit import (
    TRANSFORM_CONVENTIONS,
    build_transform_payload,
    get_transform_conventions,
)
from app.transform_conversion import convert_transform_convention


def build_session_capabilities(sess: EditorSessionState | None) -> dict[str, Any]:
    """Machine- and human-readable session gates for MCP agents."""
    if sess is None or not sess.snapshot:
        return {
            "canReadLiveSession": False,
            "canMutateScene": False,
            "connected": False,
            "mcpAllowSceneEdition": False,
            "mutationBlockedReason": "no_live_session",
            "userMessage": (
                "No live editor session for this project. Opening the workspace folder in Cursor is not enough — "
                "igltf-editor must be running with this project loaded."
            ),
            "userAction": (
                "1) Resolve the hub project UUID (igltf_list_registered_projects or read `.igltf/project-id` in the workspace). "
                "2) Open that project in igltf-editor (not Cursor alone). "
                "3) Enable Settings → Allow scene edition if you need mutations."
            ),
        }

    connected = sess.websocket is not None
    mcp_allow = sess.mcp_allow_scene_edition
    can_mutate = connected and mcp_allow

    if can_mutate:
        return {
            "canReadLiveSession": True,
            "canMutateScene": True,
            "connected": True,
            "mcpAllowSceneEdition": True,
            "mutationBlockedReason": None,
            "userMessage": "Scene edition via MCP is allowed for this project.",
            "userAction": None,
        }

    if not connected:
        return {
            "canReadLiveSession": True,
            "canMutateScene": False,
            "connected": False,
            "mcpAllowSceneEdition": mcp_allow,
            "mutationBlockedReason": "editor_not_connected",
            "userMessage": (
                "A scene snapshot is available but the editor WebSocket is disconnected, so MCP cannot apply changes."
            ),
            "userAction": "Keep igltf-editor open on this project with the authoring API running.",
        }

    return {
        "canReadLiveSession": True,
        "canMutateScene": False,
        "connected": True,
        "mcpAllowSceneEdition": False,
        "mutationBlockedReason": "mcp_scene_edition_disabled",
        "userMessage": "Scene edition via MCP is disabled for this project (read-only mode).",
        "userAction": "In igltf-editor: Settings → enable “Allow scene edition”, then retry. Do not edit project.json.",
    }


def _session_status(project_id: str) -> dict[str, Any]:
    sess = editor_session_hub.get(project_id)
    caps = build_session_capabilities(sess)
    if sess is None or not sess.snapshot:
        return {
            "projectId": project_id,
            "revision": None,
            **caps,
        }
    return {
        "projectId": project_id,
        "revision": sess.revision,
        **caps,
    }


def _with_session_capabilities(project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    sess = editor_session_hub.get(project_id)
    caps = build_session_capabilities(sess)
    out = {**payload, "sessionCapabilities": caps}
    if not caps["canMutateScene"] and caps.get("userMessage"):
        out["mutationNotice"] = caps["userMessage"]
        if caps.get("userAction"):
            out["mutationNoticeAction"] = caps["userAction"]
    return out


def _mutation_error(project_id: str, code: str, message: str) -> dict[str, Any]:
    caps = build_session_capabilities(editor_session_hub.get(project_id))
    return {
        "error": {
            "code": code,
            "message": message,
            "userMessage": caps.get("userMessage"),
            "userAction": caps.get("userAction"),
            "sessionCapabilities": caps,
        }
    }


def _require_live(project_id: str) -> dict[str, Any]:
    try:
        return editor_session_hub.require_live(project_id).snapshot
    except EditorSessionError as e:
        return {"error": {"code": e.code, "message": e.message}}


def _node_kind(node: dict[str, Any]) -> str:
    if node.get("id") == "root" or node.get("parentId") is None and node.get("id") == "root":
        pass
    if node.get("id") == "root":
        return "root"
    if node.get("sourceGltfNodeIndex") is not None:
        return "mirror"
    if node.get("assetRef"):
        return "placement"
    return "empty"


def _transform_meta() -> dict[str, Any]:
    return {
        "rotationOrder": TRANSFORM_CONVENTIONS["rotationOrder"],
        "rotationUnits": TRANSFORM_CONVENTIONS["rotationUnits"],
        "coordinateSystem": TRANSFORM_CONVENTIONS["coordinateSystem"],
    }


def _scene_nodes(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    scene = snapshot.get("scene")
    if not isinstance(scene, dict):
        return []
    nodes = scene.get("nodes")
    return nodes if isinstance(nodes, list) else []


def _find_scene_node(snapshot: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    for raw in _scene_nodes(snapshot):
        if isinstance(raw, dict) and raw.get("id") == node_id:
            return raw
    return None


def build_scene_hierarchy(
    snapshot: dict[str, Any],
    *,
    include_descriptions: bool = False,
    include_transforms: bool = False,
    transform_space: str = "both",
) -> list[dict[str, Any]]:
    scene = snapshot.get("scene")
    if not isinstance(scene, dict):
        return []
    nodes = scene.get("nodes")
    if not isinstance(nodes, list):
        return []

    out: list[dict[str, Any]] = []
    for raw in nodes:
        if not isinstance(raw, dict):
            continue
        nid = raw.get("id")
        if not isinstance(nid, str):
            continue
        desc = raw.get("description")
        has_desc = isinstance(desc, str) and bool(desc.strip())
        atts = raw.get("interactionAttachments")
        has_scripts = isinstance(atts, list) and len(atts) > 0
        row: dict[str, Any] = {
            "id": nid,
            "name": raw.get("name") if isinstance(raw.get("name"), str) else "",
            "parentId": raw.get("parentId"),
            "nodeKind": _node_kind(raw),
            "assetRef": raw.get("assetRef"),
            "hasDescription": has_desc,
            "hasScripts": has_scripts,
            "visible": raw.get("visible") is not False,
        }
        if include_descriptions and has_desc:
            row["description"] = desc.strip()
        if include_transforms:
            space = transform_space if transform_space in ("local", "world", "both") else "both"
            row["transforms"] = build_transform_payload(
                raw,
                nodes,
                include_matrix=False,
                transform_space=space,  # type: ignore[arg-type]
            )
        out.append(row)
    return out


def igltf_get_editor_session_status(project_id: str) -> dict[str, Any]:
    return _session_status(project_id)


def igltf_list_scene_hierarchy(
    project_id: str,
    include_descriptions: bool = False,
    include_transforms: bool = False,
    transform_space: str = "both",
) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    return _with_session_capabilities(
        project_id,
        {
            "projectId": project_id,
            "revision": editor_session_hub.require_live(project_id).revision,
            "nodes": build_scene_hierarchy(
                snap,
                include_descriptions=include_descriptions,
                include_transforms=include_transforms,
                transform_space=transform_space,
            ),
            **(_transform_meta() if include_transforms else {}),
        },
    )


def igltf_list_assets(project_id: str) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    assets = snap.get("assets")
    if not isinstance(assets, list):
        assets = []
    rows: list[dict[str, Any]] = []
    for raw in assets:
        if not isinstance(raw, dict):
            continue
        aid = raw.get("assetId")
        if not isinstance(aid, str):
            continue
        desc = raw.get("description")
        has_desc = isinstance(desc, str) and bool(desc.strip())
        rows.append(
            {
                "assetId": aid,
                "name": raw.get("name"),
                "assetKind": raw.get("assetKind"),
                "logicalFolder": raw.get("logicalFolder"),
                "hasDescription": has_desc,
                "scriptExports": raw.get("scriptExports"),
            }
        )
    return _with_session_capabilities(
        project_id,
        {
            "projectId": project_id,
            "revision": editor_session_hub.require_live(project_id).revision,
            "assets": rows,
        },
    )


def igltf_get_descriptions(
    project_id: str,
    node_ids: list[str] | None = None,
    asset_ids: list[str] | None = None,
) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap

    node_filter = set(node_ids) if node_ids else None
    asset_filter = set(asset_ids) if asset_ids else None

    node_rows: list[dict[str, Any]] = []
    scene = snap.get("scene")
    if isinstance(scene, dict) and isinstance(scene.get("nodes"), list):
        for raw in scene["nodes"]:
            if not isinstance(raw, dict):
                continue
            nid = raw.get("id")
            if not isinstance(nid, str):
                continue
            if node_filter is not None and nid not in node_filter:
                continue
            desc = raw.get("description")
            if isinstance(desc, str) and desc.strip():
                node_rows.append({"id": nid, "description": desc.strip()})

    asset_rows: list[dict[str, Any]] = []
    assets = snap.get("assets")
    if isinstance(assets, list):
        for raw in assets:
            if not isinstance(raw, dict):
                continue
            aid = raw.get("assetId")
            if not isinstance(aid, str):
                continue
            if asset_filter is not None and aid not in asset_filter:
                continue
            desc = raw.get("description")
            if isinstance(desc, str) and desc.strip():
                asset_rows.append({"assetId": aid, "description": desc.strip()})

    return _with_session_capabilities(
        project_id,
        {
            "projectId": project_id,
            "nodes": node_rows,
            "assets": asset_rows,
        },
    )


def igltf_get_node_details(project_id: str, node_id: str) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    scene = snap.get("scene")
    if not isinstance(scene, dict) or not isinstance(scene.get("nodes"), list):
        return {"error": {"code": "node_not_found", "message": f"Node {node_id!r} not found"}}
    for raw in scene["nodes"]:
        if isinstance(raw, dict) and raw.get("id") == node_id:
            atts = raw.get("interactionAttachments")
            scripts: list[dict[str, Any]] = []
            if isinstance(atts, list):
                for a in atts:
                    if not isinstance(a, dict):
                        continue
                    scripts.append(
                        {
                            "id": a.get("id"),
                            "scriptAssetRef": a.get("scriptAssetRef"),
                            "serializedProps": a.get("serializedProps"),
                        }
                    )
            return _with_session_capabilities(
                project_id,
                {
                    "projectId": project_id,
                    "node": {
                        "id": raw.get("id"),
                        "name": raw.get("name"),
                        "description": raw.get("description"),
                        "parentId": raw.get("parentId"),
                        "position": raw.get("position"),
                        "rotation": raw.get("rotation"),
                        "scale": raw.get("scale"),
                        "assetRef": raw.get("assetRef"),
                        "sourceAssetRef": raw.get("sourceAssetRef"),
                        "sourceGltfNodeIndex": raw.get("sourceGltfNodeIndex"),
                        "sourcePlacementId": raw.get("sourcePlacementId"),
                        "visible": raw.get("visible") is not False,
                        "layerId": raw.get("layerId"),
                        "authoringBounds": raw.get("authoringBounds"),
                        "interactionAttachments": scripts,
                        "nodeKind": _node_kind(raw),
                    },
                },
            )
    return {"error": {"code": "node_not_found", "message": f"Node {node_id!r} not found"}}


def igltf_get_node_transform(
    project_id: str,
    node_id: str,
    include_matrix: bool = True,
) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    raw = _find_scene_node(snap, node_id)
    if not raw:
        return {"error": {"code": "node_not_found", "message": f"Node {node_id!r} not found"}}
    nodes = _scene_nodes(snap)
    return _with_session_capabilities(
        project_id,
        {
            "projectId": project_id,
            "revision": editor_session_hub.require_live(project_id).revision,
            "nodeId": node_id,
            "transforms": build_transform_payload(
                raw,
                nodes,
                include_matrix=include_matrix,
                transform_space="both",
            ),
            **_transform_meta(),
        },
    )


def igltf_get_nodes_details(
    project_id: str,
    node_ids: list[str],
    include_transforms: bool = True,
) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    if not node_ids:
        return {"error": {"code": "invalid_argument", "message": "node_ids must be a non-empty array"}}

    nodes = _scene_nodes(snap)
    by_id = {str(n.get("id")): n for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)}
    rows: list[dict[str, Any]] = []
    missing: list[str] = []
    for nid in node_ids:
        raw = by_id.get(nid)
        if not raw:
            missing.append(nid)
            continue
        atts = raw.get("interactionAttachments")
        scripts: list[dict[str, Any]] = []
        if isinstance(atts, list):
            for a in atts:
                if not isinstance(a, dict):
                    continue
                scripts.append(
                    {
                        "id": a.get("id"),
                        "scriptAssetRef": a.get("scriptAssetRef"),
                        "serializedProps": a.get("serializedProps"),
                    }
                )
        row: dict[str, Any] = {
            "id": raw.get("id"),
            "name": raw.get("name"),
            "description": raw.get("description"),
            "parentId": raw.get("parentId"),
            "position": raw.get("position"),
            "rotation": raw.get("rotation"),
            "scale": raw.get("scale"),
            "assetRef": raw.get("assetRef"),
            "sourceAssetRef": raw.get("sourceAssetRef"),
            "sourceGltfNodeIndex": raw.get("sourceGltfNodeIndex"),
            "sourcePlacementId": raw.get("sourcePlacementId"),
            "visible": raw.get("visible") is not False,
            "layerId": raw.get("layerId"),
            "authoringBounds": raw.get("authoringBounds"),
            "interactionAttachments": scripts,
            "nodeKind": _node_kind(raw),
        }
        if include_transforms:
            row["transforms"] = build_transform_payload(
                raw,
                nodes,
                include_matrix=True,
                transform_space="both",
            )
        rows.append(row)

    out: dict[str, Any] = {
        "projectId": project_id,
        "revision": editor_session_hub.require_live(project_id).revision,
        "nodes": rows,
    }
    if missing:
        out["missingNodeIds"] = missing
    if include_transforms:
        out.update(_transform_meta())
    return _with_session_capabilities(project_id, out)


def igltf_get_transform_conventions() -> dict[str, Any]:
    return {"conventions": get_transform_conventions()}


def igltf_convert_transform_convention(
    source: str,
    target: str,
    transform: dict[str, Any],
) -> dict[str, Any]:
    return convert_transform_convention(source, target, transform)


async def _dispatch(
    project_id: str,
    op: str,
    params: dict[str, Any],
    *,
    require_scene_edit: bool = True,
) -> dict[str, Any]:
    if require_scene_edit:
        caps = build_session_capabilities(editor_session_hub.get(project_id))
        if not caps["canMutateScene"]:
            code = str(caps.get("mutationBlockedReason") or "mutation_blocked")
            message = str(caps.get("userMessage") or "Scene mutation is not allowed.")
            return _mutation_error(project_id, code, message)

    try:
        return await editor_session_hub.dispatch_command(
            project_id,
            op,
            params,
            require_mcp_scene_edition=require_scene_edit,
        )
    except EditorSessionError as e:
        if require_scene_edit:
            return _mutation_error(project_id, e.code, e.message)
        return {"error": {"code": e.code, "message": e.message}}


async def igltf_apply_transform_batch(
    project_id: str,
    updates: list[dict[str, Any]],
    space: str = "local",
    dry_run: bool = False,
    transaction_label: str | None = None,
) -> dict[str, Any]:
    if not isinstance(updates, list) or not updates:
        return {"error": {"code": "invalid_argument", "message": "updates must be a non-empty array"}}
    params: dict[str, Any] = {"updates": updates, "space": space, "dry_run": dry_run}
    if transaction_label:
        params["transaction_label"] = transaction_label
    return await _dispatch(project_id, "apply_transform_batch", params)


async def igltf_undo_last_editor_change(project_id: str) -> dict[str, Any]:
    return await _dispatch(project_id, "undo_last_change", {})


async def igltf_set_node_transform(
    project_id: str,
    node_id: str,
    position: list[float] | None = None,
    rotation: list[float] | None = None,
    scale: list[float] | None = None,
    space: str = "local",
) -> dict[str, Any]:
    params: dict[str, Any] = {"nodeId": node_id, "space": space}
    if position is not None:
        params["position"] = position
    if rotation is not None:
        params["rotation"] = rotation
    if scale is not None:
        params["scale"] = scale
    return await _dispatch(project_id, "set_node_transform", params)


async def igltf_create_empty_node(
    project_id: str,
    parent_id: str | None = None,
    name: str | None = None,
    position: list[float] | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if parent_id is not None:
        params["parentId"] = parent_id
    if name is not None:
        params["name"] = name
    if position is not None:
        params["position"] = position
    return await _dispatch(project_id, "create_empty_node", params)


async def igltf_reparent_node(
    project_id: str,
    node_id: str,
    parent_id: str,
    insert_before_sibling_id: str | None = None,
    keep_world_position: bool = True,
) -> dict[str, Any]:
    return await _dispatch(
        project_id,
        "reparent_node",
        {
            "nodeId": node_id,
            "parentId": parent_id,
            "insertBeforeSiblingId": insert_before_sibling_id,
            "keepWorldPosition": keep_world_position,
        },
    )


async def igltf_rename_node(project_id: str, node_id: str, name: str) -> dict[str, Any]:
    return await _dispatch(project_id, "rename_node", {"nodeId": node_id, "name": name})


async def igltf_set_node_visibility(project_id: str, node_id: str, visible: bool) -> dict[str, Any]:
    return await _dispatch(project_id, "set_node_visibility", {"nodeId": node_id, "visible": visible})


async def igltf_instantiate_asset(
    project_id: str,
    asset_id: str,
    parent_id: str | None = None,
    name: str | None = None,
    position: list[float] | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {"assetId": asset_id}
    if parent_id is not None:
        params["parentId"] = parent_id
    if name is not None:
        params["name"] = name
    if position is not None:
        params["position"] = position
    return await _dispatch(project_id, "instantiate_asset", params)


async def igltf_delete_nodes(project_id: str, node_ids: list[str]) -> dict[str, Any]:
    return await _dispatch(project_id, "delete_nodes", {"nodeIds": node_ids})


async def igltf_set_description(
    project_id: str,
    target: str,
    id: str,
    description: str,
) -> dict[str, Any]:
    return await _dispatch(
        project_id,
        "set_description",
        {"target": target, "id": id, "description": description},
    )


async def igltf_add_script_to_node(
    project_id: str,
    node_id: str,
    script_asset_id: str,
    serialized_props: dict[str, Any] | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {"nodeId": node_id, "scriptAssetId": script_asset_id}
    if serialized_props is not None:
        params["serializedProps"] = serialized_props
    return await _dispatch(project_id, "add_script_attachment", params)


async def igltf_remove_script_from_node(
    project_id: str,
    node_id: str,
    attachment_id: str,
) -> dict[str, Any]:
    return await _dispatch(
        project_id,
        "remove_script_attachment",
        {"nodeId": node_id, "attachmentId": attachment_id},
    )


async def igltf_update_script_on_node(
    project_id: str,
    node_id: str,
    attachment_id: str,
    serialized_props: dict[str, Any] | None = None,
    script_asset_id: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {"nodeId": node_id, "attachmentId": attachment_id}
    if serialized_props is not None:
        params["serializedProps"] = serialized_props
    if script_asset_id is not None:
        params["scriptAssetId"] = script_asset_id

    warning: str | None = None
    if serialized_props:
        snap = _require_live(project_id)
        if "error" not in snap:
            warning = _deprecated_annotated_props_warning(
                project_id, snap, node_id, attachment_id, serialized_props
            )

    result = await _dispatch(project_id, "update_script_attachment", params)
    if warning and "error" not in result:
        result["warning"] = warning
    return result


def _snapshot_node_ids(snapshot: dict[str, Any]) -> set[str]:
    scene = snapshot.get("scene")
    if not isinstance(scene, dict):
        return set()
    nodes = scene.get("nodes")
    if not isinstance(nodes, list):
        return set()
    return {n["id"] for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)}


def _snapshot_assets(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    assets = snapshot.get("assets")
    if not isinstance(assets, list):
        return []
    return [a for a in assets if isinstance(a, dict)]


def _snapshot_node_names(snapshot: dict[str, Any]) -> dict[str, str]:
    scene = snapshot.get("scene")
    if not isinstance(scene, dict) or not isinstance(scene.get("nodes"), list):
        return {}
    out: dict[str, str] = {}
    for raw in scene["nodes"]:
        if not isinstance(raw, dict):
            continue
        nid = raw.get("id")
        if isinstance(nid, str):
            name = raw.get("name")
            out[nid] = name if isinstance(name, str) and name.strip() else nid
    return out


def _snapshot_asset_names(snapshot: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in _snapshot_assets(snapshot):
        aid = raw.get("assetId")
        if not isinstance(aid, str):
            continue
        name = raw.get("name") or raw.get("relativePath")
        out[aid] = name if isinstance(name, str) and name.strip() else aid
    return out


def _find_attachment(
    snapshot: dict[str, Any], node_id: str, attachment_id: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    scene = snapshot.get("scene")
    if not isinstance(scene, dict) or not isinstance(scene.get("nodes"), list):
        return None, None
    for raw in scene["nodes"]:
        if not isinstance(raw, dict) or raw.get("id") != node_id:
            continue
        atts = raw.get("interactionAttachments")
        if not isinstance(atts, list):
            return raw, None
        for att in atts:
            if isinstance(att, dict) and att.get("id") == attachment_id:
                return raw, att
        return raw, None
    return None, None


def _deprecated_annotated_props_warning(
    project_id: str,
    snapshot: dict[str, Any],
    node_id: str,
    attachment_id: str,
    serialized_props: dict[str, Any],
) -> str | None:
    from app.script_input_schema import parse_igltf_input_annotations, read_script_asset_source, script_export_name

    _, att = _find_attachment(snapshot, node_id, attachment_id)
    if not att:
        return None
    script_asset_id = att.get("scriptAssetRef")
    if not isinstance(script_asset_id, str):
        return None
    source, asset, err = read_script_asset_source(project_id, script_asset_id, snapshot)
    if err or not source or not asset:
        return None
    export_name = script_export_name(asset)
    if not export_name:
        return None
    annotations = parse_igltf_input_annotations(source, export_name)
    bad = [k for k in serialized_props if k in annotations and k != "targetId"]
    if not bad:
        return None
    return (
        "Use igltf_set_script_inputs for @igltfInput fields (deprecated raw serializedProps): "
        + ", ".join(sorted(bad))
    )


def _introspect_script_fields(
    project_id: str, script_asset_id: str, snapshot: dict[str, Any]
) -> dict[str, Any]:
    from app.script_input_schema import (
        annotation_to_mcp_field,
        parse_igltf_input_annotations,
        read_script_asset_source,
        script_export_name,
    )

    source, asset, err = read_script_asset_source(project_id, script_asset_id, snapshot)
    if err or not source or not asset:
        return {"error": {"code": "script_source_unavailable", "message": err or "Script source unavailable"}}
    export_name = script_export_name(asset)
    if not export_name:
        return {
            "error": {
                "code": "script_export_missing",
                "message": f"Script asset {script_asset_id!r} has no scriptExports[0]",
            }
        }
    annotations = parse_igltf_input_annotations(source, export_name)
    fields = [annotation_to_mcp_field(name, defn) for name, defn in sorted(annotations.items())]
    return {
        "scriptAssetId": script_asset_id,
        "exportName": export_name,
        "fields": fields,
    }


def igltf_introspect_script_inputs(project_id: str, script_asset_id: str) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    payload = _introspect_script_fields(project_id, script_asset_id, snap)
    if "error" in payload:
        return payload
    return _with_session_capabilities(project_id, {"projectId": project_id, **payload})


def igltf_get_script_attachment_inputs(
    project_id: str,
    node_id: str,
    attachment_id: str,
) -> dict[str, Any]:
    from app.script_input_schema import _asset_by_id, format_stored_for_display

    snap = _require_live(project_id)
    if "error" in snap:
        return snap

    _, att = _find_attachment(snap, node_id, attachment_id)
    if att is None:
        return {"error": {"code": "attachment_not_found", "message": f"Attachment {attachment_id!r} not found on node {node_id!r}"}}

    script_asset_id = att.get("scriptAssetRef")
    if not isinstance(script_asset_id, str):
        return {"error": {"code": "invalid_attachment", "message": "Attachment has no scriptAssetRef"}}

    intro = _introspect_script_fields(project_id, script_asset_id, snap)
    if "error" in intro:
        return intro

    props = att.get("serializedProps") if isinstance(att.get("serializedProps"), dict) else {}
    node_names = _snapshot_node_names(snap)
    asset_names = _snapshot_asset_names(snap)

    def attachment_label(node_id: str, attachment_id: str) -> str:
        scene = snap.get("scene")
        if not isinstance(scene, dict) or not isinstance(scene.get("nodes"), list):
            return f"{node_id} / {attachment_id}"
        for raw in scene["nodes"]:
            if not isinstance(raw, dict) or raw.get("id") != node_id:
                continue
            atts = raw.get("interactionAttachments")
            if not isinstance(atts, list):
                break
            for att in atts:
                if not isinstance(att, dict) or att.get("id") != attachment_id:
                    continue
                node_name = raw.get("name") if isinstance(raw.get("name"), str) else node_id
                script_ref = att.get("scriptAssetRef")
                export = attachment_id
                if isinstance(script_ref, str):
                    asset = _asset_by_id(_snapshot_assets(snap), script_ref)
                    exports = asset.get("scriptExports") if asset else None
                    if isinstance(exports, list) and exports and isinstance(exports[0], str):
                        export = exports[0]
                    else:
                        export = asset_names.get(script_ref, script_ref)
                return f"{node_name} / {export}"
        return f"{node_names.get(node_id, node_id)} / {attachment_id}"

    field_rows: list[dict[str, Any]] = []
    for row in intro.get("fields", []):
        if not isinstance(row, dict):
            continue
        field = row.get("field")
        if not isinstance(field, str):
            continue
        defn = row.get("inputDef") if isinstance(row.get("inputDef"), dict) else {}
        stored = props.get(field)
        field_rows.append(
            {
                **row,
                "storedValue": stored,
                "displayLabel": format_stored_for_display(
                    defn,
                    stored,
                    node_name=lambda nid: node_names.get(nid, nid),
                    asset_name=lambda aid: asset_names.get(aid, aid),
                    attachment_label=attachment_label,
                ),
            }
        )

    return _with_session_capabilities(
        project_id,
        {
            "projectId": project_id,
            "nodeId": node_id,
            "attachmentId": attachment_id,
            "scriptAssetId": script_asset_id,
            "exportName": intro.get("exportName"),
            "fields": field_rows,
            "serializedProps": props,
        },
    )


async def igltf_set_script_inputs(
    project_id: str,
    node_id: str,
    attachment_id: str,
    inputs: list[dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(inputs, list) or not inputs:
        return {"error": {"code": "invalid_argument", "message": "inputs must be a non-empty array"}}

    params: dict[str, Any] = {"nodeId": node_id, "attachmentId": attachment_id, "inputs": inputs}
    return await _dispatch(project_id, "set_script_inputs", params)


def igltf_get_bounds_metadata(
    project_id: str,
    target: str,
    id: str,
) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap

    if target == "node":
        scene = snap.get("scene")
        if isinstance(scene, dict) and isinstance(scene.get("nodes"), list):
            for raw in scene["nodes"]:
                if not isinstance(raw, dict) or raw.get("id") != id:
                    continue
                bounds = raw.get("authoringBounds")
                return _with_session_capabilities(
                    project_id,
                    {
                        "projectId": project_id,
                        "target": "node",
                        "id": id,
                        "authoringBounds": bounds if isinstance(bounds, dict) else None,
                    },
                )
        return {"error": {"code": "node_not_found", "message": f"Node {id!r} not found"}}

    if target == "asset":
        assets = snap.get("assets")
        if isinstance(assets, list):
            for raw in assets:
                if not isinstance(raw, dict) or raw.get("assetId") != id:
                    continue
                bounds = raw.get("authoringBounds")
                return _with_session_capabilities(
                    project_id,
                    {
                        "projectId": project_id,
                        "target": "asset",
                        "id": id,
                        "authoringBounds": bounds if isinstance(bounds, dict) else None,
                    },
                )
        return {"error": {"code": "asset_not_found", "message": f"Asset {id!r} not found"}}

    return {"error": {"code": "invalid_argument", "message": "target must be node or asset"}}


async def igltf_measure_scene_node_bounds(
    project_id: str,
    node_id: str,
    space: str = "world",
    persist: bool = False,
) -> dict[str, Any]:
    params: dict[str, Any] = {"nodeId": node_id, "space": space, "persist": persist}
    return await _dispatch(
        project_id,
        "measure_scene_node_bounds",
        params,
        require_scene_edit=persist,
    )


async def igltf_measure_asset_bounds(
    project_id: str,
    asset_id: str,
    persist: bool = False,
) -> dict[str, Any]:
    params: dict[str, Any] = {"assetId": asset_id, "persist": persist}
    return await _dispatch(
        project_id,
        "measure_asset_bounds",
        params,
        require_scene_edit=persist,
    )


async def igltf_measure_scene_subtree_bounds(
    project_id: str,
    node_id: str,
    space: str = "world",
    persist: bool = False,
) -> dict[str, Any]:
    params: dict[str, Any] = {"nodeId": node_id, "space": space, "persist": persist}
    return await _dispatch(
        project_id,
        "measure_scene_subtree_bounds",
        params,
        require_scene_edit=persist,
    )


async def igltf_compare_bounds(
    project_id: str,
    a: str,
    b: str,
    target: str = "node",
    space: str = "world",
) -> dict[str, Any]:
    if target not in ("node", "subtree", "asset"):
        return {"error": {"code": "invalid_argument", "message": "target must be node, subtree, or asset"}}
    params: dict[str, Any] = {"a": a, "b": b, "target": target, "space": space}
    return await _dispatch(
        project_id,
        "compare_bounds",
        params,
        require_scene_edit=False,
    )


async def igltf_get_viewport_camera_summary(project_id: str) -> dict[str, Any]:
    return await _dispatch(
        project_id,
        "get_viewport_camera_summary",
        {},
        require_scene_edit=False,
    )


def igltf_list_registered_projects() -> dict[str, Any]:
    """Hub registry rows with live editor session capabilities per project id."""
    from pathlib import Path

    from app.projects_registry import load_registry

    rows: list[dict[str, Any]] = []
    for p in load_registry().projects:
        disk = Path(p.diskPath)
        caps = build_session_capabilities(editor_session_hub.get(p.id))
        rows.append(
            {
                "id": p.id,
                "diskPath": p.diskPath,
                "displayName": disk.name,
                "lastSavedAt": p.lastSavedAt,
                **caps,
            }
        )
    return {"projects": rows}


def igltf_resolve_project_id(
    *,
    disk_path: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    """
    Resolve hub UUID for MCP tools. Prefer `.igltf/project-id` in the workspace, then registry diskPath match.
    Do not guess folder names as project_id — they are UUIDs unless legacy slug layout applies.
    """
    from pathlib import Path

    from app.project_identity import read_project_identity_file
    from app.projects_registry import get_by_disk_path, load_registry

    if disk_path:
        try:
            root = Path(disk_path).expanduser().resolve()
        except (OSError, ValueError):
            return {"error": {"code": "invalid_argument", "message": f"Invalid disk_path: {disk_path!r}"}}
        if not root.is_dir():
            return {"error": {"code": "not_found", "message": f"Directory not found: {root}"}}

        from_file = read_project_identity_file(root)
        if from_file:
            return {
                "projectId": from_file,
                "diskPath": str(root),
                "source": "workspace_file",
                "sessionCapabilities": build_session_capabilities(editor_session_hub.get(from_file)),
            }

        reg = load_registry()
        hit = get_by_disk_path(reg, root)
        if hit:
            return {
                "projectId": hit.id,
                "diskPath": str(root),
                "source": "registry",
                "sessionCapabilities": build_session_capabilities(editor_session_hub.get(hit.id)),
            }

        return {
            "error": {
                "code": "project_not_registered",
                "message": f"No hub registration for {root}",
                "userMessage": "This workspace folder is not registered with the igltf hub.",
                "userAction": (
                    "Register it via igltf-editor hub or POST /studio/projects/register, "
                    "then read `.igltf/project-id` or use igltf_list_registered_projects."
                ),
            }
        }

    if display_name:
        name = display_name.strip()
        reg = load_registry()
        matches = [p for p in reg.projects if Path(p.diskPath).name == name]
        if len(matches) == 1:
            p = matches[0]
            return {
                "projectId": p.id,
                "diskPath": p.diskPath,
                "displayName": name,
                "source": "registry_display_name",
                "sessionCapabilities": build_session_capabilities(editor_session_hub.get(p.id)),
            }
        if len(matches) > 1:
            return {
                "error": {
                    "code": "ambiguous_display_name",
                    "message": f"Multiple registered projects named {name!r}",
                    "candidates": [{"id": p.id, "diskPath": p.diskPath} for p in matches],
                    "userAction": "Pass disk_path instead of display_name.",
                }
            }
        return {
            "error": {
                "code": "project_not_registered",
                "message": f"No registered project with display name {name!r}",
                "userAction": "Use igltf_list_registered_projects or pass disk_path.",
            }
        }

    return {"error": {"code": "invalid_argument", "message": "Provide disk_path or display_name"}}
