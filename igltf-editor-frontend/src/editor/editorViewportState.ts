import type * as THREE from 'three'

export type ViewportCameraSummary = {
  position: [number, number, number]
  rotationEuler: [number, number, number]
  quaternion: [number, number, number, number]
  fov: number
  near: number
  far: number
  orbitTarget: [number, number, number] | null
}

let activeCamera: THREE.PerspectiveCamera | null = null
let activeOrbitTarget: THREE.Vector3 | null = null

export function registerViewportCamera(
  camera: THREE.PerspectiveCamera,
  orbitTarget?: THREE.Vector3 | null,
): void {
  activeCamera = camera
  activeOrbitTarget = orbitTarget ? orbitTarget.clone() : null
}

export function unregisterViewportCamera(camera?: THREE.PerspectiveCamera): void {
  if (camera && activeCamera !== camera) return
  activeCamera = null
  activeOrbitTarget = null
}

export function getViewportCameraSummary(): ViewportCameraSummary | null {
  if (!activeCamera) return null
  const cam = activeCamera
  cam.updateMatrixWorld(true)
  const pos = cam.position
  const rot = cam.rotation
  const q = cam.quaternion
  return {
    position: [pos.x, pos.y, pos.z],
    rotationEuler: [rot.x, rot.y, rot.z],
    quaternion: [q.x, q.y, q.z, q.w],
    fov: cam.fov,
    near: cam.near,
    far: cam.far,
    orbitTarget: activeOrbitTarget
      ? [activeOrbitTarget.x, activeOrbitTarget.y, activeOrbitTarget.z]
      : null,
  }
}
