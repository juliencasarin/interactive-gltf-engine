# Global `GLTF` host API (interactive-gltf authoring)

Typings correspond to igltf-editor `igltfHost.d.ts`; runtimes inject the real implementation before handlers run.

## `IgltfVec3` / `IgltfVec4`

- `IgltfVec3`: `readonly x`, `y`, `z`
- `IgltfVec4`: `readonly x`, `y`, `z`, `w` (quaternion)

## `IgltfSceneObjectHandle`

- `umi3dId: string`
- `getLocalPosition(): IgltfVec3`
- `getWorldPosition(): IgltfVec3`
- `getLocalRotation(): IgltfVec4`
- `getWorldRotation(): IgltfVec4`
- `getLocalScale(): IgltfVec3`
- `getWorldScale(): IgltfVec3`
- optional `translateLocal?(x: number, y: number, z: number)`

## `InteractiveGltfHost`

- `readonly apiVersion: string` semver-style
- `getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined`
- `createTransaction(): IgltfTransactionBuilder`
- `executeTransaction(transaction): boolean` — apply immediately (async-friendly); accepts JSON or builder

## Transactions

**`IgltfTransaction`**: `{ version: 1, operations: IgltfOperation[] }`

**Transform / hierarchy operations (informative JSON):**

| `kind` | UMI3D property key | Notes |
| --- | --- | --- |
| `hierarchy.setParent` | `3` ParentId | Play: best-effort on Three.js clone |
| `transform.setLocalPosition` | `10` Position | local vec3 |
| `transform.setLocalEulerDegrees` | `11` Rotation | degrees → Euler at apply |
| `transform.setLocalQuaternion` | `11` Rotation | quat |
| `transform.setLocalScale` | `12` Scale | local vec3 |
| `transform.translate` | `10` after sync | optional `space`: `local` \| `world` |
| `transform.rotate` | `11` after sync | Euler delta (deg), optional `space` |
| `transform.rotateAround` | `11` after sync | axis, `angleDeg`, optional `pivot`, `space` |

World/global space in `translate` / `rotate` / `rotateAround` is a **runtime apply convention**; persisted project state and UMI3D DTOs remain **local TRS**.

## Builder

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

See also [transform-authoring.md](./transform-authoring.md) for Inspector / gizmo / reparent UX.

## Handler payload

`ScriptInvocationPayload` is `Record<string, unknown>` with optional `umi3d?: Record<string, unknown>` for UMI3D-shaped DTO subsets.
