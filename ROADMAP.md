# Roadmap

Future work for **interactive-gltf-engine**. **What is shipped today:** [docs/milestone-1-scope.md](docs/milestone-1-scope.md).

Items are grouped by theme; order is indicative, not a commitment.

## Milestone 2 — product hardening

- **CI** — lint, test, build on every PR (backend tests started; extend to frontend + Tauri smoke)
- **Example project** — versioned sample workspace under `examples/` (see [examples/README.md](examples/README.md))
- **Releases** — tagged versions aligned with `package.json` / `engineVersion`; optional Windows installer on GitHub Releases
- **Documentation** — screenshots in README; short demo video (optional)

## Runtime package (`igltf-engine`)

Extract Play/runtime from the frontend into a reusable package consumed by editor and third-party apps.

Open decisions:

- TypeScript vs JavaScript + JSDoc
- Bundle shape (ESM library vs consumed by Vite host)
- Script sandbox (worker, iframe, none)
- Alignment with **interactive-gltf-specs** host API naming

Until then, Play logic lives in `igltf-editor-frontend` (`PlayInteractiveGltf.tsx`, `scriptRuntime/`).

## Editor & authoring

- Authentication and multi-user workspaces
- Visual interaction graph, debugging, live reload
- Layer UI for `layerId`
- Script dependency graph editor for `scriptDependsOnAssetIds`
- Inspector control for authoring bounds measurement
- MCP: interior expand/collapse, script file creation
- Richer import pipeline (formats beyond glTF-first)

## Backend & deployment

- Stable OpenAPI / JSON Schema for public REST contract
- AuthN/AuthZ (OIDC, API keys)
- Object storage (S3-compatible) instead of local disk only
- CDN and signed URLs for `/files/…`
- ETag / conflict resolution for concurrent edits
- Optional MongoDB or metadata service (not required for core authoring)

## Core library (`igltf-editor-core`)

End of POC: extract glTF merge, extension builders, and validation from `igltf-editor-backend` into a shared Python package.

## Format & packaging

- Single-artifact distribution (zip/folder) vs sidecar `scene.js`
- glTF Validator in CI for exported assets
- Skin / animation support for interior mirror export
- Rename prototype extension `EXT_IGLTF_UMI3D_PROTO` when specs freeze naming

When exported glTF or portable script contracts change, update **interactive-gltf-specs** in the same effort (see specs repo skill `sync-interactive-gltf-format-from-engine`).

## Explicitly out of scope (for now)

- MongoDB as required dependency
- Multi-tenant production SaaS
- Full DCC parity with proprietary authoring tools
- Copying proprietary UMI3D SDK code (read-only reference only)

## Sketcher migration

UI parity targets vs UMI3D Sketcher: [docs/sketcher-migration/](docs/sketcher-migration/) and [igltf-editor-frontend/migration.md](igltf-editor-frontend/migration.md). Tracked separately from this roadmap.
