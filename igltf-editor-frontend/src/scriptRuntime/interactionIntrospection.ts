import type { InteractiveGltfHost } from './igltfHost'
import { GLTF_SCRIPT_IMPORT_PATH, INTERACTION_BASES_IMPORT_PATH, rewriteIgltfCoreImportsForBlobModule } from './interactionBasesUrl'
import { createStubInteractiveGltfHost } from './loader'
import type { EditorNode, InteractionScriptAttachment, InteractionSerializedPropsMap } from '@/editor/types'

function isClassExport(fn: unknown): boolean {
  return typeof fn === 'function' && /^class\s/.test(Function.prototype.toString.call(fn))
}

export type IntrospectedField = {
  key: string
  valueType: 'string' | 'number' | 'boolean' | 'object' | 'bigint' | 'undefined' | 'null' | 'unknown'
  defaultValue: unknown
}

function inferValueType(v: unknown): IntrospectedField['valueType'] {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'object')
    return t
  return 'unknown'
}

/** Own enumerable data properties on the instance (excluding functions and `_` prefix). */
export function introspectInstanceDataFields(instance: object): IntrospectedField[] {
  const out: IntrospectedField[] = []
  for (const key of Object.keys(instance)) {
    if (key.startsWith('_')) continue
    const v = (instance as Record<string, unknown>)[key]
    if (typeof v === 'function') continue
    out.push({ key, valueType: inferValueType(v), defaultValue: v })
  }
  out.sort((a, b) => a.key.localeCompare(b.key))
  return out
}

/**
 * Import script from source, instantiate exported class, list data fields for inspector.
 */
export async function introspectExportedInteractionClass(
  source: string,
  exportName: string,
  host?: InteractiveGltfHost,
): Promise<IntrospectedField[]> {
  const h = host ?? createStubInteractiveGltfHost()
  ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = h
  try {
    /* Preload bases so blob: modules that import /igltf-core/... resolve (same-document URL). */
    if (typeof document !== 'undefined') {
      const scriptHref = new URL(GLTF_SCRIPT_IMPORT_PATH, document.baseURI).href
      const basesHref = new URL(INTERACTION_BASES_IMPORT_PATH, document.baseURI).href
      try {
        await import(/* @vite-ignore */ scriptHref)
        await import(/* @vite-ignore */ basesHref)
      } catch {
        // User script may still import successfully if bases were cached earlier
      }
    }
    const blob = new Blob([rewriteIgltfCoreImportsForBlobModule(source)], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    try {
      const mod = await import(/* @vite-ignore */ url)
      const Cls = (mod as Record<string, unknown>)[exportName]
      if (!isClassExport(Cls)) return []
      const Inst = Cls as new () => object
      const inst = new Inst()
      return introspectInstanceDataFields(inst)
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return []
  }
}

/** Values merged onto the class before `onLoaded` (per script attachment / preview slot). */
export function mergeInteractionInstancePropsForAttachment(
  attachment: InteractionScriptAttachment,
  anchorNodeId: string,
): Record<string, unknown> {
  const raw: InteractionSerializedPropsMap = attachment.serializedProps ?? {}
  const props: Record<string, unknown> = { ...raw }
  delete props.targetId
  props.targetId = anchorNodeId
  return props
}

/** First attachment only — prefer `mergeInteractionInstancePropsForAttachment` when multiple scripts exist. */
export function mergeInteractionInstancePropsForPreview(node: EditorNode): Record<string, unknown> {
  const a = node.interactionAttachments?.[0]
  return a ? mergeInteractionInstancePropsForAttachment(a, node.id) : {}
}
