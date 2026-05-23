# Authoring interactive-gltf JavaScript interactions

MCP mirror of `docs/editor/script-authoring.md` — sync from canonical when editing.

Use **ES modules** and **exported classes**. The editor runtime loads handlers from module exports; globals are not relied on unless using legacy paths.

## Scripts must live under Assets (workspace `assets/`)

Interaction scripts belong in the project's **Assets** catalog (`project.json` → `assets[]`). Files live under **`{workspace}/assets/`** using **`.js` / `.mjs` / `.cjs`**.

**Unity-like rule:** one **`export class` / `export default class`** per file, filename stem = class name (**`assets/MyClass.js`**). Disk sync parses orphan scripts toward this stem; legacy UUID-named files migrate on save when parsing succeeds.

Stable **`assetId`** anchors scene **`interactionAttachments`**, **`serializedProps`**, and similar refs.

Use **`PATCH /projects/{project_id}/assets/{asset_id}/rename-stem`** with **`{ "stem": "NewStem" }`**. Responses include **`mismatch: true`** when the stem does not match the exported class yet.

- Prefer creating scripts **from the igltf editor UI** (staging, then save).
- External IDE: backend **disk sync** + editor WebSocket refresh. **Never** copy a lone `.js` without a catalog entry — **`PUT /document`** removes orphan files not in **`assets[]`**.

## Class hierarchy

| Role | Base class | Module |
|------|------------|--------|
| **behaviour** (`scriptRole: behaviour`) | `GlTFScript` | `/igltf-core/gltf-script.js` |
| **interaction** (`scriptRole: interaction`) | kind base → `Interaction` → `GlTFScript` | `/igltf-core/interaction-bases.js` |

`GlTFScript` is the MonoBehaviour-style root. Kind bases: `EventInteraction`, `LinkInteraction`, `FormInteraction`, `ManipulationInteraction`, `DrawingInteraction`.

## Import bases

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

**Behaviour (`scriptRole: behaviour`):**

```javascript
import { GlTFScript } from '/igltf-core/gltf-script.js'

export class MyBehaviour extends GlTFScript {
  onLoaded() {}

  onUpdate(delta) {
    void delta
  }
}
```

Export a **`class`** matching **`scriptExports[0]`** and the file stem. `/igltf-core/` imports are external in bundled `scene.js`.

## Lifecycle (Play runtime)

| Hook | When |
|------|------|
| **`onLoaded()`** | After instance creation; **`serializedProps`** (incl. **`targetId`**) merged |
| **`onUpdate(delta)`** | Each frame (`delta` seconds) |
| **`onDelete()`** | Play unmount / reload |

One instance per proto **`attachmentId`**. Handlers reuse that instance — not `new` per click.

## Interaction kind → handler method

| Template kind | Primary method |
|---------------|------------------|
| event | `onEvent(payload)` |
| link | `onLink(payload)` |
| form | `onForm(payload)` |
| manipulation | `onManipulation(payload)` |
| drawing | `onDrawing(payload)` |

Fallback: `handleInteraction(payload)`.

## Payload hints

JSON object; inspect **`payload.umi3d`** for UMI3D-shaped DTO fields. Use **`GLTF`** only — not Three.js globals.

## Transform transactions (`GLTF.createTransaction()`)

Scripts **do not** mutate Three.js directly. Either:

1. **`return`** a transaction from **`onEvent`**, **`onUpdate`**, or **`onLoaded`**, or
2. Call **`GLTF.executeTransaction(...)`** anytime — including after **`await`**.

**`entityId`** is typically **`this.targetId`** (glTF node index as string).

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

Builder methods and operation kinds: [host-api.md](./host-api.md). Inspector / gizmo: [transform-authoring.md](./transform-authoring.md).

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

Read-only: `GLTF.getObjectByUmi3dId(id)` → position / rotation / scale getters.

## Scene attachment

Via Inspector or MCP `igltf_add_script_to_node`. Stored as **`interactionAttachments[]`** on scene nodes in `project.json`.
