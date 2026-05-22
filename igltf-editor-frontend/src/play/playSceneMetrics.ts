import * as THREE from 'three'

export type SceneMetrics = {
  nodeCount: number
  meshCount: number
  materialCount: number
  sceneTriangles: number
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3)
  }
  const pos = geometry.attributes.position
  return pos ? Math.floor(pos.count / 3) : 0
}

function meshTriangleCount(mesh: THREE.Mesh): number {
  const base = geometryTriangleCount(mesh.geometry)
  if (mesh instanceof THREE.InstancedMesh) {
    return base * mesh.count
  }
  return base
}

function addMeshMaterials(materials: Set<THREE.Material>, mesh: THREE.Mesh): void {
  const m = mesh.material
  if (Array.isArray(m)) {
    for (const mat of m) {
      if (mat) materials.add(mat)
    }
  } else if (m) {
    materials.add(m)
  }
}

/** Count nodes, meshes, unique materials, and triangles under a scene root (e.g. loaded GLB clone). */
export function collectSceneMetrics(root: THREE.Object3D): SceneMetrics {
  let nodeCount = 0
  let meshCount = 0
  let sceneTriangles = 0
  const materials = new Set<THREE.Material>()

  root.traverse((obj) => {
    nodeCount += 1
    if (obj instanceof THREE.Mesh) {
      meshCount += 1
      sceneTriangles += meshTriangleCount(obj)
      addMeshMaterials(materials, obj)
    }
  })

  return {
    nodeCount,
    meshCount,
    materialCount: materials.size,
    sceneTriangles,
  }
}

/** Compact display for large metric values (e.g. 1200 → "1.2k"). */
export function formatMetricCount(n: number): string {
  const v = Math.round(n)
  if (v < 1000) return String(v)
  if (v < 1_000_000) {
    const k = v / 1000
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`
  }
  const m = v / 1_000_000
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, '')}M`
}
