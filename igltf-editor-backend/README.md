# igltf-editor-backend

**FastAPI** service for the interactive glTF editor: receives packaged assets from the frontend, stores them on disk, serves them under **`/files/...`**, and exposes **`GET /play/:id`** as a **JSON manifest** of URLs.

## Stack (iteration 1)

- **Python**: **3.12**
- **Dependencies**: **`uv`** + **`pyproject.toml`** (and lockfile as produced by `uv lock`).
- **Framework**: **FastAPI** (pin a current stable in `pyproject.toml`).
- **Dev server**: **uvicorn** (e.g. `uv run uvicorn ...`).
- **CORS**: allow the frontend origins (e.g. **`http://localhost:5173`**) and the production origin used behind the reverse proxy (configure via environment).

## Hub registry + workspaces

- **`projects.json`** lives under **`STORAGE_ROOT`** or **`IGLTF_APP_DATA_DIR`** (writable app state folder, default `./data`). It lists registered projects (`id`, `diskPath`, `lastSavedAt`, `savedWithEngineVersion`).
- **Studio:** `GET /studio/projects`, `POST /studio/projects/create` `{ parentDirectory, folderName }`, `POST /studio/projects/register` `{ projectDirectory }`, `DELETE /studio/projects/{id}` (removes the listing only — **does not** delete files).

## MCP (interactive-gltf script authoring kit)

Embedded **Streamable HTTP** MCP on **`GET/POST`** path **`PUBLIC_BASE_URL` + `/mcp`** when the backend is running (same uvicorn process as the REST API). Tools:

| Tool | Purpose |
|------|--------|
| `igltf_list_framework_files` | Relative paths (`*.md`, `*.js`, `*.txt`) under the bundled `authoring_kit/` |
| `igltf_read_framework_file` | Read one file safely (blocks traversal); **correlate versions with `/health`** (`engineVersion`). |

Discovery: **`GET /health`** includes **`mcpPath`** (**`/mcp`**) so clients can construct the MCP URL consistently.

Each **workspace folder** gains **`mcp.json`** automatically when missing (never overwritten):

- On **`POST /studio/projects/create`**; and  
- On any route that invokes **`ensure_project_layout`** (`GET /document`, etc.) — backfills legacy projects opened after upgrade.

Authors open the **workspace directory** (not `PUBLIC_BASE_URL` alone) in **Cursor**, **Kilocode**, etc., point the MCP client at **`http://127.0.0.1:8000/mcp`** (or your **`PUBLIC_BASE_URL` + `/mcp`**), reload MCP. The generated **`mcp.json`** nests the **`interactive-gltf-framework`** server under **`mcpServers`** with a **`url`** field aligned with **`PUBLIC_BASE_URL`**.

Environment:

- **`IGLTF_AUTHORING_KIT`** (optional) — absolute path to an alternate authoring kit (`js/` + `md/`) instead of the bundle next to **`igltf-editor-backend`** / site-packages.
- **`IGLTF_AUTHORING_READ_MAX_BYTES`** (optional) — read cap for MCP file reads (default **524288**).

## Paths and identities

Each **`project_id`** in authoring URLs is:

- Usually a **UUID** returned by **`/studio/projects/...`**; the API resolves **`diskPath`** to the workspace root (**wherever that folder sits on disk**), or  
- **Legacy slug-only id** (`test`, etc.) resolved as **`{app_state_dir}/{id}`** if not present in **`projects.json`**.

Assets and **`project.json`** always live directly under that workspace (`project.json`, `assets/`, `_staging/`).

New projects created via the hub receive a **`.gitignore`** at workspace root that ignores **`build/`**.

## URL and static files

`GET /files/{project_id}/{relative_path}` serves a file inside the workspace after normalization (blocks path traversal).

Example workspace id **`a1b2c3…`** with `assets/cat.glb`:

| Served URL | On disk (under `diskPath`) |
|------------|-----------------------------|
| `/files/a1b2c3…/assets/cat.glb` | `…/workspace/assets/cat.glb` |

### Scripts vs `assets/` (external IDE authoring)

Interactive **scripts** must be tracked in **`project.json`** as **Assets**, with files under **`workspace/assets/`**.

**Naming:** authoring follows a **Unity-like convention**: one **`export class` / `export default class`** per file, and **`assets/<ClassName>.{js|mjs|cjs}`** as the canonical on-disk stem (staging + disk sync migrate toward this stem). Stable **`assetId`** still identifies the catalog entry for scene **`interactionAttachments`**, **`serializedProps`**, etc.

**Stem rename:** `PATCH …/projects/{project_id}/assets/{asset_id}/rename-stem` with `{ "stem": "NewStem" }` moves the file and updates **`relativePath` / `scriptExports`** without touching **`scene`**; **`mismatch: true`** in the response warns when the renamed stem does not match the exported class in source yet.

The editor persists via **`PUT /document`**, which **deletes orphan top-level files in `assets/`** that do not appear in the saved catalog — so stray `.js` files dropped only from an IDE disappear on the next save unless **disk sync** has added them first. With the authoring API running and the editor focused on that project, open **WebSocket** `ws://…/projects/{project_id}/assets/watch` or `wss://…` (same host and API path prefix as `VITE_API_BASE_URL`) so the catalog and Inspector refresh after external edits.

## Play manifest

- **`GET /play/{project_id}`** resolves **`glbUrl`** from **`build/scene.glb`**, falling back to legacy **`test.glb`** next to **`project.json`**. **`jsUrl`** is optional, in this order: **`build/scene.js`**, **`build/play.js`**, or legacy root **`test.js`**.

  ```json
  {
    "glbUrl": "https://your-api-host/files/{project_id}/build/scene.glb",
    "jsUrl": "https://your-api-host/files/{project_id}/test.js"
  }
  ```

  Returning **`jsUrl`** explicitly is optional when clients derive scripts from **`glbUrl`**-relative URIs.

## Save API (iteration 1)

- **Quick & dirty**: minimal endpoint(s) to accept **glb** + **js** for id **`test`** and write the files above. Exact shape (multipart, two part names, etc.) can evolve; formalize in a later milestone (see [`../ROADMAP.md`](../ROADMAP.md)).

## `igltf-editor-core` (iteration 1)

- Keep **save / path / gltf tweak** logic **in the backend** for now. **Refactor into `igltf-editor-core` at end of POC** (see [`../igltf-editor-core/README.md`](../igltf-editor-core/README.md)).

## Non-goals (see [`../ROADMAP.md`](../ROADMAP.md))

- **MongoDB** and metadata catalogs.
- Authentication, rate limiting, and multi-tenant isolation.

## Spec impact

HTTP API contracts and on-disk layout **must not contradict** interactive-gltf extension documents in **`interactive-gltf-specs`**. When they evolve, update **`proposals/`** / **`specifications/`** there via **`sync-interactive-gltf-format-from-engine`**.

## Project JSON phase (before packaged `glb` + `js` build)

Authoring persistence uses **`project.json`** + **`assets/`** + **`_staging/`** per project id: uploads go to **`POST …/assets/stage`**; **`PUT /document`** promotes staged files, removes orphan **`assets/`** files, and returns the persisted **`document`**. Static serving under **`/files/{id}/…`** includes those paths. Full breakdown: **[`../docs/project-json-phase-plan.md`](../docs/project-json-phase-plan.md)**.

The **Save API** for ad-hoc **`play.js`** / root **`test.js`** remains optional; **`POST …/build-play-glb`** writes **`build/scene.glb`** (merged catalog geometry) **and**, when the project catalog includes script files under **`assets/`**, runs **esbuild** to emit **`build/scene.js`**. The glTF JSON declares **`extensionsUsed`** entry **`EXT_interactive_gltf`** with a **`scripts`** array pointing at **`scene.js`** (`kind: classic`). Topological order follows **`scriptDependsOnAssetIds`** on each **`assets[]`** script row.

**JavaScript bundle toolchain:** run **`npm install`** once under **`igltf-editor-backend/`** so **`esbuild`** is available, or set **`ESBUILD_BINARY`** to an **`esbuild`** executable on **`PATH`**. Imports under **`/igltf-core/*`** are treated as **external** at bundle time (the viewer supplies those modules).

Desktop **PyInstaller** bundles still need a documented strategy for shipping **Node** or a pinned **esbuild** binary (follow-up).

### Run and configure

  `uv sync` then `uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`

- **Env:** **`STORAGE_ROOT`** or **`IGLTF_APP_DATA_DIR`** — app-state dir (**`projects.json`**, slug workspaces; default `./data`), **`PUBLIC_BASE_URL`** (default `http://127.0.0.1:8000`), **`CORS_ORIGINS`** (comma-separated).

- **API:** `GET`/`PUT /projects/{id}/document` (**PUT** response: `{"status":"ok","document":{…}}`), `POST /projects/{id}/assets/stage`, **`POST /projects/{id}/build-play-glb`** (writes **`build/scene.glb`** and optional **`build/scene.js`**; response includes **`jsRelativePath`** when **`scene.js`** exists), **`GET /projects/{id}/dev-local-path`**, **`POST /projects/{id}/open-in-ide`** (`preset=cursor|vscode|jetbrains`, runs the IDE CLI on the API host for local desktop), **`GET /files/{id}/…`** (path-serving), **`GET /studio/projects`**, **`GET /health`**.

- **Frontend:** set `VITE_API_BASE_URL` (see [`../igltf-editor-frontend/.env.example`](../igltf-editor-frontend/.env.example)).

- **Play:** `GET /play/{id}` returns **404** until **`build/scene.glb`** exists (or legacy **`test.glb`** at workspace root — run **Build glTF** or **`POST …/build-play-glb`**).

The repo now includes `pyproject.toml` and `app/`; configure `STORAGE_ROOT` / `IGLTF_APP_DATA_DIR` and `PUBLIC_BASE_URL` via environment variables as listed above.

### Desktop bundle (PyInstaller)

The Tauri desktop build embeds a **frozen** copy of this service (onedir) so end users do not install Python:

- Entry: [`scripts/igltf_backend_entry.py`](scripts/igltf_backend_entry.py).
- Spec: [`scripts/igltf-backend.spec`](scripts/igltf-backend.spec).
- Dev workflow: **`uv sync --extra packaging`** then PyInstaller commands in **[`../tauri-build/README.md`](../tauri-build/README.md)** / **`..\tauri-build\build.bat`**.
