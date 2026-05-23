# HTTP, WebSocket, and MCP API reference

**Status:** Implemented (`igltf-editor-backend/app/main.py`).

Base URL: **`PUBLIC_BASE_URL`** (default `http://127.0.0.1:8000`). MCP mount: **`GET/POST {base}/mcp`**.

## Health

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{ "status": "ok", "engineVersion": "…", "mcpPath": "/mcp" }` |

## Studio hub

| Method | Path | Body / behaviour |
|--------|------|------------------|
| GET | `/studio/projects` | List `{ id, diskPath, displayName, lastSavedAt, savedWithEngineVersion }[]` |
| POST | `/studio/projects/create` | `{ parentDirectory, folderName }` → creates folder + registers UUID; writes `.gitignore`, bootstrap files |
| POST | `/studio/projects/register` | `{ projectDirectory }` → register existing folder |
| DELETE | `/studio/projects/{id}` | Remove registry row only (**does not delete files**) |

Registry schema: [studio-hub.md](studio-hub.md).

## Project document

| Method | Path | Behaviour |
|--------|------|-----------|
| GET | `/projects/{id}/document` | Return `project.json`; if missing → **synthetic v2** (single root node, empty assets) |
| PUT | `/projects/{id}/document` | Validate v2, promote staging, prune orphan `assets/`, return `{ status, document }`; updates registry `lastSavedAt` |

See [igltf-editor-project.md](igltf-editor-project.md), [project-persistence.md](project-persistence.md).

## Assets

| Method | Path | Behaviour |
|--------|------|-----------|
| POST | `/projects/{id}/assets/stage` | Multipart file → `_staging/{uuid}.ext`; returns `assetId`, `relativePath`, `url` |
| GET | `/projects/{id}/assets/{asset_id}/source` | UTF-8 script body (`.js`/`.mjs`/`.cjs` only) |
| PUT | `/projects/{id}/assets/{asset_id}/source` | `{ content }` — max 2 MB; Monaco save path |
| PATCH | `/projects/{id}/assets/{asset_id}/rename-stem` | `{ stem }` — atomic file rename + catalog update; `mismatch` if stem ≠ export class |
| GET | `/projects/{id}/assets/{asset_id}/gltf-interior-manifest` | Default-scene node preorder for interior expand (`.glb` only) |

Upload limits: `MAX_UPLOAD_MB` (glTF), `MAX_SCRIPT_UPLOAD_MB` (scripts).

## Build & Play

| Method | Path | Behaviour |
|--------|------|-----------|
| POST | `/projects/{id}/build-play-glb` | Write `build/scene.glb` (+ `build/scene.js` if scripts); requires saved `project.json` |
| GET | `/play/{id}` | `{ glbUrl, jsUrl? }` with `?v={mtime_ns}` cache bust; 404 if no bundle |

Play bundle files served with **`Cache-Control: no-store`** via `/files/…`.

See [play-export.md](play-export.md), [play-viewer.md](play-viewer.md).

## Developer / IDE (same machine as API)

| Method | Path | Behaviour |
|--------|------|-----------|
| GET | `/projects/{id}/dev-local-path` | `{ path }` absolute workspace directory |
| POST | `/projects/{id}/open-in-ide?preset=cursor\|vscode\|jetbrains` | Spawn IDE CLI on workspace |

Frontend gated by **`VITE_OPEN_IN_IDE`**.

## Static files

| Method | Path | Behaviour |
|--------|------|-----------|
| GET | `/files/{id}/{path}` | Serve file under workspace; blocks `..` traversal |

## WebSocket

| Path | Direction | Purpose |
|------|-----------|---------|
| `/projects/{id}/editor/session` | Bidirectional | Live editor snapshot + MCP commands — [editor-session-protocol.md](editor-session-protocol.md) |
| `/projects/{id}/assets/watch` | Server → client | Disk sync events — [disk-sync.md](disk-sync.md) |

## MCP tools

22 tools on **`/mcp`**. Full list: [mcp-scene-authoring.md](mcp-scene-authoring.md).

Framework kit: `igltf_list_framework_files`, `igltf_read_framework_file`.

## Workspace bootstrap (`ensure_project_layout`)

Called on document routes and editor session connect:

- Create `assets/`, `_staging/`
- **`mcp.json`** (if absent)
- **`.cursor/rules/igltf-no-hand-edit-project-json.mdc`** (if absent)
- **`.igltf/project-id`** (hub UUID)

Existing user files are **never overwritten**.

## Errors

Standard FastAPI `HTTPException` JSON `{ detail }`. MCP maps `EditorSessionError` codes to tool responses with `userMessage` / `userAction`.
