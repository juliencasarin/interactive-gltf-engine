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
import { rewriteInteractionBasesImportsForBlobModule } from './interactionBasesUrl'
import { interactionMainMethodForKind, type InteractionTemplateKind } from './interactionScriptTemplates'

export type ScriptHandler = (
  payload: Record<string, unknown>,
  instanceProps?: Record<string, unknown>,
) => unknown

export type HandlerRegistry = Record<string, ScriptHandler>

/** `export class` detection without relying on non-portable prototype semantics. */
function isClassExport(fn: unknown): fn is new () => Record<string, unknown> {
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
          translateLocal: () => {
            console.info('[igltf preview GLTF] translateLocal', id)
          },
        }
        handles.set(id, h)
      }
      return h
    },
    createTransaction: () => createTransactionBuilder(),
  }
}

export type ScriptModuleMeta = {
  interactionKind?: InteractionTemplateKind
}

/** Dynamic import of ES module source; collects class and function exports. */
export async function loadModuleScriptIntoRegistry(
  source: string,
  _urlLabel: string,
  host: InteractiveGltfHost,
  registry: HandlerRegistry,
  meta?: ScriptModuleMeta,
): Promise<void> {
  const resolved = rewriteInteractionBasesImportsForBlobModule(source)
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
): Promise<unknown> {
  const fn = registry[name]
  if (!fn) {
    console.warn('[igltf preview] no handler', name)
    return undefined
  }
  return fn(payload, instanceProps)
}
