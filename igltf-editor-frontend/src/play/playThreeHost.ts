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
  IgltfVec4,
  InteractiveGltfHost,
} from '@/scriptRuntime/igltfHost'
import { normalizeIgltfTransaction } from '@/scriptRuntime/igltfTransactionUtils'

const _euler = new THREE.Euler(0, 0, 0, 'XYZ')
const _axis = new THREE.Vector3()
const _pivot = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _qDelta = new THREE.Quaternion()

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

function applyTranslate(obj: THREE.Object3D, delta: IgltfVec3, space: 'local' | 'world' = 'local'): void {
  if (space === 'world') {
    obj.getWorldPosition(_pos)
    _pos.x += delta.x
    _pos.y += delta.y
    _pos.z += delta.z
    if (obj.parent) obj.parent.worldToLocal(_pos)
    obj.position.copy(_pos)
    return
  }
  obj.translateX(delta.x)
  obj.translateY(delta.y)
  obj.translateZ(delta.z)
}

function applyRotate(obj: THREE.Object3D, eulerDegrees: IgltfVec3, space: 'local' | 'world' = 'local'): void {
  _euler.set(
    THREE.MathUtils.degToRad(eulerDegrees.x),
    THREE.MathUtils.degToRad(eulerDegrees.y),
    THREE.MathUtils.degToRad(eulerDegrees.z),
    'XYZ',
  )
  _qDelta.setFromEuler(_euler)
  if (space === 'world') {
    obj.quaternion.premultiply(_qDelta)
  } else {
    obj.quaternion.multiply(_qDelta)
  }
}

function applyRotateAround(
  obj: THREE.Object3D,
  axis: IgltfVec3,
  angleDeg: number,
  pivot?: IgltfVec3,
  space: 'local' | 'world' = 'world',
): void {
  _axis.set(axis.x, axis.y, axis.z)
  if (_axis.lengthSq() < 1e-12) return
  _axis.normalize()
  if (space === 'local' && obj.parent) {
    _axis.transformDirection(obj.parent.matrixWorld)
  }
  if (pivot) {
    _pivot.set(pivot.x, pivot.y, pivot.z)
  } else {
    obj.getWorldPosition(_pivot)
  }
  _qDelta.setFromAxisAngle(_axis, THREE.MathUtils.degToRad(angleDeg))
  obj.updateMatrixWorld(true)
  obj.getWorldPosition(_pos)
  _pos.sub(_pivot).applyQuaternion(_qDelta).add(_pivot)
  obj.parent?.worldToLocal(_pos)
  obj.position.copy(_pos)
  obj.quaternion.premultiply(_qDelta)
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
    } else if (op.kind === 'transform.setLocalScale') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) obj.scale.set(op.scale.x, op.scale.y, op.scale.z)
    } else if (op.kind === 'transform.setLocalQuaternion') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) obj.quaternion.set(op.quaternion.x, op.quaternion.y, op.quaternion.z, op.quaternion.w)
    } else if (op.kind === 'hierarchy.setParent') {
      const obj = resolveEntityObject(root, op.entityId)
      const parent = resolveEntityObject(root, op.parentId)
      if (obj && parent && obj !== parent) {
        console.warn(
          '[igltf play] hierarchy.setParent is best-effort; exported glTF hierarchy is fixed at build time.',
        )
        parent.add(obj)
      }
    } else if (op.kind === 'transform.translate') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) applyTranslate(obj, op.delta, op.space ?? 'local')
    } else if (op.kind === 'transform.rotate') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) applyRotate(obj, op.eulerDegrees, op.space ?? 'local')
    } else if (op.kind === 'transform.rotateAround') {
      const obj = resolveEntityObject(root, op.entityId)
      if (obj) applyRotateAround(obj, op.axis, op.angleDeg, op.pivot, op.space ?? 'world')
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
    addSetLocalScale(entityId, scale) {
      operations.push({
        kind: 'transform.setLocalScale',
        entityId,
        scale: { x: scale.x, y: scale.y, z: scale.z },
      })
      return self
    },
    addSetLocalQuaternion(entityId, quaternion) {
      operations.push({
        kind: 'transform.setLocalQuaternion',
        entityId,
        quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      })
      return self
    },
    addSetParent(entityId, parentId) {
      operations.push({ kind: 'hierarchy.setParent', entityId, parentId })
      return self
    },
    addTranslate(entityId, delta, space) {
      operations.push({
        kind: 'transform.translate',
        entityId,
        delta: { x: delta.x, y: delta.y, z: delta.z },
        ...(space ? { space } : {}),
      })
      return self
    },
    addRotate(entityId, eulerDegrees, space) {
      operations.push({
        kind: 'transform.rotate',
        entityId,
        eulerDegrees: { x: eulerDegrees.x, y: eulerDegrees.y, z: eulerDegrees.z },
        ...(space ? { space } : {}),
      })
      return self
    },
    addRotateAround(entityId, axis, angleDeg, opts) {
      operations.push({
        kind: 'transform.rotateAround',
        entityId,
        axis: { x: axis.x, y: axis.y, z: axis.z },
        angleDeg,
        ...(opts?.pivot ? { pivot: { x: opts.pivot.x, y: opts.pivot.y, z: opts.pivot.z } } : {}),
        ...(opts?.space ? { space: opts.space } : {}),
      })
      return self
    },
    build,
    toJSON: build,
  }
  return self
}

function vec3FromThree(v: THREE.Vector3): IgltfVec3 {
  return { x: v.x, y: v.y, z: v.z }
}

function vec4FromQuat(q: THREE.Quaternion): IgltfVec4 {
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

function createHandle(obj: THREE.Object3D, id: string): IgltfSceneObjectHandle {
  return {
    umi3dId: id,
    getLocalPosition(): IgltfVec3 {
      return vec3FromThree(obj.position)
    },
    getWorldPosition(): IgltfVec3 {
      const v = new THREE.Vector3()
      obj.getWorldPosition(v)
      return vec3FromThree(v)
    },
    getLocalRotation(): IgltfVec4 {
      return vec4FromQuat(obj.quaternion)
    },
    getWorldRotation(): IgltfVec4 {
      const q = new THREE.Quaternion()
      obj.getWorldQuaternion(q)
      return vec4FromQuat(q)
    },
    getLocalScale(): IgltfVec3 {
      return vec3FromThree(obj.scale)
    },
    getWorldScale(): IgltfVec3 {
      const v = new THREE.Vector3()
      obj.getWorldScale(v)
      return vec3FromThree(v)
    },
    translateLocal(x: number, y: number, z: number) {
      obj.position.x += x
      obj.position.y += y
      obj.position.z += z
    },
  }
}

export type PlayThreeHostOptions = {
  getScriptByAttachmentId?: (attachmentId: string) => unknown
}

export function createPlayThreeHost(root: THREE.Object3D, options?: PlayThreeHostOptions): InteractiveGltfHost {
  const handles = new Map<string, IgltfSceneObjectHandle>()
  const getScript = options?.getScriptByAttachmentId
  return {
    apiVersion: '1.0.0',
    getObjectByUmi3dId(id: string): IgltfSceneObjectHandle | undefined {
      let h = handles.get(id)
      if (h) return h
      const obj = resolveEntityObject(root, id)
      if (!obj) return undefined
      h = createHandle(obj, id)
      handles.set(id, h)
      return h
    },
    getScriptByAttachmentId(attachmentId: string): unknown {
      return getScript?.(attachmentId)
    },
    createTransaction: () => createTransactionBuilder(),
    executeTransaction(transaction) {
      const tx = normalizeIgltfTransaction(transaction)
      if (!tx) return false
      applyIgltfTransaction(root, tx)
      return true
    },
  }
}
