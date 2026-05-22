/**
 * Reference script loader + stub host for editor preview.
 * Full sandbox and UMI3D transaction apply paths belong in viewers.
 */
import type {
  IgltfOperation,
  IgltfTransaction,
  IgltfTransactionBuilder,
  IgltfVec3,
  IgltfSceneObjectHandle,
  InteractiveGltfHost,
} from './igltfHost'
import { normalizeIgltfTransaction } from './igltfTransactionUtils'
import { rewriteIgltfCoreImportsForBlobModule } from './interactionBasesUrl'
import { interactionMainMethodForKind, type InteractionTemplateKind } from './interactionScriptTemplates'
import { ScriptInstanceManager } from './scriptLifecycle'

export type ScriptHandler = (
  payload: Record<string, unknown>,
  instanceProps?: Record<string, unknown>,
) => unknown

export type HandlerRegistry = Record<string, ScriptHandler>

/** `export class` detection without relying on non-portable prototype semantics. */
export function isClassExport(fn: unknown): fn is new () => Record<string, unknown> {
  return typeof fn === 'function' && /^class\s/.test(Function.prototype.toString.call(fn))
}

function createTransactionBuilder(): IgltfTransactionBuilder {
  const operations: IgltfOperation[] = []
  const build = (): IgltfTransaction => ({ version: 1, operations: [...operations] })
  const self: IgltfTransactionBuilder = {
    addSetLocalPosition(entityId, position) {
      operations.push({
        kind: 'transform.setLocalPosition',
        entityId,
        position: { x: position.x, y: position.y, z: position.z },
      })
      return self
    },
    addSetLocalEulerDegrees(entityId, eulerDegrees) {
      operations.push({
        kind: 'transform.setLocalEulerDegrees',
        entityId,
        eulerDegrees: { x: eulerDegrees.x, y: eulerDegrees.y, z: eulerDegrees.z },
      })
      return self
    },
    addSetLocalScale(entityId, scale) {
      operations.push({
        kind: 'transform.setLocalScale',
        entityId,
        scale: { x: scale.x, y: scale.y, z: scale.z },
      })
      return self
    },
    addSetLocalQuaternion(entityId, quaternion) {
      operations.push({
        kind: 'transform.setLocalQuaternion',
        entityId,
        quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      })
      return self
    },
    addSetParent(entityId, parentId) {
      operations.push({ kind: 'hierarchy.setParent', entityId, parentId })
      return self
    },
    addTranslate(entityId, delta, space) {
      operations.push({
        kind: 'transform.translate',
        entityId,
        delta: { x: delta.x, y: delta.y, z: delta.z },
        ...(space ? { space } : {}),
      })
      return self
    },
    addRotate(entityId, eulerDegrees, space) {
      operations.push({
        kind: 'transform.rotate',
        entityId,
        eulerDegrees: { x: eulerDegrees.x, y: eulerDegrees.y, z: eulerDegrees.z },
        ...(space ? { space } : {}),
      })
      return self
    },
    addRotateAround(entityId, axis, angleDeg, opts) {
      operations.push({
        kind: 'transform.rotateAround',
        entityId,
        axis: { x: axis.x, y: axis.y, z: axis.z },
        angleDeg,
        ...(opts?.pivot ? { pivot: { x: opts.pivot.x, y: opts.pivot.y, z: opts.pivot.z } } : {}),
        ...(opts?.space ? { space: opts.space } : {}),
      })
      return self
    },
    build,
    toJSON: build,
  }
  return self
}

function invokeInteractionClass(
  Cls: new () => Record<string, unknown>,
  primaryMethod: string,
  payload: Record<string, unknown>,
  instanceProps?: Record<string, unknown>,
): unknown {
  const inst = new Cls()
  if (instanceProps) {
    for (const [k, v] of Object.entries(instanceProps)) {
      if (v !== undefined) inst[k] = v
    }
  }
  const onLoaded = inst.onLoaded
  if (typeof onLoaded === 'function') {
    ;(onLoaded as () => void).call(inst)
  }
  const primary = inst[primaryMethod]
  if (typeof primary === 'function') {
    return (primary as (p: Record<string, unknown>) => unknown).call(inst, payload)
  }
  const handleInteraction = inst.handleInteraction
  if (typeof handleInteraction === 'function') {
    return (handleInteraction as (p: Record<string, unknown>) => unknown).call(inst, payload)
  }
  return undefined
}

function wrapClassExport(
  Cls: new () => Record<string, unknown>,
  interactionKind: InteractionTemplateKind | undefined,
): ScriptHandler {
  const primaryMethod = interactionKind
    ? interactionMainMethodForKind(interactionKind)
    : 'onEvent'
  return (payload, instanceProps) =>
    invokeInteractionClass(Cls, primaryMethod, payload, instanceProps)
}

export function createStubInteractiveGltfHost(): InteractiveGltfHost {
  const handles = new Map<string, IgltfSceneObjectHandle>()
  return {
    apiVersion: '1.0.0',
    getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined {
      let h = handles.get(id)
      if (!h) {
        const zero: IgltfVec3 = { x: 0, y: 0, z: 0 }
        h = {
          umi3dId: id,
          getLocalPosition: () => zero,
          getWorldPosition: () => zero,
          getLocalRotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
          getWorldRotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
          getLocalScale: () => ({ x: 1, y: 1, z: 1 }),
          getWorldScale: () => ({ x: 1, y: 1, z: 1 }),
          translateLocal: () => {
            console.info('[igltf preview GLTF] translateLocal', id)
          },
        }
        handles.set(id, h)
      }
      return h
    },
    createTransaction: () => createTransactionBuilder(),
    executeTransaction(transaction) {
      const tx = normalizeIgltfTransaction(transaction)
      if (!tx) {
        console.warn('[igltf preview GLTF] executeTransaction: invalid transaction')
        return false
      }
      console.info('[igltf preview GLTF] executeTransaction', tx.operations.length, 'operation(s)')
      return true
    },
  }
}

export type ScriptModuleMeta = {
  interactionKind?: InteractionTemplateKind
}

/** After a classic/IIFE bundle ran (e.g. ``scene.js``), map globals into the handler registry. */
export function registerBundledExportsFromGlobalThis(
  registry: HandlerRegistry,
  entries: { name: string; interactionKind?: InteractionTemplateKind }[],
): void {
  for (const { name, interactionKind } of entries) {
    const v = (globalThis as unknown as Record<string, unknown>)[name]
    if (typeof v !== 'function') continue
    if (isClassExport(v)) {
      registry[name] = wrapClassExport(v, interactionKind)
    } else {
      const fn = v as (p: Record<string, unknown>) => unknown
      registry[name] = (payload) => fn(payload)
    }
  }
}

/** Register bundled class exports on a play-mode lifecycle manager (persistent instances). */
export function registerBundledClassesOnManager(
  manager: ScriptInstanceManager,
  entries: { name: string; interactionKind?: InteractionTemplateKind }[],
): void {
  manager.registerBundledFromGlobalThis(entries, isClassExport)
}

/** Dynamic import of ES module source; collects class and function exports. */
export async function loadModuleScriptIntoRegistry(
  source: string,
  _urlLabel: string,
  host: InteractiveGltfHost,
  registry: HandlerRegistry,
  meta?: ScriptModuleMeta,
): Promise<void> {
  const resolved = rewriteIgltfCoreImportsForBlobModule(source)
  const blob = new Blob([resolved], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host
  try {
    const mod = await import(/* @vite-ignore */ url)
    for (const key of Object.keys(mod)) {
      if (key === 'default') continue
      const v = (mod as Record<string, unknown>)[key]
      if (typeof v !== 'function') continue
      if (isClassExport(v)) {
        registry[key] = wrapClassExport(v, meta?.interactionKind)
      } else {
        const fn = v as (p: Record<string, unknown>) => unknown
        registry[key] = (payload) => fn(payload)
      }
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Load ES module exports into a play-mode lifecycle manager (class exports only). */
export async function loadModuleScriptIntoManager(
  source: string,
  host: InteractiveGltfHost,
  manager: ScriptInstanceManager,
  meta?: ScriptModuleMeta,
): Promise<void> {
  const resolved = rewriteIgltfCoreImportsForBlobModule(source)
  const blob = new Blob([resolved], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host
  try {
    const mod = await import(/* @vite-ignore */ url)
    manager.registerFromModule(mod as Record<string, unknown>, meta, isClassExport)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Classic script: expected global function names listed in `exportNames`. */
export function loadClassicScriptIntoRegistry(
  source: string,
  host: InteractiveGltfHost,
  registry: HandlerRegistry,
  exportNames: string[],
): void {
  ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host
  const fn = new Function('GLTF', `"use strict";\n${source}`)
  fn(host)
  for (const name of exportNames) {
    const g = (globalThis as unknown as Record<string, unknown>)[name]
    if (typeof g === 'function') registry[name] = (payload) => (g as (p: Record<string, unknown>) => unknown)(payload)
  }
}

export async function invokeHandler(
  registry: HandlerRegistry,
  name: string,
  payload: Record<string, unknown>,
  instanceProps?: Record<string, unknown>,
  options?: { attachmentId?: string; instanceManager?: ScriptInstanceManager },
): Promise<unknown> {
  if (options?.attachmentId && options.instanceManager) {
    return options.instanceManager.invokeOnAttachment(options.attachmentId, payload)
  }
  const fn = registry[name]
  if (!fn) {
    console.warn('[igltf preview] no handler', name)
    return undefined
  }
  return fn(payload, instanceProps)
}
