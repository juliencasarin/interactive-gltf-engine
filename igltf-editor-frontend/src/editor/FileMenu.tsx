import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiConfigured } from '@/api/projectApi'
import { useEditor } from './EditorContext'
import {
  downloadTextFile,
  parseAnyProjectFile,
  serializeProjectV1,
  toProjectFileV2,
} from './projectIo'

const GLTF_EXT = /\.(glb|gltf)$/i

function isGltfName(name: string): boolean {
  return GLTF_EXT.test(name)
}

export function FileMenu({ projectBasename }: { projectBasename: string }) {
  const {
    nodes,
    projectAssets,
    dirty,
    addGltfFromFile,
    replaceProjectState,
    saveProjectToServer,
    markSavedBaseline,
    newProject,
  } = useEditor()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const closeMenu = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeMenu()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, closeMenu])

  const downloadExport = useCallback(() => {
    if (isApiConfigured()) {
      const doc = toProjectFileV2(nodes, projectAssets)
      downloadTextFile(
        `${projectBasename || 'project'}.json`,
        JSON.stringify(doc, null, 2),
      )
    } else {
      downloadTextFile(`${projectBasename || 'project'}.json`, serializeProjectV1(nodes))
    }
    markSavedBaseline()
    closeMenu()
  }, [projectBasename, nodes, projectAssets, markSavedBaseline, closeMenu])

  const downloadExportBackup = useCallback(() => {
    if (isApiConfigured()) {
      const doc = toProjectFileV2(nodes, projectAssets)
      downloadTextFile(
        `${projectBasename || 'project'}-backup.json`,
        JSON.stringify(doc, null, 2),
      )
    } else {
      downloadTextFile(`${projectBasename || 'project'}-backup.json`, serializeProjectV1(nodes))
    }
    closeMenu()
  }, [projectBasename, nodes, projectAssets, closeMenu])

  const save = useCallback(async () => {
    if (isApiConfigured()) {
      try {
        await saveProjectToServer()
        closeMenu()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
      return
    }
    downloadExport()
  }, [saveProjectToServer, closeMenu, downloadExport])

  const saveAs = useCallback(() => {
    void save()
  }, [save])

  const closeProject = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes and close the project?')) return
    newProject()
    closeMenu()
  }, [dirty, newProject, closeMenu])

  const loadProjectFile = useCallback(
    async (file: File) => {
      const text = await file.text()
      const parsed = parseAnyProjectFile(text)
      const rootId = parsed.nodes.find((n) => n.parentId === null)?.id ?? null
      replaceProjectState(parsed.nodes, parsed.assets, { markClean: true, selectionId: rootId })
      closeMenu()
    },
    [replaceProjectState, closeMenu],
  )

  const importGltfFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => isGltfName(f.name))
      for (const f of list) {
        await addGltfFromFile(f)
      }
      if (list.length) closeMenu()
    },
    [addGltfFromFile, closeMenu],
  )

  const onProjectInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.json')) await loadProjectFile(file)
      else if (isGltfName(file.name)) await importGltfFiles([file])
      else window.alert('Open: choose a .json project or a .glb / .gltf file.')
    },
    [loadProjectFile, importGltfFiles],
  )

  const onImportInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      e.target.value = ''
      if (files?.length) await importGltfFiles(files)
    },
    [importGltfFiles],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable)
      ) {
        return
      }
      if (e.key === 'Escape') {
        closeMenu()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void saveAs()
        else void save()
      }
      if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        closeProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, saveAs, closeProject, closeMenu])

  return (
    <div className="fileMenuWrap" ref={wrapRef}>
      <input
        ref={projectInputRef}
        type="file"
        className="fileMenuHiddenInput"
        accept=".json,.glb,.gltf,model/gltf-binary,model/gltf+json"
        onChange={onProjectInputChange}
        aria-hidden
      />
      <input
        ref={importInputRef}
        type="file"
        className="fileMenuHiddenInput"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        multiple
        onChange={onImportInputChange}
        aria-hidden
      />
      <button
        type="button"
        className={`toolbarBtn${open ? ' toolbarBtnActive' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        File
      </button>
      {open ? (
        <div className="fileMenuDropdown" role="menu">
          <button
            type="button"
            className="fileMenuItem"
            role="menuitem"
            onClick={() => projectInputRef.current?.click()}
          >
            Open… <span className="fileMenuShortcut"> </span>
          </button>
          <button
            type="button"
            className="fileMenuItem"
            role="menuitem"
            onClick={() => importInputRef.current?.click()}
          >
            Import glTF…
          </button>
          <div className="fileMenuSep" role="separator" />
          <button type="button" className="fileMenuItem" role="menuitem" onClick={() => void save()}>
            Save <span className="fileMenuShortcut">Ctrl+S</span>
          </button>
          <button type="button" className="fileMenuItem" role="menuitem" onClick={() => void saveAs()}>
            Save As… <span className="fileMenuShortcut">Ctrl+Shift+S</span>
          </button>
          {isApiConfigured() ? (
            <button
              type="button"
              className="fileMenuItem"
              role="menuitem"
              onClick={downloadExportBackup}
            >
              Export JSON backup…
            </button>
          ) : null}
          <div className="fileMenuSep" role="separator" />
          <button type="button" className="fileMenuItem" role="menuitem" onClick={closeProject}>
            Close project <span className="fileMenuShortcut">Ctrl+W</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
