# Global `GLTF` host API

**Status:** Implemented in Play viewer. Typings: `igltf-editor-frontend` `igltfHost.d.ts`. Runtimes inject the implementation before handlers run.

**Portable standard:** [`proposal-interactive-gltf-javascript-scripts`](../../../interactive-gltf-specs/interactive-gltf-specs/proposals/proposal-interactive-gltf-javascript-scripts.md).

MCP mirror: `igltf-editor-backend/authoring_kit/md/host-api.md`.

## Vectors

- **`IgltfVec3`**: `readonly x`, `y`, `z`
- **`IgltfVec4`**: `readonly x`, `y`, `z`, `w` (quaternion)

## `IgltfSceneObjectHandle`

- `umi3dId: string`
- `getLocalPosition(): IgltfVec3`
- `getWorldPosition(): IgltfVec3`
- `getLocalRotation(): IgltfVec4`
- `getWorldRotation(): IgltfVec4`
- `getLocalScale(): IgltfVec3`
- `getWorldScale(): IgltfVec3`
- optional `translateLocal?(x: number, y: number, z: number)`

## `InteractiveGltfHost` (`GLTF`)

- `readonly apiVersion: string` (semver-style)
- `getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined`
- `createTransaction(): IgltfTransactionBuilder`
- `executeTransaction(transaction): boolean` — immediate apply (async-friendly); accepts JSON or builder

## `IgltfTransaction`

`{ version: 1, operations: IgltfOperation[] }`

| `kind` | UMI3D key | Notes |
|--------|-----------|-------|
| `hierarchy.setParent` | 3 ParentId | Play: best-effort on Three.js clone |
| `transform.setLocalPosition` | 10 Position | local vec3 |
| `transform.setLocalEulerDegrees` | 11 Rotation | degrees → Euler at apply |
| `transform.setLocalQuaternion` | 11 Rotation | quaternion |
| `transform.setLocalScale` | 12 Scale | local vec3 |
| `transform.translate` | 10 after sync | optional `space`: `local` \| `world` |
| `transform.rotate` | 11 after sync | Euler delta (deg), optional `space` |
| `transform.rotateAround` | 11 after sync | axis, `angleDeg`, optional `pivot`, `space` |

World/global space in translate / rotate / rotateAround is a **runtime apply convention**; persisted project state and UMI3D DTOs remain **local TRS**.

## Builder (`GLTF.createTransaction()`)

`IgltfTransactionBuilder`:

- `addSetLocalPosition(entityId, position)`
- `addSetLocalEulerDegrees(entityId, eulerDegrees)`
- `addSetLocalScale(entityId, scale)`
- `addSetLocalQuaternion(entityId, quaternion)`
- `addSetParent(entityId, parentId)`
- `addTranslate(entityId, delta, space?)`
- `addRotate(entityId, eulerDegrees, space?)`
- `addRotateAround(entityId, axis, angleDeg, opts?)`
- `build(): IgltfTransaction`
- `toJSON(): IgltfTransaction` (same snapshot)

Prefer returning **`GLTF.createTransaction()....toJSON()`** from interaction handlers where the viewer applies results.

| Builder method | UMI3D property | Notes |
|----------------|----------------|-------|
| `addSetLocalPosition` | Position (10) | absolute local vec3 |
| `addSetLocalEulerDegrees` | Rotation (11) | degrees at apply |
| `addSetLocalQuaternion` | Rotation (11) | quaternion |
| `addSetLocalScale` | Scale (12) | local vec3 |
| `addSetParent` | ParentId (3) | Play: best-effort on clone |
| `addTranslate` | Position after sync | optional `space` |
| `addRotate` | Rotation after sync | Euler delta (deg) |
| `addRotateAround` | Rotation after sync | axis, pivot, `space` |

See [script-authoring.md](script-authoring.md) for examples and [transform-authoring.md](transform-authoring.md) for Inspector / gizmo UX.

## Handler payload

`ScriptInvocationPayload`: `Record<string, unknown>` with optional **`umi3d?: Record<string, unknown>`** for UMI3D-shaped DTO subsets.
