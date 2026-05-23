import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { aabbFromBox3, measureObjectBounds, parseAuthoringBoundsFromDisk, sphereFromBox3 } from './authoringBounds'

describe('authoringBounds', () => {
  it('measures local bounds from a unit cube mesh', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6))
    root.add(mesh)

    const bounds = measureObjectBounds(root, 'local')
    expect(bounds).not.toBeNull()
    expect(bounds!.space).toBe('local')
    expect(bounds!.aabb.size).toEqual([2, 4, 6])
    expect(bounds!.aabb.min[0]).toBe(-1)
    expect(bounds!.aabb.max[0]).toBe(1)
    expect(bounds!.sphere.radius).toBeGreaterThan(0)
  })

  it('parses disk metadata', () => {
    const parsed = parseAuthoringBoundsFromDisk({
      space: 'world',
      aabb: {
        min: [0, 0, 0],
        max: [1, 2, 3],
        center: [0.5, 1, 1.5],
        size: [1, 2, 3],
      },
      sphere: { center: [0.5, 1, 1.5], radius: 2 },
      measuredAt: '2026-05-22T12:00:00.000Z',
    })
    expect(parsed?.space).toBe('world')
    expect(parsed?.aabb.size).toEqual([1, 2, 3])
    expect(parsed?.measuredAt).toBe('2026-05-22T12:00:00.000Z')
  })

  it('sphereFromBox3 wraps box corners', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3))
    const sphere = sphereFromBox3(box)
    expect(sphere.radius).toBeGreaterThan(3)
    expect(aabbFromBox3(box).center).toEqual([0, 0, 0])
  })
})
