## Agent instructions (interactive-gltf-engine)

When working on **igltf-editor workspaces** (authoring project folders with `project.json`, `assets/`, `mcp.json`):

- **Strict:** agents must **never** edit `project.json` — including as an MCP fallback when the live session is down. See `.cursor/rules/igltf-no-hand-edit-project-json.mdc`.
- Scene changes: **MCP live session tools** while igltf-editor is open, or the **editor UI** + Save.
- Catalog assets: files under `assets/` + disk sync — not hand-edited catalog rows in `project.json`.

Each workspace gets `.cursor/rules/igltf-no-hand-edit-project-json.mdc` automatically on first `ensure_project_layout` (same policy as repo root).

Engine, editor, and product docs live in this repository (**`docs/editor/`**, component READMEs). **Portable** glTF extension and JS scripting specs live in **interactive-gltf-specs** only.

**Editor leads, specs follow:** document full implemented behaviour in **`docs/editor/`**; when export or host API diverges from the standard, update **`interactive-gltf-specs`** proposals via **`sync-interactive-gltf-format-from-engine`**. See **`.cursor/rules/documentation-scope.mdc`** in both repos.
