import * as THREE from 'three'
import { measureObjectBounds, sphereFromBox3 } from './authoringBounds'
import { unionAuthoringBoundsAabb } from './boundsCompare'
import type { AuthoringBoundsMetadata } from './types'

const _unionBox = new THREE.Box3()

const sceneNodeObjects = new Map<string, THREE.Object3D>()
/** Per placement clone roots (`assetId::placementId`) plus latest fallback per asset id. */
const assetGltfRoots = new Map<string, THREE.Object3D>()

function assetGltfRootKey(assetId: string, placementId?: string): string {
  return placementId ? `${assetId}::${placementId}` : assetId
}

export function registerSceneNodeObject(nodeId: string, object: THREE.Object3D): void {
  sceneNodeObjects.set(nodeId, object)
}

export function unregisterSceneNodeObject(nodeId: string, object?: THREE.Object3D): void {
  if (object && sceneNodeObjects.get(nodeId) !== object) return
  sceneNodeObjects.delete(nodeId)
}

export function registerAssetGltfRoot(
  assetId: string,
  root: THREE.Object3D,
  placementId?: string,
): void {
  if (placementId) assetGltfRoots.set(assetGltfRootKey(assetId, placementId), root)
  assetGltfRoots.set(assetId, root)
}

export function unregisterAssetGltfRoot(
  assetId: string,
  root?: THREE.Object3D,
  placementId?: string,
): void {
  if (placementId) {
    const scoped = assetGltfRootKey(assetId, placementId)
    if (!root || assetGltfRoots.get(scoped) === root) assetGltfRoots.delete(scoped)
  }
  if (root && assetGltfRoots.get(assetId) !== root) return
  assetGltfRoots.delete(assetId)
}

export function measureSceneNodeBoundsFromViewport(
  nodeId: string,
  space: 'local' | 'world',
): AuthoringBoundsMetadata | null {
  const obj = sceneNodeObjects.get(nodeId)
  if (!obj) return null
  return measureObjectBounds(obj, space)
}

/** Union viewport mesh bounds for all descendant node ids that have registered objects. */
export function measureSceneSubtreeBoundsFromViewport(
  descendantNodeIds: string[],
  space: 'local' | 'world',
): AuthoringBoundsMetadata | null {
  const aabbs = []
  for (const nid of descendantNodeIds) {
    const obj = sceneNodeObjects.get(nid)
    if (!obj) continue
    const b = measureObjectBounds(obj, space)
    if (b) aabbs.push(b.aabb)
  }
  const merged = unionAuthoringBoundsAabb(aabbs)
  if (!merged) return null
  _unionBox.min.set(merged.min[0], merged.min[1], merged.min[2])
  _unionBox.max.set(merged.max[0], merged.max[1], merged.max[2])
  return {
    space,
    aabb: merged,
    sphere: sphereFromBox3(_unionBox),
    measuredAt: new Date().toISOString(),
  }
}

/** Catalog glTF bounds in model-local space (clone root, ignoring placement transform). */
export function measureAssetBoundsFromViewport(assetId: string): AuthoringBoundsMetadata | null {
  const root = assetGltfRoots.get(assetId)
  if (!root) return null
  return measureObjectBounds(root, 'local')
}

export function clearEditorViewportBoundsRegistry(): void {
  sceneNodeObjects.clear()
  assetGltfRoots.clear()
}
