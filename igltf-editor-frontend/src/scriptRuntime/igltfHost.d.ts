/**
 * interactive-gltf host API (author typings only).
 * Runtimes inject the real object; implementations live in viewers.
 * @see interactive-gltf-specs proposals: proposal-interactive-gltf-javascript-scripts.md
 */

export interface IgltfVec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Opaque-ish scene reference; mutations TBD by spec. */
export interface IgltfSceneObjectHandle {
  readonly umi3dId: string
  getLocalPosition(): IgltfVec3
  getWorldPosition(): IgltfVec3
  /** Example helper from proposal drafts — optional on v1 hosts */
  translateLocal?(x: number, y: number, z: number): void
}

/**
 * Single operation inside a transaction (informative JSON shapes; normative schema TBD).
 * Align with UMI3D-style EDK / entity-update operations and
 * {@link https://github.com/UMI3D/UMI3D-SDK UMI3D SDK} DTO vocabulary where possible;
 * see `proposal-interactive-gltf-javascript-scripts.md` (transactions) in interactive-gltf-specs.
 */
export type IgltfOperation =
  | {
      kind: 'transform.setLocalPosition'
      entityId: string
      position: IgltfVec3
    }
  | {
      kind: 'transform.setLocalEulerDegrees'
      entityId: string
      /** Euler angles in degrees (informative; runtime may convert). */
      eulerDegrees: IgltfVec3
    }

/**
 * JSON-serializable transaction returned from a script handler or built via {@link IgltfTransactionBuilder}.
 */
export interface IgltfTransaction {
  readonly version: 1
  operations: IgltfOperation[]
}

/**
 * Mutable builder; call {@link IgltfTransactionBuilder.build} for a plain object to return from handlers.
 */
export interface IgltfTransactionBuilder {
  /**
   * Queue a local position update (DTO-only vec3, no Three.js types).
   * @param entityId UMI3D / entity id as string (as in glTF `payload` / interaction DTO).
   * @see proposal-interactive-gltf-javascript-scripts.md — UMI3D-shaped transactions
   */
  addSetLocalPosition(entityId: string, position: IgltfVec3): IgltfTransactionBuilder
  /**
   * Queue a local Euler rotation in degrees (informative until a normative rotation op exists).
   * @see proposal-interactive-gltf-javascript-scripts.md — transaction granularity
   */
  addSetLocalEulerDegrees(entityId: string, eulerDegrees: IgltfVec3): IgltfTransactionBuilder
  /** Plain transaction object for `return` from handlers. */
  build(): IgltfTransaction
  /** Same as {@link IgltfTransactionBuilder.build} (JSON-serializable snapshot). */
  toJSON(): IgltfTransaction
}

export interface InteractiveGltfHost {
  readonly apiVersion: `${number}.${number}.${number}`
  getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined
  /**
   * Start a transaction the author can populate and return from an interaction `callback`.
   * Informative JSON matches `IgltfTransaction` until a formal `Umi3dTransactionJSON` schema ships.
   * @see proposal-umi3d-interaction-model.md — interaction taxonomy
   */
  createTransaction(): IgltfTransactionBuilder
}

/** JSON-only handler argument (author payload + runtime \`umi3d\`). */
export type ScriptInvocationPayload = Record<string, unknown> & {
  umi3d?: Record<string, unknown>
}

declare global {
  /** Injected by the viewer before handlers run (name may be finalized in spec). */
  // eslint-disable-next-line no-var
  var GLTF: InteractiveGltfHost
}

export {}
