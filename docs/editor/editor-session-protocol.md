# Editor session — WebSocket protocol

**Status:** Implemented.

**Endpoint:** `WS /projects/{project_id}/editor/session`  
**Backend:** `editor_session.py`  
**Frontend:** `editorSessionClient.ts`, `editorMcpCommands.ts`

## Purpose

While the editor is open, the frontend pushes a live **`project.json`** snapshot to the backend. MCP read/write tools use this session — **not** unsaved-on-disk state alone.

## Connection lifecycle

1. Frontend opens WebSocket when editor mounts and API configured
2. Server sends **`{ type: "hello", projectId }`**
3. Frontend sends **`session_register`** with full snapshot
4. On each revision change → **`session_update`**
5. Exponential backoff reconnect (max ~15s) on disconnect
6. New connection replaces previous (old socket closed with code 4000)

## Client → server messages

### `session_register` / `session_update`

```json
{
  "type": "session_register",
  "revision": 42,
  "mcpAllowSceneEdition": true,
  "snapshot": { "format": "igltf-editor-project", "version": 2, "scene": {…}, "assets": […] }
}
```

| Field | Meaning |
|-------|---------|
| `revision` | Monotonic editor revision (increments on scene mutations) |
| `mcpAllowSceneEdition` | Mirror of Settings checkbox |
| `snapshot` | Full v2 document as in memory |

Backend stores snapshot + flags on `EditorSessionState`.

### `command_result`

Response to server **`command`** message:

```json
{
  "type": "command_result",
  "requestId": "uuid",
  "ok": true,
  "revision": 43,
  "result": { }
}
```

On failure:

```json
{
  "ok": false,
  "error": { "code": "…", "message": "…", "userMessage": "…", "userAction": "…" }
}
```

Frontend blocks mutations when `mcpAllowSceneEdition` is false (even if server forwarded command).

## Server → client messages

### `command`

MCP tool dispatched via backend:

```json
{
  "type": "command",
  "requestId": "uuid",
  "op": "set_node_transform",
  "params": { "node_id": "…", "position": [0,0,0], … }
}
```

**Timeout:** 10 seconds (`COMMAND_TIMEOUT_S`).

### Command ops (frontend handler)

| `op` | Maps to MCP tool |
|------|------------------|
| `create_empty_node` | `igltf_create_empty_node` |
| `set_node_transform` | `igltf_set_node_transform` |
| `apply_transform_batch` | `igltf_apply_transform_batch` |
| `undo_last_change` | `igltf_undo_last_editor_change` |
| `reparent_node` | `igltf_reparent_node` |
| `rename_node` | `igltf_rename_node` |
| `set_node_visibility` | `igltf_set_node_visibility` |
| `instantiate_asset` | `igltf_instantiate_asset` |
| `delete_nodes` | `igltf_delete_nodes` |
| `set_description` | `igltf_set_description` |
| `add_script_attachment` | `igltf_add_script_to_node` |
| `remove_script_attachment` | `igltf_remove_script_from_node` |
| `update_script_attachment` | `igltf_update_script_on_node` |
| `measure_scene_node_bounds` | `igltf_measure_scene_node_bounds` |
| `measure_scene_subtree_bounds` | `igltf_measure_scene_subtree_bounds` |
| `compare_bounds` | `igltf_compare_bounds` |
| `measure_asset_bounds` | `igltf_measure_asset_bounds` |
| `get_viewport_camera_summary` | `igltf_get_viewport_camera_summary` |

Measure ops with **`persist: true`** count as scene mutations (require allow flag).

`apply_transform_batch` with **`dry_run: true`** is read-only (preview resolved local/world TRS without mutating).

### Transform conventions (MCP audit)

- **Coordinate system:** right-handed, **Y-up**, lengths in **meters** (glTF / igltf-editor).
- **Stored rotations:** Euler **XYZ** in **radians** on each node (`position` / `rotation` / `scale` are **local** under the parent).
- **`set_node_transform` / batch with `space: "world"`:** world Euler XYZ radians are converted to local TRS under the parent before persistence.
- **Read-only audit (no live WebSocket):** `igltf_get_node_transform`, `igltf_get_nodes_details`, `igltf_list_scene_hierarchy` (`include_transforms`), `igltf_get_transform_conventions` — world TRS composed from the live snapshot in the backend.
- **Convention conversion (pure):** `igltf_convert_transform_convention` (e.g. `unity_lh_y_up` → `gltf_rh_y_up`).

Implementation: **`dispatchEditorMcpCommand`** in `editorMcpCommands.ts` → `EditorContext` mutations. Viewport measure uses Three.js scene registry (`editorViewportBounds.ts`).

## Session errors (MCP)

| Code | Meaning |
|------|---------|
| `no_live_session` | No snapshot yet |
| `mcp_scene_edition_disabled` | Flag off |
| `editor_not_connected` | WebSocket down |
| `command_timeout` | No `command_result` in 10s |
| `command_failed` | Frontend returned `ok: false` |

## Persistence note

Live session updates **editor memory** only until user **Save** (`PUT /document`). Settings checkbox persists **`editorSettings`** immediately via dedicated save path.

## Related

- [mcp-scene-authoring.md](mcp-scene-authoring.md) — tool list + agent policy
- [authoring-bounds.md](authoring-bounds.md) — measure ops
