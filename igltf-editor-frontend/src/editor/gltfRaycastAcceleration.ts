import * as THREE from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'

let meshRaycastPatched = false

/** Use BVH-accelerated mesh raycasts (three-mesh-bvh, already bundled via drei). */
export function ensureMeshBvhRaycast(): void {
  if (meshRaycastPatched) return
  THREE.Mesh.prototype.raycast = acceleratedRaycast
  meshRaycastPatched = true
}

/** Build per-mesh BVHs once after a glTF scene clone is ready for picking. */
export function accelerateGltfSceneRaycasts(root: THREE.Object3D): void {
  ensureMeshBvhRaycast()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const geo = o.geometry
    if (!geo || geo.boundsTree) return
    try {
      geo.computeBoundsTree()
    } catch {
      // Non-indexed or empty geometry — keep default raycast.
    }
  })
}

/** Skip raycast for helpers that should not steal viewport picks (grid, etc.). */
export function disableObjectRaycast(obj: THREE.Object3D): void {
  obj.raycast = () => {}
}
