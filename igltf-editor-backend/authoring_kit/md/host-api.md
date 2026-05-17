# Global `GLTF` host API (interactive-gltf authoring)

Typings correspond to igltf-editor `igltfHost.d.ts`; runtimes inject the real implementation before handlers run.

## `IgltfVec3`

- `readonly x`, `y`, `z`: numbers

## `IgltfSceneObjectHandle`

- `umi3dId: string`
- `getLocalPosition(): IgltfVec3`
- `getWorldPosition(): IgltfVec3`
- optional `translateLocal?(x: number, y: number, z: number)`

## `InteractiveGltfHost`

- `readonly apiVersion: string` semver-style
- `getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined`
- `createTransaction(): IgltfTransactionBuilder`

## Transactions

**`IgltfTransaction`**: `{ version: 1, operations: IgltfOperation[] }`

**Operations (informative JSON):**

1. `{ kind: "transform.setLocalPosition", entityId: string, position: IgltfVec3 }`
2. `{ kind: "transform.setLocalEulerDegrees", entityId: string, eulerDegrees: IgltfVec3 }` (degrees)

## Builder

`IgltfTransactionBuilder`:

- `addSetLocalPosition(entityId, position)`
- `addSetLocalEulerDegrees(entityId, eulerDegrees)`
- `build(): IgltfTransaction`
- `toJSON(): IgltfTransaction` (same snapshot)

Prefer returning **`GLTF.createTransaction()....toJSON()`** from interaction handlers where the viewer applies results.

## Handler payload

`ScriptInvocationPayload` is `Record<string, unknown>` with optional `umi3d?: Record<string, unknown>` for UMI3D-shaped DTO subsets.
