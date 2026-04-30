# igltf-editor-backend

**FastAPI** service for the interactive glTF editor: receives packaged assets from the frontend, stores them on disk, serves them under **`/files/...`**, and exposes **`GET /play/:id`** as a **JSON manifest** of URLs.

## Stack (iteration 1)

- **Python**: **3.12**
- **Dependencies**: **`uv`** + **`pyproject.toml`** (and lockfile as produced by `uv lock`).
- **Framework**: **FastAPI** (pin a current stable in `pyproject.toml`).
- **Dev server**: **uvicorn** (e.g. `uv run uvicorn ...`).
- **CORS**: allow the frontend origins (e.g. **`http://localhost:5173`**) and the production origin used behind the reverse proxy (configure via environment).

## URL and file layout (POC)

For id **`test`** (only id in iteration 1):

| Served URL | On-disk (example, configurable root) |
|------------|--------------------------------------|
| `/files/test/test.glb` | `{storage_root}/test/test.glb` |
| `/files/test/test.js` | `{storage_root}/test/test.js` |

The saved **`.glb`** should reference the script with a **relative** URI **`./test.js`** so clients resolving URLs against the glb location load the JS from the same path prefix.

## Play manifest

- **`GET /play/test`** (generalize to **`GET /play/{id}`** later): returns **JSON** whose fields include **absolute** URLs (using the public **host** / base URL from config), for example:

  ```json
  {
    "glbUrl": "https://your-api-host/files/test/test.glb",
    "jsUrl": "https://your-api-host/files/test/test.js"
  }
  ```

  Returning **`jsUrl`** explicitly is optional if clients derive it from `glbUrl` + `./test.js`; both are acceptable for the quick & dirty contract.

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

The **Save API** for final **`test.glb` + `test.js`** remains a **later** milestone once a **build/compile** step exists; the JSON phase does not replace the play manifest long term.

### Run and configure

  `uv sync` then `uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`

- **Env:** `STORAGE_ROOT` (optional, default `./data`), `PUBLIC_BASE_URL` (default `http://127.0.0.1:8000`), `CORS_ORIGINS` (comma-separated).

- **API:** `GET`/`PUT /projects/{id}/document` (**PUT** response: `{"status":"ok","document":{…}}`), `POST /projects/{id}/assets/stage`, static `GET /files/{id}/…`, `GET /health`.

- **Frontend:** set `VITE_API_BASE_URL` (see [`../igltf-editor-frontend/.env.example`](../igltf-editor-frontend/.env.example)).

- **Play:** `GET /play/{id}` returns **404** until `test.glb` exists (build phase).

The repo now includes `pyproject.toml` and `app/`; configure `STORAGE_ROOT` / `PUBLIC_BASE_URL` via environment variables as listed above.
