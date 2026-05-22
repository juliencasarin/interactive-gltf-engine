# glTF / GLB interior editing — scope and limits

**Language:** English (engineering notes).

This document defines what the igltf-editor guarantees when catalog `.glb` assets are **expanded** into hierarchical scene rows (**`sourceAssetRef`**, **`sourceGltfNodeIndex`**, and optional **`sourcePlacementId`** on `SceneNode` in `app/models.py`) versus the legacy opaque placement behaviour.

## Supported (V1)

- **TRS deltas** per interior mirror row: authoring stores **Euler XYZ radians** (`rotation`) and **`position` / `scale` as multiplicative / additive deltas** composed with the source glTF node's local transform at export (see exporter in `build_play_glb.py`).
- **Grouping rows** without `sourceGltfNodeIndex` **under an expanded placement** (empty/group nodes); they export as plain transform-only glTF nodes.
- **Interactions** serialized on **any authored row** mapped to its merged gl **`node`** index (`EXT_IGLTF_UMI3D_PROTO`); **`targetId`** defaults to that glTF index (string digits) unless overridden in `serializedProps`.
- **Interior mirror rows** (`sourceAssetRef` + `sourceGltfNodeIndex`): may be **reparented anywhere** under the scene root (including **outside** the catalogue placement subtree, or duplicated as copies). The exporter and preview resolve the catalogue **placement host** thus: **`sourcePlacementId`** if present and naming a row whose **`assetRef`** equals **`sourceAssetRef`**; otherwise the first ancestor row with **`assetRef == sourceAssetRef`**. Set **`sourcePlacementId`** after reparent breaks that implicit chain; **`EditorContext`** updates or clears it on drag.
- **Placement row guard**: catalogue **placement** rows (nodes with **`assetRef`**) may **not** be reparented into a different catalogue GLB scope (see **`interiorReparentForbidden`** in the editor).
- **Skinned meshes rejected** during export validation (existing rule); expanding a hierarchy that references a skinned primitive will fail **`build`** until skin support exists.

## Not supported yet (explicit non-goals for V1)

| Area | Behaviour |
|------|-----------|
| **Skins / joint animation** | Export raises `HTTP 400`; interior mirrors must not reference a `skin`‑bearing source node after merge semantics are defined |
| **Morph targets / morph weights** | Not adjusted per interior row |
| **`animation` clips** targeting interior nodes after reparent/edit | Stripped globally today (`combined.animations = []`); authoring transform does **not** retarget animations |
| **Cameras / lights** on mirrored nodes | Dropped analogous to `_clone_source_node` (interaction-only authoring focus on meshes) |
| **Stable linkage after external `.glb` replacement** | `sourceGltfNodeIndex` is **positional** relative to `nodes[]` in the catalog file **at export time**. Replacing/overwriting that file invalidates authoring unless an optional **`sourceGltfFingerprint`** (planned) detects drift |
| **Very large hierarchies** | Full expand duplicates every reachable default‑scene row into `project.json`; expect large JSON footprint |
| **Pointer / interaction traversal order** | Play walks **from hit leaf toward root** (`PlayInteractiveGltf`) and invokes the **first** node encountered that carries **`attachments`**; children do not preempt parents if the parent's mesh was hit indirectly — see alignment note in proto doc |

## Editor conventions

1. **Placement row** owns `assetRef` (catalog `.glb` asset id); **mirror rows** use `sourceAssetRef` duplicated from that asset but **omit** own `assetRef`.
2. **Legacy opaque placement**: if a placement row has **`assetRef`** and **no mirror row authored with this placement as its resolved mesh host** (expanded authoring off for that placement), exporters keep emitting the previous **whole default scene clone** beneath a single wrapper. Detached mirrors that still resolve to this placement remain part of expanded mode for export.

3. **`sourcePlacementId` scrubbing**: if disk sync removes or invalidates **`sourceAssetRef`**, **`sourcePlacementId`** is cleared with the mirror fields (**`assets_disk_sync.py`**).

## Relation to prototypes

[`umi3d-proto-extension-alignment.md`](umi3d-proto-extension-alignment.md) now clarifies **`targetId` resolves against the built `scene.glb`**.
