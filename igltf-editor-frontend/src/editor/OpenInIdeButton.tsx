import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDevLocalProjectPath, postOpenInIde, type OpenIdePresetApi } from '@/api/projectApi'
import {
  ideOpenDeepLinkAbsolute,
  loadIdeOpenPrefs,
  resolvedLocalProjectFolder,
  saveIdeOpenPrefs,
  shellOpenCommandAbsolute,
  type IdeOpenPrefs,
  type IdePreset,
} from './ideOpenPrefs'
import './panels.css'

export function OpenInIdeButton({ projectId }: { projectId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<IdeOpenPrefs>(loadIdeOpenPrefs)
  const [pathLoading, setPathLoading] = useState(true)
  const [pathHint, setPathHint] = useState<string | null>(null)

  const [openBusy, setOpenBusy] = useState(false)
  const [apiResolvedPath, setApiResolvedPath] = useState<string | null>(null)

  const persist = useCallback((next: IdeOpenPrefs) => {
    setPrefs(next)
    saveIdeOpenPrefs(next)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    let cancelled = false
    setPathLoading(true)
    setPathHint(null)
    setApiResolvedPath(null)
    ;(async () => {
      try {
        const p = await fetchDevLocalProjectPath(projectId)
        if (cancelled) return
        if (p) {
          setApiResolvedPath(p)
        } else {
          setPathHint('Could not resolve project folder from API.')
        }
      } catch (e) {
        if (!cancelled) setPathHint(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setPathLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const resolvedPath = useMemo(() => {
    const api = apiResolvedPath?.trim()
    if (api) return api
    return resolvedLocalProjectFolder(prefs, projectId)
  }, [apiResolvedPath, prefs, projectId])

  const deepLink = ideOpenDeepLinkAbsolute(prefs, resolvedPath)

  const copyPath = () => {
    void navigator.clipboard.writeText(resolvedPath).catch(() => {})
  }

  const copyCmd = () => {
    void navigator.clipboard.writeText(shellOpenCommandAbsolute(prefs, resolvedPath)).catch(() => {})
  }

  const onClickOpen = () => {
    void (async () => {
      if (prefs.preset === 'custom') {
        preferencesOpenIdeDeepLink(deepLink)
        return
      }
      setPathHint(null)
      setOpenBusy(true)
      try {
        await postOpenInIde(projectId, prefs.preset as OpenIdePresetApi)
      } catch (e) {
        setPathHint(e instanceof Error ? e.message : String(e))
      } finally {
        setOpenBusy(false)
      }
    })()
  }

  const openTitle =
    prefs.preset === 'custom'
      ? deepLink
      : 'Open folder on this machine via API (IDE CLI, new window when supported)'

  return (
    <div className="ideOpenWrap" ref={wrapRef}>
      <button type="button" className="toolbarBtn" onClick={() => setOpen((o) => !o)}>
        Open in IDE
      </button>
      {open ? (
        <div
          className="idePopover"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Open project in IDE"
        >
          <p className="inspectorHintMuted" style={{ margin: 0 }}>
            Project id: <strong style={{ color: 'rgb(210,210,210)' }}>{projectId}</strong>
          </p>
          {pathLoading ? <p className="inspectorHintMuted">Loading folder path…</p> : null}
          {pathHint ? <p className="inspectorHintMuted">{pathHint}</p> : null}
          <label>
            IDE
            <select
              value={prefs.preset}
              onChange={(e) => persist({ ...prefs, preset: e.target.value as IdePreset })}
            >
              <option value="cursor">Cursor</option>
              <option value="vscode">VS Code</option>
              <option value="jetbrains">JetBrains (idea://)</option>
              <option value="custom">Custom URL…</option>
            </select>
          </label>
          {prefs.preset === 'custom' ? (
            <label>
              Template ({'{path}'} = folder)
              <input
                type="text"
                value={prefs.customTemplate}
                onChange={(e) => persist({ ...prefs, customTemplate: e.target.value })}
              />
            </label>
          ) : null}
          <details style={{ marginTop: 8 }}>
            <summary className="inspectorHintMuted" style={{ cursor: 'pointer' }}>
              Advanced: override folder path
            </summary>
            <label style={{ display: 'block', marginTop: 8 }}>
              Local folder fallback (legacy: STORAGE_ROOT-like parent plus id suffix). Prefer path from API above.
              <input
                type="text"
                placeholder="Usually filled from API"
                value={prefs.localRoot}
                onChange={(e) => persist({ ...prefs, localRoot: e.target.value })}
              />
            </label>
          </details>
          <div className="idePopoverActions">
            <button
              type="button"
              className="footerToolbarBtn"
              disabled={pathLoading || openBusy || !resolvedPath.trim()}
              title={openTitle}
              onClick={onClickOpen}
            >
              {openBusy ? 'Opening…' : 'Open'}
            </button>
            <button type="button" className="footerToolbarBtn" onClick={copyPath}>
              Copy path
            </button>
            <button type="button" className="footerToolbarBtn" onClick={copyCmd}>
              Copy shell command
            </button>
          </div>
          <p className="inspectorHintMuted" style={{ margin: 0 }}>
            Resolved: {resolvedPath || '—'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function preferencesOpenIdeDeepLink(url: string) {
  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if (!w) window.location.href = url
  } catch {
    window.location.href = url
  }
}
