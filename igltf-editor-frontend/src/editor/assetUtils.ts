import type { ProjectAssetEntry } from './types'

const GLTF_RE = /\.(glb|gltf)$/i
const SCRIPT_RE = /\.(mjs|cjs|js)$/i

export function isGltfAssetPath(path: string): boolean {
  return GLTF_RE.test(path)
}

export function isScriptAssetPath(path: string): boolean {
  return SCRIPT_RE.test(path)
}

export function isGltfAssetEntry(a: ProjectAssetEntry): boolean {
  if (a.assetKind === 'gltf') return true
  if (a.assetKind === 'script') return false
  return isGltfAssetPath(a.relativePath) || isGltfAssetPath(a.name ?? '')
}

export function isScriptAssetEntry(a: ProjectAssetEntry): boolean {
  if (a.assetKind === 'script') return true
  if (a.assetKind === 'gltf') return false
  return isScriptAssetPath(a.relativePath) || isScriptAssetPath(a.name ?? '')
}

export function inferAssetKindFromPath(path: string): 'gltf' | 'script' {
  if (isScriptAssetPath(path)) return 'script'
  return 'gltf'
}

/** Filename stem for Unity-like scripts (`assets/MyClass.js` → `MyClass`). */
export function catalogAssetStem(relativePath: string): string {
  const raw = relativePath.trim().replace(/^.*[/\\]/, '').replace(/^.*:/, '')
  return raw.replace(/\.(js|mjs|cjs)$/i, '')
}

/** Human-readable label for catalog rows (Assets explorer, Inspector script foldouts). */
export function assetDisplayLabel(entry: ProjectAssetEntry): string {
  if (isScriptAssetEntry(entry)) return catalogAssetStem(entry.relativePath)
  return (entry.name && entry.name.trim()) || entry.relativePath
}
