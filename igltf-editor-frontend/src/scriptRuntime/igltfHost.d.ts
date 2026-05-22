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

export interface IgltfVec4 {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

export type IgltfTransformSpace = 'local' | 'world'

/** Opaque-ish scene reference; mutations TBD by spec. */
export interface IgltfSceneObjectHandle {
  readonly umi3dId: string
  getLocalPosition(): IgltfVec3
  getWorldPosition(): IgltfVec3
  getLocalRotation(): IgltfVec4
  getWorldRotation(): IgltfVec4
  getLocalScale(): IgltfVec3
  getWorldScale(): IgltfVec3
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
  | {
      kind: 'transform.setLocalScale'
      entityId: string
      scale: IgltfVec3
    }
  | {
      kind: 'transform.setLocalQuaternion'
      entityId: string
      quaternion: IgltfVec4
    }
  | {
      kind: 'hierarchy.setParent'
      entityId: string
      parentId: string
    }
  | {
      kind: 'transform.translate'
      entityId: string
      delta: IgltfVec3
      space?: IgltfTransformSpace
    }
  | {
      kind: 'transform.rotate'
      entityId: string
      /** Euler delta in degrees. */
      eulerDegrees: IgltfVec3
      space?: IgltfTransformSpace
    }
  | {
      kind: 'transform.rotateAround'
      entityId: string
      axis: IgltfVec3
      angleDeg: number
      pivot?: IgltfVec3
      space?: IgltfTransformSpace
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
   * UMI3D property key 10 (Position).
   */
  addSetLocalPosition(entityId: string, position: IgltfVec3): IgltfTransactionBuilder
  /**
   * Queue a local Euler rotation in degrees (informative until a normative rotation op exists).
   * UMI3D property key 11 (Rotation) when converted to quaternion at export.
   */
  addSetLocalEulerDegrees(entityId: string, eulerDegrees: IgltfVec3): IgltfTransactionBuilder
  /** UMI3D property key 12 (Scale). */
  addSetLocalScale(entityId: string, scale: IgltfVec3): IgltfTransactionBuilder
  /** UMI3D property key 11 (Rotation) as quaternion. */
  addSetLocalQuaternion(entityId: string, quaternion: IgltfVec4): IgltfTransactionBuilder
  /** UMI3D property key 3 (Parent). Play runtime: best-effort on Three.js clone. */
  addSetParent(entityId: string, parentId: string): IgltfTransactionBuilder
  addTranslate(entityId: string, delta: IgltfVec3, space?: IgltfTransformSpace): IgltfTransactionBuilder
  addRotate(entityId: string, eulerDegrees: IgltfVec3, space?: IgltfTransformSpace): IgltfTransactionBuilder
  addRotateAround(
    entityId: string,
    axis: IgltfVec3,
    angleDeg: number,
    opts?: { pivot?: IgltfVec3; space?: IgltfTransformSpace },
  ): IgltfTransactionBuilder
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
  /**
   * Apply a transaction immediately (sync). Use from async code (`await fetch…` then execute),
   * timers, or anywhere returning a transaction from a hook is awkward.
   * Accepts plain `{ version: 1, operations }` or a builder from {@link createTransaction}.
   * @returns `true` when applied; `false` when the payload was invalid.
   */
  executeTransaction(transaction: IgltfTransaction | IgltfTransactionBuilder): boolean
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
