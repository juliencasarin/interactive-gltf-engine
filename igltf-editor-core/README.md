# igltf-editor-core

**Python** library with **framework-agnostic** and **database-agnostic** building blocks for the editor pipeline: glTF manipulation, merging helpers, interactive-gltf extension JSON construction, and packaging rules.

## Iteration 1 — defer extraction

For the **first iteration**, keep implementation **inside `igltf-editor-backend`**. **At end of POC**, revisit what to **move** here (e.g. glTF JSON patching, extension helpers, path conventions, validation helpers) so FastAPI stays a thin HTTP layer.

## Responsibilities (target)

- Shared logic used by **`igltf-editor-backend`** without importing FastAPI or database drivers.
- Unit-testable pure functions where possible (paths, buffers, JSON structures).

## Non-goals (see [`../ROADMAP.md`](../ROADMAP.md))

- HTTP layer, session handling, or storage backends.
- Full glTF validator replacement.

## Spec impact

This package should implement **only** what the **published or in-progress** spec text allows in **`interactive-gltf-specs`**. If code needs a new field or behavior, **update the spec first or in the same change**, using **`sync-interactive-gltf-format-from-engine`** in that repository.

## Layout (future)

This directory will gain `pyproject.toml` (or a shared workspace with `uv`), importable package `igltf_editor_core/` (or equivalent), and tests when extraction happens.
