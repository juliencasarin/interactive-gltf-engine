# Interior scene nodes (catalogue mirrors)

**Status:** Implemented (editor + `build_play_glb.py` exporter).

## Purpose

The editor persists a **flat** `scene.nodes[]` array. **Placement** rows attach catalogue geometry via **`assetRef`**. **Interior editing** duplicates the reachable default-scene subtree of that catalogue `.glb` as extra scene rows whose transforms layer on top of the corresponding source glTF **`nodes`** entry.

## Row types

| Type | Fields | Behaviour |
|------|--------|-----------|
| **Placement** | `assetRef` set | Owns a catalogue `.glb`; may have child mirror rows |
| **Mirror** | `sourceAssetRef` + `sourceGltfNodeIndex` | Omits `assetRef`; TRS are **authoring deltas** merged at export |
| **Group** | neither placement nor mirror | Empty / grouping node; export as transform-only glTF node |
| **Legacy opaque placement** | `assetRef`, no mirrors for host | Exporter clones full default scene subgraph under one wrapper |

## Mesh host resolution

Mirrors designate which catalogue **`assetRef`** backs their geometry. The **mesh host** is:

1. **`sourcePlacementId`** if present: that row must be a placement with `assetRef == sourceAssetRef`.
2. Otherwise: walk **`parentId`** upward until a row with `assetRef == sourceAssetRef`.

If neither applies, export/preview is invalid until corrected. **`EditorContext`** sets or clears **`sourcePlacementId`** on reparent.

## Transform semantics

- **`position`**, **`rotation`**, **`scale`** on mirrors: Euler-XYZ-radian **deltas** composed with the catalogue node's local transform at export (`build_play_glb.py`).
- **Detached mirrors** (reparented outside the placement subtree) still resolve mesh via **`sourcePlacementId`** or ancestry.
- Viewport gizmo in **world** space converts to local TRS via `transformMath` (placement) or `mirrorDeltaFromObject` (mirrors).

## Editor rules

| Rule | Implementation |
|------|----------------|
| Placement reparent guard | Catalogue placement rows may **not** move into a different catalogue GLB scope (`interiorReparentForbidden`) |
| Reparent default | Hierarchy drag uses **`keepWorldPosition: true`** |
| Disk sync scrub | If `sourceAssetRef` invalidated, mirror fields and `sourcePlacementId` cleared (`assets_disk_sync.py`) |
| Expand / collapse UI | Creates or removes mirror rows for reachable default-scene nodes |

## Supported at export (V1)

- TRS deltas per mirror row; grouping rows under expanded placements.
- Interactions on **any** authored row → merged gl **`node`** index (`EXT_IGLTF_UMI3D_PROTO`); default **`targetId`** = that index unless `serializedProps` overrides.
- Mirrors may be reparented anywhere (including duplicated); host resolved via rules above.
- **Skinned meshes** rejected — export `HTTP 400` until skin support exists.

## Not supported yet (V1)

| Area | Behaviour |
|------|-----------|
| Skins / joint animation | Export fails validation |
| Morph targets / weights | Not adjusted per interior row |
| Animation clips on interior nodes | Globally stripped (`combined.animations = []`) |
| Cameras / lights on mirrors | Dropped at clone |
| Stable linkage after `.glb` replacement | `sourceGltfNodeIndex` is **positional**; optional **`sourceGltfFingerprint`** planned |
| Very large hierarchies | Full expand duplicates all reachable rows — large `project.json` |
| Pointer hit order | Play walks leaf → root; first node with `attachments` wins |

## Play interaction traversal

`PlayInteractiveGltf` walks **from hit leaf toward root** and invokes the **first** node with attachments. Children do not preempt parents on indirect parent mesh hits — see [play-export.md](play-export.md).

## Portable standard

Interior mirror **storage** is editor-only (`igltf-editor-project`). **Exported** glTF node indices and interaction attachment placement inform alignment proposals in **`interactive-gltf-specs`**. Positional `sourceGltfNodeIndex` is an authoring constraint, not a portable glTF extension.

## Interior expand (editor API)

**`GET /projects/{id}/assets/{asset_id}/gltf-interior-manifest`** — preorder of default-scene glTF nodes for UI expand. See [interior-scene-nodes.md](interior-scene-nodes.md), [http-api.md](http-api.md).

## Planned

- `sourceGltfFingerprint` to detect catalogue regeneration drift.
- Skin / animation remap rules once exporter supports them.
