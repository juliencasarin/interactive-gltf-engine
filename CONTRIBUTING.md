# Contributing

Thank you for your interest in **interactive-gltf-engine**.

## Before you start

1. Read [GETTING_STARTED.md](GETTING_STARTED.md) and run backend + frontend locally.
2. Read [docs/milestone-1-scope.md](docs/milestone-1-scope.md) — know what is in scope for Milestone 1.
3. **Format changes** (exported glTF, script packaging, portable host API) belong in **[interactive-gltf-specs](https://github.com/UMI3D/interactive-gltf-specs)** as well as this repo. Product-only behaviour stays in **`docs/editor/`** here.

## Documentation

| Change type | Where to write |
|-------------|----------------|
| Editor behaviour, API, UI | `docs/editor/` (canonical) |
| MCP authoring kit mirror | Update `docs/editor/` first, then sync `igltf-editor-backend/authoring_kit/md/` |
| Portable glTF / JS language | **interactive-gltf-specs** `proposals/` / `specifications/` |

Do **not** use the specs repo proposal template for igltf-editor product docs.

## Code

- **Backend:** Python 3.12, `uv`, FastAPI — tests in `igltf-editor-backend/tests/` (`uv run pytest`).
- **Frontend:** React, TypeScript, Vite — tests via `npm test` in `igltf-editor-frontend/`.
- Match existing style in touched files; keep diffs focused.
- Never commit `.env` files or local `data/` workspaces with private content.

## Pull requests

1. Describe **why** and link related specs/issues when relevant.
2. Note any doc updates in the same PR.
3. Ensure backend tests pass (`uv run pytest` from `igltf-editor-backend/`).
4. For user-visible behaviour, update or add a short note under `docs/editor/` when appropriate.

## Agent / MCP authoring

Agents must **not** hand-edit `project.json` in user workspaces. Scene changes go through the live editor session or the UI. See `docs/editor/mcp-scene-authoring.md`.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
