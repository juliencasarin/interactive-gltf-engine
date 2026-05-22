import type { InteractionTemplateKind } from '@/scriptRuntime/interactionScriptTemplates'

import { EXT_IGLTF_UMI3D_PROTO, type GltfJson, type Umi3dProtoNodePayload } from './umi3dProtoTypes'

const KINDS = new Set<string>(['event', 'link', 'form', 'manipulation', 'drawing'])

function readPayload(node: GltfJson['nodes'][number]): Umi3dProtoNodePayload | undefined {
  const ext = node.extensions?.[EXT_IGLTF_UMI3D_PROTO] as { umi3d?: Umi3dProtoNodePayload } | undefined
  return ext?.umi3d
}

function asKind(raw: string | undefined): InteractionTemplateKind | undefined {
  if (!raw) return undefined
  const k = raw.toLowerCase()
  return KINDS.has(k) ? (k as InteractionTemplateKind) : undefined
}

/** Unique ``scriptHandlerId`` values from prototype attachments (for bundled ``scene.js`` registry). */
export function collectProtoHandlerEntries(
  nodes: GltfJson['nodes'],
): { name: string; interactionKind?: InteractionTemplateKind }[] {
  const seen = new Set<string>()
  const out: { name: string; interactionKind?: InteractionTemplateKind }[] = []
  for (const node of nodes) {
    const payload = readPayload(node)
    if (!payload?.attachments?.length) continue
    for (const att of payload.attachments) {
      const id = String(att.scriptHandlerId ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ name: id, interactionKind: asKind(att.interactionKind) })
    }
  }
  return out
}
