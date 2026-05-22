# Transform authoring (igltf-editor)

UMI3D-aligned transform editing in the web editor. Persisted state is **always local TRS** plus `parentId` in `project.json`.

## Inspector — Transform foldout

- **Position / Rotation (°) / Scale** — local TRS only (`updateNode`).
- No parent picker, reparent options, advanced rotate/relative, or glTF attach slot in the Inspector (those belong to hierarchy, assets workflow, or scripts).

## Hierarchy

Drag-and-drop reparent uses `placeSceneNodeInHierarchy` with **`keepWorldPosition: true`** internally (world pose preserved on reparent).

Interior mirror rows and catalogue placement reparent rules (`interiorReparentForbidden`) are unchanged.

## Viewport toolbar — gizmo space (Sketcher parity)

Single toggle button in the preview header toolbar (like Sketcher `gizmoMode`):

- Label shows current mode: **Local** or **Global**
- Click toggles: Global → Local when a single object is selected; Local → Global otherwise
- Drives `TransformControls` `space` via shared `viewportTransformSpace`

Tool shortcuts: **Q** select, **W** move, **E** rotate, **R** scale.

Snap: translation 0.1, rotation 15°.

World-space gizmo drags convert to local TRS via `transformMath.localTRSFromObjectMatrices` (placement rows) or `mirrorDeltaFromObject` (interior mirrors).

## Advanced transforms (scripts only)

Rotate-around, relative deltas, scale/quaternion setters, and imperative reparent are available through **`GLTF.createTransaction()`** / **`GLTF.executeTransaction()`** in Play — not in the Inspector UI. See [script-authoring.md](./script-authoring.md) and [host-api.md](./host-api.md).

## Math module

`igltf-editor-frontend/src/editor/transformMath.ts` — local/world conversion, reparent, rotate-around, relative deltas (used by gizmo apply path and available to script transactions). Unit tests in `transformMath.test.ts`.
