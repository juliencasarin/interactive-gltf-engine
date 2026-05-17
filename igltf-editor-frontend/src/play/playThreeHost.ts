/**
 * Play-mode {@link InteractiveGltfHost}: resolves entities against exported glTF node indices
 * and applies returned transactions to a Three.js subgraph.
 */
import * as THREE from 'three'

import type {
  IgltfOperation,
  IgltfSceneObjectHandle,
  IgltfTransaction,
  IgltfTransactionBuilder,
  IgltfVec3,
  InteractiveGltfHost,
} from '@/scriptRuntime/igltfHost'

function findObjectByIgltfIndex(root: THREE.Object3D, index: number): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined
  root.traverse((o) => {
    if (o.userData?.igltfNodeIndex === index) found = o
  })
  return found
}

function resolveEntityObject(root: THREE.Object3D, entityId: string): THREE.Object3D | undefined {
  if (/^\d+$/.test(entityId)) {
    return findObjectByIgltfIndex(root, Number(entityId))
  }
  let found: THREE.Object3D | undefined
  root.traverse((o) => {
    if (o.name === entityId) found = o
  })
  return found
}

export function applyIgltfTransaction(root: THREE.Object3D, tx: IgltfTransaction): void {
  for (const op of tx.operations) {
    if (op.kind === 'transform.setLocalPosition') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) obj.position.set(op.position.x, op.position.y, op.position.z)
    } else if (op.kind === 'transform.setLocalEulerDegrees') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) {
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(op.eulerDegrees.x),
          THREE.MathUtils.degToRad(op.eulerDegrees.y),
          THREE.MathUtils.degToRad(op.eulerDegrees.z),
          'XYZ',
        )
        obj.rotation.copy(euler)
      }
    }
  }
}

function createTransactionBuilder(): IgltfTransactionBuilder {
  const operations: IgltfOperation[] = []
  const build = (): IgltfTransaction => ({ version: 1, operations: [...operations] })
  const self: IgltfTransactionBuilder = {
    addSetLocalPosition(entityId, position) {
      operations.push({
        kind: 'transform.setLocalPosition',
        entityId,
        position: { x: position.x, y: position.y, z: position.z },
      })
      return self
    },
    addSetLocalEulerDegrees(entityId, eulerDegrees) {
      operations.push({
        kind: 'transform.setLocalEulerDegrees',
        entityId,
        eulerDegrees: { x: eulerDegrees.x, y: eulerDegrees.y, z: eulerDegrees.z },
      })
      return self
    },
    build,
    toJSON: build,
  }
  return self
}

export function createPlayThreeHost(root: THREE.Object3D): InteractiveGltfHost {
  const handles = new Map<string, IgltfSceneObjectHandle>()
  return {
    apiVersion: '1.0.0',
    getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined {
      let h = handles.get(id)
      if (h) return h
      const obj = resolveEntityObject(root, id)
      if (!obj) return undefined
      h = {
        umi3dId: id,
        getLocalPosition(): IgltfVec3 {
          return { x: obj.position.x, y: obj.position.y, z: obj.position.z }
        },
        getWorldPosition(): IgltfVec3 {
          const v = new THREE.Vector3()
          obj.getWorldPosition(v)
          return { x: v.x, y: v.y, z: v.z }
        },
        translateLocal(x: number, y: number, z: number) {
          obj.position.x += x
          obj.position.y += y
          obj.position.z += z
        },
      }
      handles.set(id, h)
      return h
    },
    createTransaction: () => createTransactionBuilder(),
  }
}
