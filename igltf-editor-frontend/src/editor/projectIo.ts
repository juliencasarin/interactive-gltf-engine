import type { EditorNode, ProjectAssetEntry, ProjectFileV1, ProjectFileV2, SceneNodeV2, Vec3 } from './types'

export function serializeProjectV1(nodes: EditorNode[]): string {
  const doc: ProjectFileV1 = {
    format: 'igltf-editor-project',
    version: 1,
    nodes,
  }
  return JSON.stringify(doc, null, 2)
}

export function parseProjectJsonV1(text: string): ProjectFileV1 {
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project file')
  const o = raw as Record<string, unknown>
  if (o.format !== 'igltf-editor-project' || o.version !== 1 || !Array.isArray(o.nodes)) {
    throw new Error('Unsupported project format (expected igltf-editor-project v1)')
  }
  return o as ProjectFileV1
}

export function assetsReferencedInScene(
  nodes: EditorNode[],
  all: ProjectAssetEntry[],
): ProjectAssetEntry[] {
  const ids = new Set(nodes.map((n) => n.assetRef).filter(Boolean) as string[])
  return all.filter((a) => ids.has(a.assetId))
}

export function toProjectFileV2(nodes: EditorNode[], assets: ProjectAssetEntry[]): ProjectFileV2 {
  const sceneNodes: SceneNodeV2[] = nodes.map((n) => {
    const { id, name, parentId, position, rotation, scale, assetRef } = n
    if (!assetRef) {
      return {
        id,
        name,
        parentId,
        position,
        rotation,
        scale,
      }
    }
    return {
      id,
      name,
      parentId,
      position,
      rotation,
      scale,
      assetRef,
    }
  })
  return {
    format: 'igltf-editor-project',
    version: 2,
    scene: { nodes: sceneNodes },
    assets: assets.map((a) => ({ ...a })),
  }
}

export function parseProjectJsonV2(text: string): ProjectFileV2 {
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project file')
  const o = raw as Record<string, unknown>
  if (o.format !== 'igltf-editor-project' || o.version !== 2) {
    throw new Error('Unsupported project format (expected igltf-editor-project v2)')
  }
  const scene = o.scene as Record<string, unknown> | undefined
  if (!scene || !Array.isArray(scene.nodes)) throw new Error('Invalid v2 project: missing scene.nodes')
  if (!Array.isArray(o.assets)) throw new Error('Invalid v2 project: missing assets')
  return o as unknown as ProjectFileV2
}

export function parseAnyProjectFile(text: string): {
  nodes: EditorNode[]
  assets: ProjectAssetEntry[]
} {
  const raw = JSON.parse(text) as Record<string, unknown>
  if (!raw || raw.format !== 'igltf-editor-project') throw new Error('Invalid project file')
  if (raw.version === 2) {
    const doc = parseProjectJsonV2(text)
    const nodes: EditorNode[] = doc.scene.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      parentId: n.parentId,
      position: triple(n.position as number[]),
      rotation: triple(n.rotation as number[]),
      scale: triple(n.scale as number[]),
      assetRef: n.assetRef,
    }))
    return { nodes, assets: doc.assets }
  }
  if (raw.version === 1) {
    const doc = parseProjectJsonV1(text)
    return { nodes: doc.nodes, assets: [] }
  }
  throw new Error(`Unsupported project version: ${String(raw.version)}`)
}

function triple(a: number[]): Vec3 {
  if (!Array.isArray(a) || a.length !== 3) throw new Error('expected vec3')
  return [a[0], a[1], a[2]]
}

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
