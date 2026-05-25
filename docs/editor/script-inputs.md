# Script inputs (`@igltfInput`)

**Status:** Implemented (editor Inspector, Play export, MCP).

**Portable standard:** [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md) section 2.5.

**MCP agents:** [script-inputs-mcp.md](script-inputs-mcp.md).

## Declaring inputs

Annotate **public class fields** with JSDoc `@igltfInput` and a JSON descriptor:

```javascript
import { EventInteraction } from '/igltf-core/interaction-bases.js'

export class DoorOpener extends EventInteraction {
  /** @igltfInput { "kind": "node" } */
  doorTarget = null

  /** @igltfInput { "kind": "script", "exportName": "DoorController" } */
  doorScriptAssetId = ''

  /** @igltfInput { "kind": "scriptAttachment", "exportName": "RotateWheel" } */
  wheelBehaviour = null

  /** @igltfInput { "kind": "gltfAsset" } */
  meshAssetId = ''

  /** @igltfInput { "kind": "object", "fields": { "speed": { "kind": "number" } } } */
  tuning = { speed: 1 }

  onLoaded() {
    // Local init — props are still JSON refs here.
  }

  afterLoading() {
    const id = this.doorTarget?.id ?? this.doorTarget
    this._door = id ? GLTF.getObjectByUmi3dId(id) : undefined
    const wheelRef = this.wheelBehaviour
    this._wheel =
      wheelRef?.attachmentId != null
        ? GLTF.getScriptByAttachmentId(wheelRef.attachmentId)
        : undefined
  }
}
```

Kinds v1: **`node`**, **`script`** (catalog asset type), **`scriptAttachment`** (specific attachment on a node), **`gltfAsset`**, **`object`** (nested scalars/refs). Unannotated public fields remain plain scalars in `serializedProps`.

## Stored JSON (`serializedProps` / export)

Refs are **JSON only** — never live handles in the project file or exported glTF:

| Kind | Stored shape |
|------|----------------|
| `node` | `{ "kind": "node", "id": "<authoring-node-id>" }` → export remaps `id` to glTF node index string |
| `script` | `{ "kind": "script", "assetId": "<catalog-assetId>", "exportName?": "ClassName" }` — **script file** in catalogue, not an instance |
| `scriptAttachment` | `{ "kind": "scriptAttachment", "nodeId": "<authoring-node-id>", "attachmentId": "<attachment-id>" }` → export remaps `nodeId`; **`attachmentId`** stable |
| `gltfAsset` | `{ "kind": "gltfAsset", "assetId": "<catalog-assetId>" }` |
| `object` | Plain object; nested fields follow their `fields` schema |

`targetId` is injected at runtime from the host node — hide it in the Inspector; do not author it unless you intentionally override.

## Lifecycle

| Hook | When |
|------|------|
| `onLoaded()` | After instance creation and prop merge; local setup only |
| `afterLoading()` | After **all** instances exist and async `onLoaded` hooks settled; cross-script wiring |

Order of `afterLoading()` across attachments is **not guaranteed**. Resolve refs lazily in handlers if order matters.

Play bootstrap (3 passes): create instances → `onLoaded` (await promises) → `afterLoading`.

## Runtime resolution

No eager injection in exported JSON. Recommended patterns:

```javascript
afterLoading() {
  const wheel = GLTF.getScriptByAttachmentId(this.wheelFL?.attachmentId)
  void wheel
}
```

Or resolve on demand inside `onEvent` / `onUpdate`. Use **`kind: "node"`** when you only need the scene entity; use **`kind: "scriptAttachment"`** when you need another script's **live instance** (e.g. Buggy → each wheel's `RotateWheel` behaviour).

## Inspector

The Inspector shows typed fields on **one row** (label + value). Ref kinds (`node`, `script`, `gltfAsset`, `scriptAttachment`) use a **read-only** value cell: assign by **drag-and-drop** only, with a light **✕** to clear. A **dropdown appears only when ambiguous** — e.g. dropping a hierarchy node with several matching `scriptAttachment` candidates. Nested `object` sub-fields use the same single-line layout. Validation matches export and MCP tools.

## Export

`build_play_glb` remaps `{ kind: "node", id }` (and legacy string `targetId`) from authoring node ids to merged glTF node indices. Script and glTF asset refs stay catalog-stable by `assetId`.

## MCP

Use **`igltf_set_script_inputs`** with semantic values — see [script-inputs-mcp.md](script-inputs-mcp.md).
