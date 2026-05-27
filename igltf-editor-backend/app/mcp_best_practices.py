"""Bootstrap MCP authoring best practices into igltf-editor workspaces."""

from __future__ import annotations

from pathlib import Path

MCP_BEST_PRACTICES_FILENAME = "igltf-edition-mcp-best-practices.md"

MCP_BEST_PRACTICES_BODY = """# igltf-editor MCP best practices

This workspace is an **igltf-editor project**. Agents may inspect files, but scene and catalog changes must go through the live editor session and MCP tools.

## Never edit `project.json`

- Do **not** create, edit, patch, rename, or delete `project.json`.
- Do **not** use `project.json` as a fallback when MCP tools fail or the editor session is unavailable.
- Do **not** hand-edit catalog rows, scene nodes, transforms, visibility, scripts, descriptions, or `authoringBounds` in `project.json`.

## Before any scene mutation

1. Resolve the project UUID with `igltf_resolve_project_id` or `igltf_list_registered_projects`.
2. Call `igltf_get_editor_session_status`.
3. If `canMutateScene` is false, stop and follow the returned `userAction` (usually open igltf-editor and enable Settings -> Allow scene edition).
4. Apply scene changes only through MCP live-session mutation tools or the editor UI, then Save in the editor.

## Recommended MCP workflow

- Read hierarchy: `igltf_list_scene_hierarchy`.
- Read node details/transforms: `igltf_get_node_details`, `igltf_get_node_transform`, `igltf_get_nodes_details`.
- Preview transforms first: `igltf_apply_transform_batch` with `dry_run: true`.
- Apply batched transform changes atomically: `igltf_apply_transform_batch` with `dry_run: false`.
- Undo one editor step if needed: `igltf_undo_last_editor_change`.
- Measure geometry from the viewport: `igltf_measure_scene_node_bounds`, `igltf_measure_scene_subtree_bounds`, `igltf_compare_bounds`.
- Inspect camera context: `igltf_get_viewport_camera_summary`.

## Assets

- Add glTF/GLB assets with `igltf_import_gltf_asset`, or place files under `assets/` and let disk sync update the catalog.
- Use `logical_name` / `display_name` on import when migration scripts need a stable human-readable asset name.
- Instantiate catalog assets with `igltf_instantiate_asset`; do not edit catalog rows by hand.

## Transform conventions

- Coordinate system: glTF / igltf-editor is right-handed, Y-up, in meters.
- Stored transforms are local TRS under the parent.
- Rotations are Euler XYZ in radians.
- World-space transform writes are converted by the editor to local TRS under the parent.
"""


def write_mcp_best_practices_if_absent(project_root: Path) -> bool:
    """Create the project-root best-practices Markdown if missing."""

    target = Path(project_root) / MCP_BEST_PRACTICES_FILENAME
    if target.is_file():
        return False
    target.write_text(MCP_BEST_PRACTICES_BODY, encoding="utf-8")
    return True
