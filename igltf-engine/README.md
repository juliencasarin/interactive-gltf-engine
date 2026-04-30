# igltf-engine

**JavaScript/TypeScript** runtime for **interactive-gltf**: loads glTF 2.0 assets that declare interactive-gltf extensions, provides a **host API** for scripts, and runs authored behaviors in the browser.

## Iteration 1 — not in scope

This package is **not implemented in the first iteration**. The editor **Play** view will integrate **`igltf-engine`** once the backend + frontend POC is in place.

**Open design points** (to resolve when work starts) are listed under **Runtime (`igltf-engine`)** in [`../ROADMAP.md`](../ROADMAP.md): language, bundler, Three.js version, script loading model, host API naming, sandboxing, offline/static hosting.

## Spec impact (when implemented)

Any change to **extension JSON expectations**, **script entrypoint**, or **host API surface** must be mirrored in the **`interactive-gltf-specs`** repository (`proposals/` / `specifications/`) using the **`sync-interactive-gltf-format-from-engine`** skill in that repo.

## Package layout (future)

This directory will gain `package.json`, sources, and build output when implementation proceeds.
