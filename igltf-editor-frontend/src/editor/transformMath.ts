/**
 * Scene-node transform math (local TRS persisted; world/global is UI-only).
 * Aligns with UMI3D SetEntityProperty local Position / Rotation / Scale + ParentId.
 */
import * as THREE from 'three'

import type { EditorNode, Vec3 } from './types'

export type TransformSpace = 'local' | 'world'

export type ReparentOptions = {
  /** Default true — recompute local TRS so world pose stays unchanged. */
  keepWorldPosition?: boolean
}

export type TRS = {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

const _mLocal = new THREE.Matrix4()
const _mWorld = new THREE.Matrix4()
const _mParentInv = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _euler = new THREE.Euler(0, 0, 0, 'XYZ')
const _axis = new THREE.Vector3()
const _pivot = new THREE.Vector3()
const _qDelta = new THREE.Quaternion()

export function nodesById(nodes: EditorNode[]): Map<string, EditorNode> {
  return new Map(nodes.map((n) => [n.id, n]))
}

export function getLocalTRS(node: EditorNode): TRS {
  return {
    position: [...node.position] as Vec3,
    rotation: [...node.rotation] as Vec3,
    scale: [...node.scale] as Vec3,
  }
}

function matrixFromTRS(position: Vec3, rotation: Vec3, scale: Vec3, out: THREE.Matrix4): THREE.Matrix4 {
  _euler.set(rotation[0], rotation[1], rotation[2])
  _mLocal.compose(
    _pos.set(position[0], position[1], position[2]),
    _quat.setFromEuler(_euler),
    _scale.set(scale[0], scale[1], scale[2]),
  )
  out.copy(_mLocal)
  return out
}

function decomposeMatrixToTRS(m: THREE.Matrix4): TRS {
  m.decompose(_pos, _quat, _scale)
  _euler.setFromQuaternion(_quat, 'XYZ')
  return {
    position: [_pos.x, _pos.y, _pos.z],
    rotation: [_euler.x, _euler.y, _euler.z],
    scale: [_scale.x, _scale.y, _scale.z],
  }
}

/** World matrix for a node from persisted local TRS + parent chain. */
export function composeWorldMatrix(nodes: EditorNode[], nodeId: string, out = _mWorld): THREE.Matrix4 | null {
  const byId = nodesById(nodes)
  const chain: EditorNode[] = []
  let cur: string | null = nodeId
  while (cur) {
    const n = byId.get(cur)
    if (!n) return null
    chain.unshift(n)
    cur = n.parentId
  }
  out.identity()
  for (const n of chain) {
    matrixFromTRS(n.position, n.rotation, n.scale, _mLocal)
    out.multiply(_mLocal)
  }
  return out
}

export function getWorldTRS(nodes: EditorNode[], nodeId: string): TRS | null {
  const m = composeWorldMatrix(nodes, nodeId)
  if (!m) return null
  return decomposeMatrixToTRS(m.clone())
}

function parentWorldMatrix(nodes: EditorNode[], parentId: string | null, out = _mWorld): THREE.Matrix4 {
  if (!parentId) {
    out.identity()
    return out
  }
  const m = composeWorldMatrix(nodes, parentId, out)
  return m ?? out.identity()
}

/** Convert world TRS to local under `parentId`. */
export function decomposeToLocal(
  nodes: EditorNode[],
  parentId: string | null,
  worldMatrix: THREE.Matrix4,
): TRS {
  parentWorldMatrix(nodes, parentId, _mParentInv)
  _mParentInv.invert()
  _mLocal.copy(_mParentInv).multiply(worldMatrix)
  return decomposeMatrixToTRS(_mLocal)
}

export function setTransformInSpace(
  node: EditorNode,
  nodes: EditorNode[],
  patch: Partial<TRS>,
  space: TransformSpace,
): Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale'>> {
  if (space === 'local') {
    const out: Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale'>> = {}
    if (patch.position) out.position = [...patch.position] as Vec3
    if (patch.rotation) out.rotation = [...patch.rotation] as Vec3
    if (patch.scale) out.scale = [...patch.scale] as Vec3
    return out
  }

  const world = getWorldTRS(nodes, node.id)
  if (!world) return {}

  if (patch.position) world.position = [...patch.position] as Vec3
  if (patch.rotation) world.rotation = [...patch.rotation] as Vec3
  if (patch.scale) world.scale = [...patch.scale] as Vec3

  _euler.set(world.rotation[0], world.rotation[1], world.rotation[2])
  matrixFromTRS(world.position, world.rotation, world.scale, _mWorld)
  const local = decomposeToLocal(nodes, node.parentId, _mWorld)
  return {
    position: local.position,
    rotation: local.rotation,
    scale: local.scale,
  }
}

/**
 * Apply reparent TRS adjustment after parentId change.
 * Call on the moved node with `nodes` already containing new parentId.
 */
export function applyReparentTransform(
  node: EditorNode,
  nodesBefore: EditorNode[],
  newParentId: string,
  opts?: ReparentOptions,
): Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale'>> | null {
  const keepWorld = opts?.keepWorldPosition !== false
  if (!keepWorld) return null

  const worldBefore = composeWorldMatrix(nodesBefore, node.id)
  if (!worldBefore) return null

  const nodesAfterParent = nodesById(nodesBefore)
  const moved = nodesAfterParent.get(node.id)
  if (!moved) return null
  const withNewParent = { ...moved, parentId: newParentId }
  const nodesForParent = nodesBefore.map((n) => (n.id === node.id ? withNewParent : n))

  const local = decomposeToLocal(nodesForParent, newParentId, worldBefore)
  return {
    position: local.position,
    rotation: local.rotation,
    scale: local.scale,
  }
}

export type RotateAroundOptions = {
  axis: Vec3
  angleDeg: number
  pivot?: Vec3
  /** Axis direction expressed in local or world space. Pivot is always world if provided. */
  space?: TransformSpace
}

export function rotateAroundAxis(
  node: EditorNode,
  nodes: EditorNode[],
  opts: RotateAroundOptions,
): Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale'>> | null {
  const world = composeWorldMatrix(nodes, node.id)
  if (!world) return null

  const angleRad = THREE.MathUtils.degToRad(opts.angleDeg)
  _axis.set(opts.axis[0], opts.axis[1], opts.axis[2])
  if (_axis.lengthSq() < 1e-12) return null
  _axis.normalize()

  if (opts.space !== 'world') {
    const parentM = parentWorldMatrix(nodes, node.parentId, _mParentInv)
    _axis.transformDirection(parentM)
  }

  if (opts.pivot) {
    _pivot.set(opts.pivot[0], opts.pivot[1], opts.pivot[2])
  } else {
    world.decompose(_pos, _quat, _scale)
    _pivot.copy(_pos)
  }

  _qDelta.setFromAxisAngle(_axis, angleRad)
  world.decompose(_pos, _quat, _scale)
  _pos.sub(_pivot).applyQuaternion(_qDelta).add(_pivot)
  _quat.premultiply(_qDelta)
  _mWorld.compose(_pos, _quat, _scale)

  const local = decomposeToLocal(nodes, node.parentId, _mWorld)
  return {
    position: local.position,
    rotation: local.rotation,
    scale: local.scale,
  }
}

export type RelativeTransformOptions = {
  translate?: Vec3
  rotateEulerDeg?: Vec3
  scaleMul?: Vec3
  space?: TransformSpace
}

export function applyRelativeTransform(
  node: EditorNode,
  nodes: EditorNode[],
  opts: RelativeTransformOptions,
): Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale'>> | null {
  const world = composeWorldMatrix(nodes, node.id)
  if (!world) return null

  const space = opts.space ?? 'local'
  world.decompose(_pos, _quat, _scale)

  if (opts.translate) {
    const d = opts.translate
    if (space === 'world') {
      _pos.x += d[0]
      _pos.y += d[1]
      _pos.z += d[2]
    } else {
      const parentM = parentWorldMatrix(nodes, node.parentId, _mParentInv)
      _axis.set(d[0], d[1], d[2]).applyMatrix4(parentM)
      _pos.add(_axis)
    }
  }

  if (opts.rotateEulerDeg) {
    const deg = opts.rotateEulerDeg
    _euler.set(
      THREE.MathUtils.degToRad(deg[0]),
      THREE.MathUtils.degToRad(deg[1]),
      THREE.MathUtils.degToRad(deg[2]),
    )
    _qDelta.setFromEuler(_euler)
    if (space === 'world') {
      _quat.premultiply(_qDelta)
    } else {
      _quat.multiply(_qDelta)
    }
  }

  if (opts.scaleMul) {
    const m = opts.scaleMul
    _scale.x *= m[0]
    _scale.y *= m[1]
    _scale.z *= m[2]
  }

  _mWorld.compose(_pos, _quat, _scale)
  const local = decomposeToLocal(nodes, node.parentId, _mWorld)
  return {
    position: local.position,
    rotation: local.rotation,
    scale: local.scale,
  }
}

/** Identity local TRS. */
export function identityLocalTRS(): TRS {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
}

/** Valid parent ids for `nodeId` (excludes self and descendants). */
export function listValidParentIds(nodes: EditorNode[], nodeId: string): string[] {
  if (nodeId === 'root') return []
  const invalid = new Set<string>([nodeId])
  const walk = (id: string) => {
    for (const c of nodes.filter((n) => n.parentId === id)) {
      invalid.add(c.id)
      walk(c.id)
    }
  }
  walk(nodeId)
  return nodes.map((n) => n.id).filter((id) => !invalid.has(id))
}

/** Convert gizmo object world/local matrices back to persisted local TRS (placement rows). */
export function localTRSFromObjectMatrices(
  object: THREE.Object3D,
  parentObject: THREE.Object3D | null,
): TRS {
  object.updateMatrixWorld(true)
  if (parentObject) {
    parentObject.updateMatrixWorld(true)
    _mParentInv.copy(parentObject.matrixWorld).invert()
    _mLocal.copy(_mParentInv).multiply(object.matrixWorld)
  } else {
    _mLocal.copy(object.matrixWorld)
  }
  return decomposeMatrixToTRS(_mLocal)
}

/** Delta TRS for interior mirror rows from object vs baseline. */
export function mirrorDeltaFromObject(
  object: THREE.Object3D,
  baseline: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 },
): TRS {
  const p = object.position
  const posDelta: Vec3 = [p.x - baseline.position.x, p.y - baseline.position.y, p.z - baseline.position.z]
  _qDelta.copy(baseline.quaternion).invert()
  _quat.copy(object.quaternion).premultiply(_qDelta)
  _euler.setFromQuaternion(_quat, 'XYZ')
  const rotDelta: Vec3 = [_euler.x, _euler.y, _euler.z]
  const bs = baseline.scale
  const os = object.scale
  const scaleDelta: Vec3 = [
    bs.x !== 0 ? os.x / bs.x : 1,
    bs.y !== 0 ? os.y / bs.y : 1,
    bs.z !== 0 ? os.z / bs.z : 1,
  ]
  return { position: posDelta, rotation: rotDelta, scale: scaleDelta }
}
