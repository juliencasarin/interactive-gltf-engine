# JavaScript script authoring (igltf-editor)

**Status:** Implemented.

**Portable standard:** [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md) — update when export shape or host API diverges.

The bundled **`authoring_kit/md/`** served to MCP is a **mirror** of this document, [host-api.md](host-api.md), and [transform-authoring.md](transform-authoring.md). Edit **here** first, then sync the kit copy.

Use **ES modules** and **exported classes**. The editor runtime loads handlers from module exports; globals are not relied on unless using legacy paths.

## Assets catalog and disk layout

Scripts belong in **`project.json` → `assets[]`** with files under **`{workspace}/assets/`** (`.js` / `.mjs` / `.cjs`).

**Unity-like rule:** one **`export class` / `export default class`** per file; filename stem = class name (**`assets/MyClass.js`**). Disk sync parses orphan scripts toward this stem; legacy UUID-named files migrate on save when parsing succeeds.

Stable **`assetId`** anchors **`interactionAttachments`**, **`serializedProps`**, and similar refs — renaming only updates **`relativePath`** and synced **`scriptExports`**.

| Action | API / behaviour |
|--------|-----------------|
| Rename stem | `PATCH …/assets/{asset_id}/rename-stem` `{ "stem": "NewStem" }` — `mismatch: true` if stem ≠ export class |
| External IDE | Disk sync + `WS …/assets/watch`; orphan files removed on editor Save if not in catalog |
| Create via UI | Staging + Save — preferred path |

- Prefer creating scripts **from the igltf editor UI** (staging, then save).
- **Never** copy a lone `.js` into `assets/` without a catalog entry — the next **`PUT /document`** removes orphan top-level files not in **`assets[]`**.

Catalog fields: [igltf-editor-project.md](igltf-editor-project.md). Persistence: [project-persistence.md](project-persistence.md).

## Class hierarchy

| Role | Base class | Module |
|------|------------|--------|
| **behaviour** (`scriptRole: behaviour`) | `GlTFScript` | `/igltf-core/gltf-script.js` |
| **interaction** (`scriptRole: interaction`) | kind base → `Interaction` → `GlTFScript` | `/igltf-core/interaction-bases.js` |

`GlTFScript` is the MonoBehaviour-style root: attachable via scene node script attachment, with lifecycle hooks. Kind bases: `EventInteraction`, `LinkInteraction`, `FormInteraction`, `ManipulationInteraction`, `DrawingInteraction`.

## Module patterns

**Interaction:**

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

**Behaviour:**

```javascript
import { GlTFScript } from '/igltf-core/gltf-script.js'

export class MyBehaviour extends GlTFScript {
  onLoaded() {}

  onUpdate(delta) {
    void delta
  }
}
```

Export a **`class`** whose name matches **`scriptExports[0]`** and the file stem.

`/igltf-core/*` imports are external in bundled `scene.js` — [play-export.md](play-export.md).

## Lifecycle (Play)

| Hook | When |
|------|------|
| `onLoaded()` | After instance creation; `serializedProps` merged (incl. `targetId`) |
| `onUpdate(delta)` | Each frame (`delta` seconds, R3F `useFrame`) |
| `onDelete()` | Scene unmount / reload |

One instance per proto **`attachmentId`**. Handlers reuse that instance — not `new` per click.

## Interaction kind → handler

| `interactionKind` | Method |
|---------------------|--------|
| event | `onEvent(payload)` |
| link | `onLink(payload)` |
| form | `onForm(payload)` |
| manipulation | `onManipulation(payload)` |
| drawing | `onDrawing(payload)` |

Fallback: `handleInteraction(payload)`.

## Payload

JSON object; inspect **`payload.umi3d`** for UMI3D-shaped DTO fields. Use **`GLTF`** only — not Three.js or other engine globals.

## Transactions

Scripts **do not** mutate Three.js directly. Either:

1. **`return`** a transaction from **`onEvent`**, **`onUpdate`**, or **`onLoaded`** (Play applies automatically), or
2. Call **`GLTF.executeTransaction(...)`** anytime — including after **`await`**.

Both accept plain `{ version: 1, operations: [...] }` or a builder from **`GLTF.createTransaction()`** (no `.toJSON()` required for execute).

**`entityId`** is typically **`this.targetId`** (merged glTF node index as string).

```javascript
import { GlTFScript } from '/igltf-core/gltf-script.js'

export class OrbitBehaviour extends GlTFScript {
  onUpdate(delta) {
    const id = this.targetId
    return GLTF.createTransaction()
      .addRotate(id, { x: 0, y: 30 * delta, z: 0 }, 'local')
      .toJSON()
  }
}
```

```javascript
import { EventInteraction } from '/igltf-core/interaction-bases.js'

export class NudgeOnClick extends EventInteraction {
  onEvent(payload) {
    void payload
    const id = this.targetId
    const pos = GLTF.getObjectByUmi3dId(id)?.getLocalPosition()
    if (!pos) return
    return GLTF.createTransaction()
      .addTranslate(id, { x: 0, y: 0.1, z: 0 }, 'local')
      .addSetLocalScale(id, { x: 1.1, y: 1.1, z: 1.1 })
      .toJSON()
  }
}
```

Builder methods and operation kinds: [host-api.md](host-api.md). Inspector / gizmo UX: [transform-authoring.md](transform-authoring.md).

### Async / imperative apply

```javascript
import { EventInteraction } from '/igltf-core/interaction-bases.js'

export class DelayedNudge extends EventInteraction {
  async onEvent(payload) {
    void payload
    await new Promise((r) => setTimeout(r, 500))
    GLTF.executeTransaction(
      GLTF.createTransaction().addTranslate(this.targetId, { x: 0, y: 0.5, z: 0 }, 'local'),
    )
  }
}
```

`executeTransaction` returns **`true`** when applied, **`false`** when invalid.

Read-only queries: `GLTF.getObjectByUmi3dId(id)` → `getLocalPosition`, `getWorldPosition`, `getLocalRotation`, `getWorldRotation`, `getLocalScale`, `getWorldScale`.

## Scene attachment (editor)

Attach via Inspector or MCP `igltf_add_script_to_node`. Storage: `interactionAttachments[]` — [igltf-editor-project.md](igltf-editor-project.md), [mcp-scene-authoring.md](mcp-scene-authoring.md).

## Alignment with portable standard

| Editor (authoring) | Exported (Play) | Specs target |
|--------------------|-----------------|--------------|
| `assets[]` script rows | `EXT_interactive_gltf.scripts[]` + `scene.js` | `scripts[]` URI rules |
| `interactionAttachments` | `EXT_IGLTF_UMI3D_PROTO.attachments[]` | Interaction + callback model |
| `GLTF` host | Play injects before handlers | Global host name + transaction schema |

When export behaviour changes, update [play-export.md](play-export.md) and sync **`interactive-gltf-specs`** proposals.
