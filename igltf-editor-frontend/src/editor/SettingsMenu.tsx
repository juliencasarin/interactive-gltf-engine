import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiConfigured } from '@/api/projectApi'
import { useEditor } from './EditorContext'

export function SettingsMenu() {
  const {
    projectId,
    dirty,
    mcpAllowSceneEdition,
    setMcpAllowSceneEdition,
    editorSessionStatus,
    editorSettingsPersistError,
  } = useEditor()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeMenu()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, closeMenu])

  const sessionLive = isApiConfigured() && editorSessionStatus === 'open'

  const sessionHint = !isApiConfigured()
    ? 'Connect the authoring API to expose a live session to MCP.'
    : editorSessionStatus === 'open'
      ? mcpAllowSceneEdition
        ? 'Live session active — MCP can read and modify the scene.'
        : 'Live session active — MCP read-only until you enable Allow scene edition below.'
      : editorSessionStatus === 'connecting'
        ? 'Connecting live session…'
        : 'No live session — open this project in igltf-editor (Cursor alone is not enough).'

  const mutationHint =
    sessionLive && !mcpAllowSceneEdition
      ? 'Vibe-coding agents can inspect the scene but cannot apply changes until you enable the checkbox below. They must not edit project.json on disk.'
      : null

  return (
    <div className="fileMenuWrap" ref={wrapRef}>
      <button
        type="button"
        className={`toolbarBtn${open ? ' toolbarBtnActive' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        Settings
      </button>
      {open ? (
        <div className="fileMenuDropdown settingsMenuDropdown" role="menu" style={{ minWidth: 320 }}>
          <div className="settingsMenuSectionTitle">MCP</div>
          <label className="inspectorBoolRow settingsMenuRow">
            <input
              type="checkbox"
              checked={mcpAllowSceneEdition}
              onChange={(e) => setMcpAllowSceneEdition(e.target.checked)}
            />
            <span className="inspectorBoolLbl">Allow scene edition</span>
          </label>
          <p className="inspectorHintMuted settingsMenuHint">
            When enabled, MCP tools may mutate this project&apos;s scene while the editor is open.
            This setting is saved immediately to project.json. Scene edits still require Save.
          </p>
          <p className="inspectorHintMuted settingsMenuHint">
            MCP project id (UUID): <code className="settingsMenuMono">{projectId}</code>
            {' — also in '}
            <code className="settingsMenuMono">.igltf/project-id</code>.
          </p>
          <p className="inspectorHintMuted settingsMenuHint">{sessionHint}</p>
          {dirty ? (
            <p className="inspectorHintMuted settingsMenuHint">Unsaved scene changes — use Save in the toolbar.</p>
          ) : null}
          {editorSettingsPersistError ? (
            <p className="inspectorHintMuted settingsMenuHint settingsMenuHintWarn">
              Could not save MCP setting: {editorSettingsPersistError}
            </p>
          ) : null}
          {mutationHint ? (
            <p className="inspectorHintMuted settingsMenuHint settingsMenuHintWarn">{mutationHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
