import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import { collectSceneMetrics, type SceneMetrics } from './playSceneMetrics'

export type PlayRuntimeMetrics = SceneMetrics & {
  fps: number
  drawCalls: number
  renderedTriangles: number
}

const UPDATE_INTERVAL_S = 0.25
const SCENE_RESCAN_INTERVAL_S = 2
const FPS_EMA_ALPHA = 0.1

type Props = {
  sceneRoot: THREE.Object3D
  onUpdate: (metrics: PlayRuntimeMetrics) => void
}

export function PlayMetricsCollector({ sceneRoot, onUpdate }: Props) {
  const { gl } = useThree()
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const fpsEmaRef = useRef(60)
  const accumRef = useRef(0)
  const sceneRescanRef = useRef(0)
  const sceneMetricsRef = useRef<SceneMetrics>(collectSceneMetrics(sceneRoot))

  useEffect(() => {
    sceneMetricsRef.current = collectSceneMetrics(sceneRoot)
    sceneRescanRef.current = 0
  }, [sceneRoot])

  useFrame((_state, delta) => {
    if (delta > 0) {
      const instant = 1 / delta
      fpsEmaRef.current =
        fpsEmaRef.current * (1 - FPS_EMA_ALPHA) + instant * FPS_EMA_ALPHA
    }

    sceneRescanRef.current += delta
    if (sceneRescanRef.current >= SCENE_RESCAN_INTERVAL_S) {
      sceneRescanRef.current = 0
      sceneMetricsRef.current = collectSceneMetrics(sceneRoot)
    }

    accumRef.current += delta
    if (accumRef.current < UPDATE_INTERVAL_S) return
    accumRef.current = 0

    const scene = sceneMetricsRef.current
    onUpdateRef.current({
      fps: Math.round(fpsEmaRef.current),
      drawCalls: gl.info.render.calls,
      renderedTriangles: gl.info.render.triangles,
      nodeCount: scene.nodeCount,
      meshCount: scene.meshCount,
      materialCount: scene.materialCount,
      sceneTriangles: scene.sceneTriangles,
    })
  })

  return null
}
