"""MCP tools for live scene read/write via editor session."""

from __future__ import annotations

from typing import Any

from app.editor_session import EditorSessionError, EditorSessionState, editor_session_hub


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


def build_scene_hierarchy(snapshot: dict[str, Any], *, include_descriptions: bool = False) -> list[dict[str, Any]]:
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
        out.append(row)
    return out


def igltf_get_editor_session_status(project_id: str) -> dict[str, Any]:
    return _session_status(project_id)


def igltf_list_scene_hierarchy(
    project_id: str,
    include_descriptions: bool = False,
) -> dict[str, Any]:
    snap = _require_live(project_id)
    if "error" in snap:
        return snap
    return _with_session_capabilities(
        project_id,
        {
            "projectId": project_id,
            "revision": editor_session_hub.require_live(project_id).revision,
            "nodes": build_scene_hierarchy(snap, include_descriptions=include_descriptions),
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
    return await _dispatch(project_id, "update_script_attachment", params)


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
