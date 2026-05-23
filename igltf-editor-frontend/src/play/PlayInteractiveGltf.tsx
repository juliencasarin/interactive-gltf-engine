import { useGLTF } from '@react-three/drei'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { getApiBase } from '@/api/projectApi'
import {
  invokeHandler,
  loadModuleScriptIntoManager,
  registerBundledClassesOnManager,
} from '@/scriptRuntime/loader'
import { preloadIgltfCoreModules } from '@/scriptRuntime/interactionBasesUrl'
import type { InteractiveGltfHost } from '@/scriptRuntime/igltfHost'
import { isIgltfTransaction } from '@/scriptRuntime/igltfTransactionUtils'
import { ScriptInstanceManager } from '@/scriptRuntime/scriptLifecycle'

import { bindIgltfNodeIndices } from './bindIgltfNodeIndices'
import { collectProtoHandlerEntries } from './collectProtoHandlerEntries'
import { collectProtoScriptUrls } from './collectProtoScriptUrls'
import { PlayMetricsCollector, type PlayRuntimeMetrics } from './PlayMetricsCollector'
import { applyIgltfTransaction, createPlayThreeHost } from './playThreeHost'
import {
  EXT_IGLTF_UMI3D_PROTO,
  type GltfJson,
  type Umi3dProtoNodePayload,
} from './umi3dProtoTypes'

type Props = {
  glbUrl: string
  projectId: string
  /** From ``GET /play`` ``jsUrl`` — bundled ``scene.js`` when present. */
  bundledScriptUrl?: string
  onMetricsUpdate?: (metrics: PlayRuntimeMetrics) => void
}

export function PlayInteractiveGltf({ glbUrl, projectId, bundledScriptUrl, onMetricsUpdate }: Props) {
  const gltf = useGLTF(glbUrl)
  const clone = useMemo(() => gltf.scene.clone(true), [gltf.scene, glbUrl])
  const parserJson = (gltf as { parser: { json: GltfJson } }).parser.json

  const instanceManagerRef = useRef<ScriptInstanceManager>(new ScriptInstanceManager())
  const hostRef = useRef<InteractiveGltfHost | null>(null)

  useLayoutEffect(() => {
    bindIgltfNodeIndices(clone, parserJson)
  }, [clone, parserJson])

  useEffect(() => {
    return () => {
      useGLTF.clear(glbUrl)
    }
  }, [glbUrl])

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
    const applyScriptResult = (result: unknown) => {
      if (isIgltfTransaction(result)) {
        applyIgltfTransaction(clone, result)
      }
    }
    const manager = new ScriptInstanceManager(applyScriptResult)
    instanceManagerRef.current = manager

    async function loadPerAssetScripts(): Promise<void> {
      const urls = collectProtoScriptUrls(parserJson.nodes, projectId)
      for (const url of urls) {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Failed to fetch script ${url}: ${res.status}`)
        const src = await res.text()
        await loadModuleScriptIntoManager(src, host, manager)
      }
    }

    void (async () => {
      const handlerEntries = collectProtoHandlerEntries(parserJson.nodes)
      try {
        await preloadIgltfCoreModules()
        if (bundledScriptUrl) {
          const res = await fetch(bundledScriptUrl)
          if (!res.ok) throw new Error(`bundled script HTTP ${res.status}`)
          const code = await res.text()
          if (cancelled) return
          ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host
          /* Indirect eval: run esbuild IIFE in global scope so ``globalThis`` handler bindings apply. */
          ;(0, eval)(code)
          registerBundledClassesOnManager(manager, handlerEntries)
        } else {
          await loadPerAssetScripts()
        }
        if (!cancelled) {
          manager.bootstrap(parserJson.nodes)
        }
      } catch (e) {
        if (bundledScriptUrl) {
          console.warn('[igltf play] scene.js failed, falling back to per-asset scripts:', e)
          try {
            await loadPerAssetScripts()
            if (!cancelled) manager.bootstrap(parserJson.nodes)
          } catch (e2) {
            console.error('[igltf play] interaction scripts:', e2)
          }
        } else {
          console.error('[igltf play] interaction scripts:', e)
        }
      }
    })()

    return () => {
      cancelled = true
      manager.destroy()
    }
  }, [clone, parserJson, projectId, glbUrl, bundledScriptUrl])

  useFrame((_state, delta) => {
    instanceManagerRef.current.tick(delta)
  })

  const onPointerDown = useCallback(
    async (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const hit = e.intersections[0]?.object
      if (!hit) return
      const host = hostRef.current
      const manager = instanceManagerRef.current
      if (!host) return
      ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host

      let cur: THREE.Object3D | null = hit
      /** Traverse from raycast leaf toward root — first glTF row with attachments wins. */

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
              await invokeHandler(
                {},
                att.scriptHandlerId,
                invokePayload,
                undefined,
                { attachmentId: att.attachmentId, instanceManager: manager },
              )
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
    <>
      {onMetricsUpdate ? (
        <PlayMetricsCollector sceneRoot={clone} onUpdate={onMetricsUpdate} />
      ) : null}
      <group onPointerDown={onPointerDown}>
        <primitive object={clone} />
      </group>
    </>
  )
}
