from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.server import StreamableHTTPASGIApp

from app.authoring_kit_fs import list_framework_kit_files_rel, read_framework_kit_file, resolve_authoring_kit_root
from app.mcp_scene_tools import (
    igltf_add_script_to_node,
    igltf_delete_nodes,
    igltf_get_bounds_metadata,
    igltf_get_descriptions,
    igltf_get_editor_session_status,
    igltf_get_node_details,
    igltf_instantiate_asset,
    igltf_list_assets,
    igltf_list_registered_projects,
    igltf_list_scene_hierarchy,
    igltf_measure_asset_bounds,
    igltf_measure_scene_node_bounds,
    igltf_remove_script_from_node,
    igltf_rename_node,
    igltf_reparent_node,
    igltf_resolve_project_id,
    igltf_set_description,
    igltf_set_node_transform,
    igltf_set_node_visibility,
    igltf_update_script_on_node,
)
from app.version_info import ENGINE_VERSION

logger = logging.getLogger(__name__)

"""Single Fast MCP instance bundled with igltf-editor-backend."""
framework_fast_mcp = FastMCP(
    name="interactive-gltf-framework",
    instructions=(
        "Interactive glTF authoring: browse authoring_kit docs/scripts; read and mutate the live editor scene "
        "when igltf-editor is open on the project.\n\n"
        "NEVER create, edit, or patch project.json in a workspace — not as a fallback when the live session "
        "is missing or canMutateScene is false. Tell the user to open igltf-editor instead.\n\n"
        "Before any scene mutation, call igltf_get_editor_session_status (or read sessionCapabilities on any live "
        "scene tool). If canMutateScene is false, do NOT attempt write tools — tell the user userMessage and "
        "userAction from the response (typically: enable Settings → Allow scene edition in igltf-editor).\n\n"
        "Resolve project UUID with igltf_list_registered_projects or igltf_resolve_project_id (read `.igltf/project-id` "
        "in the workspace). Never use the folder display name as project_id unless igltf_resolve_project_id confirms it.\n\n"
        f"Backend engineVersion is {ENGINE_VERSION!r}; correlate with REST GET /health."
    ),
    streamable_http_path="/",
    stateless_http=True,
)

_streamable_mount_handler: StreamableHTTPASGIApp | None = None


@framework_fast_mcp.tool(name="igltf_list_framework_files")
def igltf_list_framework_files() -> dict[str, object]:
    """Relative paths (.md/.js/.txt) under authoring_kit bundled with igltf-editor-backend (for MCP clients)."""

    root = resolve_authoring_kit_root()
    paths = list_framework_kit_files_rel(root)
    return {
        "engineVersion": ENGINE_VERSION,
        "authoring_kit_root": root.as_posix(),
        "files": paths,
    }


@framework_fast_mcp.tool(name="igltf_read_framework_file")
def igltf_read_framework_file(rel_path: str) -> dict[str, object]:
    """
    UTF-8 text of one authoring_kit file. rel_path uses forward slashes, no traversal.
    See igltf_list_framework_files before reading.
    """

    root = resolve_authoring_kit_root()
    body, nbytes = read_framework_kit_file(rel_path, root)
    return {
        "engineVersion": ENGINE_VERSION,
        "rel_path": rel_path.replace("\\", "/").lstrip("/"),
        "byteLength": nbytes,
        "contents": body,
    }


# --- Live editor scene (requires open editor + session snapshot) ---


@framework_fast_mcp.tool(name="igltf_get_editor_session_status")
def mcp_get_editor_session_status(project_id: str) -> dict[str, object]:
    """
    Live editor session: canReadLiveSession, canMutateScene, mcpAllowSceneEdition, connected, revision.
    Call this before scene mutations; if canMutateScene is false, warn the user with userMessage / userAction.
    """

    return igltf_get_editor_session_status(project_id)


@framework_fast_mcp.tool(name="igltf_list_registered_projects")
def mcp_list_registered_projects() -> dict[str, object]:
    """Hub registry: project UUID, diskPath, displayName, and live sessionCapabilities for each."""

    return igltf_list_registered_projects()


@framework_fast_mcp.tool(name="igltf_resolve_project_id")
def mcp_resolve_project_id(
    disk_path: str | None = None,
    display_name: str | None = None,
) -> dict[str, object]:
    """Resolve hub project UUID from workspace path (reads `.igltf/project-id`) or exact folder display name."""

    return igltf_resolve_project_id(disk_path=disk_path, display_name=display_name)


@framework_fast_mcp.tool(name="igltf_list_scene_hierarchy")
def mcp_list_scene_hierarchy(project_id: str, include_descriptions: bool = False) -> dict[str, object]:
    """Compact scene tree from the live editor session. Includes sessionCapabilities and mutationNotice when read-only."""

    return igltf_list_scene_hierarchy(project_id, include_descriptions=include_descriptions)


@framework_fast_mcp.tool(name="igltf_list_assets")
def mcp_list_assets(project_id: str) -> dict[str, object]:
    """Asset catalog from the live editor session."""

    return igltf_list_assets(project_id)


@framework_fast_mcp.tool(name="igltf_get_descriptions")
def mcp_get_descriptions(
    project_id: str,
    node_ids: list[str] | None = None,
    asset_ids: list[str] | None = None,
) -> dict[str, object]:
    """Author descriptions for scene nodes and/or catalog assets (live session)."""

    return igltf_get_descriptions(project_id, node_ids=node_ids, asset_ids=asset_ids)


@framework_fast_mcp.tool(name="igltf_get_node_details")
def mcp_get_node_details(project_id: str, node_id: str) -> dict[str, object]:
    """Full details for one scene node from the live session."""

    return igltf_get_node_details(project_id, node_id)


@framework_fast_mcp.tool(name="igltf_get_bounds_metadata")
def mcp_get_bounds_metadata(project_id: str, target: str, id: str) -> dict[str, object]:
    """Stored authoringBounds on a scene node (target=node) or catalog asset (target=asset)."""

    return igltf_get_bounds_metadata(project_id, target, id)


@framework_fast_mcp.tool(name="igltf_measure_scene_node_bounds")
async def mcp_measure_scene_node_bounds(
    project_id: str,
    node_id: str,
    space: str = "world",
    persist: bool = False,
) -> dict[str, object]:
    """Measure AABB + bounding sphere for a scene node via the editor viewport (persist stores on node)."""

    return await igltf_measure_scene_node_bounds(project_id, node_id, space=space, persist=persist)


@framework_fast_mcp.tool(name="igltf_measure_asset_bounds")
async def mcp_measure_asset_bounds(
    project_id: str,
    asset_id: str,
    persist: bool = False,
) -> dict[str, object]:
    """Measure model-local AABB + sphere for a catalog glTF asset (persist stores on asset)."""

    return await igltf_measure_asset_bounds(project_id, asset_id, persist=persist)


@framework_fast_mcp.tool(name="igltf_set_node_transform")
async def mcp_set_node_transform(
    project_id: str,
    node_id: str,
    position: list[float] | None = None,
    rotation: list[float] | None = None,
    scale: list[float] | None = None,
    space: str = "local",
) -> dict[str, object]:
    """Set node transform (Euler XYZ radians). Requires canMutateScene (see igltf_get_editor_session_status)."""

    return await igltf_set_node_transform(
        project_id, node_id, position=position, rotation=rotation, scale=scale, space=space
    )


@framework_fast_mcp.tool(name="igltf_reparent_node")
async def mcp_reparent_node(
    project_id: str,
    node_id: str,
    parent_id: str,
    insert_before_sibling_id: str | None = None,
    keep_world_position: bool = True,
) -> dict[str, object]:
    """Reparent a scene node under parent_id."""

    return await igltf_reparent_node(
        project_id,
        node_id,
        parent_id,
        insert_before_sibling_id=insert_before_sibling_id,
        keep_world_position=keep_world_position,
    )


@framework_fast_mcp.tool(name="igltf_rename_node")
async def mcp_rename_node(project_id: str, node_id: str, name: str) -> dict[str, object]:
    """Rename a scene node."""

    return await igltf_rename_node(project_id, node_id, name)


@framework_fast_mcp.tool(name="igltf_set_node_visibility")
async def mcp_set_node_visibility(project_id: str, node_id: str, visible: bool) -> dict[str, object]:
    """Show or hide a scene node in the viewport."""

    return await igltf_set_node_visibility(project_id, node_id, visible)


@framework_fast_mcp.tool(name="igltf_instantiate_asset")
async def mcp_instantiate_asset(
    project_id: str,
    asset_id: str,
    parent_id: str | None = None,
    name: str | None = None,
    position: list[float] | None = None,
) -> dict[str, object]:
    """Place a catalog glTF asset in the scene."""

    return await igltf_instantiate_asset(
        project_id, asset_id, parent_id=parent_id, name=name, position=position
    )


@framework_fast_mcp.tool(name="igltf_delete_nodes")
async def mcp_delete_nodes(project_id: str, node_ids: list[str]) -> dict[str, object]:
    """Delete scene subtrees by root node ids (cannot delete root)."""

    return await igltf_delete_nodes(project_id, node_ids)


@framework_fast_mcp.tool(name="igltf_set_description")
async def mcp_set_description(
    project_id: str,
    target: str,
    id: str,
    description: str,
) -> dict[str, object]:
    """Set author description on a scene node (target=node) or catalog asset (target=asset)."""

    return await igltf_set_description(project_id, target, id, description)


@framework_fast_mcp.tool(name="igltf_add_script_to_node")
async def mcp_add_script_to_node(
    project_id: str,
    node_id: str,
    script_asset_id: str,
    serialized_props: dict[str, object] | None = None,
) -> dict[str, object]:
    """Attach an interaction script asset to a scene node."""

    return await igltf_add_script_to_node(
        project_id, node_id, script_asset_id, serialized_props=serialized_props
    )


@framework_fast_mcp.tool(name="igltf_remove_script_from_node")
async def mcp_remove_script_from_node(
    project_id: str,
    node_id: str,
    attachment_id: str,
) -> dict[str, object]:
    """Remove a script attachment from a scene node."""

    return await igltf_remove_script_from_node(project_id, node_id, attachment_id)


@framework_fast_mcp.tool(name="igltf_update_script_on_node")
async def mcp_update_script_on_node(
    project_id: str,
    node_id: str,
    attachment_id: str,
    serialized_props: dict[str, object] | None = None,
    script_asset_id: str | None = None,
) -> dict[str, object]:
    """Update serializedProps and/or script asset on an existing attachment."""

    return await igltf_update_script_on_node(
        project_id,
        node_id,
        attachment_id,
        serialized_props=serialized_props,
        script_asset_id=script_asset_id,
    )


def prime_mcp_mount_handler() -> StreamableHTTPASGIApp:
    """Initialise FastMCP streamable-http session manager; build ASGI callable for mounting at PUBLIC_BASE_URL + /mcp."""

    global _streamable_mount_handler
    if _streamable_mount_handler is not None:
        return _streamable_mount_handler

    framework_fast_mcp.streamable_http_app()

    mgr = framework_fast_mcp.session_manager

    logger.info("interactive-gltf MCP streamable HTTP mount initialised (%s)", ENGINE_VERSION)

    _streamable_mount_handler = StreamableHTTPASGIApp(mgr)

    return _streamable_mount_handler
