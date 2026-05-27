from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.server import StreamableHTTPASGIApp

from app.assets_disk_sync import import_gltf_asset_from_absolute_path
from app.authoring_kit_fs import list_framework_kit_files_rel, read_framework_kit_file, resolve_authoring_kit_root
from app.mcp_scene_tools import (
    igltf_add_script_to_node,
    igltf_apply_transform_batch,
    igltf_compare_bounds,
    igltf_convert_transform_convention,
    igltf_create_empty_node,
    igltf_delete_nodes,
    igltf_get_bounds_metadata,
    igltf_get_descriptions,
    igltf_get_editor_session_status,
    igltf_get_node_details,
    igltf_get_node_transform,
    igltf_get_nodes_details,
    igltf_get_script_attachment_inputs,
    igltf_get_transform_conventions,
    igltf_get_viewport_camera_summary,
    igltf_instantiate_asset,
    igltf_introspect_script_inputs,
    igltf_list_assets,
    igltf_list_registered_projects,
    igltf_list_scene_hierarchy,
    igltf_measure_asset_bounds,
    igltf_measure_scene_node_bounds,
    igltf_measure_scene_subtree_bounds,
    igltf_remove_script_from_node,
    igltf_rename_node,
    igltf_reparent_node,
    igltf_resolve_project_id,
    igltf_set_description,
    igltf_set_node_transform,
    igltf_set_node_visibility,
    igltf_set_script_inputs,
    igltf_undo_last_editor_change,
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
def mcp_list_scene_hierarchy(
    project_id: str,
    include_descriptions: bool = False,
    include_transforms: bool = False,
    transform_space: str = "both",
) -> dict[str, object]:
    """Compact scene tree from the live editor session. Optionally includes local/world transforms per node."""

    return igltf_list_scene_hierarchy(
        project_id,
        include_descriptions=include_descriptions,
        include_transforms=include_transforms,
        transform_space=transform_space,
    )


@framework_fast_mcp.tool(name="igltf_list_assets")
def mcp_list_assets(project_id: str) -> dict[str, object]:
    """Asset catalog from the live editor session."""

    return igltf_list_assets(project_id)


@framework_fast_mcp.tool(name="igltf_import_gltf_asset")
def mcp_import_gltf_asset(
    project_id: str,
    source_path: str,
    logical_name: str | None = None,
    display_name: str | None = None,
) -> dict[str, object]:
    """
    Copy an absolute .glb/.gltf file path into the project's assets/ folder and sync the asset catalog.
    Optional logical_name/display_name set a stable catalog name (resolved by name in main.json).
    Does not mutate the scene; instantiate the returned assetId separately when needed.
    """

    return import_gltf_asset_from_absolute_path(
        project_id,
        source_path,
        logical_name=logical_name,
        display_name=display_name,
    )


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


@framework_fast_mcp.tool(name="igltf_get_node_transform")
def mcp_get_node_transform(
    project_id: str,
    node_id: str,
    include_matrix: bool = True,
) -> dict[str, object]:
    """Local and world TRS (+ optional 4x4 world matrix) for one node from the live snapshot."""

    return igltf_get_node_transform(project_id, node_id, include_matrix=include_matrix)


@framework_fast_mcp.tool(name="igltf_get_nodes_details")
def mcp_get_nodes_details(
    project_id: str,
    node_ids: list[str],
    include_transforms: bool = True,
) -> dict[str, object]:
    """Batch node details (and optional transforms) from the live snapshot."""

    return igltf_get_nodes_details(project_id, node_ids, include_transforms=include_transforms)


@framework_fast_mcp.tool(name="igltf_get_transform_conventions")
def mcp_get_transform_conventions() -> dict[str, object]:
    """Coordinate system, rotation order (XYZ radians), and storage conventions for igltf-editor transforms."""

    return igltf_get_transform_conventions()


@framework_fast_mcp.tool(name="igltf_convert_transform_convention")
def mcp_convert_transform_convention(
    source: str,
    target: str,
    transform: dict[str, object],
) -> dict[str, object]:
    """Pure conversion between transform conventions (e.g. unity_lh_y_up -> gltf_rh_y_up)."""

    return igltf_convert_transform_convention(source, target, transform)  # type: ignore[arg-type]


@framework_fast_mcp.tool(name="igltf_introspect_script_inputs")
def mcp_introspect_script_inputs(project_id: str, script_asset_id: str) -> dict[str, object]:
    """
    Parse @igltfInput JSDoc on a script catalog asset (read-only).
    Returns field schema: inputKind, inputDef per annotated public field.
    """

    return igltf_introspect_script_inputs(project_id, script_asset_id)


@framework_fast_mcp.tool(name="igltf_get_script_attachment_inputs")
def mcp_get_script_attachment_inputs(
    project_id: str,
    node_id: str,
    attachment_id: str,
) -> dict[str, object]:
    """
    Schema + current serializedProps for one script attachment on a scene node (read-only).
    Includes displayLabel for node/script/gltfAsset refs from live session names.
    """

    return igltf_get_script_attachment_inputs(project_id, node_id, attachment_id)


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


@framework_fast_mcp.tool(name="igltf_measure_scene_subtree_bounds")
async def mcp_measure_scene_subtree_bounds(
    project_id: str,
    node_id: str,
    space: str = "world",
    persist: bool = False,
) -> dict[str, object]:
    """Union viewport bounds for a node and all descendants."""

    return await igltf_measure_scene_subtree_bounds(project_id, node_id, space=space, persist=persist)


@framework_fast_mcp.tool(name="igltf_compare_bounds")
async def mcp_compare_bounds(
    project_id: str,
    a: str,
    b: str,
    target: str = "node",
    space: str = "world",
) -> dict[str, object]:
    """Compare viewport-measured bounds of two nodes, subtrees, or catalog assets."""

    return await igltf_compare_bounds(project_id, a, b, target=target, space=space)


@framework_fast_mcp.tool(name="igltf_get_viewport_camera_summary")
async def mcp_get_viewport_camera_summary(project_id: str) -> dict[str, object]:
    """Editor viewport camera pose, clip planes, orbit target, and visible scene roots."""

    return await igltf_get_viewport_camera_summary(project_id)


@framework_fast_mcp.tool(name="igltf_apply_transform_batch")
async def mcp_apply_transform_batch(
    project_id: str,
    updates: list[dict[str, object]],
    space: str = "local",
    dry_run: bool = False,
    transaction_label: str | None = None,
) -> dict[str, object]:
    """Atomically apply multiple transform updates (dry_run previews without mutating)."""

    return await igltf_apply_transform_batch(
        project_id,
        updates,  # type: ignore[arg-type]
        space=space,
        dry_run=dry_run,
        transaction_label=transaction_label,
    )


@framework_fast_mcp.tool(name="igltf_undo_last_editor_change")
async def mcp_undo_last_editor_change(project_id: str) -> dict[str, object]:
    """Undo the last editor change (single step on the editor undo stack)."""

    return await igltf_undo_last_editor_change(project_id)


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


@framework_fast_mcp.tool(name="igltf_create_empty_node")
async def mcp_create_empty_node(
    project_id: str,
    parent_id: str | None = None,
    name: str | None = None,
    position: list[float] | None = None,
) -> dict[str, object]:
    """Create an empty scene node under parent_id (or root). Requires canMutateScene."""

    return await igltf_create_empty_node(project_id, parent_id=parent_id, name=name, position=position)


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
    """
    Attach an interaction script asset to a scene node.
    For event interactions, unannotated runtime options such as {"hold": true}
    may be provided in serialized_props; use igltf_set_script_inputs for @igltfInput fields.
    """

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
    """
    Update serializedProps and/or script asset on an existing attachment.
    Deprecated for @igltfInput annotated fields — use igltf_set_script_inputs instead.
    For unannotated event runtime options such as {"hold": true}, serializedProps is allowed.
    """

    return await igltf_update_script_on_node(
        project_id,
        node_id,
        attachment_id,
        serialized_props=serialized_props,
        script_asset_id=script_asset_id,
    )


@framework_fast_mcp.tool(name="igltf_set_script_inputs")
async def mcp_set_script_inputs(
    project_id: str,
    node_id: str,
    attachment_id: str,
    inputs: list[dict[str, object]],
) -> dict[str, object]:
    """
    Set @igltfInput fields on a script attachment with semantic validation.
    Each input: { "field": "doorTarget", "value": { "nodeId": "…" } } (or scalar / nested object).
    Requires canMutateScene. Do not hand-patch annotated serializedProps via igltf_update_script_on_node.
    """

    return await igltf_set_script_inputs(project_id, node_id, attachment_id, inputs)


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
