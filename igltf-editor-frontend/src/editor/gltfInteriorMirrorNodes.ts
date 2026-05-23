import type { GltfInteriorManifest } from '@/api/projectApi'
import type { EditorNode } from './types'

function newMirrorNodeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `n_${Math.random().toString(36).slice(2)}`
}

/** Mirror glTF default-scene rows under a catalogue placement (interior expand). */
export function buildInteriorMirrorNodesFromManifest(
  placementNodeId: string,
  catalogueAssetRef: string,
  manifest: GltfInteriorManifest,
): EditorNode[] {
  const rowsByIdx = new Map(manifest.nodes.map((r) => [r.index, r]))
  const preorder = manifest.preorderIndices
  const idForGltfIndex = new Map<number, string>()
  const appended: EditorNode[] = []

  for (let i = 0; i < preorder.length; i += 1) {
    const gi = preorder[i]!
    const row = rowsByIdx.get(gi)
    if (!row) continue
    if (row.hasSkin && typeof console !== 'undefined')
      console.warn(
        `[igltf] expanded node "${row.name}" (index ${gi}) is skinned — export/build will reject until skins are supported`,
      )

    const nid = newMirrorNodeId()
    idForGltfIndex.set(gi, nid)

    let parentEditor: string | null = placementNodeId
    if (row.parentIndex !== null && row.parentIndex !== undefined) {
      parentEditor = idForGltfIndex.get(row.parentIndex) ?? parentEditor
    }

    appended.push({
      id: nid,
      name: row.name,
      parentId: parentEditor,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      sourceAssetRef: catalogueAssetRef,
      sourceGltfNodeIndex: gi,
      sourcePlacementId: placementNodeId,
    })
  }

  return appended
}
