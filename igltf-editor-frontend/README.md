# igltf-editor-frontend

**React** application for authoring interactive scenes and running the **Play** view against assets served by **`igltf-editor-backend`**.

## Stack (iteration 1)

- **React**: latest stable at scaffold time (pin explicitly in `package.json`).
- **Router**: **React Router** with **`/`** (**Projects hub**), **`/editor/:id`**, **`/play/:id`**. Project ids from **`GET /studio/projects`** are UUIDs; slug-only routes like **`/editor/test`** resolve legacy workspaces under **`STORAGE_ROOT`**.
- **Base URL**: support **dev** and **prod** behind a **reverse proxy** (configure `basename` / `VITE_BASE` or equivalent so `/editor/:id` resolves correctly).
- **State**: **minimal** for the POC (React state / context as needed; no Redux requirement).
- **Three.js in the editor**: **strict separation** — the editor is **UI + preview** only (lightweight Three preview acceptable). The **Play** view will eventually use the **`igltf-engine`** package; that package is **not** part of iteration 1 (see [`../ROADMAP.md`](../ROADMAP.md)). Until then, play may load the glb URL from the backend manifest with a minimal viewer or placeholder.

## Backend integration (iteration 1)

- **Projects hub**: **`GET /studio/projects`**, **`POST /studio/projects/create`**, **`POST /studio/projects/register`**, **`DELETE /studio/projects/{id}`**. See [`../igltf-editor-backend/README.md`](../igltf-editor-backend/README.md).
- **Project persistence (JSON first):** **`GET`/`PUT /projects/:id/document`** (response includes canonical **`document`** after **`PUT`**) and **`POST /projects/:id/assets/stage`** for uploads (files land in **`_staging/`** until **`PUT`** promotes them to **`assets/`**). Persisted models are loaded via **`GET /files/:id/assets/…`** on open (not from a local rehydrated binary cache). Details: **[`../docs/project-json-phase-plan.md`](../docs/project-json-phase-plan.md)**. Configure **`VITE_API_BASE_URL`** when the API is available. **Merging** scene + script into a single shipped **`glb`** is **not** part of this step.
- **`GET /play/:id`**: expect **JSON** with absolute URLs for build outputs (prefers **`build/scene.glb`**, legacy **`test.glb`** still works). Optional **`jsUrl`** prefers **`build/scene.js`**, then **`build/play.js`**, then legacy root **`test.js`**:

  ```json
  {
    "glbUrl": "http://localhost:8000/files/{projectId}/build/scene.glb",
    "jsUrl": "http://localhost:8000/files/{projectId}/build/scene.js"
  }
  ```

  Your **`.glb`** may reference scripts with paths relative to that URL; the backend always serves them under **`/files/{projectId}/…`**.

- **Save**: call backend save endpoint(s) as defined in [`../igltf-editor-backend/README.md`](../igltf-editor-backend/README.md) (contract kept loose for the first iteration).

## Desktop (Tauri)

- **`@tauri-apps/plugin-dialog`** powers **Browse…** on the Projects hub (folder pickers). Browser dev mode uses typed absolute paths instead.
- **Release assets** — bundled FastAPI (**PyInstaller** onedir → `resources/igltf-backend/`) plus NSIS **`setup.exe`**. Scripts and prerequisites: **[`../tauri-build/README.md`](../tauri-build/README.md)** (`build.bat`, `bump-version.ps1`).
- **`.env.production`** sets **`VITE_API_BASE_URL=http://127.0.0.1:8000`** for packaged WebView **`fetch`** to the spawned API.
- **Open in IDE** is shown only when the API host is loopback (`localhost`, `127.0.0.1`, `::1`, `tauri.localhost`). Set **`VITE_OPEN_IN_IDE=1`** to show it for a non-loopback URL (same machine / LAN). Set **`VITE_OPEN_IN_IDE=0`** to hide it.
- **`dragDropEnabled: false`** on the Tauri window (see **`tauri.conf.json`**) is required on **Windows** for **HTML5** drag-drop in the UI; OS-level file-drop via the shell is disabled as a consequence. Background and links: **[`../tauri-build/README.md`](../tauri-build/README.md)** (section *Windows: native shell drag-drop vs HTML5 drag-drop*).

## Non-goals (see [`../ROADMAP.md`](../ROADMAP.md))

- Login, registration.
- Full DCC feature parity; merge of arbitrary formats may come after glTF-first POC.

## Spec impact

UI labels are non-normative; **data shapes** sent to the API and embedded in glTF **are** normative and must stay aligned with **`interactive-gltf-specs`** (`proposals/` / `specifications/`). Use **`sync-interactive-gltf-format-from-engine`** in that repository when changing them.

## Sketcher migration (UI parity)

- Inventory of Unity editor UI and behavior: [`migration.md`](migration.md).
- **Phase 1 user stories** (reverse-engineered from Sketcher, design fidelity contract): [`../docs/sketcher-migration/phase1-user-stories.md`](../docs/sketcher-migration/phase1-user-stories.md).
- Workflow for story-by-story migration: [`.cursor/skills/migrate-sketcher-feature/SKILL.md`](../.cursor/skills/migrate-sketcher-feature/SKILL.md).

## Package layout (future)

This directory will gain `package.json`, `src/`, and tooling when implementation starts.
