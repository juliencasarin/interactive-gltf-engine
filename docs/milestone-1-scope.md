# Milestone 1 — implemented scope

**Status:** First major product milestone (author → Play interactive glTF POC).

## Shipped

### Projects hub & persistence

- Hub registry (`projects.json`) with create / register / unregister
- `project.json` v2 + `assets/` + `_staging/` per workspace
- REST save/load, static `/files/…` serving
- Synthetic default document when opening a new project (root node only)
- Workspace bootstrap: `mcp.json`, `.cursor/rules/`, `.igltf/project-id`, `.gitignore` on create

### Editor

- Sketcher-inspired shell: hierarchy, preview, inspector, assets, libraries panels
- Scene graph: placement, interior expand/collapse, reparent, visibility, duplicate, delete
- Transform inspector + viewport gizmo (local/global), undo/redo (100 steps)
- Assets panel: glTF + script import, virtual folders, Monaco script editor, interaction templates
- File menu: save, open local JSON (v1/v2), import, offline fallback when API unset
- Settings: MCP allow scene edition, session status hints, project UUID display
- Build → `build/scene.glb` + optional `scene.js` → open Play

### Backend services

- Full REST + WebSocket API ([http-api.md](editor/http-api.md))
- Assets disk sync + watch ([disk-sync.md](editor/disk-sync.md))
- Live editor session for MCP ([editor-session-protocol.md](editor/editor-session-protocol.md))
- MCP Streamable HTTP (22 tools) + authoring kit
- Play manifest with cache-bust `?v=` on bundle URLs
- Open-in-IDE (Cursor / VS Code / JetBrains) on API host

### Play viewer

- Load merged glTF + bundled or per-asset scripts
- Interaction pointer path, behaviour lifecycle, `GLTF` transactions
- Metrics footer (triangle/mesh counts)

### Desktop (optional)

- Tauri shell + PyInstaller embedded backend ([../tauri-build/README.md](../tauri-build/README.md))

## Partial / editor-only (not portable standard)

| Feature | Notes |
|---------|--------|
| `layerId` on nodes | Persisted; **no layer UI or filtering** yet |
| `scriptDependsOnAssetIds` | Export + schema; **no deps editor UI** |
| `scriptRole: behaviour` | Supported; less UI than interaction scripts |
| Authoring bounds | MCP measure + persist; **no Inspector measure button** |
| Interior via MCP | Expand/collapse **UI only** — not MCP tools (v1) |
| v1 `gltfDataUrl` projects | Import/open locally; not server truth |

## Explicitly deferred

- Auth, multi-tenant, MongoDB
- `igltf-engine` standalone runtime package
- `igltf-editor-core` extraction from backend
- ETag / conflict resolution on concurrent edits
- Skins / animation retarget for interior mirrors
- Production hardening (rate limits, signed assets)

## Portable standard sync

Exported glTF + script contracts tracked in **`interactive-gltf-specs`**. Editor product truth: **`docs/editor/`**.
