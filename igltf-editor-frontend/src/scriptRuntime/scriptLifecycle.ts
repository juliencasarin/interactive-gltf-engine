/**
 * Play-mode script lifecycle: one persistent instance per proto attachment,
 * with onLoaded / onUpdate / onDelete hooks.
 */
import type { GltfJson, Umi3dProtoNodePayload } from '@/play/umi3dProtoTypes'
import { EXT_IGLTF_UMI3D_PROTO } from '@/play/umi3dProtoTypes'

import { interactionMainMethodForKind, type InteractionTemplateKind } from './interactionScriptTemplates'

export type ScriptClassExport = {
  Cls: new () => Record<string, unknown>
  interactionKind?: InteractionTemplateKind
}

export type ScriptAttachmentDescriptor = {
  attachmentId: string
  scriptHandlerId: string
  interactionKind?: InteractionTemplateKind
  serializedProps?: Record<string, unknown>
}

function readPayload(node: GltfJson['nodes'][number]): Umi3dProtoNodePayload | undefined {
  const ext = node.extensions?.[EXT_IGLTF_UMI3D_PROTO] as { umi3d?: Umi3dProtoNodePayload } | undefined
  return ext?.umi3d
}

function asInteractionKind(raw: string | undefined): InteractionTemplateKind | undefined {
  if (!raw) return undefined
  const k = raw.toLowerCase()
  if (k === 'event' || k === 'link' || k === 'form' || k === 'manipulation' || k === 'drawing') {
    return k
  }
  return undefined
}

function mergeInstanceProps(
  inst: Record<string, unknown>,
  props: Record<string, unknown> | undefined,
): void {
  if (!props) return
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) inst[k] = v
  }
}

function invokeMethodOnInstance(
  inst: Record<string, unknown>,
  methodName: string,
  payload: Record<string, unknown>,
): unknown {
  const primary = inst[methodName]
  if (typeof primary === 'function') {
    return (primary as (p: Record<string, unknown>) => unknown).call(inst, payload)
  }
  const handleInteraction = inst.handleInteraction
  if (typeof handleInteraction === 'function') {
    return (handleInteraction as (p: Record<string, unknown>) => unknown).call(inst, payload)
  }
  return undefined
}

export function collectProtoAttachments(nodes: GltfJson['nodes']): ScriptAttachmentDescriptor[] {
  const out: ScriptAttachmentDescriptor[] = []
  for (const node of nodes) {
    const payload = readPayload(node)
    if (!payload?.attachments?.length) continue
    for (const att of payload.attachments) {
      const attachmentId = String(att.attachmentId ?? '').trim()
      const scriptHandlerId = String(att.scriptHandlerId ?? '').trim()
      if (!attachmentId || !scriptHandlerId) continue
      out.push({
        attachmentId,
        scriptHandlerId,
        interactionKind: asInteractionKind(att.interactionKind),
        serializedProps: att.serializedProps,
      })
    }
  }
  return out
}

export type ScriptHookResultHandler = (result: unknown) => void

export class ScriptInstanceManager {
  private classExports = new Map<string, ScriptClassExport>()
  private instances = new Map<string, Record<string, unknown>>()
  private attachmentMeta = new Map<string, ScriptAttachmentDescriptor>()

  constructor(private readonly onHookResult?: ScriptHookResultHandler) {}

  private emitHookResult(result: unknown): void {
    if (result instanceof Promise) {
      void result.then((resolved) => {
        if (resolved !== undefined && resolved !== null) {
          this.onHookResult?.(resolved)
        }
      })
      return
    }
    if (result !== undefined && result !== null) {
      this.onHookResult?.(result)
    }
  }

  registerClass(name: string, Cls: new () => Record<string, unknown>, interactionKind?: InteractionTemplateKind): void {
    this.classExports.set(name, { Cls, interactionKind })
  }

  registerBundledFromGlobalThis(
    entries: { name: string; interactionKind?: InteractionTemplateKind }[],
    isClassExport: (fn: unknown) => fn is new () => Record<string, unknown>,
  ): void {
    for (const { name, interactionKind } of entries) {
      const v = (globalThis as unknown as Record<string, unknown>)[name]
      if (typeof v !== 'function') continue
      if (isClassExport(v)) {
        this.registerClass(name, v, interactionKind)
      }
    }
  }

  registerFromModule(
    mod: Record<string, unknown>,
    meta: { interactionKind?: InteractionTemplateKind } | undefined,
    isClassExport: (fn: unknown) => fn is new () => Record<string, unknown>,
  ): void {
    for (const key of Object.keys(mod)) {
      if (key === 'default') continue
      const v = mod[key]
      if (typeof v !== 'function') continue
      if (isClassExport(v)) {
        this.registerClass(key, v, meta?.interactionKind)
      }
    }
  }

  private invokeHook(inst: Record<string, unknown>, methodName: string, ...args: unknown[]): unknown {
    const fn = inst[methodName]
    if (typeof fn !== 'function') return undefined
    return (fn as (...a: unknown[]) => unknown).call(inst, ...args)
  }

  private async settleHook(result: unknown): Promise<void> {
    if (result instanceof Promise) {
      const resolved = await result
      if (resolved !== undefined && resolved !== null) {
        this.onHookResult?.(resolved)
      }
      return
    }
    if (result !== undefined && result !== null) {
      this.onHookResult?.(result)
    }
  }

  async bootstrap(nodes: GltfJson['nodes']): Promise<void> {
    this.destroy()
    const descriptors = collectProtoAttachments(nodes)
    const pending: { attachmentId: string; inst: Record<string, unknown> }[] = []

    for (const desc of descriptors) {
      const exp = this.classExports.get(desc.scriptHandlerId)
      if (!exp) {
        console.warn('[igltf play] no class export for attachment', desc.attachmentId, desc.scriptHandlerId)
        continue
      }
      const inst = new exp.Cls()
      mergeInstanceProps(inst, desc.serializedProps)
      this.instances.set(desc.attachmentId, inst)
      this.attachmentMeta.set(desc.attachmentId, desc)
      pending.push({ attachmentId: desc.attachmentId, inst })
    }

    await Promise.all(
      pending.map(async ({ inst }) => {
        await this.settleHook(this.invokeHook(inst, 'onLoaded'))
      }),
    )

    for (const { inst } of pending) {
      await this.settleHook(this.invokeHook(inst, 'afterLoading'))
    }
  }

  tick(delta: number): void {
    for (const inst of this.instances.values()) {
      const onUpdate = inst.onUpdate
      if (typeof onUpdate === 'function') {
        this.emitHookResult((onUpdate as (delta: number) => unknown).call(inst, delta))
      }
    }
  }

  destroy(): void {
    for (const inst of this.instances.values()) {
      const onDelete = inst.onDelete
      if (typeof onDelete === 'function') {
        ;(onDelete as () => void).call(inst)
      }
    }
    this.instances.clear()
    this.attachmentMeta.clear()
  }

  getInstance(attachmentId: string): Record<string, unknown> | undefined {
    return this.instances.get(attachmentId)
  }

  invokeOnAttachment(attachmentId: string, payload: Record<string, unknown>): unknown {
    const inst = this.instances.get(attachmentId)
    if (!inst) {
      console.warn('[igltf play] no script instance for attachment', attachmentId)
      return undefined
    }
    const meta = this.attachmentMeta.get(attachmentId)
    const kind = meta?.interactionKind
    const methodName = kind ? interactionMainMethodForKind(kind) : 'onEvent'
    const result = invokeMethodOnInstance(inst, methodName, payload)
    this.emitHookResult(result)
    return result
  }
}
