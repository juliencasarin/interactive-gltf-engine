import * as THREE from 'three'
import type { AuthoringBoundsAabb, AuthoringBoundsMetadata, AuthoringBoundsSphere, Vec3 } from './types'

const _box = new THREE.Box3()
const _meshBox = new THREE.Box3()
const _invRoot = new THREE.Matrix4()
const _center = new THREE.Vector3()
const _size = new THREE.Vector3()

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function roundVec3(v: Vec3): Vec3 {
  return [round6(v[0]), round6(v[1]), round6(v[2])]
}

function vec3From(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z]
}

export function aabbFromBox3(box: THREE.Box3): AuthoringBoundsAabb {
  box.getCenter(_center)
  box.getSize(_size)
  return {
    min: roundVec3(vec3From(box.min)),
    max: roundVec3(vec3From(box.max)),
    center: roundVec3(vec3From(_center)),
    size: roundVec3(vec3From(_size)),
  }
}

export function sphereFromBox3(box: THREE.Box3): AuthoringBoundsSphere {
  box.getCenter(_center)
  const radius = Math.max(_center.distanceTo(box.min), _center.distanceTo(box.max))
  return {
    center: roundVec3(vec3From(_center)),
    radius: round6(radius),
  }
}

/** Union mesh AABBs under `root` in local (root) or world space. Returns null when no geometry. */
export function computeBoundsBox3(root: THREE.Object3D, space: 'local' | 'world'): THREE.Box3 | null {
  root.updateWorldMatrix(true, true)
  _box.makeEmpty()
  let hasMesh = false

  if (space === 'world') {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return
      const g = child.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      if (!g.boundingBox || g.boundingBox.isEmpty()) return
      _meshBox.copy(g.boundingBox)
      _meshBox.applyMatrix4(child.matrixWorld)
      hasMesh = true
      _box.union(_meshBox)
    })
  } else {
    _invRoot.copy(root.matrixWorld).invert()
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return
      const g = child.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      if (!g.boundingBox || g.boundingBox.isEmpty()) return
      _meshBox.copy(g.boundingBox)
      _meshBox.applyMatrix4(child.matrixWorld).applyMatrix4(_invRoot)
      hasMesh = true
      _box.union(_meshBox)
    })
  }

  if (!hasMesh || _box.isEmpty()) return null
  return _box.clone()
}

export function measureObjectBounds(
  root: THREE.Object3D,
  space: 'local' | 'world',
): AuthoringBoundsMetadata | null {
  const box = computeBoundsBox3(root, space)
  if (!box) return null
  return {
    space,
    aabb: aabbFromBox3(box),
    sphere: sphereFromBox3(box),
    measuredAt: new Date().toISOString(),
  }
}

export function parseAuthoringBoundsFromDisk(raw: unknown): AuthoringBoundsMetadata | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const space = o.space === 'world' ? 'world' : o.space === 'local' ? 'local' : null
  if (!space) return undefined

  const aabbRaw = o.aabb
  const sphereRaw = o.sphere
  if (!aabbRaw || typeof aabbRaw !== 'object' || Array.isArray(aabbRaw)) return undefined
  if (!sphereRaw || typeof sphereRaw !== 'object' || Array.isArray(sphereRaw)) return undefined

  const a = aabbRaw as Record<string, unknown>
  const s = sphereRaw as Record<string, unknown>
  const min = parseVec3(a.min)
  const max = parseVec3(a.max)
  const centerAabb = parseVec3(a.center)
  const size = parseVec3(a.size)
  const centerSphere = parseVec3(s.center)
  const radius = typeof s.radius === 'number' && Number.isFinite(s.radius) ? s.radius : null
  if (!min || !max || !centerAabb || !size || !centerSphere || radius === null) return undefined

  const measuredAt = typeof o.measuredAt === 'string' && o.measuredAt ? o.measuredAt : undefined
  return {
    space,
    aabb: { min, max, center: centerAabb, size },
    sphere: { center: centerSphere, radius },
    ...(measuredAt ? { measuredAt } : {}),
  }
}

function parseVec3(raw: unknown): Vec3 | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null
  const nums = raw.map((v) => Number(v))
  if (nums.some((n) => !Number.isFinite(n))) return null
  return [nums[0]!, nums[1]!, nums[2]!]
}
