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
import { fetchDocument, isApiConfigured, putDocument, uploadAssetStage } from '@/api/projectApi'
import { normalizeFolderSegments, normalizeLogicalFolder } from './folderUtils'
import { readFileAsDataUrl, toProjectFileV2 } from './projectIo'
import type { EditorNode, PanelFocus, ProjectAssetEntry, ProjectFileV2, Vec3 } from './types'

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
  }))
  const assets: ProjectAssetEntry[] = doc.assets.map((a) => ({
    assetId: a.assetId,
    relativePath: a.relativePath,
    name: a.name,
    ...(a.logicalFolder ? { logicalFolder: normalizeLogicalFolder(a.logicalFolder) } : {}),
  }))
  return { nodes, assets, assetFolders }
}

export type SceneNodePlacementOptions = {
  parentId?: string
  worldPosition?: Vec3
}

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
      Pick<EditorNode, 'position' | 'rotation' | 'scale' | 'name' | 'visible' | 'layerId' | 'assetRef'>
    >,
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
  addSceneNodeFromAsset: (assetId: string, opts?: SceneNodePlacementOptions) => void
  updateProjectAsset: (assetId: string, patch: Partial<Pick<ProjectAssetEntry, 'name' | 'logicalFolder'>>) => void
  moveAssetLogicalFolder: (assetId: string, folderSegments: string[]) => void
  /** Declared empty folders for catalog parity (serialized). */
  addExplicitAssetFolder: (folderPathSegments: string[]) => void
  removeExplicitAssetFolder: (folderPathNormalized: string) => void
  deleteProjectAssetsConfirm: (assetIds: string[]) => void
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
}

const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const v = useContext(EditorContext)
  if (!v) throw new Error('useEditor must be used inside EditorProvider')
  return v
}

function cloneNodes(nodes: EditorNode[]): EditorNode[] {
  return nodes.map((n) => ({ ...n }))
}

function cloneAssets(a: ProjectAssetEntry[]): ProjectAssetEntry[] {
  return a.map((x) => ({ ...x }))
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

  const [hierarchySearch, setHierarchySearchState] = useState('')
  const [hierarchyCollapsed, setHierarchyCollapsed] = useState<Record<string, true>>({})
  const [isolateSubtreeId, setIsolateSubtreeIdState] = useState<string | null>(null)

  const [assetExplorerPath, setAssetExplorerPathState] = useState<string[]>([])
  const [assetFoldersExplicit, setAssetFoldersExplicit] = useState<string[]>([])

  const baselineRef = useRef<string>(baselineKey(defaultNodes(), [], []))
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  /** Bump when server/local truth changes so a late GET /document must not overwrite newer state */
  const hydrateEpochRef = useRef(0)

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
      const doc = toProjectFileV2(snapNodes, snapAssets, snapFolders)
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
  }, [projectId])

  const updateNode = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<EditorNode, 'position' | 'rotation' | 'scale' | 'name' | 'visible' | 'layerId' | 'assetRef'>
      >,
    ) => {
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
      setDirty(true)
    },
    [],
  )

  const toggleNodeHierarchyVisible = useCallback((id: string) => {
    if (id === 'root') return
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n
        const hidden = n.visible === false
        return hidden ? { ...n, visible: undefined } : { ...n, visible: false }
      }),
    )
    setDirty(true)
  }, [])

  const placeSceneNodeInHierarchy = useCallback(
    (nodeId: string, parentId: string, insertBeforeSiblingId: string | null) => {
      setNodes((prev) => relocateSceneNodeAmongSiblings(prev, nodeId, parentId, insertBeforeSiblingId) ?? prev)
      setDirty(true)
    },
    [],
  )

  const reparentSceneNode = useCallback(
    (nodeId: string, newParentId: string) => {
      placeSceneNodeInHierarchy(nodeId, newParentId, null)
    },
    [placeSceneNodeInHierarchy],
  )

  const createEmptyChild = useCallback((parentId: string) => {
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
  }, [])

  const duplicateSceneNode = useCallback((nodeId: string) => {
    if (nodeId === 'root') return
    const src = nodes.find((n) => n.id === nodeId)
    if (!src) return
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
    }
    setNodes((prev) => [...prev, dup])
    setSelectedNodeIdsState([nid])
    setDirty(true)
  }, [nodes])

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
  }, [nodes])

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
      prev.map((n) => (n.assetRef && assetIds.has(n.assetRef) ? { ...n, assetRef: undefined } : n)),
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
      const pid = projectIdRef.current
      const folderLogical = normalizeFolderSegments(assetExplorerPath)
      if (isApiConfigured()) {
        const up = await uploadAssetStage(pid, file)
        const entry: ProjectAssetEntry = {
          assetId: up.assetId,
          relativePath: up.relativePath,
          name: file.name,
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
      const dataUrl = await readFileAsDataUrl(file)
      addGltfNodeLocal(file.name || 'model', dataUrl)
    },
    [
      assetExplorerPath,
      addGltfNodeLocal,
      nodes,
      projectAssets,
      persistSnapshotToServer,
      assetFoldersExplicit,
    ],
  )

  /** Note: avoids stale explorer path in closures by passing latest via ref-less closure each render */

  const addSceneNodeFromAsset = useCallback(
    (assetId: string, opts?: SceneNodePlacementOptions) => {
      const entry = projectAssets.find((a) => a.assetId === assetId)
      if (!entry) return
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
    [projectAssets, nodes],
  )

  const updateProjectAsset = useCallback(
    (assetId: string, patch: Partial<Pick<ProjectAssetEntry, 'name' | 'logicalFolder'>>) => {
      const norm =
        patch.logicalFolder !== undefined
          ? { ...patch, logicalFolder: normalizeLogicalFolder(patch.logicalFolder) || undefined }
          : patch
      setProjectAssets((prev) =>
        prev.map((a) => (a.assetId === assetId ? { ...a, ...norm } : a)),
      )
      setDirty(true)
    },
    [],
  )

  const moveAssetLogicalFolder = useCallback((assetId: string, folderSegments: string[]) => {
    const folder = normalizeFolderSegments(folderSegments)
    updateProjectAsset(assetId, folder ? { logicalFolder: folder } : { logicalFolder: undefined })
  }, [updateProjectAsset])

  const addExplicitAssetFolder = useCallback(
    (folderPathSegments: string[]) => {
      const p = normalizeFolderSegments(folderPathSegments)
      if (!p) return
      setAssetFoldersExplicit((prev) => [...new Set([...prev, p])].sort())
      setDirty(true)
    },
    [],
  )

  const removeExplicitAssetFolder = useCallback((folderPathNormalized: string) => {
    const p = normalizeLogicalFolder(folderPathNormalized)
    if (!p) return
    setAssetFoldersExplicit((prev) => prev.filter((x) => x !== p))
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

      const removeSet = new Set(uniq)
      detachAssetRefsForDeletedAssets(removeSet)
      setProjectAssets((prev) => prev.filter((a) => !removeSet.has(a.assetId)))
      setDirty(true)
    },
    [nodes, projectAssets, detachAssetRefsForDeletedAssets],
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
    [assetFoldersExplicit],
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
  }, [])

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
      toggleNodeHierarchyVisible,
      reparentSceneNode,
      placeSceneNodeInHierarchy,
      createEmptyChild,
      duplicateSceneNode,
      deleteSceneSubtreesConfirm,
      selectChildrenOf,

      addGltfNodeLocal,
      addGltfFromFile,
      addSceneNodeFromAsset,
      updateProjectAsset,
      moveAssetLogicalFolder,
      addExplicitAssetFolder,
      removeExplicitAssetFolder,
      deleteProjectAssetsConfirm,

      replaceProjectState,
      saveProjectToServer,
      markSavedBaseline,
      newProject,
      resolveGltfUrl,
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
      toggleNodeHierarchyVisible,
      reparentSceneNode,
      placeSceneNodeInHierarchy,
      createEmptyChild,
      duplicateSceneNode,
      deleteSceneSubtreesConfirm,
      selectChildrenOf,
      addGltfNodeLocal,
      addGltfFromFile,
      addSceneNodeFromAsset,
      updateProjectAsset,
      moveAssetLogicalFolder,
      addExplicitAssetFolder,
      removeExplicitAssetFolder,
      deleteProjectAssetsConfirm,
      replaceProjectState,
      saveProjectToServer,
      markSavedBaseline,
      newProject,
      resolveGltfUrl,
      setHierarchySearch,
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
