# Global `GLTF` host API (interactive-gltf authoring)

MCP mirror of `docs/editor/host-api.md` — sync from canonical when editing.

Typings correspond to igltf-editor `igltfHost.d.ts`; runtimes inject the implementation before handlers run.

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

## `InteractiveGltfHost` (`GLTF`)

- `readonly apiVersion: string` semver-style
- `getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined`
- `createTransaction(): IgltfTransactionBuilder`
- `executeTransaction(transaction): boolean` — apply immediately (async-friendly); accepts JSON or builder

## Transactions

**`IgltfTransaction`**: `{ version: 1, operations: IgltfOperation[] }`

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

World/global space in `translate` / `rotate` / `rotateAround` is a **runtime apply convention**; persisted project state remains **local TRS**.

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

Prefer returning **`GLTF.createTransaction()....toJSON()`** from interaction handlers.

See [script-authoring.md](./script-authoring.md) and [transform-authoring.md](./transform-authoring.md).

## Handler payload

`ScriptInvocationPayload`: `Record<string, unknown>` with optional `umi3d?: Record<string, unknown>` for UMI3D-shaped DTO subsets.
