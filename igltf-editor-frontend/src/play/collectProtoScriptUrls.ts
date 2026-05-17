import { getApiBase } from '@/api/projectApi'

import { EXT_IGLTF_UMI3D_PROTO, type GltfJson, type Umi3dProtoNodePayload } from './umi3dProtoTypes'

function readPayload(node: GltfJson['nodes'][number]): Umi3dProtoNodePayload | undefined {
  const ext = node.extensions?.[EXT_IGLTF_UMI3D_PROTO] as { umi3d?: Umi3dProtoNodePayload } | undefined
  return ext?.umi3d
}

/** Unique fetch URLs for interaction scripts referenced by the prototype extension. */
export function collectProtoScriptUrls(nodes: GltfJson['nodes'], projectId: string): string[] {
  const base = getApiBase().replace(/\/$/, '')
  const urls = new Set<string>()
  for (const node of nodes) {
    const payload = readPayload(node)
    if (!payload?.attachments?.length) continue
    for (const a of payload.attachments) {
      const rel = String(a.scriptRelativePath ?? '').replace(/^\/+/, '')
      if (!rel) continue
      urls.add(`${base}/files/${encodeURIComponent(projectId)}/${rel}`)
    }
  }
  return [...urls]
}
