# interactive-gltf-engine — documentation

**Language:** English.

Authoritative product and engineering documentation for the **reference implementation** (igltf-editor, backend, Play, desktop packaging). Portable glTF / JS scripting **standard** lives in **`interactive-gltf-specs`**.

**New here?** Start with **[../GETTING_STARTED.md](../GETTING_STARTED.md)**.

## Milestone 1 (current)

See **[milestone-1-scope.md](milestone-1-scope.md)** for what is **implemented** vs deferred.

## Index

| Document | Scope |
|----------|--------|
| [configuration.md](configuration.md) | Environment variables (backend + frontend) |
| [milestone-1-scope.md](milestone-1-scope.md) | Shipped features, known limits, out of scope |
| [editor/README.md](editor/README.md) | **igltf-editor** — full spec index |
| [sketcher-migration/](sketcher-migration/) | UI parity targets vs UMI3D Sketcher (not as-built) |
| [../tauri-build/README.md](../tauri-build/README.md) | Desktop NSIS installer, PyInstaller, WebView2 DnD |

## Quick start paths

| Role | Start here |
|------|------------|
| Author / developer | [editor/studio-hub.md](editor/studio-hub.md) → [editor/editor-ui.md](editor/editor-ui.md) |
| Agent / MCP | [editor/mcp-scene-authoring.md](editor/mcp-scene-authoring.md) + authoring kit |
| Backend integrator | [editor/http-api.md](editor/http-api.md) |
| Format alignment | `interactive-gltf-specs` proposals (editor leads — see [editor/README.md](editor/README.md)) |

## Packages (placeholders)

| Package | Status | Doc |
|---------|--------|-----|
| `igltf-editor-frontend` + `igltf-editor-backend` | **Implemented** | [editor/](editor/) |
| `igltf-editor-core` | Logic in backend; extract later | [../igltf-editor-core/README.md](../igltf-editor-core/README.md) |
| `igltf-engine` | Not implemented (Play inline in frontend) | [../igltf-engine/README.md](../igltf-engine/README.md) |
