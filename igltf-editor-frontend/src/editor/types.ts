import type { InteractionTemplateKind } from '@/scriptRuntime/interactionScriptTemplates'

export type Vec3 = [number, number, number]

/** Axis-aligned bounding box for scale / collision authoring (editor-only metadata). */
export type AuthoringBoundsAabb = {
  min: Vec3
  max: Vec3
  center: Vec3
  size: Vec3
}

/** Bounding sphere derived from mesh geometry (editor-only metadata). */
export type AuthoringBoundsSphere = {
  center: Vec3
  radius: number
}

/**
 * Measured bounds stored on scene nodes or catalog assets.
 * `local` = relative to node / glTF root; `world` = scene space (nodes only).
 */
export type AuthoringBoundsMetadata = {
  space: 'local' | 'world'
  aabb: AuthoringBoundsAabb
  sphere: AuthoringBoundsSphere
  measuredAt?: string
}

/** Instance props merged into the interaction class before `onLoaded` / handler (JSON-serializable). */
export type InteractionSerializedPropsMap = Record<string, string | number | boolean | null>

/** One script anchored to a scene node; runtime `targetId` is that node's id (not stored). */
export type InteractionScriptAttachment = {
  id: string
  scriptAssetRef: string
  serializedProps?: InteractionSerializedPropsMap
}

export type ProjectAssetKind = 'gltf' | 'script'

export type ScriptRole = 'interaction' | 'behaviour'

export type EditorSettingsV2 = {
  /** When true, MCP clients may mutate the live scene via editor session. Default false when absent. */
  mcpAllowSceneEdition?: boolean
}

/** Persisted scene node (v2); no inline glTF on disk. */
export type SceneNodeV2 = {
  id: string
  name: string
  /** Author / MCP semantic hint; editor-only, not exported to Play glTF. */
  description?: string
  /** Measured AABB + sphere for scale / collision tooling; editor-only. */
  authoringBounds?: AuthoringBoundsMetadata
  parentId: string | null
  position: Vec3
  rotation: Vec3
  scale: Vec3
  /** Catalog `.glb` asset id — placement rows only when using catalog models. */
  assetRef?: string
  /** Interior mirror rows: same catalog asset as the parent placement. */
  sourceAssetRef?: string
  /** glTF `nodes[]` index in the catalogue file (mirror rows only). */
  sourceGltfNodeIndex?: number
  /**
   * Catalogue placement row id whose GLB instance feeds this mirror when the mirror is not
   * nested under that placement in the editor hierarchy.
   */
  sourcePlacementId?: string
  /** Omitted means visible (Sketch parity default). */
  visible?: boolean
  /** Scene / layer tagging (minimal v1 parity). */
  layerId?: string
  /** Scripts / behaviours attached to this node (each with own target + props). */
  interactionAttachments?: InteractionScriptAttachment[]
}

export type ProjectAssetEntry = {
  assetId: string
  relativePath: string
  name?: string
  /** Author / MCP semantic hint; editor-only. */
  description?: string
  /** Measured model-local bounds (catalog glTF); editor-only. */
  authoringBounds?: AuthoringBoundsMetadata
  /** Virtual path under catalog (segments joined by `/`, no leading slash). */
  logicalFolder?: string
  /** When omitted, inferred from file extension. */
  assetKind?: ProjectAssetKind
  /** Editor metadata for scripting; not required for pure glTF. */
  scriptRole?: ScriptRole
  /**
   * Inline script source (offline / before first server sync).
   * Cleared once the file exists under assets/ on the server.
   */
  sourceText?: string
  /** Editor-only: UMI3D-aligned interaction kind when created from a template (tooling metadata). */
  interactionKind?: InteractionTemplateKind
  /** Optional list of global handler names for classic scripts (preview registry). */
  scriptExports?: string[]
  /** Bundle-time deps: other script assetIds (topological order). */
  scriptDependsOnAssetIds?: string[]
}
export type EditorNode = {
  id: string
  name: string
  description?: string
  authoringBounds?: AuthoringBoundsMetadata
  parentId: string | null
  position: Vec3
  rotation: Vec3
  scale: Vec3
  gltfDataUrl?: string
  assetRef?: string
  sourceAssetRef?: string
  sourceGltfNodeIndex?: number
  /** See `SceneNodeV2.sourcePlacementId`. */
  sourcePlacementId?: string
  visible?: boolean
  layerId?: string
  interactionAttachments?: InteractionScriptAttachment[]
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
  /** Empty virtual folders persisted under the asset catalog (Sketch `FolderItem` parity). */
  assetFolders?: string[]
  editorSettings?: EditorSettingsV2
}
