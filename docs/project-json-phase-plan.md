# Plan: project JSON persistence (frontend + backend)

**Goal:** Treat **`project.json`** as the **authoring source of truth** on the server: it references the **scene graph** and **asset files** under a project folder. **Compilation** (merge into a single shipped `glb` + `js`) is **explicitly out of scope** for this phase; it will be a later build step.

**Principles:**

1. **Save / load** the project via the **backend** (not only download/upload in the browser).
2. **Assets** live as normal files under a project directory (today: disk; later: object storage + sync semantics unchanged at the API level where possible).
3. **Preview in the editor** resolves glTF **from URLs** served by the backend (or local blob fallback during transition).

---

## 1. Project document schema

### 1.1 Current state (frontend only)

- **`igltf-editor-project` v1** in `igltf-editor-frontend` embeds glTF as **`gltfDataUrl`** on nodes (portable but heavy, not suitable as server truth).

### 1.2 Target: v2 (server-first)

Introduce **`igltf-editor-project` version `2`** with:

| Field | Purpose |
|--------|--------|
| `format`, `version` | Same convention as v1 (`format: "igltf-editor-project"`, `version: 2`). |
| `scene` | Scene graph: nodes with `id`, `name`, `parentId`, `position`, `rotation`, `scale`. |
| `assets` | Catalog of **binary glTF** assets keyed by stable **`assetId`** (UUID or content hash). Each entry: `assetId`, **relative path** under project (e.g. `assets/obj.glb`), optional `name`, optional `contentHash` for dedup audits later. |
| `nodes[].assetRef` | Optional: **`assetId`** referencing `assets[]` instead of inline geometry. Nodes without `assetRef` are group/empty nodes. |

**Rules:**

- **No** giant base64 glTF in v2 on disk (optional: server rejects documents > N MB with only URLs).
- v1 remains supported for **import/export file** in the browser (migration helper: “upload v1 → server unpacks data URLs to `assets/` + rewrites to v2” can be a later enhancement).

**Open minor decisions** (record in implementation PR):

- Exact MIME / naming for uploaded blobs (`*.glb` only in phase 1).
- Whether `assetId` === filename stem or always UUID (recommend **UUID** + human `name` for fewer collisions).

---

## 2. Backend (`igltf-editor-backend`)

### 2.1 Storage layout (POC)

Assume configurable **`STORAGE_ROOT`**. For project id **`{projectId}`** (e.g. route param or path):

```text
{STORAGE_ROOT}/{projectId}/
  project.json          # authoritative document (v2)
  assets/
    {assetId}.glb|.gltf # final copies after a successful PUT /document
  _staging/
    {assetId}.glb|.gltf # uploads via POST …/assets/stage until promoted
```

(Serving continues to allow **`/files/{projectId}/...`** as today for **`project.json`**, **`assets/…`**, and **`_staging/…`** (preview before save).)

### 2.2 HTTP API (minimal set)

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/projects/{id}/document` | Return **`project.json`** body (JSON). `404` if missing. |
| `PUT` | `/projects/{id}/document` | Replace **entire** document. Body = v2 JSON. Validate `format` + `version` + shape; require every non-null **`scene.assetRef`** to exist in **`assets[].assetId`** (**`assets[]`** may list **extra** catalog entries not yet referenced by the scene). On success: **move** **`_staging/{assetId}.*` → `assets/{assetId}.*`**, **delete** files under **`assets/`** that are not listed in **`assets[]`**, **clear** **`_staging`**, write normalized **`project.json`**. Response **`{"status":"ok","document": …}`** — client should apply returned **`document`**. |
| `POST` | `/projects/{id}/assets/stage` | **Multipart**: one file → **`_staging/{uuid}.glb|.gltf`**, return **`assetId`**, **`relativePath`**, **`url`** (`/files/{id}/…`) for preview; final **`assets/`** only after **`PUT /document`**. |
| `GET` | `/files/{id}/...` | Static serving: **`project.json`**, **`assets/*`**, **`_staging/*`**, and later build artifacts. |

**Staging vs publish:** imports use **`POST …/assets/stage`** and preview via **`GET`** on that URL. **Save** is **`PUT …/document`** (promote + prune). After reload, glTF for saved projects loads via **`GET`** on **`/files/{id}/assets/…`**; a cache-bust query (e.g. rev after load/save) avoids stale browser caches.

**Deferred (not required for JSON phase):**

- `PATCH` for partial graph updates.
- ETag / conflict resolution.
- `GET /play/{id}` **unchanged in intent** (manifest for built `glb`+`js`); until build exists, it may return **404**, **placeholder**, or point at a **preview glb** if you add a stub — document whichever you choose.

### 2.3 Implementation scaffolding

- Add **`pyproject.toml`**, **`uv`**, **FastAPI** app, **CORS** for `http://localhost:5173` (env-driven).
- Env: `STORAGE_ROOT`, `PUBLIC_BASE_URL` (for absolute URLs in responses if needed).
- Validation: Pydantic models mirroring v2 document + upload response.

### 2.4 Security / POC limits

- No auth in iteration 1; **do not** expose `STORAGE_ROOT` outside a controlled dev network.
- Optional: cap upload size; reject non-`.glb` / non-glTF extensions per policy.

---

## 3. Frontend (`igltf-editor-frontend`)

### 3.1 Configuration

- **`VITE_API_BASE_URL`** (e.g. `http://localhost:8000`) — base for REST calls; **no** trailing slash convention documented in code.

### 3.2 Data layer

- **`api/projectApi.ts`**: `fetchDocument(id)`, `putDocument(id, doc)` (expects **`document`** in response), `uploadAssetStage(id, file)` → **`POST …/assets/stage`**.
- **Normalize** internal editor state:
  - Keep **`EditorNode`** in memory with **`gltfAssetRef?: string`** (`assetId`) **or** temporary **`gltfDataUrl`** for offline-only path.
  - **`useGLTF`**: pass **absolute URL** `VITE_API_BASE_URL + '/files/' + id + '/' + relativePath` when `assetRef` is set (optional **`?v=…`** cache buster after server round-trips); keep data-URL path for v1/local fallback.

### 3.3 UX flows

| Flow | Behavior |
|------|----------|
| **Open editor `/editor/:id`** | On mount: `GET /projects/{id}/document`. If 404, optionally seed empty v2 (or show “new project” — product choice). |
| **Save** | Serialize v2 (only assets still referenced in the scene); `PUT` document; replace state with returned **`document`**. Clear dirty after success. |
| **Import glTF** | `POST …/assets/stage` → **`assets[]`** entry + `PUT /document` promotes to **`assets/`**; user places in scene by adding a node referencing `assetRef` (e.g. drag from asset list to preview). |
| **Drag-drop** | Same as import (upload then reference). |
| **Offline / dev without API** | Keep **download/upload v1** as fallback behind a flag or if `VITE_API_BASE_URL` unset (optional; simplifies local Three hacking). |

### 3.4 File menu alignment

- **Save** / **Save As**: primary path = **PUT** document; optional **download** still useful for backup (export v2 JSON).
- **Open**: keep local file open for v1/v2 JSON **or** navigate to `/editor/{id}` list (when you have a project list — later).

### 3.5 Files likely touched (implementation checklist)

- `src/editor/types.ts` — v2 types + compatibility with v1.
- `src/editor/EditorContext.tsx` — `assets` map, load/save orchestration, dirty sync.
- `src/editor/projectIo.ts` — parse/serialize v1 + v2; migration helper stub optional.
- `src/editor/FileMenu.tsx` — wire Save to API when configured.
- `src/pages/EditorPage.tsx` — pass `id`, trigger initial fetch.
- `src/editor/PreviewViewport.tsx` / GLTF loader — URL vs data URL resolution.
- New: `src/api/projectApi.ts` (or `src/services/…`).
- `vite-env.d.ts` — `VITE_API_BASE_URL`.

---

## 4. Explicitly out of scope (this phase)

- **Build / compile** pipeline: merged shipping **`glb`**, bundled **`js`**, `GET /play/{id}` returning real prod URLs from that build.
- **glTF merge**, buffer deduplication, single-binary scene export.
- **Cloud sync**, auth, multi-tenant quotas.
- **Conflict resolution** on concurrent edits.

---

## 5. Suggested implementation order

1. **Backend**: scaffold FastAPI + disk layout + `GET/PUT` document + `POST …/assets/stage` + apply-on-`PUT` (promote/prune) + static `GET /files/...`.
2. **Frontend**: `projectApi` + v2 types + load on mount + Save → PUT (apply returned `document`).
3. **Frontend**: import/drop → `POST …/assets/stage` + full **`assets[]`** catalog in **`PUT`**; add scene nodes with **`assetRef`** when user places (drag from assets → preview); persisted assets load via **`GET`** after reload.
4. **Polish**: export v2 download, v1→v2 import path (optional), error UI and CORS docs in READMEs.

---

## 6. Spec repository

When the **normative** JSON shape or URI conventions are fixed, mirror or reference them in **`interactive-gltf-specs`** if they become part of the portable format story; use **`sync-interactive-gltf-format-from-engine`** there as required by that repo’s rules.

---

*This plan supersedes ad-hoc “only data URL project” persistence for team-aligned development; the editor may retain v1 export for portability until v2 is ubiquitous.*
