/**
 * Thin Play glue: wires React Three events to igltf-engine JS runtime.
 */
import * as THREE from 'three'

import {
  createPlayInteractionRuntime,
  type InteractionInvokePayload,
  type PlayInteractionRuntime,
} from 'igltf-engine'

import type { ScriptInstanceManager } from '@/scriptRuntime/scriptLifecycle'

import { EXT_IGLTF_UMI3D_PROTO, type GltfJson } from './umi3dProtoTypes'

export type { PlayInteractionRuntime }

export function createPlayRuntimeBridge(options: {
  gltfNodes: GltfJson['nodes']
  sceneRoot: THREE.Object3D
  instanceManager: ScriptInstanceManager
}): PlayInteractionRuntime {
  return createPlayInteractionRuntime({
    gltfNodes: options.gltfNodes,
    protoExtensionKey: EXT_IGLTF_UMI3D_PROTO,
    invokeInteraction: async (
      attachmentId: string,
      _handlerId: string,
      payload: InteractionInvokePayload,
      method: string,
    ) => {
      return options.instanceManager.invokeOnAttachment(
        attachmentId,
        payload as unknown as Record<string, unknown>,
        method,
      )
    },
    resolveHoveredId: (tool) => tool.id,
  })
}

/**
 * Resolve interactable tool from raycast hit (walk up the Three.js hierarchy).
 * Attachments live on glTF nodes; the ray often hits a child mesh whose node has no tool.
 */
export function resolveToolFromHit(
  hit: THREE.Object3D,
  runtime: PlayInteractionRuntime,
): { tool: ReturnType<PlayInteractionRuntime['toolRegistry']['get']>; gltfNodeIndex: number } | null {
  let cur: THREE.Object3D | null = hit
  while (cur) {
    const idx = cur.userData?.igltfNodeIndex
    if (typeof idx === 'number') {
      const tool = runtime.toolRegistry.get(String(idx))
      if (tool) return { tool, gltfNodeIndex: idx }
    }
    cur = cur.parent
  }
  return null
}
