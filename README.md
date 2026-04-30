# interactive-gltf-engine

**Reference implementation (POC and beyond)** for **interactive-gltf**: web runtimes and tooling that load, author, package, and execute interactive glTF assets.

Portable format definitions (**`proposals/`**, **`specifications/`**) live in the separate **`interactive-gltf-specs`** repository. This repository holds **JavaScript/TypeScript/Python** code and app scaffolding only.

## Sub-projects

| Directory | Role |
|-----------|------|
| [`igltf-engine/`](igltf-engine/) | Browser runtime: load interactive glTF, execute scripted behaviors, host API for scripts. **Not in scope for iteration 1** — see [`ROADMAP.md`](ROADMAP.md). |
| [`igltf-editor-frontend/`](igltf-editor-frontend/) | React app: **Editor** (`/editor/:id`) and **Play** (`/play/:id`). Iteration 1: UI + editor preview; play loads assets from the backend manifest (full **`igltf-engine`** integration later). |
| [`igltf-editor-backend/`](igltf-editor-backend/) | FastAPI: save scenes, serve static files under `/files/...`, **`GET /play/:id`** returns JSON with absolute asset URLs. |
| [`igltf-editor-core/`](igltf-editor-core/) | Python library for shared glTF/extension logic. **Iteration 1:** defer; move code out of the backend **at end of POC** (see [`igltf-editor-core/README.md`](igltf-editor-core/README.md)). |

## Proof of concept — iteration 1

**In scope**

- **`igltf-editor-frontend`** + **`igltf-editor-backend`** wired together.
- **No authentication.**
- **Single id** `test`: use `/editor/test` and `/play/test`.
- **On-disk layout** (under a configurable root): `test/test.glb` and `test/test.js`, exposed as **`/files/test/test.glb`** and **`/files/test/test.js`**. The **`.glb`** should reference the script with a **relative** URI **`./test.js`** (same directory when resolved against the glb URL).
- **`GET /play/test`**: returns **JSON** including the **absolute** URL of the glb (e.g. `{ "glbUrl": "https://api.example.com/files/test/test.glb" }`). The client resolves `./test.js` from that base or the backend also returns `jsUrl` if convenient for the quick & dirty contract.
- **CORS** for the frontend dev server (e.g. `http://localhost:5173`) and production origin behind a reverse proxy.
- **Authoring persistence (near-term):** `project.json` + asset files per project id on the backend; **no** merged shipping `glb` in that phase. See [`docs/project-json-phase-plan.md`](docs/project-json-phase-plan.md).

**Deferred to later iterations**

- Package **`igltf-engine`** (Three.js runtime, script execution). Open design points are listed under **`igltf-engine`** in [`ROADMAP.md`](ROADMAP.md).
- Extracting **`igltf-editor-core`** from the backend (end of POC).

**Still out of scope** (see [`ROADMAP.md`](ROADMAP.md)): MongoDB, auth, multi-tenant ids, production hardening.

## Related repository (format)

Clone the **`interactive-gltf-specs`** repository alongside this project. Any change here that **alters** extension JSON, script discovery, security model, or host API **must** be reflected there.

Contributors with both repos in a workspace should use the Cursor skill **`sync-interactive-gltf-format-from-engine`** from the **specs** repository (`.cursor/skills/sync-interactive-gltf-format-from-engine/SKILL.md`).

## Reference material (read-only)

If **`UMI3D-SDK-version-2.9`** is present in the workspace, it remains **read-only** UMI3D reference. Do not copy proprietary SDK code; align **concepts and identifiers** with interactive-gltf extension text in **interactive-gltf-specs** instead.

## License

See [`LICENSE`](LICENSE) (Apache 2.0).
