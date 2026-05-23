# Assets panel

**Status:** Implemented (`AssetsPanel.tsx`, `ScriptAssetEditor.tsx`).

## Purpose

Manage the **`assets[]`** catalog and on-disk files under **`workspace/assets/`**. glTF catalogue entries and JavaScript interaction/behaviour scripts share the same panel with virtual folders.

## Virtual folders

- **`assetFolders`** — root folder names in `project.json`
- **`logicalFolder`** per asset — which virtual folder contains the row
- UI: create/rename folders, drag assets between folders (updates `logicalFolder` only)

## Import flows

| Source | Behaviour |
|--------|-------------|
| Panel **Import** button | Multipart → `POST …/assets/stage` → adds catalog row (editor state) |
| Drag-drop onto panel | Same staging path |
| Drag glTF to preview | Stages if needed, then creates placement node |

Supported extensions: `.glb`, `.gltf`, `.js`, `.mjs`, `.cjs`.

## Script assets

| Feature | Detail |
|---------|--------|
| **Monaco editor** | `GET/PUT …/assets/{id}/source`; debounced save; no undo integration |
| **Templates** | Create interaction script from kind (`event`, `link`, …) — sets `interactionKind`, `scriptRole: interaction` |
| **Behaviour scripts** | `scriptRole: behaviour` — `GlTFScript` lifecycle |
| **Stem rename** | `PATCH …/rename-stem` — keeps `assetId`, moves file |
| **Export class sync** | Disk sync parses `export class` → updates `scriptExports` |

Unity-like rule: **`assets/MyClass.js`** ↔ `export class MyClass` — [script-authoring.md](script-authoring.md).

## glTF assets

- Thumbnail / name in list
- Double-click or drag to scene
- **Expand interior** (from hierarchy context on placement) uses **`GET …/gltf-interior-manifest`**

## Disk sync indicator

When **`WS …/assets/watch`** connected, panel shows live sync status. External IDE edits under `assets/` merge into catalog — [disk-sync.md](disk-sync.md).

## Orphan policy

**Save** (`PUT /document`) deletes top-level files in `assets/` not listed in **`assets[]`**. Disk sync adds catalog rows **before** save when watch is active.

## Script dependencies

**`scriptDependsOnAssetIds`** on catalog rows affects esbuild bundle order at export — [play-export.md](play-export.md). **No graph editor UI** yet; set via JSON or future tooling.

## Related

- [igltf-editor-project.md](igltf-editor-project.md) — catalog fields
- [project-persistence.md](project-persistence.md) — staging
