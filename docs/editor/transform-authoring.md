# Transform authoring (Inspector and viewport)

**Status:** Implemented (`igltf-editor-frontend`).

UMI3D-aligned transform editing. Persisted state is **always local TRS** + `parentId` in `project.json` — [igltf-editor-project.md](igltf-editor-project.md).

## Inspector — Transform foldout

- **Position / Rotation (°) / Scale** — local TRS only (`updateNode`).
- No parent picker, reparent options, advanced rotate/relative, or glTF attach slot in the Inspector (hierarchy, assets workflow, or scripts).

## Hierarchy

Drag-and-drop reparent uses `placeSceneNodeInHierarchy` with **`keepWorldPosition: true`** (world pose preserved).

Interior mirror rows and catalogue placement reparent rules (`interiorReparentForbidden`) — [interior-scene-nodes.md](interior-scene-nodes.md).

## Viewport toolbar — gizmo space (Sketcher parity)

Single toggle in the preview header toolbar (like Sketcher `gizmoMode`):

- Label: **Local** or **Global**
- Click toggles: Global → Local when a single object is selected; Local → Global otherwise
- Drives `TransformControls` `space` via shared `viewportTransformSpace`

Shortcuts: **Q** select, **W** move, **E** rotate, **R** scale. Snap: translation 0.1, rotation 15°.

World-space gizmo drags convert to local TRS via `transformMath.localTRSFromObjectMatrices` (placement rows) or `mirrorDeltaFromObject` (interior mirrors).

## Advanced transforms (scripts only)

Rotate-around, relative deltas, scale/quaternion setters, and imperative reparent via **`GLTF.createTransaction()`** / **`GLTF.executeTransaction()`** in Play — not in the Inspector UI. See [script-authoring.md](script-authoring.md) and [host-api.md](host-api.md).

## Math module

`igltf-editor-frontend/src/editor/transformMath.ts` — local/world conversion, reparent, rotate-around, relative deltas. Unit tests: `transformMath.test.ts`.

## Portable standard

Local TRS persistence aligns with UMI3D property keys 3/10/11/12 — [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md).
