import { safeInteractionSerializedProps } from '@/scriptRuntime/scriptInputSchema'
import type {
  EditorNode,
  EditorSettingsV2,
  InteractionScriptAttachment,
  ProjectAssetEntry,
  ProjectFileV1,
  ProjectFileV2,
  SceneNodeV2,
  Vec3,
} from './types'
import { normalizeLogicalFolder } from './folderUtils'
import { parseAuthoringBoundsFromDisk } from './authoringBounds'

export { safeInteractionSerializedProps }

export function newAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `a_${Math.random().toString(36).slice(2)}`
}

function parseAttachmentFromDisk(raw: unknown): InteractionScriptAttachment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const scriptAssetRef = typeof o.scriptAssetRef === 'string' ? o.scriptAssetRef : ''
  if (!scriptAssetRef) return null
  const id = typeof o.id === 'string' && o.id ? o.id : newAttachmentId()
  const serializedProps = safeInteractionSerializedProps(o.serializedProps)
  const a: InteractionScriptAttachment = { id, scriptAssetRef }
  if (serializedProps) a.serializedProps = serializedProps
  return a
}

/** Migrate legacy singular interaction fields + parse `interactionAttachments` from disk JSON. */
export function interactionAttachmentsFromDiskNode(raw: Record<string, unknown>): InteractionScriptAttachment[] | undefined {
  const out: InteractionScriptAttachment[] = []
  const arr = raw.interactionAttachments
  if (Array.isArray(arr)) {
    for (const item of arr) {
      const a = parseAttachmentFromDisk(item)
      if (a) out.push(a)
    }
  }
  if (out.length) return out

  const legacyRef = raw.interactionScriptAssetRef
  if (typeof legacyRef === 'string' && legacyRef) {
    const a: InteractionScriptAttachment = { id: newAttachmentId(), scriptAssetRef: legacyRef }
    const sp = safeInteractionSerializedProps(raw.interactionSerializedProps)
    if (sp) a.serializedProps = sp
    return [a]
  }

  return undefined
}

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
  if (n.sourceAssetRef) out.sourceAssetRef = n.sourceAssetRef
  if (typeof n.sourceGltfNodeIndex === 'number' && Number.isFinite(n.sourceGltfNodeIndex)) {
    out.sourceGltfNodeIndex = Math.trunc(n.sourceGltfNodeIndex)
  }
  if (n.sourcePlacementId) out.sourcePlacementId = n.sourcePlacementId
  if (n.visible === false) out.visible = false
  if (n.layerId) out.layerId = n.layerId
  if (n.description?.trim()) out.description = n.description.trim()
  if (n.authoringBounds) out.authoringBounds = { ...n.authoringBounds }
  if (n.interactionAttachments?.length) {
    out.interactionAttachments = n.interactionAttachments.map((a) => {
      const row: InteractionScriptAttachment = {
        id: a.id,
        scriptAssetRef: a.scriptAssetRef,
      }
      if (a.serializedProps && Object.keys(a.serializedProps).length > 0)
        row.serializedProps = { ...a.serializedProps }
      return row
    })
  }
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
  editorSettings?: EditorSettingsV2,
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
      ...(a.description?.trim() ? { description: a.description.trim() } : {}),
      ...(a.authoringBounds ? { authoringBounds: { ...a.authoringBounds } } : {}),
      ...(a.logicalFolder ? { logicalFolder: normalizeLogicalFolder(a.logicalFolder) } : {}),
      ...(a.assetKind ? { assetKind: a.assetKind } : {}),
      ...(a.scriptRole ? { scriptRole: a.scriptRole } : {}),
      ...(a.interactionKind ? { interactionKind: a.interactionKind } : {}),
      ...(a.sourceText !== undefined && a.sourceText !== '' ? { sourceText: a.sourceText } : {}),
      ...(a.scriptExports?.length ? { scriptExports: [...a.scriptExports] } : {}),
      ...(a.scriptDependsOnAssetIds?.length ? { scriptDependsOnAssetIds: [...a.scriptDependsOnAssetIds] } : {}),
    })),
  }
  const af = [...new Set((assetFoldersExplicit ?? []).map(normalizeLogicalFolder).filter(Boolean))].sort()
  if (af.length) doc.assetFolders = af
  if (editorSettings?.mcpAllowSceneEdition) {
    doc.editorSettings = { mcpAllowSceneEdition: true }
  }
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

function editorNodeFromSceneLike(raw: Record<string, unknown>, vecs: {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}): EditorNode {
  const attachments = interactionAttachmentsFromDiskNode(raw)
  return {
    id: raw.id as string,
    name: raw.name as string,
    parentId: (raw.parentId ?? null) as string | null,
    position: vecs.position,
    rotation: vecs.rotation,
    scale: vecs.scale,
    ...(typeof raw.assetRef === 'string' ? { assetRef: raw.assetRef } : {}),
    ...(typeof raw.sourceAssetRef === 'string' && raw.sourceAssetRef
      ? { sourceAssetRef: raw.sourceAssetRef }
      : {}),
    ...(typeof raw.sourceGltfNodeIndex === 'number' && Number.isFinite(raw.sourceGltfNodeIndex)
      ? { sourceGltfNodeIndex: raw.sourceGltfNodeIndex as number }
      : {}),
    ...(typeof raw.sourcePlacementId === 'string' && raw.sourcePlacementId
      ? { sourcePlacementId: raw.sourcePlacementId }
      : {}),
    ...(typeof raw.description === 'string' && raw.description.trim()
      ? { description: raw.description.trim() }
      : {}),
    ...(() => {
      const bounds = parseAuthoringBoundsFromDisk(raw.authoringBounds)
      return bounds ? { authoringBounds: bounds } : {}
    })(),
    ...(raw.visible === false ? { visible: false as const } : {}),
    ...(typeof raw.layerId === 'string' ? { layerId: raw.layerId } : {}),
    ...(attachments?.length ? { interactionAttachments: attachments } : {}),
  }
}

export function parseEditorSettingsFromDoc(raw: Record<string, unknown>): EditorSettingsV2 {
  const es = raw.editorSettings
  if (!es || typeof es !== 'object' || Array.isArray(es)) return {}
  const o = es as Record<string, unknown>
  return {
    ...(o.mcpAllowSceneEdition === true ? { mcpAllowSceneEdition: true } : {}),
  }
}

export function parseAnyProjectFile(text: string): {
  nodes: EditorNode[]
  assets: ProjectAssetEntry[]
  assetFolders: string[]
  editorSettings: EditorSettingsV2
} {
  const raw = JSON.parse(text) as Record<string, unknown>
  if (!raw || raw.format !== 'igltf-editor-project') throw new Error('Invalid project file')
  if (raw.version === 2) {
    const doc = parseProjectJsonV2(text)
    const nodes: EditorNode[] = doc.scene.nodes.map((n) =>
      editorNodeFromSceneLike(n as unknown as Record<string, unknown>, {
        position: triple(n.position as number[]),
        rotation: triple(n.rotation as number[]),
        scale: triple(n.scale as number[]),
      }),
    )
    const foldersRaw = Array.isArray((doc as ProjectFileV2).assetFolders)
      ? ((doc as ProjectFileV2).assetFolders as string[])
      : []
    const assetFolders = [...new Set(foldersRaw.map(normalizeLogicalFolder).filter(Boolean))].sort()
    return {
      nodes,
      assets: doc.assets.map((a) => ({
        ...a,
        ...(a.logicalFolder ? { logicalFolder: normalizeLogicalFolder(a.logicalFolder) } : {}),
        ...(typeof a.description === 'string' && a.description.trim()
          ? { description: a.description.trim() }
          : {}),
        ...(() => {
          const bounds = parseAuthoringBoundsFromDisk((a as Record<string, unknown>).authoringBounds)
          return bounds ? { authoringBounds: bounds } : {}
        })(),
      })),
      assetFolders,
      editorSettings: parseEditorSettingsFromDoc(doc as unknown as Record<string, unknown>),
    }
  }
  if (raw.version === 1) {
    const doc = parseProjectJsonV1(text)
    const nodes: EditorNode[] = doc.nodes.map((n) => {
      const o = n as unknown as Record<string, unknown>
      return editorNodeFromSceneLike(o, {
        position: triple(o.position as number[]),
        rotation: triple(o.rotation as number[]),
        scale: triple(o.scale as number[]),
      })
    })
    return { nodes, assets: [], assetFolders: [], editorSettings: {} }
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

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(file, 'UTF-8')
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
