import * as THREE from 'three'

import type { GltfJson } from './umi3dProtoTypes'

/** Matches each glTF node index to `object.userData.igltfNodeIndex` (DFS parallel to default scene). */
export function bindIgltfNodeIndices(root: THREE.Object3D, json: GltfJson): void {
  root.traverse((o) => {
    delete o.userData.igltfNodeIndex
  })
  const si = json.scene ?? 0
  const sceneEntry = json.scenes?.[si]
  const roots = sceneEntry?.nodes ?? []
  if (!roots.length) return

  if (roots.length !== root.children.length) {
    console.warn(
      `[igltf play] scene root count mismatch: glTF ${roots.length}, Three.js ${root.children.length}`,
    )
  }
  const n = Math.min(roots.length, root.children.length)
  for (let i = 0; i < n; i++) {
    walkBind(json, roots[i], root.children[i] as THREE.Object3D)
  }
}

function walkBind(json: GltfJson, nodeIdx: number, obj: THREE.Object3D): void {
  const def = json.nodes[nodeIdx]
  if (!def) return
  obj.userData.igltfNodeIndex = nodeIdx
  const chIdx = def.children ?? []
  const oc = obj.children
  if (chIdx.length !== oc.length) {
    console.warn(`[igltf play] node ${nodeIdx}: glTF ${chIdx.length} children vs Three ${oc.length}`)
  }
  const m = Math.min(chIdx.length, oc.length)
  for (let i = 0; i < m; i++) {
    walkBind(json, chIdx[i], oc[i] as THREE.Object3D)
  }
}
