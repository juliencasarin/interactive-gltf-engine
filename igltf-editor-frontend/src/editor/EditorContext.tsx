import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  assetsWatchUrl,
  fetchDocument,
  isApiConfigured,
  putDocument,
  uploadAssetStage,
} from '@/api/projectApi'
import { buildInteractionScriptTemplate, type InteractionTemplateKind } from '@/scriptRuntime/interactionScriptTemplates'
import { normalizeFolderSegments, normalizeLogicalFolder } from './folderUtils'
import { readFileAsDataUrl, readFileAsText, interactionAttachmentsFromDiskNode, newAttachmentId, toProjectFileV2 } from './projectIo'
import type { EditorNode, InteractionScriptAttachment, PanelFocus, ProjectAssetEntry, ProjectFileV2, Vec3 } from './types'
import { inferAssetKindFromPath, isGltfAssetEntry } from './assetUtils'

function stripEphemeralScriptSources(assets: ProjectAssetEntry[]): ProjectAssetEntry[] {
  return assets.map((a) => {
    if (a.sourceText === undefined) return a
    const { sourceText: _st, ...rest } = a
    return rest
  })
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `n_${Math.random().toString(36).slice(2)}`
}

function defaultNodes(): EditorNode[] {
  return [
    {
      id: 'root',
      name: 'Scene',
      parentId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      layerId: 'scene',
    },
  ]
}

function baselineKey(
  nodes: EditorNode[],
  assets: ProjectAssetEntry[],
  assetFolders: string[],
): string {
  return JSON.stringify({ nodes, assets, assetFolders })
}

function wouldCycle(nodes: EditorNode[], nodeId: string, newParentId: string): boolean {
  if (nodeId === newParentId) return true
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur: string | null = newParentId
  while (cur) {
    if (cur === nodeId) return true
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/**
 * Moves a node next to siblings under `newParentId`.
 * Array order determines sibling order after save/load.
 * @param insertBeforeSiblingId — insert before this direct child of `newParentId`, or null to append after last sibling.
 */
function relocateSceneNodeAmongSiblings(
  prev: EditorNode[],
  nodeId: string,
  newParentId: string,
  insertBeforeSiblingId: string | null,
): EditorNode[] | null {
  if (nodeId === 'root') return null
  if (!prev.some((n) => n.id === nodeId)) return null
  if (!prev.some((n) => n.id === newParentId)) return null
  if (wouldCycle(prev, nodeId, newParentId)) return null
  if (insertBeforeSiblingId != null) {
    const cand = prev.find((n) => n.id === insertBeforeSiblingId)
    if (!cand || cand.parentId !== newParentId) return null
  }

  const movedBase = prev.find((n) => n.id === nodeId)!
  const moved: EditorNode = { ...movedBase, parentId: newParentId }
  const without = prev.filter((n) => n.id !== nodeId)

  const siblingEntries = without
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.parentId === newParentId)
    .sort((a, b) => a.i - b.i)

  let insertIdx: number
  if (insertBeforeSiblingId) {
    const found = siblingEntries.find((e) => e.n.id === insertBeforeSiblingId)
    if (!found) return null
    insertIdx = found.i
  } else if (!siblingEntries.length) {
    const pIx = without.findIndex((n) => n.id === newParentId)
    insertIdx = pIx >= 0 ? pIx + 1 : without.length
  } else {
    const last = siblingEntries[siblingEntries.length - 1]!
    insertIdx = last.i + 1
  }

  return [...without.slice(0, insertIdx), moved, ...without.slice(insertIdx)]
}

function minimizeSubtreeRoots(nodes: EditorNode[], ids: string[]): string[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    let p: string | null = nodes.find((n) => n.id === id)?.parentId ?? null
    while (p) {
      if (set.has(p)) return false
      p = nodes.find((n) => n.id === p)?.parentId ?? null
    }
    return true
  })
}

function docToEditorState(doc: ProjectFileV2): {
  nodes: EditorNode[]
  assets: ProjectAssetEntry[]
  assetFolders: string[]
} {
  const assetFoldersRaw = Array.isArray(doc.assetFolders) ? doc.assetFolders : []
  const assetFolders = [...new Set(assetFoldersRaw.map(normalizeLogicalFolder).filter(Boolean))].sort()

  const nodes: EditorNode[] = doc.scene.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    parentId: n.parentId,
    position: [...n.position] as Vec3,
    rotation: [...n.rotation] as Vec3,
    scale: [...n.scale] as Vec3,
    ...(n.assetRef ? { assetRef: n.assetRef } : {}),
    ...(n.visible === false ? { visible: false as const } : {}),
    ...(n.layerId ? { layerId: n.layerId } : {}),
    ...(() => {
      const att = interactionAttachmentsFromDiskNode(n as unknown as Record<string, unknown>)
      return att?.length ? { interactionAttachments: att } : {}
    })(),
  }))
  const assets: ProjectAssetEntry[] = doc.assets.map((a) => ({
    assetId: a.assetId,
    relativePath: a.relativePath,
    name: a.name,
    ...(a.logicalFolder ? { logicalFolder: normalizeLogicalFolder(a.logicalFolder) } : {}),
    ...(a.assetKind ? { assetKind: a.assetKind } : {}),
    ...(a.scriptRole ? { scriptRole: a.scriptRole } : {}),
    ...(a.interactionKind ? { interactionKind: a.interactionKind } : {}),
    ...(a.sourceText !== undefined ? { sourceText: a.sourceText } : {}),
    ...(a.scriptExports?.length ? { scriptExports: [...a.scriptExports] } : {}),
  }))
  return { nodes, assets, assetFolders }
}

export type SceneNodePlacementOptions = {
  parentId?: string
  worldPosition?: Vec3
}

/** Viewport transform tool (Sketcher `toolbar2` tools row). */
export type ViewportToolMode = 'select' | 'translate' | 'rotate' | 'scale'

/** Backend `watch` payloads for `channel: assets_disk` (debounced disk → ``project.json`` sync). */
type AssetsDiskWsPayload = {
  hello?: boolean
  events?: { type: string; assetId?: string; relativePath?: string }[]
  error?: string
}

export type AssetsDiskWatchStatus = 'idle' | 'connecting' | 'open' | 'error'

export type EditorContextValue = {
  projectId: string
  nodes: EditorNode[]
  projectAssets: ProjectAssetEntry[]
  /** Primary selection tail (inspector); full multi-select uses `selectedNodeIds`. */
  selectionId: string | null
  selectedNodeIds: string[]
  dirty: boolean
  viewportHover: boolean
  panelFocus: PanelFocus
  loadError: string | null
  isSaving: boolean
  /** Bumped after server sync to refresh resolved asset URLs. */
  assetFetchRev: number

  assetsDiskWatch: AssetsDiskWatchStatus

  hierarchySearch: string
  hierarchyCollapsed: Record<string, true>
  isolateSubtreeId: string | null
  activeLayerDisplay: string
  assetExplorerPath: string[]
  assetFoldersExplicit: string[]

  setSelectionId: (id: string | null) => void
  setSelectedNodeIds: (ids: string[]) => void
  setViewportHover: (v: boolean) => void
  setPanelFocus: (f: PanelFocus) => void
  setHierarchySearch: (q: string) => void
  toggleHierarchyCollapsed: (nodeId: string) => void
  setIsolateSubtreeId: (id: string | null) => void
  toggleIsolateForSelected: () => void
  clearIsolate: () => void
  setAssetExplorerPath: (segments: string[]) => void

  updateNode: (
    id: string,
    patch: Partial<
      Pick<
        EditorNode,
        | 'position'
        | 'rotation'
        | 'scale'
        | 'name'
        | 'visible'
        | 'layerId'
        | 'assetRef'
      >
    >,
  ) => void

  addInteractionAttachment: (nodeId: string, scriptAssetId: string) => void
  removeInteractionAttachment: (nodeId: string, attachmentId: string) => void
  updateInteractionAttachment: (
    nodeId: string,
    attachmentId: string,
    patch: Partial<Pick<InteractionScriptAttachment, 'scriptAssetRef' | 'serializedProps'>>,
  ) => void

  toggleNodeHierarchyVisible: (id: string) => void

  /** Reparent under `parentId`; order = last sibling (Unity child drop). */
  reparentSceneNode: (nodeId: string, newParentId: string) => void
  /** Reorder / reparent among siblings (`insertBefore` = direct child id under `parentId`, or null = append last). */
  placeSceneNodeInHierarchy: (
    nodeId: string,
    parentId: string,
    insertBeforeSiblingId: string | null,
  ) => void
  createEmptyChild: (parentId: string) => void
  duplicateSceneNode: (nodeId: string) => void
  deleteSceneSubtreesConfirm: (rootIds: string[]) => void
  /** Direct children IDs for multi-select parity (US-SK-034). */
  selectChildrenOf: (parentId: string) => void

  addGltfNodeLocal: (name: string, gltfDataUrl: string, parentId?: string) => string
  addGltfFromFile: (file: File) => Promise<void>
  addInteractionScriptAsset: (
    kind: InteractionTemplateKind,
    opts?: { logicalFolder?: string; baseName?: string },
  ) => Promise<string>
  addSceneNodeFromAsset: (assetId: string, opts?: SceneNodePlacementOptions) => void
  updateProjectAsset: (
    assetId: string,
    patch: Partial<
      Pick<
        ProjectAssetEntry,
        | 'name'
        | 'logicalFolder'
        | 'assetKind'
        | 'scriptRole'
        | 'interactionKind'
        | 'scriptExports'
        | 'sourceText'
        | 'relativePath'
      >
    >,
  ) => void
  moveAssetLogicalFolder: (assetId: string, folderSegments: string[]) => void
  /** Declared empty folders for catalog parity (serialized). */
  addExplicitAssetFolder: (folderPathSegments: string[]) => void
  removeExplicitAssetFolder: (folderPathNormalized: string) => void
  deleteProjectAssetsConfirm: (assetIds: string[]) => void
  /** Update script source without affecting undo history (typing in Monaco). */
  setProjectAssetSourceText: (assetId: string, text: string) => void
  replaceProjectState: (
    nodes: EditorNode[],
    assets: ProjectAssetEntry[],
    opts?: {
      selectionId?: string | null
      selectedNodeIds?: string[]
      assetFolders?: string[]
      assetExplorerPath?: string[]
      markClean?: boolean
    },
  ) => void
  saveProjectToServer: () => Promise<void>
  markSavedBaseline: () => void
  newProject: () => void
  resolveGltfUrl: (node: EditorNode) => string | null

  viewportToolMode: ViewportToolMode
  setViewportToolMode: (m: ViewportToolMode) => void
  /** Gizmo drag begin/end from the preview canvas (one undo step per drag). */
  setViewportTransformDragging: (dragging: boolean) => void
  undoDepth: number
  redoDepth: number
  canUndoVisual: boolean
  canRedoVisual: boolean
  undo: () => void
  redo: () => void
}

const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const v = useContext(EditorContext)
  if (!v) throw new Error('useEditor must be used inside EditorProvider')
  return v
}

function cloneNodes(nodes: EditorNode[]): EditorNode[] {
  return nodes.map((n) => ({
    ...n,
    ...(n.interactionAttachments?.length
      ? {
          interactionAttachments: n.interactionAttachments.map((a) => ({
            ...a,
            ...(a.serializedProps ? { serializedProps: { ...a.serializedProps } } : {}),
          })),
        }
      : {}),
  }))
}

function cloneAssets(a: ProjectAssetEntry[]): ProjectAssetEntry[] {
  return a.map((x) => ({ ...x }))
}

type HistorySnap = {
  nodes: EditorNode[]
  projectAssets: ProjectAssetEntry[]
  assetFoldersExplicit: string[]
}

function takeDocSnapshot(
  nodes: EditorNode[],
  assets: ProjectAssetEntry[],
  folders: string[],
): HistorySnap {
  return {
    nodes: cloneNodes(nodes),
    projectAssets: cloneAssets(assets),
    assetFoldersExplicit: [...folders],
  }
}

export function EditorProvider({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const [nodes, setNodes] = useState<EditorNode[]>(defaultNodes)
  const [projectAssets, setProjectAssets] = useState<ProjectAssetEntry[]>([])
  const [selectedNodeIds, setSelectedNodeIdsState] = useState<string[]>(['root'])

  const [dirty, setDirty] = useState(false)
  const [viewportHover, setViewportHover] = useState(false)
  const [panelFocus, setPanelFocus] = useState<PanelFocus>('viewport')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [assetFetchRev, setAssetFetchRev] = useState(0)
  const [assetsDiskWatch, setAssetsDiskWatch] = useState<AssetsDiskWatchStatus>('idle')

  const [hierarchySearch, setHierarchySearchState] = useState('')
  const [hierarchyCollapsed, setHierarchyCollapsed] = useState<Record<string, true>>({})
  const [isolateSubtreeId, setIsolateSubtreeIdState] = useState<string | null>(null)

  const [assetExplorerPath, setAssetExplorerPathState] = useState<string[]>([])
  const [assetFoldersExplicit, setAssetFoldersExplicit] = useState<string[]>([])

  const [viewportToolMode, setViewportToolModeState] = useState<ViewportToolMode>('translate')
  const [histCounts, setHistCounts] = useState({ undo: 0, redo: 0 })

  const baselineRef = useRef<string>(baselineKey(defaultNodes(), [], []))
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  /** Bump when server/local truth changes so a late GET /document must not overwrite newer state */
  const hydrateEpochRef = useRef(0)

  const undoStackRef = useRef<HistorySnap[]>([])
  const redoStackRef = useRef<HistorySnap[]>([])
  const historyApplyingRef = useRef(false)
  const viewportTransformDraggingRef = useRef(false)

  const nodesDocRef = useRef(nodes)
  const projectAssetsDocRef = useRef(projectAssets)
  const assetFoldersDocRef = useRef(assetFoldersExplicit)
  nodesDocRef.current = nodes
  projectAssetsDocRef.current = projectAssets
  assetFoldersDocRef.current = assetFoldersExplicit

  const syncHistoryCounts = useCallback(() => {
    setHistCounts({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
  }, [])

  const clearHistoryStacks = useCallback(() => {
    undoStackRef.current = []
    redoStackRef.current = []
    setHistCounts({ undo: 0, redo: 0 })
  }, [])

  const pushUndo = useCallback(() => {
    if (historyApplyingRef.current) return
    undoStackRef.current.push(
      takeDocSnapshot(nodesDocRef.current, projectAssetsDocRef.current, assetFoldersDocRef.current),
    )
    redoStackRef.current = []
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
    syncHistoryCounts()
  }, [syncHistoryCounts])

  const undo = useCallback(() => {
    if (historyApplyingRef.current) return
    if (undoStackRef.current.length === 0) return
    historyApplyingRef.current = true
    try {
      const prev = undoStackRef.current.pop()!
      redoStackRef.current.push(
        takeDocSnapshot(nodesDocRef.current, projectAssetsDocRef.current, assetFoldersDocRef.current),
      )
      setNodes(cloneNodes(prev.nodes))
      setProjectAssets(cloneAssets(prev.projectAssets))
      setAssetFoldersExplicit([...prev.assetFoldersExplicit])
      setSelectedNodeIdsState((cur) => {
        const valid = cur.filter((id) => prev.nodes.some((n) => n.id === id))
        if (valid.length) return valid
        const rootId = prev.nodes.find((n) => n.parentId === null)?.id
        return rootId ? [rootId] : []
      })
      setDirty(true)
    } finally {
      historyApplyingRef.current = false
      syncHistoryCounts()
    }
  }, [syncHistoryCounts])

  const redo = useCallback(() => {
    if (historyApplyingRef.current) return
    if (redoStackRef.current.length === 0) return
    historyApplyingRef.current = true
    try {
      const next = redoStackRef.current.pop()!
      undoStackRef.current.push(
        takeDocSnapshot(nodesDocRef.current, projectAssetsDocRef.current, assetFoldersDocRef.current),
      )
      setNodes(cloneNodes(next.nodes))
      setProjectAssets(cloneAssets(next.projectAssets))
      setAssetFoldersExplicit([...next.assetFoldersExplicit])
      setSelectedNodeIdsState((cur) => {
        const valid = cur.filter((id) => next.nodes.some((n) => n.id === id))
        if (valid.length) return valid
        const rootId = next.nodes.find((n) => n.parentId === null)?.id
        return rootId ? [rootId] : []
      })
      setDirty(true)
    } finally {
      historyApplyingRef.current = false
      syncHistoryCounts()
    }
  }, [syncHistoryCounts])

  const setViewportTransformDragging = useCallback(
    (dragging: boolean) => {
      if (dragging) {
        if (!viewportTransformDraggingRef.current) pushUndo()
        viewportTransformDraggingRef.current = true
      } else {
        viewportTransformDraggingRef.current = false
      }
    },
    [pushUndo],
  )

  const setViewportToolMode = useCallback((m: ViewportToolMode) => {
    viewportTransformDraggingRef.current = false
    setViewportToolModeState(m)
  }, [])

  const selectionId =
    selectedNodeIds.length === 0 ? null : selectedNodeIds[selectedNodeIds.length - 1]!

  const setSelectionIdWrapped = useCallback((id: string | null) => {
    setSelectedNodeIdsState(id ? [id] : [])
  }, [])

  const setSelectedNodeIds = useCallback((ids: string[]) => {
    setSelectedNodeIdsState(ids.filter(Boolean))
  }, [])

  const setHierarchySearch = useCallback((q: string) => {
    setHierarchySearchState(q)
  }, [])

  const toggleHierarchyCollapsed = useCallback((nodeId: string) => {
    setHierarchyCollapsed((prev) => {
      const next = { ...prev }
      if (next[nodeId]) delete next[nodeId]
      else next[nodeId] = true
      return next
    })
  }, [])

  const clearIsolate = useCallback(() => {
    setIsolateSubtreeIdState(null)
  }, [])

  const toggleIsolateForSelected = useCallback(() => {
    const sid = selectionId
    if (!sid) return
    setIsolateSubtreeIdState((prev) => (prev === sid ? null : sid))
  }, [selectionId])

  const persistSnapshotToServer = useCallback(
    async (
      snapNodes: EditorNode[],
      snapAssets: ProjectAssetEntry[],
      snapFolders: string[],
    ) => {
      if (!isApiConfigured()) throw new Error('API not configured (set VITE_API_BASE_URL)')
      const bad = snapNodes.filter((n) => Boolean(n.gltfDataUrl) && !n.assetRef)
      if (bad.length)
        throw new Error(
          'Cannot save to server: some models use local inline glTF only. Re-import via Import glTF… with the API running.',
        )
      const pid = projectIdRef.current
      const doc = toProjectFileV2(snapNodes, stripEphemeralScriptSources(snapAssets), snapFolders)
      const normalized = await putDocument(pid, doc)
      const { nodes: nn, assets: na, assetFolders: nf } = docToEditorState(normalized)
      setNodes(nn)
      setProjectAssets(na)
      setAssetFoldersExplicit(nf)
      setAssetFetchRev((r) => r + 1)
      baselineRef.current = baselineKey(nn, na, nf)
      setDirty(false)
      hydrateEpochRef.current += 1
    },
    [],
  )

  useEffect(() => {
    clearHistoryStacks()
    setViewportToolMode('translate')
    setLoadError(null)
    setNodes(defaultNodes())
    setProjectAssets([])
    setSelectedNodeIdsState(['root'])
    setDirty(false)
    setHierarchySearchState('')
    setHierarchyCollapsed({})
    setIsolateSubtreeIdState(null)
    setAssetExplorerPathState([])
    setAssetFoldersExplicit([])
    baselineRef.current = baselineKey(defaultNodes(), [], [])

    if (!isApiConfigured()) return

    let cancelled = false
    const hydrateGeneration = hydrateEpochRef.current
    ;(async () => {
      try {
        const doc = await fetchDocument(projectId)
        if (cancelled) return
        if (hydrateGeneration !== hydrateEpochRef.current) return
        if (doc && doc.version === 2) {
          const { nodes: nextNodes, assets: nextAssets, assetFolders: nf } = docToEditorState(doc)
          setNodes(nextNodes)
          setProjectAssets(nextAssets)
          setAssetFoldersExplicit(nf)
          const rootId = nextNodes.find((n) => n.parentId === null)?.id ?? null
          setSelectedNodeIdsState(rootId ? [rootId] : [])
          baselineRef.current = baselineKey(nextNodes, nextAssets, nf)
          setDirty(false)
          setAssetFetchRev((r) => r + 1)
        }
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, clearHistoryStacks, setViewportToolMode])

  useEffect(() => {
    if (!isApiConfigured()) {
      setAssetsDiskWatch('idle')
      return
    }

    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const refreshFromServer = async () => {
      hydrateEpochRef.current += 1
      const gen = hydrateEpochRef.current
      try {
        const doc = await fetchDocument(projectIdRef.current)
        if (cancelled || gen !== hydrateEpochRef.current) return
        if (doc && doc.version === 2) {
          const { nodes: nn, assets: na, assetFolders: nf } = docToEditorState(doc)
          setNodes(nn)
          setProjectAssets(na)
          setAssetFoldersExplicit(nf)
          baselineRef.current = baselineKey(nn, na, nf)
          setDirty(false)
          clearHistoryStacks()
          setAssetFetchRev((r) => r + 1)
        }
      } catch {
        /* transient */
      }
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      attempt += 1
      const ms = Math.min(15_000, 1000 * Math.min(64, Math.pow(2, Math.min(attempt, 6))))
      retryTimer = globalThis.setTimeout(connect, ms)
    }

    const connect = () => {
      if (cancelled) return
      const url = assetsWatchUrl(projectIdRef.current)
      if (!url) {
        setAssetsDiskWatch('idle')
        return
      }
      setAssetsDiskWatch('connecting')
      ws = new WebSocket(url)

      ws.onopen = () => {
        attempt = 0
        setAssetsDiskWatch('open')
      }
      ws.onerror = () => {
        setAssetsDiskWatch((s) => (s === 'connecting' ? 'error' : s))
      }
      ws.onclose = () => {
        if (cancelled) return
        setAssetsDiskWatch((s) => (s === 'open' ? 'error' : 'connecting'))
        scheduleReconnect()
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { channel?: string; payload?: AssetsDiskWsPayload }
          if (msg.channel !== 'assets_disk' || !msg.payload) return
          if (msg.payload.error) {
            setAssetsDiskWatch('error')
            return
          }
          if (msg.payload.hello) {
            const evs = msg.payload.events
            if (!Array.isArray(evs) || evs.length === 0) return
            void refreshFromServer()
            return
          }
          void refreshFromServer()
        } catch {
          /* ignore */
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
      setAssetsDiskWatch('idle')
    }
  }, [projectId, clearHistoryStacks])

  const updateNode = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          EditorNode,
          | 'position'
          | 'rotation'
          | 'scale'
          | 'name'
          | 'visible'
          | 'layerId'
          | 'assetRef'
        >
      >,
    ) => {
      if (!historyApplyingRef.current && !viewportTransformDraggingRef.current) {
        pushUndo()
      }
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
      setDirty(true)
    },
    [pushUndo],
  )

  const addInteractionAttachment = useCallback(
    (nodeId: string, scriptAssetId: string) => {
      pushUndo()
      const att: InteractionScriptAttachment = { id: newAttachmentId(), scriptAssetRef: scriptAssetId }
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n
          const list = [...(n.interactionAttachments ?? []), att]
          return { ...n, interactionAttachments: list }
        }),
      )
      setDirty(true)
    },
    [pushUndo],
  )

  const removeInteractionAttachment = useCallback(
    (nodeId: string, attachmentId: string) => {
      pushUndo()
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n
          const list = (n.interactionAttachments ?? []).filter((a) => a.id !== attachmentId)
          return { ...n, interactionAttachments: list.length ? list : undefined }
        }),
      )
      setDirty(true)
    },
    [pushUndo],
  )

  const updateInteractionAttachment = useCallback(
    (
      nodeId: string,
      attachmentId: string,
      patch: Partial<
        Pick<InteractionScriptAttachment, 'scriptAssetRef' | 'serializedProps'>
      >,
    ) => {
      pushUndo()
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n
          const list = (n.interactionAttachments ?? []).map((a) =>
            a.id === attachmentId ? { ...a, ...patch } : a,
          )
          return { ...n, interactionAttachments: list.length ? list : undefined }
        }),
      )
      setDirty(true)
    },
    [pushUndo],
  )

  const toggleNodeHierarchyVisible = useCallback((id: string) => {
    if (id === 'root') return
    pushUndo()
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n
        const hidden = n.visible === false
        return hidden ? { ...n, visible: undefined } : { ...n, visible: false }
      }),
    )
    setDirty(true)
  }, [pushUndo])

  const placeSceneNodeInHierarchy = useCallback(
    (nodeId: string, parentId: string, insertBeforeSiblingId: string | null) => {
      pushUndo()
      setNodes((prev) => relocateSceneNodeAmongSiblings(prev, nodeId, parentId, insertBeforeSiblingId) ?? prev)
      setDirty(true)
    },
    [pushUndo],
  )

  const reparentSceneNode = useCallback(
    (nodeId: string, newParentId: string) => {
      placeSceneNodeInHierarchy(nodeId, newParentId, null)
    },
    [placeSceneNodeInHierarchy],
  )

  const createEmptyChild = useCallback((parentId: string) => {
    pushUndo()
    const id = uid()
    const node: EditorNode = {
      id,
      name: 'Empty',
      parentId: parentId,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }
    setNodes((prev) => [...prev, node])
    setSelectedNodeIdsState([id])
    setHierarchyCollapsed((prev) => {
      const next = { ...prev }
      delete next[parentId]
      return next
    })
    setDirty(true)
  }, [pushUndo])

  const duplicateSceneNode = useCallback((nodeId: string) => {
    if (nodeId === 'root') return
    const src = nodes.find((n) => n.id === nodeId)
    if (!src) return
    pushUndo()
    const nid = uid()
    const dup: EditorNode = {
      id: nid,
      name: `${src.name} Copy`,
      parentId: src.parentId,
      position: [...src.position],
      rotation: [...src.rotation],
      scale: [...src.scale],
      ...(src.visible === false ? { visible: false as const } : {}),
      ...(src.layerId ? { layerId: src.layerId } : {}),
      ...(src.assetRef ? { assetRef: src.assetRef } : {}),
      ...(src.gltfDataUrl ? { gltfDataUrl: src.gltfDataUrl } : {}),
      ...(src.interactionAttachments?.length
        ? {
            interactionAttachments: src.interactionAttachments.map((a) => ({
              ...a,
              id: newAttachmentId(),
              ...(a.serializedProps ? { serializedProps: { ...a.serializedProps } } : {}),
            })),
          }
        : {}),
    }
    setNodes((prev) => [...prev, dup])
    setSelectedNodeIdsState([nid])
    setDirty(true)
  }, [nodes, pushUndo])

  const deleteSceneSubtreesConfirm = useCallback((rootIds: string[]) => {
    const uniq = [...new Set(rootIds)].filter((id) => id !== 'root')
    if (!uniq.length) return
    const minimized = minimizeSubtreeRoots(nodes, uniq)
    if (
      !window.confirm(
        `Delete ${minimized.length} object(s) and their children from the hierarchy?`,
      )
    )
      return
    pushUndo()
    const remove = new Set<string>()
    for (const rid of minimized) {
      const stack = [rid]
      while (stack.length) {
        const id = stack.pop()!
        remove.add(id)
        for (const c of nodes.filter((n) => n.parentId === id)) stack.push(c.id)
      }
    }
    const nextNodes = nodes.filter((n) => !remove.has(n.id))
    setNodes(nextNodes)
    setIsolateSubtreeIdState((prev) => (prev && remove.has(prev) ? null : prev))
    setSelectedNodeIdsState((cur) => {
      const surviving = cur.filter((id) => !remove.has(id))
      const rootId = nextNodes.find((n) => n.parentId === null)?.id ?? null
      if (surviving.length) return surviving.filter((id) => nextNodes.some((n) => n.id === id))
      return rootId ? [rootId] : []
    })
    setDirty(true)
  }, [nodes, pushUndo])

  const selectChildrenOf = useCallback(
    (parentId: string) => {
      const children = nodes.filter((n) => n.parentId === parentId).map((c) => c.id)
      if (!children.length) return
      setSelectedNodeIdsState(children)
    },
    [nodes],
  )

  const detachAssetRefsForDeletedAssets = useCallback((assetIds: Set<string>) => {
    setNodes((prev) =>
      prev.map((n) => {
        let next: EditorNode = n
        if (n.assetRef && assetIds.has(n.assetRef)) next = { ...next, assetRef: undefined }
        const atts = n.interactionAttachments?.filter((a) => !assetIds.has(a.scriptAssetRef))
        if (atts && atts.length !== (n.interactionAttachments?.length ?? 0)) {
          next = { ...next, interactionAttachments: atts.length ? atts : undefined }
        }
        return next
      }),
    )
    setDirty(true)
  }, [])

  const addGltfNodeLocal = useCallback((name: string, gltfDataUrl: string, parentId?: string) => {
    const id = uid()
    const rootId = nodes.find((n) => n.parentId === null)?.id ?? 'root'
    const pid = parentId ?? rootId
    const node: EditorNode = {
      id,
      name: name.replace(/\.(glb|gltf)$/i, '') || 'Model',
      parentId: pid,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      gltfDataUrl,
    }
    setNodes((prev) => [...prev, node])
    setSelectedNodeIdsState([id])
    setHierarchyCollapsed((h) => {
      const nh = { ...h }
      delete nh[pid]
      return nh
    })
    setDirty(true)
    return id
  }, [nodes])

  const addGltfFromFile = useCallback(
    async (file: File) => {
      pushUndo()
      const pid = projectIdRef.current
      const folderLogical = normalizeFolderSegments(assetExplorerPath)
      const lower = (file.name || '').toLowerCase()
      const isScript =
        lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')

      if (isApiConfigured()) {
        const up = await uploadAssetStage(pid, file)
        const pathKind = inferAssetKindFromPath(up.relativePath)
        const entry: ProjectAssetEntry = {
          assetId: up.assetId,
          relativePath: up.relativePath,
          name: file.name,
          ...(pathKind === 'script'
            ? { assetKind: 'script' as const, scriptRole: 'interaction' as const }
            : { assetKind: 'gltf' as const }),
          ...(folderLogical ? { logicalFolder: folderLogical } : {}),
        }
        const nextAssets = projectAssets.some((p) => p.assetId === entry.assetId)
          ? projectAssets
          : [...projectAssets, entry]

        setProjectAssets(nextAssets)

        setIsSaving(true)
        try {
          await persistSnapshotToServer(nodes, nextAssets, assetFoldersExplicit)
        } catch (e) {
          setDirty(true)
          throw e
        } finally {
          setIsSaving(false)
        }
        return
      }

      if (isScript) {
        const text = await readFileAsText(file)
        const id = uid()
        const ext = lower.endsWith('.mjs') ? '.mjs' : lower.endsWith('.cjs') ? '.cjs' : '.js'
        const entry: ProjectAssetEntry = {
          assetId: id,
          relativePath: `_virtual/${id}${ext}`,
          name: file.name,
          assetKind: 'script',
          scriptRole: 'interaction',
          sourceText: text,
          ...(folderLogical ? { logicalFolder: folderLogical } : {}),
        }
        setProjectAssets((prev) => [...prev, entry])
        setDirty(true)
        return
      }

      const dataUrl = await readFileAsDataUrl(file)
      addGltfNodeLocal(file.name || 'model', dataUrl)
    },
    [
      pushUndo,
      assetExplorerPath,
      addGltfNodeLocal,
      nodes,
      projectAssets,
      persistSnapshotToServer,
      assetFoldersExplicit,
    ],
  )

  const addInteractionScriptAsset = useCallback(
    async (kind: InteractionTemplateKind, opts?: { logicalFolder?: string; baseName?: string }) => {
      pushUndo()
      const pid = projectIdRef.current
      const folderLogical =
        opts?.logicalFolder !== undefined
          ? normalizeLogicalFolder(opts.logicalFolder)
          : normalizeFolderSegments(assetExplorerPath)
      const built = buildInteractionScriptTemplate(kind, { baseName: opts?.baseName })

      if (isApiConfigured()) {
        const blob = new Blob([built.source], { type: 'text/javascript' })
        const file = new File([blob], built.fileName, { type: 'text/javascript' })
        const up = await uploadAssetStage(pid, file)
        const entry: ProjectAssetEntry = {
          assetId: up.assetId,
          relativePath: up.relativePath,
          name: built.fileName,
          assetKind: 'script',
          scriptRole: 'interaction',
          interactionKind: kind,
          scriptExports: [built.className],
          ...(folderLogical ? { logicalFolder: folderLogical } : {}),
        }
        const nextAssets = projectAssets.some((p) => p.assetId === entry.assetId)
          ? projectAssets
          : [...projectAssets, entry]

        setProjectAssets(nextAssets)

        setIsSaving(true)
        try {
          await persistSnapshotToServer(nodes, nextAssets, assetFoldersExplicit)
        } catch (e) {
          setDirty(true)
          throw e
        } finally {
          setIsSaving(false)
        }
        return entry.assetId
      }

      const id = uid()
      const entry: ProjectAssetEntry = {
        assetId: id,
        relativePath: `_virtual/${id}.js`,
        name: built.fileName,
        assetKind: 'script',
        scriptRole: 'interaction',
        interactionKind: kind,
        sourceText: built.source,
        scriptExports: [built.className],
        ...(folderLogical ? { logicalFolder: folderLogical } : {}),
      }
      setProjectAssets((prev) => [...prev, entry])
      setDirty(true)
      return entry.assetId
    },
    [pushUndo, assetExplorerPath, projectAssets, nodes, persistSnapshotToServer, assetFoldersExplicit],
  )

  /** Note: avoids stale explorer path in closures by passing latest via ref-less closure each render */

  const addSceneNodeFromAsset = useCallback(
    (assetId: string, opts?: SceneNodePlacementOptions) => {
      const entry = projectAssets.find((a) => a.assetId === assetId)
      if (!entry || !isGltfAssetEntry(entry)) return
      pushUndo()
      const rootRef = nodes.find((n) => n.parentId === null)?.id ?? 'root'
      const parentId = opts?.parentId ?? rootRef

      const id = uid()
      const stem =
        (entry.name && entry.name.replace(/\.(glb|gltf)$/i, '')) ||
        entry.relativePath.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ||
        'Model'
      const pos: Vec3 = opts?.worldPosition
        ? ([...opts.worldPosition] as Vec3)
        : ([0, 0, 0] as Vec3)
      const node: EditorNode = {
        id,
        name: stem || 'Model',
        parentId,
        position: pos,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        assetRef: assetId,
      }
      setNodes((prev) => [...prev, node])
      setSelectedNodeIdsState([id])
      setHierarchyCollapsed((h) => {
        const nh = { ...h }
        delete nh[parentId]
        return nh
      })
      setDirty(true)
    },
    [projectAssets, nodes, pushUndo],
  )

  const updateProjectAsset = useCallback(
    (
      assetId: string,
      patch: Partial<
        Pick<
          ProjectAssetEntry,
          | 'name'
          | 'logicalFolder'
          | 'assetKind'
          | 'scriptRole'
          | 'interactionKind'
          | 'scriptExports'
          | 'sourceText'
          | 'relativePath'
        >
      >,
    ) => {
      pushUndo()
      const norm =
        patch.logicalFolder !== undefined
          ? { ...patch, logicalFolder: normalizeLogicalFolder(patch.logicalFolder) || undefined }
          : patch
      setProjectAssets((prev) =>
        prev.map((a) => (a.assetId === assetId ? { ...a, ...norm } : a)),
      )
      setDirty(true)
    },
    [pushUndo],
  )

  const moveAssetLogicalFolder = useCallback((assetId: string, folderSegments: string[]) => {
    const folder = normalizeFolderSegments(folderSegments)
    updateProjectAsset(assetId, folder ? { logicalFolder: folder } : { logicalFolder: undefined })
  }, [updateProjectAsset])

  const addExplicitAssetFolder = useCallback(
    (folderPathSegments: string[]) => {
      const p = normalizeFolderSegments(folderPathSegments)
      if (!p) return
      pushUndo()
      setAssetFoldersExplicit((prev) => [...new Set([...prev, p])].sort())
      setDirty(true)
    },
    [pushUndo],
  )

  const removeExplicitAssetFolder = useCallback((folderPathNormalized: string) => {
    const p = normalizeLogicalFolder(folderPathNormalized)
    if (!p) return
    pushUndo()
    setAssetFoldersExplicit((prev) => prev.filter((x) => x !== p))
    setDirty(true)
  }, [pushUndo])

  const setProjectAssetSourceText = useCallback((assetId: string, text: string) => {
    setProjectAssets((prev) =>
      prev.map((a) => (a.assetId === assetId ? { ...a, sourceText: text } : a)),
    )
    setDirty(true)
  }, [])

  const deleteProjectAssetsConfirm = useCallback(
    (assetIds: string[]) => {
      const uniq = [...new Set(assetIds)]
      if (!uniq.length) return

      const used = nodes.filter((n) => n.assetRef && uniq.includes(n.assetRef))
      if (
        used.length &&
        !window.confirm(
          `${used.length} scene object(s) still reference these asset(s). Remove references before deletion?`,
        )
      )
        return

      if (
        !window.confirm(`Remove ${uniq.length} asset(s) from the project catalog on next save/export?`)
      )
        return

      pushUndo()
      const removeSet = new Set(uniq)
      detachAssetRefsForDeletedAssets(removeSet)
      setProjectAssets((prev) => prev.filter((a) => !removeSet.has(a.assetId)))
      setDirty(true)
    },
    [nodes, detachAssetRefsForDeletedAssets, pushUndo],
  )

  const setExplorerPathSegments = useCallback((segments: string[]) => {
    setAssetExplorerPathState(segments.map((s) => s.trim()).filter(Boolean))
  }, [])

  const replaceProjectState = useCallback(
    (
      nextNodes: EditorNode[],
      nextAssets: ProjectAssetEntry[],
      opts?: {
        selectionId?: string | null
        selectedNodeIds?: string[]
        assetFolders?: string[]
        assetExplorerPath?: string[]
        markClean?: boolean
      },
    ) => {
      if (!historyApplyingRef.current) clearHistoryStacks()
      setNodes(cloneNodes(nextNodes))
      setProjectAssets(cloneAssets(nextAssets))

      let foldersAfterReplace = assetFoldersExplicit
      if (opts?.assetFolders !== undefined) {
        foldersAfterReplace = [...new Set(opts.assetFolders.map(normalizeLogicalFolder).filter(Boolean))].sort()
        setAssetFoldersExplicit(foldersAfterReplace)
      }
      if (opts?.assetExplorerPath !== undefined)
        setAssetExplorerPathState([...opts.assetExplorerPath])

      const rootId = nextNodes.find((n) => n.parentId === null)?.id ?? null
      if (opts?.selectedNodeIds !== undefined) setSelectedNodeIdsState(opts.selectedNodeIds)
      else if (opts?.selectionId !== undefined)
        setSelectedNodeIdsState(opts.selectionId ? [opts.selectionId] : [])
      else if (rootId) setSelectedNodeIdsState([rootId])
      else setSelectedNodeIdsState(nextNodes[0]?.id ? [nextNodes[0].id] : [])

      if (opts?.markClean) {
        hydrateEpochRef.current += 1
        baselineRef.current = baselineKey(nextNodes, nextAssets, foldersAfterReplace)
        setDirty(false)
        if (isApiConfigured()) setAssetFetchRev((r) => r + 1)
      } else {
        setDirty(true)
      }
    },
    [assetFoldersExplicit, clearHistoryStacks],
  )

  const markSavedBaseline = useCallback(() => {
    baselineRef.current = baselineKey(nodes, projectAssets, assetFoldersExplicit)
    setDirty(false)
  }, [nodes, projectAssets, assetFoldersExplicit])

  const saveProjectToServer = useCallback(async () => {
    setIsSaving(true)
    try {
      await persistSnapshotToServer(nodes, projectAssets, assetFoldersExplicit)
    } finally {
      setIsSaving(false)
    }
  }, [nodes, projectAssets, assetFoldersExplicit, persistSnapshotToServer])

  const newProject = useCallback(() => {
    hydrateEpochRef.current += 1
    clearHistoryStacks()
    const fresh = defaultNodes()
    baselineRef.current = baselineKey(fresh, [], [])
    setNodes(fresh)
    setProjectAssets([])
    setSelectedNodeIdsState(['root'])
    setHierarchySearchState('')
    setHierarchyCollapsed({})
    setIsolateSubtreeIdState(null)
    setAssetExplorerPathState([])
    setAssetFoldersExplicit([])
    setDirty(false)
  }, [clearHistoryStacks])

  const resolveGltfUrl = useCallback(
    (node: EditorNode): string | null => {
      if (node.gltfDataUrl) return node.gltfDataUrl
      if (!node.assetRef) return null
      const base = import.meta.env.VITE_API_BASE_URL
        ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, '')
        : ''
      if (!base) return null
      const entry = projectAssets.find((a) => a.assetId === node.assetRef)
      if (!entry) return null
      const rel = entry.relativePath.split('/').map(encodeURIComponent).join('/')
      return `${base}/files/${encodeURIComponent(projectId)}/${rel}?v=${assetFetchRev}`
    },
    [projectId, projectAssets, assetFetchRev],
  )

  const activeLayerDisplay = 'Scene'

  const value = useMemo<EditorContextValue>(
    () => ({
      projectId,
      nodes,
      projectAssets,
      selectionId,
      selectedNodeIds,
      dirty,
      viewportHover,
      panelFocus,
      loadError,
      isSaving,
      assetFetchRev,
      assetsDiskWatch,

      hierarchySearch,
      hierarchyCollapsed,
      isolateSubtreeId,
      activeLayerDisplay,
      assetExplorerPath,
      assetFoldersExplicit,

      setSelectionId: setSelectionIdWrapped,
      setSelectedNodeIds,
      setViewportHover,
      setPanelFocus,
      setHierarchySearch,
      toggleHierarchyCollapsed,
      setIsolateSubtreeId: setIsolateSubtreeIdState,
      toggleIsolateForSelected,
      clearIsolate,
      setAssetExplorerPath: setExplorerPathSegments,

      updateNode,
      addInteractionAttachment,
      removeInteractionAttachment,
      updateInteractionAttachment,
      toggleNodeHierarchyVisible,
      reparentSceneNode,
      placeSceneNodeInHierarchy,
      createEmptyChild,
      duplicateSceneNode,
      deleteSceneSubtreesConfirm,
      selectChildrenOf,

      addGltfNodeLocal,
      addGltfFromFile,
      addInteractionScriptAsset,
      addSceneNodeFromAsset,
      updateProjectAsset,
      moveAssetLogicalFolder,
      addExplicitAssetFolder,
      removeExplicitAssetFolder,
      deleteProjectAssetsConfirm,

      setProjectAssetSourceText,
      replaceProjectState,
      saveProjectToServer,
      markSavedBaseline,
      newProject,
      resolveGltfUrl,

      viewportToolMode,
      setViewportToolMode,
      setViewportTransformDragging,
      undoDepth: histCounts.undo,
      redoDepth: histCounts.redo,
      canUndoVisual: histCounts.undo > 0,
      canRedoVisual: histCounts.redo > 0,
      undo,
      redo,
    }),
    [
      projectId,
      nodes,
      projectAssets,
      selectionId,
      selectedNodeIds,
      dirty,
      viewportHover,
      panelFocus,
      loadError,
      isSaving,
      assetFetchRev,
      assetsDiskWatch,
      hierarchySearch,
      hierarchyCollapsed,
      isolateSubtreeId,
      assetExplorerPath,
      assetFoldersExplicit,
      setSelectionIdWrapped,
      setSelectedNodeIds,
      toggleHierarchyCollapsed,
      toggleIsolateForSelected,
      clearIsolate,
      setExplorerPathSegments,
      updateNode,
      addInteractionAttachment,
      removeInteractionAttachment,
      updateInteractionAttachment,
      toggleNodeHierarchyVisible,
      reparentSceneNode,
      placeSceneNodeInHierarchy,
      createEmptyChild,
      duplicateSceneNode,
      deleteSceneSubtreesConfirm,
      selectChildrenOf,
      addGltfNodeLocal,
      addGltfFromFile,
      addInteractionScriptAsset,
      addSceneNodeFromAsset,
      updateProjectAsset,
      moveAssetLogicalFolder,
      addExplicitAssetFolder,
      removeExplicitAssetFolder,
      deleteProjectAssetsConfirm,
      setProjectAssetSourceText,
      replaceProjectState,
      saveProjectToServer,
      markSavedBaseline,
      newProject,
      resolveGltfUrl,
      setHierarchySearch,
      viewportToolMode,
      histCounts,
      undo,
      redo,
      setViewportToolMode,
      setViewportTransformDragging,
    ],
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

export function vec3ToEulerDegrees(rad: Vec3): Vec3 {
  return rad.map((x) => (x * 180) / Math.PI) as Vec3
}

export function eulerDegreesToRad(deg: Vec3): Vec3 {
  return deg.map((d) => (d * Math.PI) / 180) as Vec3
}
