# Project persistence — storage and HTTP API

**Status:** Implemented (iteration 1 POC).

## Principles

1. **`project.json`** is the authoring source of truth on disk (schema: [igltf-editor-project.md](igltf-editor-project.md)).
2. Binary assets live as files under the workspace `assets/` directory.
3. Editor preview loads glTF from backend URLs (`GET /files/...`).
4. Play shipping artifacts (`build/scene.glb`, `build/scene.js`) are produced by an explicit **build** step — see [play-export.md](play-export.md).

## Workspace layout

For project id `{projectId}` (UUID from hub, or legacy slug):

```text
{workspace}/
  project.json          # authoritative document (v2)
  assets/
    {uuid}.glb          # promoted glTF assets
    MyHandler.js        # script assets (stem = export class name)
  _staging/
    {uuid}.glb          # uploads until PUT /document promotes
  build/
    scene.glb           # merged Play output (after build)
    scene.js            # bundled scripts (after build)
  mcp.json              # generated MCP client config
  .igltf/project-id     # stable UUID for MCP resolve
  .cursor/rules/        # agent policy (generated)
```

Hub registry: [studio-hub.md](studio-hub.md).

## HTTP API

**Full reference:** [http-api.md](http-api.md) (REST, WebSocket, MCP, bootstrap, synthetic document on first GET).

Core flows: **`GET/PUT /document`**, **`POST …/assets/stage`**, **`GET /files/…`**, **`POST …/build-play-glb`**, **`GET /play/{id}`**.

## Staging vs save

1. Import / drag-drop → `POST …/assets/stage` → preview via staged URL.
2. **Save** in editor → `PUT …/document` with full catalog + scene → promotes staging, prunes orphans.

## Disk sync (external IDE)

When the backend watches `assets/` and the editor has **`WS …/assets/watch`** open:

- New script files gain catalog rows automatically.
- Orphan top-level files under `assets/` **not** in `assets[]` are removed on next editor **Save** (`PUT /document`).
- Agents must **not** hand-edit `project.json` — see [mcp-scene-authoring.md](mcp-scene-authoring.md).

Disk sync detail: [disk-sync.md](disk-sync.md).

## Frontend integration

- **`VITE_API_BASE_URL`** — REST base (no trailing slash).
- **`api/projectApi.ts`** — `fetchDocument`, `putDocument`, `uploadAssetStage`.
- **`EditorContext`** — load on mount, dirty tracking, save orchestration.
- GLTF preview: `VITE_API_BASE_URL + '/files/' + id + '/' + relativePath` with optional cache-bust query.

## Out of scope (this milestone)

- Partial graph `PATCH`, ETag / conflict resolution.
- Auth, multi-tenant isolation, cloud object storage (API shape may extend later).

## Portable standard

Only **exported** glTF and script packaging are mirrored in **`interactive-gltf-specs`**. This document and [igltf-editor-project.md](igltf-editor-project.md) stay in the engine repo.
