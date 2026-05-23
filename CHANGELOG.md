# Changelog

All notable changes to this repository are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Milestone 1 — interactive glTF editor POC

First public reference implementation aligned with **interactive-gltf-specs** proposals (work in progress).

#### Added

- **Projects hub** — create/register workspaces, compile to Play bundle
- **igltf-editor** — hierarchy, preview, inspector, assets panel, undo/redo, interior expand/collapse
- **project.json v2** — scene graph, asset catalog, script attachments, editor settings
- **Backend API** — document CRUD, asset staging, disk sync, WebSocket watch, Play manifest
- **Play export** — `build/scene.glb`, bundled `build/scene.js`, prototype `EXT_IGLTF_UMI3D_PROTO`
- **Play viewer** — script lifecycle, interactions, `GLTF` transactions
- **MCP** — 22 tools, live editor session, authoring kit
- **Desktop** — Tauri + PyInstaller Windows packaging
- **Documentation** — `docs/editor/` product specs, GETTING_STARTED, CONTRIBUTING

#### Known limitations

See [docs/milestone-1-scope.md](docs/milestone-1-scope.md).

[0.1.0]: https://github.com/UMI3D/interactive-gltf-engine/releases/tag/v0.1.0
