import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { collectSceneMetrics, formatMetricCount } from './playSceneMetrics'

describe('formatMetricCount', () => {
  it('formats small numbers as-is', () => {
    expect(formatMetricCount(0)).toBe('0')
    expect(formatMetricCount(999)).toBe('999')
  })

  it('formats thousands compactly', () => {
    expect(formatMetricCount(1200)).toBe('1.2k')
    expect(formatMetricCount(98000)).toBe('98k')
  })
})

describe('collectSceneMetrics', () => {
  it('counts nodes and indexed mesh triangles', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry().setIndex([0, 1, 2, 0, 2, 3]),
      new THREE.MeshBasicMaterial(),
    )
    root.add(mesh)
    root.add(new THREE.Object3D())

    const m = collectSceneMetrics(root)
    expect(m.nodeCount).toBe(3)
    expect(m.meshCount).toBe(1)
    expect(m.materialCount).toBe(1)
    expect(m.sceneTriangles).toBe(2)
  })

  it('counts non-indexed geometry triangles', () => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(27), 3))
    const root = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())

    const m = collectSceneMetrics(root)
    expect(m.sceneTriangles).toBe(3)
  })

  it('multiplies instanced mesh triangles by instance count', () => {
    const geo = new THREE.BufferGeometry().setIndex([0, 1, 2])
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 4)
    const root = new THREE.Group()
    root.add(mesh)

    const m = collectSceneMetrics(root)
    expect(m.meshCount).toBe(1)
    expect(m.sceneTriangles).toBe(4)
  })

  it('counts multiple materials on one mesh', () => {
    const geo = new THREE.BufferGeometry().setIndex([0, 1, 2])
    const mesh = new THREE.Mesh(geo, [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ])
    const m = collectSceneMetrics(mesh)
    expect(m.materialCount).toBe(2)
  })
})
