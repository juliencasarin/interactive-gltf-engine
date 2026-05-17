# Authoring interactive-gltf JavaScript interactions

Use **ES modules** and **exported classes**. The editor runtime loads handlers from module exports; globals are not relied on unless using legacy paths.

## Scripts must live under Assets (workspace `assets/`)

Interaction scripts belong in the project's **Assets** catalog (`project.json` → `assets[]`). Files live under **`{workspace}/assets/`** using the **`.js` / `.mjs` / `.cjs`** extension.

**Unity-like rule:** one **`export class` / `export default class`** per file, with the filename stem aligned to that class (**`assets/MyClass.js`**). Disk sync parses new orphan scripts toward this stem; legacy UUID-named files migrate on save when parsing succeeds.

Stable **`assetId`** (catalog UUID) anchors scene **`interactionAttachments`**, **`serializedProps`**, and similar refs — renaming only updates **`relativePath`** and synced **`scriptExports`**.

Use **`PATCH /projects/{project_id}/assets/{asset_id}/rename-stem`** with **`{ "stem": "NewStem" }`** to move **`assets/NewStem.{ext}`** atomically without touching **`scene`**. Responses include **`mismatch: true`** when the renamed stem **does not** match the exported class in file content yet — fix or revert the **`export class`** name before authoring expectations line up again.

- Prefer creating scripts **from the igltf editor UI** (**staging**, then save) so the catalog and filesystem stay aligned.
- If you create files with an external IDE (**Cursor**, etc.), rely on backend **disk sync** (workspace watcher → `project.json` update → editor WebSocket refresh). **Never** rely on copying a lone `.js` into `assets/` without a catalog entry — the next **`PUT /document`** from the editor removes **top-level orphan files under `assets/`** that are not referenced in **`assets[]`**.

## Import bases

Standard pattern:

```javascript
import { EventInteraction } from '/igltf-core/interaction-bases.js'

export class MyHandler extends EventInteraction {
  onLoaded() {}

  onEvent(payload) {
    const entityId = this.targetId
    void payload?.umi3d
    return GLTF.createTransaction().addSetLocalPosition(entityId, { x: 0, y: 0, z: 0 }).toJSON()
  }
}
```

Path `/igltf-core/interaction-bases.js` resolves in the authoring UI; authored assets are served from the project and follow the same import string.

## Class export and glTF mapping

Export a **`class`** whose name matches the **catalog `scriptExports` entry** used at runtime — for Unity-like projects this is the primary export and must match **the stem of the `.js`/`.mjs`/`.cjs` file**.

## Lifecycle

- **`onLoaded()`**: optional hook when the behaviour is instantiated (preview and runtime implementations may mirror Unity-style patterns).

## Interaction kind → handler method

| Template kind | Primary method on behaviour |
|---------------|----------------------------|
| event | `onEvent(payload)` |
| link | `onLink(payload)` |
| form | `onForm(payload)` |
| manipulation | `onManipulation(payload)` |
| drawing | `onDrawing(payload)` |

## Payload hints

Scripts receive a JSON-ish `payload` object. Inspect `payload.umi3d` for UMI3D-flavoured DTO fields (interaction id, tool context, form values, manipulation tool id, stroke updates, …). Prefer reading through `payload`/`payload.umi3d` only; avoid depending on proprietary engine globals beyond **`GLTF`**.

## Fallback handler names

Hosts may invoke `handleInteraction(payload)` when the primary template method is missing.
