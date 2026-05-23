# igltf-editor — technical documentation

**Language:** English.

Authoritative **product specs** for the reference implementation. The editor often **leads** the portable standard in **`interactive-gltf-specs`** — document here first, then sync proposals when export diverges.

## Documentation policy

| Layer | Location |
|-------|----------|
| **Editor (this folder)** | Full implemented behaviour |
| **Portable standard** | `interactive-gltf-specs` — glTF extensions + JS scripting only |

See also **[../README.md](../README.md)** (engine-wide index) and **[../milestone-1-scope.md](../milestone-1-scope.md)**.

## Index — data & API

| Document | Scope |
|----------|--------|
| [igltf-editor-project.md](igltf-editor-project.md) | `project.json` v2 schema |
| [project-persistence.md](project-persistence.md) | Disk layout, save/load principles |
| [http-api.md](http-api.md) | **Complete** REST, WebSocket, MCP routes |
| [studio-hub.md](studio-hub.md) | Projects registry + hub UI |
| [disk-sync.md](disk-sync.md) | External IDE file watch + catalog merge |

## Index — authoring & export

| Document | Scope |
|----------|--------|
| [interior-scene-nodes.md](interior-scene-nodes.md) | Catalogue mirrors, expand/collapse, export |
| [play-export.md](play-export.md) | `build/scene.glb`, extensions, proto alignment |
| [play-viewer.md](play-viewer.md) | Play runtime behaviour |
| [script-authoring.md](script-authoring.md) | JS modules, lifecycle, transactions |
| [host-api.md](host-api.md) | Global `GLTF` API |
| [transform-authoring.md](transform-authoring.md) | Inspector + gizmo |
| [authoring-bounds.md](authoring-bounds.md) | Measured bounds (MCP-only persist) |

## Index — UI & agents

| Document | Scope |
|----------|--------|
| [editor-ui.md](editor-ui.md) | Shell, panels, File/Settings, undo, Build→Play |
| [assets-panel.md](assets-panel.md) | Catalog, Monaco, folders, import |
| [mcp-scene-authoring.md](mcp-scene-authoring.md) | MCP tools + agent policy |
| [editor-session-protocol.md](editor-session-protocol.md) | Live session WebSocket + command ops |

## Related (outside this folder)

| Path | Role |
|------|------|
| [../configuration.md](../configuration.md) | Environment variables |
| [../../igltf-editor-backend/README.md](../../igltf-editor-backend/README.md) | Backend dev setup |
| [../../igltf-editor-frontend/README.md](../../igltf-editor-frontend/README.md) | Frontend dev setup |
| [../../tauri-build/README.md](../../tauri-build/README.md) | Desktop packaging |
| [../sketcher-migration/](../sketcher-migration/) | Parity **targets** (not as-built) |

## Portable standard cross-links

| Editor topic | Specs proposal |
|--------------|----------------|
| Scripts, host API | `proposal-interactive-gltf-javascript-scripts` |
| Interaction on glTF nodes | `proposal-umi3d-interaction-model` |
