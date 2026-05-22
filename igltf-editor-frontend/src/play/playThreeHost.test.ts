import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createPlayThreeHost } from './playThreeHost'

describe('createPlayThreeHost executeTransaction', () => {
  it('applies builder transactions immediately', () => {
    const root = new THREE.Group()
    const child = new THREE.Group()
    child.userData.igltfNodeIndex = 3
    child.position.set(0, 0, 0)
    root.add(child)

    const host = createPlayThreeHost(root)
    const ok = host.executeTransaction(
      host.createTransaction().addSetLocalPosition('3', { x: 1, y: 2, z: 3 }),
    )

    expect(ok).toBe(true)
    expect(child.position.x).toBeCloseTo(1)
    expect(child.position.y).toBeCloseTo(2)
    expect(child.position.z).toBeCloseTo(3)
  })

  it('returns false for invalid payloads', () => {
    const host = createPlayThreeHost(new THREE.Group())
    expect(host.executeTransaction({ version: 1 } as never)).toBe(false)
  })
})
