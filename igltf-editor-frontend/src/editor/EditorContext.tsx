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
import {
  assetsReferencedInScene,
  readFileAsDataUrl,
  toProjectFileV2,
} from './projectIo'
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
    },
  ]
}

function baselineKey(nodes: EditorNode[], assets: ProjectAssetEntry[]): string {
  return JSON.stringify({ nodes, assets })
}

export type EditorContextValue = {
  projectId: string
  nodes: EditorNode[]
  projectAssets: ProjectAssetEntry[]
  selectionId: string | null
  dirty: boolean
  viewportHover: boolean
  panelFocus: PanelFocus
  loadError: string | null
  isSaving: boolean
  setSelectionId: (id: string | null) => void
  setViewportHover: (v: boolean) => void
  setPanelFocus: (f: PanelFocus) => void
  updateNode: (
    id: string,
    patch: Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale' | 'name'>>,
  ) => void
  addGltfNodeLocal: (name: string, gltfDataUrl: string) => string
  addGltfFromFile: (file: File) => Promise<void>
  replaceProjectState: (
    nodes: EditorNode[],
    assets: ProjectAssetEntry[],
    opts?: { selectionId?: string | null; markClean?: boolean },
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

function docToEditorState(doc: ProjectFileV2): { nodes: EditorNode[]; assets: ProjectAssetEntry[] } {
  return {
    nodes: doc.scene.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      parentId: n.parentId,
      position: [...n.position] as Vec3,
      rotation: [...n.rotation] as Vec3,
      scale: [...n.scale] as Vec3,
      assetRef: n.assetRef,
    })),
    assets: doc.assets.map((a) => ({ ...a })),
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
  const [selectionId, setSelectionId] = useState<string | null>('root')
  const [dirty, setDirty] = useState(false)
  const [viewportHover, setViewportHover] = useState(false)
  const [panelFocus, setPanelFocus] = useState<PanelFocus>('viewport')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [assetFetchRev, setAssetFetchRev] = useState(0)
  const baselineRef = useRef<string>(baselineKey(defaultNodes(), []))
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const setSelectionIdWrapped = useCallback((id: string | null) => {
    setSelectionId(id)
  }, [])

  useEffect(() => {
    setLoadError(null)
    setNodes(defaultNodes())
    setProjectAssets([])
    setSelectionId('root')
    setDirty(false)
    baselineRef.current = baselineKey(defaultNodes(), [])

    if (!isApiConfigured()) return

    let cancelled = false
    ;(async () => {
      try {
        const doc = await fetchDocument(projectId)
        if (cancelled) return
        if (doc && doc.version === 2) {
          const { nodes: nextNodes, assets: nextAssets } = docToEditorState(doc)
          setNodes(nextNodes)
          setProjectAssets(nextAssets)
          const rootId = nextNodes.find((n) => n.parentId === null)?.id ?? null
          setSelectionId(rootId)
          baselineRef.current = baselineKey(nextNodes, nextAssets)
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
    (id: string, patch: Partial<Pick<EditorNode, 'position' | 'rotation' | 'scale' | 'name'>>) => {
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
      setDirty(true)
    },
    [],
  )

  const addGltfNodeLocal = useCallback((name: string, gltfDataUrl: string) => {
    const id = uid()
    const node: EditorNode = {
      id,
      name: name.replace(/\.(glb|gltf)$/i, '') || 'Model',
      parentId: 'root',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      gltfDataUrl,
    }
    setNodes((prev) => [...prev, node])
    setSelectionId(id)
    setDirty(true)
    return id
  }, [])

  const addGltfFromFile = useCallback(
    async (file: File) => {
      const pid = projectIdRef.current
      if (isApiConfigured()) {
        const up = await uploadAssetStage(pid, file)
        const displayName = file.name.replace(/\.(glb|gltf)$/i, '') || 'Model'
        const id = uid()
        const node: EditorNode = {
          id,
          name: displayName,
          parentId: 'root',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          assetRef: up.assetId,
        }
        const entry: ProjectAssetEntry = {
          assetId: up.assetId,
          relativePath: up.relativePath,
          name: file.name,
        }
        setProjectAssets((prev) => {
          if (prev.some((p) => p.assetId === entry.assetId)) return prev
          return [...prev, entry]
        })
        setNodes((prev) => [...prev, node])
        setSelectionId(id)
        setDirty(true)
        return
      }
      const dataUrl = await readFileAsDataUrl(file)
      addGltfNodeLocal(file.name || 'model', dataUrl)
    },
    [addGltfNodeLocal],
  )

  const replaceProjectState = useCallback(
    (
      nextNodes: EditorNode[],
      nextAssets: ProjectAssetEntry[],
      opts?: { selectionId?: string | null; markClean?: boolean },
    ) => {
      setNodes(cloneNodes(nextNodes))
      setProjectAssets(cloneAssets(nextAssets))
      if (opts?.selectionId !== undefined) setSelectionId(opts.selectionId)
      else setSelectionId(nextNodes[0]?.id ?? null)
      if (opts?.markClean) {
        baselineRef.current = baselineKey(nextNodes, nextAssets)
        setDirty(false)
        if (isApiConfigured()) setAssetFetchRev((r) => r + 1)
      } else {
        setDirty(true)
      }
    },
    [],
  )

  const markSavedBaseline = useCallback(() => {
    baselineRef.current = baselineKey(nodes, projectAssets)
    setDirty(false)
  }, [nodes, projectAssets])

  const saveProjectToServer = useCallback(async () => {
    const pid = projectIdRef.current
    if (!isApiConfigured()) throw new Error('API not configured (set VITE_API_BASE_URL)')
    const bad = nodes.filter((n) => Boolean(n.gltfDataUrl) && !n.assetRef)
    if (bad.length)
      throw new Error(
        'Cannot save to server: some models use local inline glTF only. Re-import via Import glTF… with the API running.',
      )
    setIsSaving(true)
    try {
      const persisted = assetsReferencedInScene(nodes, projectAssets)
      const doc = toProjectFileV2(nodes, persisted)
      const normalized = await putDocument(pid, doc)
      const { nodes: nn, assets: na } = docToEditorState(normalized)
      setNodes(nn)
      setProjectAssets(na)
      setAssetFetchRev((r) => r + 1)
      baselineRef.current = baselineKey(nn, na)
      setDirty(false)
    } finally {
      setIsSaving(false)
    }
  }, [nodes, projectAssets])

  const newProject = useCallback(() => {
    const fresh = defaultNodes()
    baselineRef.current = baselineKey(fresh, [])
    setNodes(fresh)
    setProjectAssets([])
    setSelectionId('root')
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

  const value = useMemo<EditorContextValue>(
    () => ({
      projectId,
      nodes,
      projectAssets,
      selectionId,
      dirty,
      viewportHover,
      panelFocus,
      loadError,
      isSaving,
      setSelectionId: setSelectionIdWrapped,
      setViewportHover,
      setPanelFocus,
      updateNode,
      addGltfNodeLocal,
      addGltfFromFile,
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
      dirty,
      viewportHover,
      panelFocus,
      loadError,
      isSaving,
      setSelectionIdWrapped,
      updateNode,
      addGltfNodeLocal,
      addGltfFromFile,
      replaceProjectState,
      saveProjectToServer,
      markSavedBaseline,
      newProject,
      resolveGltfUrl,
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
