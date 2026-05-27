import type { AuthoringBoundsAabb, AuthoringBoundsMetadata } from './types'

function vec3Delta(a: readonly [number, number, number], b: readonly [number, number, number]) {
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as [number, number, number]
}

function vec3Distance(d: readonly [number, number, number]): number {
  return Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
}

function aabbVolume(size: readonly [number, number, number]): number {
  return Math.abs(size[0] * size[1] * size[2])
}

export function compareAuthoringBounds(
  a: AuthoringBoundsMetadata,
  b: AuthoringBoundsMetadata,
): {
  delta: { center: [number, number, number]; size: [number, number, number] }
  distance: number
  volumeRatio: number | null
} {
  const centerDelta = vec3Delta(a.aabb.center, b.aabb.center)
  const sizeDelta = vec3Delta(a.aabb.size, b.aabb.size)
  const volA = aabbVolume(a.aabb.size)
  const volB = aabbVolume(b.aabb.size)
  return {
    delta: { center: centerDelta, size: sizeDelta },
    distance: vec3Distance(centerDelta),
    volumeRatio: volA > 1e-12 ? volB / volA : null,
  }
}

export function unionAuthoringBoundsAabb(
  boxes: AuthoringBoundsAabb[],
): AuthoringBoundsAabb | null {
  if (!boxes.length) return null
  const min: [number, number, number] = [...boxes[0]!.min]
  const max: [number, number, number] = [...boxes[0]!.max]
  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i]!
    min[0] = Math.min(min[0], b.min[0])
    min[1] = Math.min(min[1], b.min[1])
    min[2] = Math.min(min[2], b.min[2])
    max[0] = Math.max(max[0], b.max[0])
    max[1] = Math.max(max[1], b.max[1])
    max[2] = Math.max(max[2], b.max[2])
  }
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ]
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  return { min, max, center, size }
}
