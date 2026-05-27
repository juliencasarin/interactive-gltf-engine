# MCP scene authoring (migration / agents)

Operational reference for **igltf-editor-backend** MCP tools that read or mutate the **live editor session**. See [editor-session-protocol.md](editor-session-protocol.md) for WebSocket message shapes.

## Prerequisites

1. Resolve **`project_id`** (hub UUID): `igltf_list_registered_projects` or `igltf_resolve_project_id` (read `.igltf/project-id` in the workspace).
2. Open the project in **igltf-editor** (not Cursor alone).
3. Call **`igltf_get_editor_session_status`** before mutations. If `canMutateScene` is false, do **not** edit `project.json` on disk.

## Transform audit (read-only)

| Tool | Purpose |
|------|---------|
| `igltf_get_transform_conventions` | RH Y-up, meters, Euler **XYZ radians**, local storage |
| `igltf_get_node_transform` | Local + world TRS (+ optional 16-element column-major `worldMatrix`) for one node |
| `igltf_get_nodes_details` | Batch node details; optional transforms per node |
| `igltf_list_scene_hierarchy` | Pass `include_transforms=true`, `transform_space=local\|world\|both` |
| `igltf_convert_transform_convention` | Pure conversion (e.g. `unity_lh_y_up` → `gltf_rh_y_up`) |

World transforms in audit tools are composed from the parent chain of **local** TRS on the live snapshot (same rules as `transformMath.ts`).

**`set_node_transform` / `igltf_apply_transform_batch` with `space: "world"`:** accepts world Euler XYZ radians; the editor converts to local under the parent before save.

## Safe batch mutations

| Tool | Purpose |
|------|---------|
| `igltf_apply_transform_batch` | `updates[]`, `space`, `dry_run`, optional `transaction_label` — single undo step when applied |
| `igltf_undo_last_editor_change` | One step on the editor undo stack |

Use **`dry_run: true`** to get `wouldAffect`, `resolvedTransforms`, and `errors` without mutating.

## Bounds and viewport

| Tool | Purpose |
|------|---------|
| `igltf_measure_scene_node_bounds` | Per-node viewport AABB + sphere |
| `igltf_measure_scene_subtree_bounds` | Union bounds over a node and descendants |
| `igltf_compare_bounds` | Compare two nodes, subtrees, or catalog assets (`target`: `node` \| `subtree` \| `asset`) |
| `igltf_get_viewport_camera_summary` | Camera pose, clip planes, orbit target, visible roots |
| `igltf_get_bounds_metadata` | Stored `authoringBounds` from snapshot (no viewport) |

See [authoring-bounds.md](authoring-bounds.md). Viewport measure requires meshes loaded in the editor preview.

## Assets

| Tool | Purpose |
|------|---------|
| `igltf_import_gltf_asset` | Copy absolute `.glb`/`.gltf` into `assets/`; optional `logical_name` / `display_name` for stable `ProjectAsset.name` |
| `igltf_list_assets` | Catalog from live session |
| `igltf_instantiate_asset` | Place catalog glTF in the scene |

## Scene structure

| Tool | Purpose |
|------|---------|
| `igltf_create_empty_node` | Empty node under a parent |
| `igltf_get_node_details` | Single-node details (local TRS, scripts, bounds metadata) |
| `igltf_reparent_node` | Reparent with optional `keep_world_position` |
