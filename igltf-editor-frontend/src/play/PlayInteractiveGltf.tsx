import { useGLTF } from '@react-three/drei'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { getApiBase } from '@/api/projectApi'
import {
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
import {
  createPlayRuntimeBridge,
  resolveToolFromHit,
  type PlayInteractionRuntime,
} from './playInteractionRuntimeBridge'
import { PlayMetricsCollector, type PlayRuntimeMetrics } from './PlayMetricsCollector'
import { applyIgltfTransaction, createPlayThreeHost } from './playThreeHost'
import type { GltfJson } from './umi3dProtoTypes'

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
  const camera = useThree((s) => s.camera)

  const instanceManagerRef = useRef<ScriptInstanceManager>(new ScriptInstanceManager())
  const hostRef = useRef<InteractiveGltfHost | null>(null)
  const interactionRuntimeRef = useRef<PlayInteractionRuntime | null>(null)

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
    const scriptResolverRef: { current: ((id: string) => unknown) | null } = { current: null }
    const host = createPlayThreeHost(clone, {
      getScriptByAttachmentId: (id) => scriptResolverRef.current?.(id),
    })
    hostRef.current = host
    const applyScriptResult = (result: unknown) => {
      if (isIgltfTransaction(result)) {
        applyIgltfTransaction(clone, result)
      }
    }
    const manager = new ScriptInstanceManager(applyScriptResult)
    instanceManagerRef.current = manager
    scriptResolverRef.current = (id) => manager.getInstance(id)

    const interactionRuntime = createPlayRuntimeBridge({
      gltfNodes: parserJson.nodes,
      sceneRoot: clone,
      instanceManager: manager,
    })
    interactionRuntimeRef.current = interactionRuntime

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
          ;(0, eval)(code)
          registerBundledClassesOnManager(manager, handlerEntries)
        } else {
          await loadPerAssetScripts()
        }
        if (!cancelled) {
          await manager.bootstrap(parserJson.nodes)
        }
      } catch (e) {
        if (bundledScriptUrl) {
          console.warn('[igltf play] scene.js failed, falling back to per-asset scripts:', e)
          try {
            await loadPerAssetScripts()
            if (!cancelled) await manager.bootstrap(parserJson.nodes)
          } catch (e2) {
            console.error('[igltf play] interaction scripts:', e2)
          }
        } else {
          console.error('[igltf play] interaction scripts:', e)
        }
      }
    })()

    const onKeyDown = (e: KeyboardEvent) => {
      interactionRuntimeRef.current?.handleKeyboard(e, 'down')
    }
    const onKeyUp = (e: KeyboardEvent) => {
      interactionRuntimeRef.current?.handleKeyboard(e, 'up')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      interactionRuntime.destroy()
      manager.destroy()
      interactionRuntimeRef.current = null
    }
  }, [clone, parserJson, projectId, glbUrl, bundledScriptUrl])

  useFrame((_state, delta) => {
    instanceManagerRef.current.tick(delta)
    const rt = interactionRuntimeRef.current
    if (rt && camera) {
      const p = camera.position
      const q = camera.quaternion
      rt.setBoneFromCamera(
        { x: p.x, y: p.y, z: p.z },
        { x: q.x, y: q.y, z: q.z, w: q.w },
      )
    }
  })

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const hit = e.intersections[0]?.object
    const rt = interactionRuntimeRef.current
    if (!hit || !rt) return
    const resolved = resolveToolFromHit(hit, rt)
    if (resolved?.tool) {
      rt.setHover(resolved.tool, true)
    }
  }, [])

  const onPointerOut = useCallback(() => {
    const rt = interactionRuntimeRef.current
    if (rt?.hoveredTool) {
      rt.setHover(rt.hoveredTool, false)
    }
  }, [])

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const hit = e.intersections[0]?.object
    const host = hostRef.current
    const rt = interactionRuntimeRef.current
    if (!hit || !host || !rt) return
    ;(globalThis as unknown as { GLTF: InteractiveGltfHost }).GLTF = host

    const resolved = resolveToolFromHit(hit, rt)
    if (resolved?.tool) {
      rt.handlePointerDownOnTool(resolved.tool)
    }
  }, [])

  const onPointerUp = useCallback(() => {
    interactionRuntimeRef.current?.handlePointerUpOnTool()
  }, [])

  return (
    <>
      {onMetricsUpdate ? (
        <PlayMetricsCollector sceneRoot={clone} onUpdate={onMetricsUpdate} />
      ) : null}
      <group
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <primitive object={clone} />
      </group>
    </>
  )
}
