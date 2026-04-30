# igltf-editor-frontend

**React** application for authoring interactive scenes and running the **Play** view against assets served by **`igltf-editor-backend`**.

## Stack (iteration 1)

- **React**: latest stable at scaffold time (pin explicitly in `package.json`).
- **Router**: **React Router** with routes **`/editor/:id`** and **`/play/:id`**. For the POC, only **`test`** is used (`/editor/test`, `/play/test`).
- **Base URL**: support **dev** and **prod** behind a **reverse proxy** (configure `basename` / `VITE_BASE` or equivalent so `/editor/:id` resolves correctly).
- **State**: **minimal** for the POC (React state / context as needed; no Redux requirement).
- **Three.js in the editor**: **strict separation** — the editor is **UI + preview** only (lightweight Three preview acceptable). The **Play** view will eventually use the **`igltf-engine`** package; that package is **not** part of iteration 1 (see [`../ROADMAP.md`](../ROADMAP.md)). Until then, play may load the glb URL from the backend manifest with a minimal viewer or placeholder.

## Backend integration (iteration 1)

- **Project persistence (JSON first):** **`GET`/`PUT /projects/:id/document`** (response includes canonical **`document`** after **`PUT`**) and **`POST /projects/:id/assets/stage`** for uploads (files land in **`_staging/`** until **`PUT`** promotes them to **`assets/`**). Persisted models are loaded via **`GET /files/:id/assets/…`** on open (not from a local rehydrated binary cache). Details: **[`../docs/project-json-phase-plan.md`](../docs/project-json-phase-plan.md)**. Configure **`VITE_API_BASE_URL`** when the API is available. **Merging** scene + script into a single shipped **`glb`** is **not** part of this step.
- **`GET /play/:id`** (e.g. `/play/test`): expect **JSON** with absolute URLs for saved assets. Example shape (quick & dirty, subject to refinement):

  ```json
  {
    "glbUrl": "http://localhost:8000/files/test/test.glb",
    "jsUrl": "http://localhost:8000/files/test/test.js"
  }
  ```

  The **`.glb`** on disk is authored so it references **`./test.js`** relative to its URL; the backend serves both under **`/files/test/`**.

- **Save**: call backend save endpoint(s) as defined in [`../igltf-editor-backend/README.md`](../igltf-editor-backend/README.md) (contract kept loose for the first iteration).

## Non-goals (see [`../ROADMAP.md`](../ROADMAP.md))

- Login, registration, multi-project dashboards.
- Full DCC feature parity; merge of arbitrary formats may come after glTF-first POC.

## Spec impact

UI labels are non-normative; **data shapes** sent to the API and embedded in glTF **are** normative and must stay aligned with **`interactive-gltf-specs`** (`proposals/` / `specifications/`). Use **`sync-interactive-gltf-format-from-engine`** in that repository when changing them.

## Sketcher migration (UI parity)

- Inventory of Unity editor UI and behavior: [`migration.md`](migration.md).
- **Phase 1 user stories** (reverse-engineered from Sketcher, design fidelity contract): [`../docs/sketcher-migration/phase1-user-stories.md`](../docs/sketcher-migration/phase1-user-stories.md).
- Workflow for story-by-story migration: [`.cursor/skills/migrate-sketcher-feature/SKILL.md`](../.cursor/skills/migrate-sketcher-feature/SKILL.md).

## Package layout (future)

This directory will gain `package.json`, `src/`, and tooling when implementation starts.
