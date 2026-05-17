# Interactive glTF authoring kit (backend)

Markdown and JavaScript reference served to MCP clients (`igltf_list_framework_files` / `igltf_read_framework_file`) so coding assistants can emit valid interaction scripts.

## Sync rule (anti-drift)

Keep `js/interaction-bases.js` **identical** to:

`interactive-gltf-engine/igltf-editor-frontend/public/igltf-core/interaction-bases.js`

The editor bundles that URL for viewers; this folder is the **stable copy** bundled with `igltf-editor-backend`. When you change one file, mirror the change in the other (or automate in a future build step).

## Layout

| Path | Role |
|------|------|
| `js/interaction-bases.js` | Base classes (`EventInteraction`, …) imported by authored scripts |
| `md/host-api.md` | Global `GLTF` host surface and transactions (mirrors authoring typings) |
| `md/script-authoring.md` | Module patterns, lifecycle, payload hints |

Optional override of kit root when debugging: env `IGLTF_AUTHORING_KIT` (absolute path to a folder with the same layout).
