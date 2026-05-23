# Play viewer

**Status:** Implemented (`PlayPage.tsx`, `PlayInteractiveGltf.tsx`).

Route: **`/play/:id`**.

## Load sequence

1. `GET /play/{id}` → `{ glbUrl, jsUrl? }` (cache-bust query on bundle files)
2. Fetch and parse **`scene.glb`**
3. Load scripts:
   - Prefer bundled **`scene.js`** when present
   - Fallback: load individual catalog scripts from `/files/…` paths referenced in proto attachments
4. Inject **`GLTF`** host before handler registration

See [play-export.md](play-export.md) for build artifacts.

## Script runtime

| Kind | Behaviour |
|------|-------------|
| **behaviour** | One `GlTFScript` instance per attachment id; `onLoaded` / `onUpdate` / `onDelete` |
| **interaction** | Kind handler on pointer path (`onEvent`, …) on same persistent instance |

Lifecycle detail: [script-authoring.md](script-authoring.md).

## Pointer / hit traversal

On click, walk **from hit leaf toward root** in the merged scene. Invoke the **first** node carrying **`attachments`**. Parent handlers win when parent mesh is hit directly — see [interior-scene-nodes.md](interior-scene-nodes.md).

## Transactions

Handlers may **return** `{ version: 1, operations: [...] }` or call **`GLTF.executeTransaction`**. Play applies transform/hierarchy ops on the Three.js clone — [host-api.md](host-api.md).

## Metrics footer

**`PlayMetricsFooter`** displays triangle and mesh counts from loaded glTF (debug/author feedback). Non-normative.

## Limitations (milestone 1)

- No networking / UMI3D server session
- No XR device mapping
- Proto extension placeholders — alignment tracked in **`interactive-gltf-specs`**
- Animations stripped in merged export when interior editing active globally

## Related

- [play-export.md](play-export.md) — build pipeline
- [editor-ui.md](editor-ui.md) — Build & Play entry
