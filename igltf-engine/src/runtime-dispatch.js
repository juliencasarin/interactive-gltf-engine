import { InteractionRegistry } from './interaction-registry.js'
import { normalizeInteractionKind, UNSUPPORTED_INTERACTION_KINDS } from './interaction-runtime-contract.js'
import { ToolRegistry } from './tool-registry.js'

/**
 * Build tools + interactions from glTF EXT_IGLTF_UMI3D_PROTO payloads.
 * @param {Array<{ extensions?: Record<string, unknown> }>} nodes
 * @param {string} extensionKey
 * @returns {{ toolRegistry: ToolRegistry, interactionRegistry: InteractionRegistry }}
 */
export function buildRegistriesFromGltfNodes(nodes, extensionKey = 'EXT_IGLTF_UMI3D_PROTO') {
  const toolRegistry = new ToolRegistry()
  const interactionRegistry = new InteractionRegistry()

  nodes.forEach((node, gltfNodeIndex) => {
    const ext = node.extensions?.[extensionKey]
    const umi3d = ext && typeof ext === 'object' && 'umi3d' in ext ? ext.umi3d : null
    if (!umi3d || !Array.isArray(umi3d.attachments) || umi3d.attachments.length === 0) return

    const toolId = String(gltfNodeIndex)
    /** @type {import('./interaction-registry.js').InteractionRecord[]} */
    const interactions = []

    for (const att of umi3d.attachments) {
      const kind = normalizeInteractionKind(att.interactionKind ?? att.dto?.interactionType)
      if (UNSUPPORTED_INTERACTION_KINDS.includes(kind)) continue

      const attachmentId = String(att.attachmentId ?? '').trim()
      const scriptHandlerId = String(att.scriptHandlerId ?? '').trim()
      if (!attachmentId || !scriptHandlerId) continue

      const dto = {
        ...(att.dto ?? {}),
        ...(att.serializedProps ?? {}),
        name: att.dto?.name ?? att.serializedProps?.name,
        hold: att.dto?.hold ?? att.serializedProps?.hold,
        url: att.dto?.url ?? att.serializedProps?.href ?? att.serializedProps?.url,
      }

      const record = interactionRegistry.register(attachmentId, {
        id: attachmentId,
        kind,
        dto,
        scriptHandlerId,
        attachmentId,
        serializedProps: att.serializedProps ?? {},
      })
      interactions.push(record)
    }

    if (interactions.length > 0) {
      toolRegistry.register(toolId, gltfNodeIndex, interactions)
    }
  })

  return { toolRegistry, interactionRegistry }
}
