export type Vec3 = [number, number, number]

/** Persisted scene node (v2); no inline glTF on disk. */
export type SceneNodeV2 = {
  id: string
  name: string
  parentId: string | null
  position: Vec3
  rotation: Vec3
  scale: Vec3
  assetRef?: string
}

export type ProjectAssetEntry = {
  assetId: string
  relativePath: string
  name?: string
}

/** In-memory editor node: server `assetRef` and/or local preview `gltfDataUrl`. */
export type EditorNode = {
  id: string
  name: string
  parentId: string | null
  position: Vec3
  rotation: Vec3
  scale: Vec3
  gltfDataUrl?: string
  assetRef?: string
}

export type PanelFocus = 'viewport' | 'hierarchy' | 'assets' | 'inspector'

export type ProjectFileV1 = {
  format: 'igltf-editor-project'
  version: 1
  nodes: EditorNode[]
}

export type ProjectFileV2 = {
  format: 'igltf-editor-project'
  version: 2
  scene: { nodes: SceneNodeV2[] }
  assets: ProjectAssetEntry[]
}
