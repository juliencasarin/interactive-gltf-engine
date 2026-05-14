import type { EditorNode, ProjectAssetEntry, ProjectFileV1, ProjectFileV2, SceneNodeV2, Vec3 } from './types'
import { normalizeLogicalFolder } from './folderUtils'

function editorNodeToSceneNodeV2(n: EditorNode): SceneNodeV2 {
  const out: SceneNodeV2 = {
    id: n.id,
    name: n.name,
    parentId: n.parentId,
    position: n.position,
    rotation: n.rotation,
    scale: n.scale,
  }
  if (n.assetRef) out.assetRef = n.assetRef
  if (n.visible === false) out.visible = false
  if (n.layerId) out.layerId = n.layerId
  return out
}

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

export function toProjectFileV2(
  nodes: EditorNode[],
  assets: ProjectAssetEntry[],
  assetFoldersExplicit?: string[],
): ProjectFileV2 {
  const sceneNodes = nodes.map(editorNodeToSceneNodeV2)
  const doc: ProjectFileV2 = {
    format: 'igltf-editor-project',
    version: 2,
    scene: { nodes: sceneNodes },
    assets: assets.map((a) => ({
      assetId: a.assetId,
      relativePath: a.relativePath,
      name: a.name,
      ...(a.logicalFolder ? { logicalFolder: normalizeLogicalFolder(a.logicalFolder) } : {}),
    })),
  }
  const af = [...new Set((assetFoldersExplicit ?? []).map(normalizeLogicalFolder).filter(Boolean))].sort()
  if (af.length) doc.assetFolders = af
  return doc
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
  assetFolders: string[]
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
      ...(n.assetRef ? { assetRef: n.assetRef } : {}),
      ...(n.visible === false ? { visible: false as const } : {}),
      ...(n.layerId ? { layerId: n.layerId } : {}),
    }))
    const foldersRaw = Array.isArray((doc as ProjectFileV2).assetFolders)
      ? ((doc as ProjectFileV2).assetFolders as string[])
      : []
    const assetFolders = [...new Set(foldersRaw.map(normalizeLogicalFolder).filter(Boolean))].sort()
    return {
      nodes,
      assets: doc.assets.map((a) => ({
        ...a,
        ...(a.logicalFolder ? { logicalFolder: normalizeLogicalFolder(a.logicalFolder) } : {}),
      })),
      assetFolders,
    }
  }
  if (raw.version === 1) {
    const doc = parseProjectJsonV1(text)
    return { nodes: doc.nodes, assets: [], assetFolders: [] }
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
