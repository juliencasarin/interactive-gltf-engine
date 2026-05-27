import { describe, expect, it } from 'vitest'
import { compareAuthoringBounds } from './boundsCompare'
import type { AuthoringBoundsMetadata } from './types'

const bounds = (center: [number, number, number], size: [number, number, number]): AuthoringBoundsMetadata => ({
  space: 'world',
  aabb: {
    min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
    max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
    center,
    size,
  },
  sphere: { center, radius: 1 },
})

describe('compareAuthoringBounds', () => {
  it('computes center delta and distance', () => {
    const a = bounds([0, 0, 0], [1, 1, 1])
    const b = bounds([3, 0, 0], [1, 1, 1])
    const cmp = compareAuthoringBounds(a, b)
    expect(cmp.delta.center).toEqual([3, 0, 0])
    expect(cmp.distance).toBe(3)
    expect(cmp.volumeRatio).toBe(1)
  })
})
