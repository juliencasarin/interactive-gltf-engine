# Editor UI — shell, panels, menus

**Status:** Implemented (`igltf-editor-frontend`).

Routes: **`/`** hub, **`/editor/:id`**, **`/play/:id`**.

## Shell layout (`EditorShell`)

Sketcher-inspired resizable panels:

| Panel | Role |
|-------|------|
| **Hierarchy** | Scene tree, DnD reparent/reorder, context menu (expand/collapse interior, delete, duplicate) |
| **Preview** | Three.js viewport, gizmo, asset drop onto scene, raycast selection |
| **Inspector** | Transform, visibility, description, script attachments + `serializedProps` |
| **Assets** | Catalog — [assets-panel.md](assets-panel.md) |
| **Libraries** | Placeholder / future DCC libraries |

Toolbar: **File**, **Settings**, undo/redo, save indicator, **Build & Play**, transform tools (Q/W/E/R), gizmo Local/Global toggle.

## File menu

| Item | Behaviour |
|------|-------------|
| **Save** | `PUT /document` when API configured; clears dirty |
| **Save As** | Download v2 JSON backup |
| **Open** | Local `.json` file (v1 or v2) — offline or import |
| **Import glTF** | Stage upload + add to catalog |
| **Close** | Navigate to hub |

Shortcuts: **Ctrl+S** save, **Ctrl+W** close (when bound).

When **`VITE_API_BASE_URL`** unset: local-only open/save without server.

## Settings menu

| Control | Behaviour |
|---------|-------------|
| **Allow scene edition** | Toggles `editorSettings.mcpAllowSceneEdition`; **immediate `PUT`** partial settings persist |
| Session hints | Live WS status; read-only vs mutation-capable MCP |
| Project UUID | Display + pointer to `.igltf/project-id` |

MCP mutations still require **Save** for disk persistence after live session edits.

See [mcp-scene-authoring.md](mcp-scene-authoring.md).

## Undo / redo

- In-memory stacks in **`EditorContext`** (max **100** steps)
- Captures scene nodes + assets snapshot per history push
- **Ctrl+Z** / **Ctrl+Shift+Z** via `EditorToolsBar`
- Gizmo drag = one undo step (begin/end hooks)
- Monaco script typing uses **`updateScriptSourceWithoutHistory`** — not in undo stack until explicit catalog-changing ops

## Build & Play flow

1. User clicks **Build & Play** (or hub **Compile** without editor)
2. If dirty → prompt save first
3. `POST /projects/{id}/build-play-glb`
4. Navigate to **`/play/{id}`** (or open Play from hub)

See [play-export.md](play-export.md).

## Hierarchy operations

| Operation | Notes |
|-----------|--------|
| Reparent | `keepWorldPosition: true`; interior placement guard — [interior-scene-nodes.md](interior-scene-nodes.md) |
| Reorder | Insert before sibling |
| Expand interior | Context menu → fetches `gltf-interior-manifest`, creates mirror rows |
| Collapse interior | Removes mirror subtree for placement |
| Duplicate | Clones subtree with new ids |
| Delete | Subtree removal |

## Inspector (scene node)

- Transform foldout — [transform-authoring.md](transform-authoring.md)
- Visibility checkbox
- Description (MCP-facing)
- **Interaction attachments** — add/remove script assets, edit `serializedProps` via interaction introspection
- Delete / duplicate actions

## Preview viewport

- Loads glTF from `/files/…` URLs (or data URL fallback)
- Renders placement + interior mirror deltas
- Drag catalog glTF → raycast placement (`instantiate` equivalent)
- Selection syncs hierarchy ↔ inspector

## Open in IDE

When **`VITE_OPEN_IN_IDE=true`**: button calls `POST …/open-in-ide` (Cursor default). Requires API on same machine as IDE.

## Sketcher parity tracking

Target inventory: [`../sketcher-migration/`](../sketcher-migration/) and `igltf-editor-frontend/migration.md` — **not** as-built truth; this document is.

## Related

- [editor-session-protocol.md](editor-session-protocol.md) — MCP live edits
- [studio-hub.md](studio-hub.md) — project entry
