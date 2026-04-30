# interactive-gltf-engine — roadmap

This document lists **deferred work**, **open decisions**, and capabilities not yet implemented. Items are ordered roughly by dependency; dates are not fixed.

## Runtime (`igltf-engine`) — not in iteration 1

The **`igltf-engine`** package is **skipped for the first iteration**. The **Play** view will eventually consume the manifest from **`GET /play/:id`** and run the glb + script through this runtime; until then, the play route can show a minimal placeholder or load the glb without full interactive-gltf execution.

**Open decisions (to settle before / while implementing `igltf-engine`)**

- **Language**: TypeScript vs JavaScript + JSDoc.
- **Bundler / package shape**: Vite library mode, rollup, esbuild, or plain ESM consumed by the frontend.
- **Three.js** version and loader stack (`GLTFLoader` vs integration with a React wrapper).
- **Script loading model**: ESM `import`, global IIFE, or other; how the host API is exposed (`import map`, `window`, etc.).
- **Host API surface**: naming, capabilities, alignment with **interactive-gltf-specs** proposals.
- **Sandboxing**: worker, iframe, or none for POC.
- **Offline / `file:`** and static hosting constraints.

Related older bullets (still valid once work starts):

- **Engine-agnostic APIs** beyond Three.js.
- **Normative mapping** from UMI3D interaction concepts to extension fields (beyond POC subset).

## Packaging and format

- **Single `.glb` vs folder/zip** for distribution; zip/folder tooling.
- **Script module shape**: single bundle vs multiple modules; how `extensions` reference script entrypoints.
- **Strict glTF merge**: merge arbitrary sources (`.obj`, etc.) into one interactive glTF; glTF Validator in CI.
- Formalize the **quick & dirty** save API into a versioned contract (see Backend below).

## Near-term: project JSON on the server (no compile step)

- **Authoring truth**: `project.json` (v2) under each project id; references **asset files** on disk (or future object storage). See **[`docs/project-json-phase-plan.md`](docs/project-json-phase-plan.md)** for planned **frontend and backend** changes.
- **Deferred**: merge / “compilation” into a single shipped `glb` + `js`; `GET /play/:id` manifest stays as documented for when that build exists.

## Editor (frontend)

- **Authentication and workspaces**: user accounts, project ids beyond fixed `test`.
- **Rich authoring**: visual graph for interactions, debugging, breakpoints, live reload.
- **Import pipeline UI**: drag-drop for all supported formats; asset cleanup and material policy.
- **Play view**: integrate **`igltf-engine`** when that package exists (today: strict split — editor preview vs play runtime).

## Backend

- **Stable REST contract**: document request/response schemas for save and `/play/:id`; multipart vs JSON+base64; error model.
- **MongoDB** (or other DB): metadata, versioning, asset catalog, user ownership.
- **AuthN/AuthZ**: OIDC, API keys, org roles.
- **Object storage**: S3-compatible blobs instead of local disk.
- **CDN and signed URLs** for `/files/...`.

## Core library (`igltf-editor-core`)

- **End of POC**: decide what to **extract** from **`igltf-editor-backend`** (glTF patching, extension JSON builders, path conventions) into **`igltf-editor-core`**.
- **Framework-agnostic** glTF manipulation beyond the first extraction.
- **Validation** hooks (glTF Validator, custom extension rules).

## Process and quality

- **CI** for packages (lint, test, build) once code lands.
- **Versioning** of extension namespaces and engine semver alignment with spec releases.

## Specification repository hygiene

When roadmap items **change** the format or host contract, update **`proposals/`** and **`specifications/`** in the **`interactive-gltf-specs`** repository and apply the **`sync-interactive-gltf-format-from-engine`** skill there (`.cursor/skills/sync-interactive-gltf-format-from-engine/SKILL.md`) so the spec project stays the source of portable truth.
