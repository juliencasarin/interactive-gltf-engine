import { useCallback, useEffect, useRef, useState } from 'react'
import { FileMenu } from '@/editor/FileMenu'
import { useEditor } from '@/editor/EditorContext'
import { AssetsCatalogTree, AssetsExplorerPanel } from '@/editor/AssetsPanel'
import { HierarchyPanel } from '@/editor/HierarchyPanel'
import { InspectorPanel } from '@/editor/InspectorPanel'
import { PreviewViewport } from '@/editor/PreviewViewport'
import './editor-shell.css'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function initialProjectPath(sceneId: string): string {
  const base = import.meta.env?.BASE_URL ?? '/'
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base
  return `${normalized || ''}/projects/${sceneId}`
}

const GLTF_EXT = /\.(glb|gltf)$/i

function isGltfName(name: string): boolean {
  return GLTF_EXT.test(name)
}

export type EditorShellProps = {
  sceneId: string
}

export function EditorShell({ sceneId }: EditorShellProps) {
  const { dirty, addGltfFromFile, setPanelFocus, loadError } = useEditor()
  const projectPath = initialProjectPath(sceneId)
  const mainDisplayRef = useRef<HTMLDivElement>(null)

  const [hierarchyW, setHierarchyW] = useState(268)
  const [inspectorW, setInspectorW] = useState(231)
  const [assetsH, setAssetsH] = useState(200)
  const [librariesW, setLibrariesW] = useState(268)

  const dragKind = useRef<
    null | 'hierarchy' | 'inspector' | 'assetsRow' | 'libraries'
  >(null)
  const dragStart = useRef({
    x: 0,
    y: 0,
    hierarchyW: 0,
    inspectorW: 0,
    assetsH: 0,
    librariesW: 0,
  })

  const endDrag = useCallback(() => {
    dragKind.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const k = dragKind.current
      if (!k) return
      const st = dragStart.current
      if (k === 'hierarchy') {
        const next = st.hierarchyW + (e.clientX - st.x)
        setHierarchyW(clamp(next, 100, 600))
      } else if (k === 'inspector') {
        const next = st.inspectorW - (e.clientX - st.x)
        setInspectorW(clamp(next, 100, 600))
      } else if (k === 'assetsRow') {
        const next = st.assetsH - (e.clientY - st.y)
        setAssetsH(clamp(next, 80, 480))
      } else if (k === 'libraries') {
        const next = st.librariesW + (e.clientX - st.x)
        setLibrariesW(clamp(next, 80, 600))
      }
    }
    const onUp = () => endDrag()

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [endDrag])

  useEffect(() => {
    const sync = () => {
      const el = mainDisplayRef.current
      if (!el) return
      const h = el.clientHeight
      const minH = Math.max(80, h * 0.2)
      const maxH = Math.max(minH, h * 0.6)
      setAssetsH((a) => clamp(a, minH, maxH))
    }
    sync()
    const ro = new ResizeObserver(sync)
    if (mainDisplayRef.current) ro.observe(mainDisplayRef.current)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  const startHierarchyDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragKind.current = 'hierarchy'
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      hierarchyW,
      inspectorW,
      assetsH,
      librariesW,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const startInspectorDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragKind.current = 'inspector'
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      hierarchyW,
      inspectorW,
      assetsH,
      librariesW,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const startAssetsRowDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragKind.current = 'assetsRow'
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      hierarchyW,
      inspectorW,
      assetsH,
      librariesW,
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const startLibrariesDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragKind.current = 'libraries'
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      hierarchyW,
      inspectorW,
      assetsH,
      librariesW,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onDragOverShell = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDropShell = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const files = e.dataTransfer.files
      if (!files?.length) return
      const gltfs = Array.from(files).filter((f) => isGltfName(f.name))
      if (!gltfs.length) return
      try {
        for (const f of gltfs) {
          await addGltfFromFile(f)
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
    [addGltfFromFile],
  )

  return (
    <div className="editor">
      <div
        className="screen"
        onDragOver={onDragOverShell}
        onDrop={onDropShell}
      >
        <div className="toolbar">
          <div className="fileMenuToolbarSlot">
            <FileMenu projectBasename={sceneId} />
          </div>
          <button type="button" className="toolbarBtn">
            Settings
          </button>
          <span className="projectPath" title={projectPath}>
            {projectPath}
            {dirty ? ' *' : ''}
          </span>
        </div>

        <div className="windowContainer">
          <div className="toolbar2">
            <div className="toolsPlaceholder">Tools (placeholder)</div>
            <div className="serverPlaceholder">Play manifest (placeholder)</div>
          </div>

          <div className="mainDisplay" ref={mainDisplayRef}>
            <div className="mainTopDisplay">
              <div
                className="panelHierarchy"
                style={{ width: hierarchyW, flexShrink: 0 }}
              >
                <HierarchyPanel />
              </div>

              <div
                className="splitter splitterVertical"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={startHierarchyDrag}
              />

              <div className="panelPreview">
                <div className="previewHeader">
                  <span className="previewHeaderPlaceholder">Preview</span>
                </div>
                <PreviewViewport />
              </div>

              <div
                className="splitter splitterVertical"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={startInspectorDrag}
              />

              <div
                className="panelInspector"
                style={{ width: inspectorW, flexShrink: 0 }}
              >
                <div className="divisionHeader">
                  <span>Inspector</span>
                </div>
                <InspectorPanel />
              </div>
            </div>

            <div
              className="splitter splitterHorizontal"
              role="separator"
              aria-orientation="horizontal"
              onMouseDown={startAssetsRowDrag}
            />

            <div
              className="assetsRow"
              style={{ height: assetsH, flexShrink: 0 }}
              onMouseDown={() => setPanelFocus('assets')}
            >
              <div className="assetsInner">
                <div
                  className="assetsLibraries"
                  style={{ width: librariesW, flexShrink: 0 }}
                >
                  <div className="divisionHeader">
                    <span>Assets</span>
                  </div>
                  <div className="catalogLibrariesHost">
                    <AssetsCatalogTree />
                  </div>
                </div>

                <div
                  className="splitter splitterVertical"
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={startLibrariesDrag}
                />

                <div className="assetsTab assetsTabFilled">
                  <AssetsExplorerPanel />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="errorLog">
          <span className="errorStub" aria-hidden />
          <button type="button" className="errorCount" disabled>
            {loadError ? '!' : '0'}
          </button>
          <button type="button" className="errorMsg" disabled title={loadError ?? undefined}>
            {loadError ?? 'No errors'}
          </button>
        </div>
      </div>
    </div>
  )
}
