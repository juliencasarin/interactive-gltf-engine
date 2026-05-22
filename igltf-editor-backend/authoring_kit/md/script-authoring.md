# Authoring interactive-gltf JavaScript interactions

Use **ES modules** and **exported classes**. The editor runtime loads handlers from module exports; globals are not relied on unless using legacy paths.

## Scripts must live under Assets (workspace `assets/`)

Interaction scripts belong in the project's **Assets** catalog (`project.json` → `assets[]`). Files live under **`{workspace}/assets/`** using the **`.js` / `.mjs` / `.cjs`** extension.

**Unity-like rule:** one **`export class` / `export default class`** per file, with the filename stem aligned to that class (**`assets/MyClass.js`**). Disk sync parses new orphan scripts toward this stem; legacy UUID-named files migrate on save when parsing succeeds.

Stable **`assetId`** (catalog UUID) anchors scene **`interactionAttachments`**, **`serializedProps`**, and similar refs — renaming only updates **`relativePath`** and synced **`scriptExports`**.

Use **`PATCH /projects/{project_id}/assets/{asset_id}/rename-stem`** with **`{ "stem": "NewStem" }`** to move **`assets/NewStem.{ext}`** atomically without touching **`scene`**. Responses include **`mismatch: true`** when the renamed stem **does not** match the exported class in file content yet — fix or revert the **`export class`** name before authoring expectations line up again.

- Prefer creating scripts **from the igltf editor UI** (**staging**, then save) so the catalog and filesystem stay aligned.
- If you create files with an external IDE (**Cursor**, etc.), rely on backend **disk sync** (workspace watcher → `project.json` update → editor WebSocket refresh). **Never** rely on copying a lone `.js` into `assets/` without a catalog entry — the next **`PUT /document`** from the editor removes **top-level orphan files under `assets/`** that are not referenced in **`assets[]`**.

## Class hierarchy

| Role | Base class | Module |
|------|------------|--------|
| **behaviour** (`scriptRole: behaviour`) | `GlTFScript` | `/igltf-core/gltf-script.js` |
| **interaction** (`scriptRole: interaction`) | kind base → `Interaction` → `GlTFScript` | `/igltf-core/interaction-bases.js` |

`GlTFScript` is the MonoBehaviour-style root: attachable to a transform via scene node script attachment, with lifecycle hooks. Interaction scripts extend a kind-specific base (`EventInteraction`, `LinkInteraction`, …) that inherits from `Interaction`.

## Import bases

Interaction pattern:

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

Behaviour pattern (`scriptRole: behaviour`):

```javascript
import { GlTFScript } from '/igltf-core/gltf-script.js'

export class MyBehaviour extends GlTFScript {
  onLoaded() {}

  onUpdate(delta) {
    void delta
  }
}
```

Paths under `/igltf-core/` resolve in the authoring UI and in Play; bundled `scene.js` treats them as external imports.

## Class export and glTF mapping

Export a **`class`** whose name matches the **catalog `scriptExports` entry** used at runtime — for Unity-like projects this is the primary export and must match **the stem of the `.js`/`.mjs`/`.cjs` file**.

## Lifecycle (Play runtime)

| Hook | When |
|------|------|
| **`onLoaded()`** | Once after the instance is created and **`serializedProps`** (including **`targetId`**) are merged |
| **`onUpdate(delta)`** | Each frame while the scene is active (`delta` in seconds, R3F `useFrame` convention) |
| **`onDelete()`** | When the Play scene unmounts or reloads |

Play keeps **one persistent instance per proto attachment** (`attachmentId`). Interaction handlers (`onEvent`, …) run on that same instance — not a fresh `new` per click.

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

## Transform transactions (`GLTF.createTransaction()`)

Scripts **do not** mutate Three.js directly. Either:

1. **`return`** a transaction from **`onEvent`**, **`onUpdate`**, or **`onLoaded`** (Play applies it automatically), or  
2. Call **`GLTF.executeTransaction(...)`** anytime — including after **`await`** in async code.

Both accept plain `{ version: 1, operations: [...] }` or a builder from **`GLTF.createTransaction()`** (no need to call `.toJSON()` for execute).

**`entityId`** is typically **`this.targetId`** (glTF node index as string, set at runtime from the attachment host).

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

| Builder method | UMI3D property | Notes |
|----------------|----------------|-------|
| `addSetLocalPosition` | Position (10) | absolute local vec3 |
| `addSetLocalEulerDegrees` | Rotation (11) | degrees → Euler at apply |
| `addSetLocalQuaternion` | Rotation (11) | quaternion |
| `addSetLocalScale` | Scale (12) | local vec3 |
| `addSetParent` | ParentId (3) | Play: best-effort on clone |
| `addTranslate` | Position after sync | optional `space`: `'local'` \| `'world'` |
| `addRotate` | Rotation after sync | Euler delta (deg), optional `space` |
| `addRotateAround` | Rotation after sync | axis, `angleDeg`, optional `pivot`, `space` |

**World space** in `addTranslate` / `addRotate` / `addRotateAround` is a runtime apply convention only — persisted UMI3D state remains **local TRS**. See [host-api.md](./host-api.md).

Read-only queries: `getObjectByUmi3dId(id)` → `getLocalPosition`, `getWorldPosition`, `getLocalRotation`, `getWorldRotation`, `getLocalScale`, `getWorldScale`.

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

`executeTransaction` returns **`true`** when applied, **`false`** when the payload was invalid.
