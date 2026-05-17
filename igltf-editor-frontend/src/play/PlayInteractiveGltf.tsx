import { useGLTF } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { getApiBase } from '@/api/projectApi'
import {
  type HandlerRegistry,
  invokeHandler,
  loadModuleScriptIntoRegistry,
} from '@/scriptRuntime/loader'
import type { IgltfTransaction, InteractiveGltfHost } from '@/scriptRuntime/igltfHost'

import { bindIgltfNodeIndices } from './bindIgltfNodeIndices'
import { collectProtoScriptUrls } from './collectProtoScriptUrls'
import { applyIgltfTransaction, createPlayThreeHost } from './playThreeHost'
import {
  EXT_IGLTF_UMI3D_PROTO,
  type GltfJson,
  type Umi3dProtoNodePayload,
} from './umi3dProtoTypes'

type Props = {
  glbUrl: string
  projectId: string
}

export function PlayInteractiveGltf({ glbUrl, projectId }: Props) {
  const gltf = useGLTF(glbUrl)
  const clone = useMemo(() => gltf.scene.clone(true), [gltf.scene, glbUrl])
  const parserJson = (gltf as { parser: { json: GltfJson } }).parser.json

  const registryRef = useRef<HandlerRegistry>({})
  const hostRef = useRef<InteractiveGltfHost | null>(null)

  useLayoutEffect(() => {
    bindIgltfNodeIndices(clone, parserJson)
  }, [clone, parserJson])

  useEffect(() => {
    return () => {
      clone.traverse((o) => {
        const maybeMesh = o as THREE.Mesh
        if (maybeMesh.geometry?.dispose) {
          maybeMesh.geometry.dispose()
          const m = maybeMesh.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose?.())
          else (m as THREE.Material | undefined)?.dispose?.()
        }
      })
    }
  }, [clone])

  useEffect(() => {
    if (getApiBase() === '') return
    let cancelled = false
    const host = createPlayThreeHost(clone)
    hostRef.current = host
    void (async () => {
      const urls = collectProtoScriptUrls(parserJson.nodes, projectId)
      const reg: HandlerRegistry = {}
      try {
        for (const url of urls) {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`Failed to fetch script ${url}: ${res.status}`)
          const src = await res.text()
          await loadModuleScriptIntoRegistry(src, url, host, reg)
        }
      } catch (e) {
        console.error('[igltf play] interaction scripts:', e)
      }
      if (!cancelled) registryRef.current = reg
    })()
    return () => {
      cancelled = true
    }
  }, [clone, parserJson, projectId, glbUrl])

  const onPointerDown = useCallback(
    async (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const hit = e.intersections[0]?.object
      if (!hit) return
      const host = hostRef.current
      const registry = registryRef.current
      if (!host) return
      ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host

      let cur: THREE.Object3D | null = hit
      while (cur) {
        const idx = cur.userData?.igltfNodeIndex
        if (typeof idx === 'number') {
          const nodeDef = parserJson.nodes[idx]
          const extBlock = nodeDef?.extensions?.[EXT_IGLTF_UMI3D_PROTO] as
            | { umi3d?: Umi3dProtoNodePayload }
            | undefined
          const payload = extBlock?.umi3d
          if (payload?.attachments?.length) {
            for (const att of payload.attachments) {
              if (att.interactionKind !== 'event') continue
              if (att.dto?.interactionType && att.dto.interactionType !== 'event') continue
              const invokePayload: Record<string, unknown> = {
                eventType: 'click',
                gltfNodeIndex: idx,
                umi3d: {
                  protoAttachmentId: att.attachmentId,
                  interactionType: 'event',
                },
              }
              const result = await invokeHandler(
                registry,
                att.scriptHandlerId,
                invokePayload,
                att.serializedProps,
              )
              if (
                result &&
                typeof result === 'object' &&
                'version' in result &&
                (result as IgltfTransaction).version === 1
              ) {
                applyIgltfTransaction(clone, result as IgltfTransaction)
              }
            }
            break
          }
        }
        cur = cur.parent
      }
    },
    [clone, parserJson],
  )

  return (
    <group onPointerDown={onPointerDown}>
      <primitive object={clone} />
    </group>
  )
}
