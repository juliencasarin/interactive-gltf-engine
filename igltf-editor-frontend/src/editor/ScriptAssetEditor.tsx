import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { fetchAssetSource, isApiConfigured, putAssetSource } from '@/api/projectApi'
import { DEFAULT_SCRIPT_TEMPLATE, registerIgltfHostExtraLibs } from '@/scriptRuntime/monacoSetup'
import { useEditor } from './EditorContext'
import type { ProjectAssetEntry } from './types'
import { isScriptAssetEntry } from './assetUtils'
import './panels.css'

function flattenTsMessage(msg: unknown): string {
  if (typeof msg === 'string') return msg
  if (msg && typeof msg === 'object' && 'messageText' in msg) {
    const m = msg as { messageText: string; next?: unknown }
    const tail = m.next ? `\n${flattenTsMessage(m.next)}` : ''
    return m.messageText + tail
  }
  return String(msg)
}

export function ScriptAssetEditor({ asset }: { asset: ProjectAssetEntry }) {
  const { projectId, setProjectAssetSourceText } = useEditor()
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [diagSummary, setDiagSummary] = useState<string | null>(null)
  const [diagHasErrors, setDiagHasErrors] = useState(false)

  useEffect(() => {
    if (!hostRef.current || !isScriptAssetEntry(asset)) return undefined

    registerIgltfHostExtraLibs()

    const el = hostRef.current
    let cancelled = false
    let editor: monaco.editor.IStandaloneCodeEditor | null = null
    let saveTimer = 0
    let sub: monaco.IDisposable | null = null

    void (async () => {
      let initial: string
      if (asset.sourceText !== undefined) {
        initial = asset.sourceText
      } else if (isApiConfigured()) {
        try {
          initial = await fetchAssetSource(projectId, asset.assetId)
        } catch (e) {
          if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e))
          initial = DEFAULT_SCRIPT_TEMPLATE
        }
      } else {
        initial = DEFAULT_SCRIPT_TEMPLATE
      }

      if (cancelled || !el) return

      editor = monaco.editor.create(el, {
        value: initial,
        language: 'javascript',
        theme: 'vs-dark',
        minimap: { enabled: false },
        automaticLayout: true,
        fontSize: 12,
        scrollBeyondLastLine: false,
      })
      editorRef.current = editor

      sub = editor.onDidChangeModelContent(() => {
        if (!editor) return
        const text = editor.getValue()
        window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => {
          if (isApiConfigured()) {
            void putAssetSource(projectId, asset.assetId, text).catch(() => {})
          } else {
            setProjectAssetSourceText(asset.assetId, text)
          }
        }, 450)
      })
    })()

    return () => {
      cancelled = true
      window.clearTimeout(saveTimer)
      sub?.dispose()
      editor?.dispose()
      editorRef.current = null
    }
  }, [asset.assetId, asset.relativePath, projectId, setProjectAssetSourceText])

  const runCheck = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    registerIgltfHostExtraLibs()
    const model = editor.getModel()
    if (!model) return

    const getWorker = await monaco.languages.typescript.getJavaScriptWorker()
    const worker = await getWorker(model.uri)
    const uriStr = model.uri.toString()
    const syntactic = await worker.getSyntacticDiagnostics(uriStr)
    const all = syntactic

    const markers: monaco.editor.IMarkerData[] = all.map((d) => {
      const startOff = d.start ?? 0
      const len = d.length ?? 0
      const start = model.getPositionAt(startOff)
      const end = model.getPositionAt(startOff + len)
      const severity =
        d.category === 1
          ? monaco.MarkerSeverity.Error
          : d.category === 0
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info
      return {
        severity,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        message: flattenTsMessage(d.messageText),
      }
    })

    monaco.editor.setModelMarkers(model, 'script-check', markers)

    const errors = markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length
    const warnings = markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length
    const infos = markers.length - errors - warnings
    setDiagHasErrors(errors > 0)
    const parts = [`${errors} error(s)`, `${warnings} warning(s)`]
    if (infos > 0) parts.push(`${infos} info`)
    setDiagSummary(parts.join(', '))
  }, [])

  if (!isScriptAssetEntry(asset)) return null

  return (
    <div className="scriptAssetEditor">
      <div className="scriptAssetEditorToolbar">
        <button type="button" onClick={() => void runCheck()}>
          Check script
        </button>
        {diagSummary ? (
          <span className={`scriptAssetEditorDiagSummary${diagHasErrors ? ' hasErrors' : ''}`}>
            {diagSummary}
          </span>
        ) : null}
      </div>
      <div className="scriptAssetEditorLabel">Script source</div>
      {loadErr ? (
        <p className="inspectorHintMuted" title={loadErr}>
          Could not load from server — showing template. ({loadErr})
        </p>
      ) : null}
      <div ref={hostRef} className="scriptMonacoHost" />
    </div>
  )
}
