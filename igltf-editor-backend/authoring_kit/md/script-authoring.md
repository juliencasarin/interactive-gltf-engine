# Authoring interactive-gltf JavaScript interactions

MCP mirror of `docs/editor/script-authoring.md` — sync from canonical when editing.

Use **ES modules** and **exported classes**. The editor runtime loads handlers from module exports; globals are not relied on unless using legacy paths.

MCP/vibe-coding tools should treat this page as the source of truth before creating or attaching scripts. The generated class, the catalog `interactionKind`, and the callback method must describe the same interaction kind.

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

`GlTFScript` is the MonoBehaviour-style root. Interaction classes must extend the kind base that matches the asset `interactionKind`.

| `interactionKind` | Base class | Primary callback | Use for | Do not use for |
|-------------------|------------|------------------|---------|----------------|
| `event` | `EventInteraction` | `onEvent(payload)` | Click, trigger, hold start/end, simple buttons, "push this object" when no continuous manipulation payload is needed | Free-form object transforms driven by controller deltas |
| `link` | `LinkInteraction` | `onLink(payload)` | Opening or handling a URL-like target | General click actions |
| `form` | `FormInteraction` | `onForm(payload)` | Form answers / submitted values | Buttons that do not submit data |
| `manipulation` | `ManipulationInteraction` | `onManipulation(payload)` | Runtime-provided manipulation requests such as translation/rotation deltas, grab/manipulate tools | Ordinary click, pointer down/up, or a UMI3D Graph "push" if the runtime does not emit manipulation payloads |
| `drawing` | `DrawingInteraction` | `onDrawing(payload)` | Drawing payloads when supported by the runtime | Current Play portable drawing is reserved / not implemented |

For generated scripts, verify this invariant before saving:

1. The script imports the matching base from `/igltf-core/interaction-bases.js`.
2. The exported class extends that base.
3. The asset catalog row has the matching `interactionKind`.
4. The class implements the matching primary callback.

Example: a class extending `ManipulationInteraction` must be attached through an asset whose `interactionKind` is `manipulation`; otherwise Play routes the interaction to `onEvent` and the script appears to do nothing.

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
| **`afterLoading()`** | After all instances exist and async **`onLoaded`** settled; cross-script wiring |
| **`onUpdate(delta)`** | Each runtime frame (`delta` seconds) |
| **`onDelete()`** | Play unmount / reload |

One instance per proto **`attachmentId`**. Handlers reuse that instance — not `new` per click.

## Script inputs (`@igltfInput`)

Typed Inspector / MCP fields via JSDoc on public class properties. Stored as portable JSON refs in **`serializedProps`**; resolve at runtime with **`GLTF.getObjectByUmi3dId`** in **`afterLoading()`**. Full author doc: **`docs/editor/script-inputs.md`**. MCP: **`script-inputs-mcp.md`**.

## Interaction kind → handler method

| Template kind | Primary method |
|---------------|------------------|
| event | `onEvent(payload)` |
| link | `onLink(payload)` |
| form | `onForm(payload)` |
| manipulation | `onManipulation(payload)` |
| drawing | `onDrawing(payload)` |

Fallback: `handleInteraction(payload)`.

The fallback is only for intentionally generic scripts. Do not rely on it to hide a mismatch between base class, `interactionKind`, and callback.

## Payload hints

JSON object; inspect **`payload.umi3d`** for UMI3D-shaped DTO fields. Use **`GLTF`** only — not Three.js globals.

### Event hold

`EventInteraction` supports two event modes:

- Default trigger events call `onEvent(payload)` once with `payload.eventType === "trigger"`.
- Hold events call `onEvent(payload)` on press and release with:
  - `payload.eventType === "holdStart"` and `payload.active === true`
  - `payload.eventType === "holdEnd"` and `payload.active === false`

There are no separate `onHoldStart` / `onHoldEnd` hooks; branch inside `onEvent(payload)`.

Enable hold by setting `hold: true` on the script attachment `serializedProps` (Inspector/MCP). The Play export mirrors that value into the event DTO so the runtime can bind pointer down/up instead of a one-shot trigger.

## Portable runtime rules

Interactive glTF scripts must be portable across browser Play, Unity-like runtimes, and other engines embedding a JavaScript VM. Use only standard ECMAScript, exported modules/classes, lifecycle callbacks, and the global `GLTF` host API documented here.

Do **not** use browser- or engine-specific globals in portable scripts:

- `window`, `document`, DOM APIs
- `requestAnimationFrame`
- `setTimeout`, `setInterval`, timer-driven animation loops
- `performance.now`, browser clocks
- Three.js, React, React Three Fiber, Unity globals, or direct scene-object mutation

Use `onUpdate(delta)` for time-based behavior. Store script state on the class instance, accumulate `delta` seconds, and return or execute `GLTF` transactions from lifecycle or interaction callbacks.

For one-shot delayed effects, set state in the interaction callback and complete the delay in `onUpdate(delta)`. For animations, keep `from`, `to`, `elapsed`, and `duration` fields on the instance; do not start a private frame loop.

## Transform transactions (`GLTF.createTransaction()`)

Scripts **do not** mutate Three.js directly. Either:

1. **`return`** a transaction from **`onEvent`**, **`onUpdate`**, or **`onLoaded`**, or
2. Call **`GLTF.executeTransaction(...)`** from a lifecycle or interaction callback when returning is not convenient.

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

### State-driven delay

```javascript
import { EventInteraction } from '/igltf-core/interaction-bases.js'

export class DelayedNudge extends EventInteraction {
  delaySeconds = 0.5
  elapsed = 0
  pending = false

  onEvent(payload) {
    void payload
    this.elapsed = 0
    this.pending = true
  }

  onUpdate(delta) {
    if (!this.pending) return
    this.elapsed += delta
    if (this.elapsed < this.delaySeconds) return

    this.pending = false
    return GLTF.createTransaction()
      .addTranslate(this.targetId, { x: 0, y: 0.5, z: 0 }, 'local')
      .toJSON()
  }
}
```

`executeTransaction` returns **`true`** when applied, **`false`** when invalid.

Read-only: `GLTF.getObjectByUmi3dId(id)` → position / rotation / scale getters.

## Scene attachment

Via Inspector or MCP `igltf_add_script_to_node`. Stored as **`interactionAttachments[]`** on scene nodes in `project.json`.
