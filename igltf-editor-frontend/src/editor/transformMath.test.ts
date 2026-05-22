import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { EditorNode } from './types'
import {
  applyReparentTransform,
  applyRelativeTransform,
  composeWorldMatrix,
  getWorldTRS,
  rotateAroundAxis,
  setTransformInSpace,
} from './transformMath'

function node(
  id: string,
  parentId: string | null,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): EditorNode {
  return { id, name: id, parentId, position, rotation, scale }
}

describe('transformMath', () => {
  const scene: EditorNode[] = [
    node('root', null),
    node('parent', 'root', [2, 0, 0]),
    node('child', 'parent', [1, 0, 0]),
  ]

  it('reparent keepWorldPosition preserves world pose', () => {
    const child = scene.find((n) => n.id === 'child')!
    const worldBefore = getWorldTRS(scene, 'child')!
    const patch = applyReparentTransform(child, scene, 'root', { keepWorldPosition: true })
    expect(patch).not.toBeNull()
    const after = scene.map((n) =>
      n.id === 'child' ? { ...n, parentId: 'root' as const, ...patch! } : n,
    )
    const worldAfter = getWorldTRS(after, 'child')!
    expect(worldAfter.position[0]).toBeCloseTo(worldBefore.position[0], 4)
    expect(worldAfter.position[1]).toBeCloseTo(worldBefore.position[1], 4)
    expect(worldAfter.position[2]).toBeCloseTo(worldBefore.position[2], 4)
  })

  it('reparent keepWorldPosition false returns null patch', () => {
    const child = scene.find((n) => n.id === 'child')!
    expect(applyReparentTransform(child, scene, 'root', { keepWorldPosition: false })).toBeNull()
  })

  it('setTransformInSpace world position converts to local', () => {
    const child = scene.find((n) => n.id === 'child')!
    const patch = setTransformInSpace(child, scene, { position: [5, 0, 0] }, 'world')
    const updated = { ...child, ...patch }
    const m = composeWorldMatrix(
      scene.map((n) => (n.id === 'child' ? updated : n)),
      'child',
    )!
    const p = new THREE.Vector3()
    m.decompose(p, new THREE.Quaternion(), new THREE.Vector3())
    expect(p.x).toBeCloseTo(5, 4)
  })

  it('rotateAround world Y changes orientation', () => {
    const child = scene.find((n) => n.id === 'child')!
    const patch = rotateAroundAxis(child, scene, {
      axis: [0, 1, 0],
      angleDeg: 90,
      space: 'world',
    })
    expect(patch?.rotation).toBeDefined()
  })

  it('applyRelativeTransform translates in local space', () => {
    const child = scene.find((n) => n.id === 'child')!
    const patch = applyRelativeTransform(child, scene, {
      translate: [0, 1, 0],
      space: 'local',
    })
    expect(patch?.position?.[1]).toBeCloseTo(1, 4)
  })
})
