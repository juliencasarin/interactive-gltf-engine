import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  deleteStudioUnregisterProject,
  fetchHealth,
  fetchStudioProjects,
  getApiBase,
  isApiConfigured,
  postBuildPlayGlb,
  postStudioCreateProject,
  postStudioRegisterProject,
  type StudioProjectRow,
} from '@/api/projectApi'
import {
  loadLastParentDirectory,
  persistLastParentDirectory,
  nativeFolderDialogAvailable,
  pickDirectoryDesktop,
} from '@/lib/desktopFolderPicker'
import './projects-hub.css'

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function ProjectsHubPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<StudioProjectRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [engineHint, setEngineHint] = useState<string>('')

  const [modal, setModal] = useState<null | 'create' | 'open'>(null)
  const [parentDir, setParentDir] = useState('')
  const [createName, setCreateName] = useState('')
  const [registerPath, setRegisterPath] = useState('')
  const [compileBusyId, setCompileBusyId] = useState<string | null>(null)
  const [modalBrowseNotice, setModalBrowseNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!isApiConfigured()) {
      setError('Configure VITE_API_BASE_URL — cannot reach the hub API.')
      setProjects([])
      return
    }
    setBusy(true)
    setError(null)
    try {
      const [rows, hl] = await Promise.all([
        fetchStudioProjects(),
        fetchHealth().catch(() => null as unknown as { engineVersion?: string }),
      ])
      setProjects(rows)
      if (hl?.engineVersion) setEngineHint(hl.engineVersion)
    } catch (e) {
      setProjects([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    setParentDir(loadLastParentDirectory())
  }, [reload])

  useEffect(() => {
    setModalBrowseNotice(null)
  }, [modal])

  const onPickParent = async () => {
    setModalBrowseNotice(null)
    const r = await pickDirectoryDesktop()
    if (r.status === 'picked') {
      setParentDir(r.path)
      persistLastParentDirectory(r.path)
      return
    }
    if (r.status === 'unsupported') {
      setModalBrowseNotice(
        'Folder browse is available in the desktop app (npm run tauri:dev or a packaged build). In this browser tab, paste an absolute path manually.',
      )
      return
    }
    if (r.status === 'error') setModalBrowseNotice(r.message)
  }

  const onPickRegisterFolder = async () => {
    setModalBrowseNotice(null)
    const r = await pickDirectoryDesktop()
    if (r.status === 'picked') {
      setRegisterPath(r.path)
      return
    }
    if (r.status === 'unsupported') {
      setModalBrowseNotice(
        'Folder browse is available in the desktop app (npm run tauri:dev or a packaged build). In this browser tab, paste an absolute path manually.',
      )
      return
    }
    if (r.status === 'error') setModalBrowseNotice(r.message)
  }

  const folderBrowseButtonTitle = nativeFolderDialogAvailable()
    ? 'Pick a folder on disk'
    : 'Browse is only wired in the Tauri desktop app — paste path here instead'

  const onCreateConfirm = async () => {
    setBanner(null)
    try {
      const { id } = await postStudioCreateProject(parentDir.trim(), createName.trim())
      persistLastParentDirectory(parentDir.trim())
      setModal(null)
      setCreateName('')
      await reload()
      navigate(`/editor/${encodeURIComponent(id)}`)
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e))
    }
  }

  const onRegisterConfirm = async () => {
    setBanner(null)
    try {
      const { id } = await postStudioRegisterProject(registerPath.trim())
      setModal(null)
      setRegisterPath('')
      await reload()
      navigate(`/editor/${encodeURIComponent(id)}`)
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e))
    }
  }

  const onCompileRow = async (id: string) => {
    setBanner(null)
    setCompileBusyId(id)
    try {
      await postBuildPlayGlb(id)
      setBanner('Build finished — artifacts in project build/ folder.')
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e))
    } finally {
      setCompileBusyId(null)
    }
  }

  const onUnregister = async (id: string) => {
    if (!window.confirm('Remove this folder from the hub list? Disk files stay unchanged.')) return
    try {
      await deleteStudioUnregisterProject(id)
      await reload()
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e))
    }
  }

  const apiConfigured = isApiConfigured()

  return (
    <div className="projectsHub">
      <header className="projectsHubTopbar">
        <span className="projectsHubTitle">interactive glTF editor — Projects</span>
        <div className="projectsHubTopbarBtns">
          <button type="button" className="projectsHubToolbarBtn" disabled={busy || !apiConfigured} onClick={() => void reload()}>
            Refresh
          </button>
          <button
            type="button"
            className="projectsHubToolbarBtn"
            disabled={!apiConfigured}
            onClick={() => {
              setModalBrowseNotice(null)
              setModal('create')
            }}
          >
            New project…
          </button>
          <button
            type="button"
            className="projectsHubToolbarBtn"
            disabled={!apiConfigured}
            onClick={() => {
              setModalBrowseNotice(null)
              setModal('open')
            }}
          >
            Open folder…
          </button>
        </div>
      </header>

      {error ? (
        <div className="projectsHubBanner">{error}</div>
      ) : (
        !apiConfigured ? (
          <div className="projectsHubBanner">Set VITE_API_BASE_URL when running `npm run dev` or build with production env.</div>
        ) : null
      )}

      {banner ? (
        <div className={`projectsHubBanner${banner.includes('finished') ? '' : ''}`}>{banner}</div>
      ) : null}

      <div className="projectsHubTableWrap">
        <table className="projectsHubTable">
          <thead>
            <tr>
              <th>Project</th>
              <th>Disk path</th>
              <th>Last saved</th>
              <th>Saved with</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && !busy ? (
              <tr>
                <td colSpan={5} className="projectsHubMuted">
                  No projects yet — create one or open an existing workspace folder on disk.
                  <div style={{ marginTop: '8px' }}>
                    Legacy shortcuts such as `/editor/test` still work if a `test` workspace exists under the API app data folder.
                  </div>
                </td>
              </tr>
            ) : null}
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link className="projectsHubName" to={`/editor/${encodeURIComponent(p.id)}`}>
                    {p.displayName || p.diskPath.split(/[/\\]/).pop()}
                  </Link>
                </td>
                <td className="projectsHubPathCell" title={p.diskPath}>
                  {p.diskPath}
                </td>
                <td className="projectsHubMuted">{formatShortDate(p.lastSavedAt)}</td>
                <td className="projectsHubMuted">{p.savedWithEngineVersion ?? '—'}</td>
                <td>
                  <div className="projectsHubRowActions">
                    <button
                      type="button"
                      className="projectsHubToolbarBtn projectsHubTinyBtn"
                      title="Compile into build/scene.glb"
                      disabled={compileBusyId === p.id || !apiConfigured}
                      onClick={() => void onCompileRow(p.id)}
                    >
                      {compileBusyId === p.id ? 'Compiling…' : 'Compile'}
                    </button>
                    <button
                      type="button"
                      className="projectsHubToolbarBtn projectsHubTinyBtn"
                      onClick={() => navigate(`/play/${encodeURIComponent(p.id)}`)}
                      disabled={!apiConfigured}
                    >
                      Play
                    </button>
                    <button
                      type="button"
                      className="projectsHubToolbarBtn projectsHubTinyBtn projectsHubDanger"
                      disabled={busy}
                      onClick={() => void onUnregister(p.id)}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="projectsHubFooter">
        <span>{getApiBase() ? `API: ${getApiBase()}` : 'API not configured'}</span>
        {engineHint ? <span>{` · Backend ${engineHint}`}</span> : null}
      </footer>

      {modal === 'create' ? (
        <div className="projectsHubModalBackdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="projectsHubModal" role="dialog" aria-labelledby="dlg-new-proj-title">
            <h3 id="dlg-new-proj-title">New project</h3>
            <p className="projectsHubHint">Creates a workspace folder below the parent directory and registers it in the hub.</p>
            <div className="projectsHubField">
              <label htmlFor="ph-parent">Parent directory</label>
              <div className="projectsHubRowIn">
                <input id="ph-parent" type="text" value={parentDir} placeholder="Absolute path…" onChange={(e) => setParentDir(e.target.value)} />
                <button type="button" className="projectsHubMiniBtn" onClick={() => void onPickParent()} title={folderBrowseButtonTitle}>
                  Browse…
                </button>
              </div>
            </div>
            <div className="projectsHubField">
              <label htmlFor="ph-name">Folder name</label>
              <input id="ph-name" type="text" value={createName} placeholder="Project folder name…" onChange={(e) => setCreateName(e.target.value)} />
            </div>
            {modalBrowseNotice ? <div className="projectsHubModalNotice">{modalBrowseNotice}</div> : null}
            <div className="projectsHubModalFooter">
              <button type="button" className="projectsHubToolbarBtn projectsHubGhostBtn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className="projectsHubToolbarBtn projectsPrimaryBtn" onClick={() => void onCreateConfirm()}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'open' ? (
        <div className="projectsHubModalBackdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="projectsHubModal" role="dialog" aria-labelledby="dlg-open-folder-title">
            <h3 id="dlg-open-folder-title">Open workspace folder</h3>
            <p className="projectsHubHint">Adds the folder to the hub; project files remain on disk (no copy).</p>
            <div className="projectsHubField">
              <label htmlFor="ph-register">Existing project directory</label>
              <div className="projectsHubRowIn">
                <input
                  id="ph-register"
                  type="text"
                  value={registerPath}
                  placeholder="Absolute path to project root…"
                  onChange={(e) => setRegisterPath(e.target.value)}
                />
                <button type="button" className="projectsHubMiniBtn" onClick={() => void onPickRegisterFolder()} title={folderBrowseButtonTitle}>
                  Browse…
                </button>
              </div>
            </div>
            {modalBrowseNotice ? <div className="projectsHubModalNotice">{modalBrowseNotice}</div> : null}
            <div className="projectsHubModalFooter">
              <button type="button" className="projectsHubToolbarBtn projectsHubGhostBtn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className="projectsHubToolbarBtn projectsPrimaryBtn" onClick={() => void onRegisterConfirm()}>
                Open
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
