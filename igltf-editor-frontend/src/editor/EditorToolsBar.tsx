import { useCallback, useEffect } from 'react'
import { useEditor } from './EditorContext'

function gizmoModeLabel(space: 'local' | 'world'): 'Local' | 'Global' {
  return space === 'local' ? 'Local' : 'Global'
}

export function EditorToolsBar() {
  const {
    viewportToolMode,
    setViewportToolMode,
    viewportTransformSpace,
    setViewportTransformSpace,
    selectedNodeIds,
    undoDepth,
    redoDepth,
    canUndoVisual,
    canRedoVisual,
    undo,
    redo,
  } = useEditor()

  const toggleGizmoMode = useCallback(() => {
    if (viewportTransformSpace === 'world' && selectedNodeIds.length <= 1) {
      setViewportTransformSpace('local')
    } else if (viewportTransformSpace === 'local') {
      setViewportTransformSpace('world')
    }
  }, [viewportTransformSpace, selectedNodeIds.length, setViewportTransformSpace])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'q') {
        e.preventDefault()
        setViewportToolMode('select')
      } else if (key === 'w') {
        e.preventDefault()
        setViewportToolMode('translate')
      } else if (key === 'e') {
        e.preventDefault()
        setViewportToolMode('rotate')
      } else if (key === 'r') {
        e.preventDefault()
        setViewportToolMode('scale')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [redo, undo, setViewportToolMode])

  const gizmoLabel = gizmoModeLabel(viewportTransformSpace)

  return (
    <div className="editorToolbarToolsHost">
      <div className="editorToolbarToolsInner">
        <button
          type="button"
          className={`editorToolbarTool${viewportToolMode === 'select' ? ' editorToolbarToolSelected' : ''}`}
          title="Select (Q)"
          aria-pressed={viewportToolMode === 'select'}
          onClick={() => setViewportToolMode('select')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphCursor" aria-hidden />
        </button>

        <button
          type="button"
          className="editorToolbarTool"
          title="Undo"
          aria-label={`Undo (${undoDepth})`}
          disabled={undoDepth <= 0}
          onClick={() => undo()}
        >
          <span
            className={`editorToolbarToolGlyphWrap${canUndoVisual ? '' : ' editorToolbarToolGlyphMuted'}`}
          >
            <span className="editorToolbarToolGlyph editorToolbarToolGlyphUndo" aria-hidden />
            <span className="editorToolbarToolCount">{undoDepth > 0 ? undoDepth : ''}</span>
          </span>
        </button>

        <button
          type="button"
          className="editorToolbarTool"
          title="Redo"
          aria-label={`Redo (${redoDepth})`}
          disabled={redoDepth <= 0}
          onClick={() => redo()}
        >
          <span
            className={`editorToolbarToolGlyphWrap${canRedoVisual ? '' : ' editorToolbarToolGlyphMuted'}`}
          >
            <span className="editorToolbarToolGlyph editorToolbarToolGlyphRedo" aria-hidden />
            <span className="editorToolbarToolCountRedo">{redoDepth > 0 ? redoDepth : ''}</span>
          </span>
        </button>

        <button
          type="button"
          className={`editorToolbarTool editorToolbarToolSpacing${viewportToolMode === 'translate' ? ' editorToolbarToolSelected' : ''}`}
          title="Move (W)"
          aria-pressed={viewportToolMode === 'translate'}
          onClick={() => setViewportToolMode('translate')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphMove" aria-hidden />
        </button>

        <button
          type="button"
          className={`editorToolbarTool${viewportToolMode === 'rotate' ? ' editorToolbarToolSelected' : ''}`}
          title="Rotate (E)"
          aria-pressed={viewportToolMode === 'rotate'}
          onClick={() => setViewportToolMode('rotate')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphRotate" aria-hidden />
        </button>

        <button
          type="button"
          className={`editorToolbarTool${viewportToolMode === 'scale' ? ' editorToolbarToolSelected' : ''}`}
          title="Scale (R)"
          aria-pressed={viewportToolMode === 'scale'}
          onClick={() => setViewportToolMode('scale')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphScale" aria-hidden />
        </button>

        <span className="editorToolbarSeparator" aria-hidden />

        <button
          type="button"
          className="editorToolbarTool editorToolbarGizmoMode"
          title={`Gizmo space: ${gizmoLabel}`}
          aria-label={`Gizmo space: ${gizmoLabel}`}
          onClick={toggleGizmoMode}
        >
          {gizmoLabel}
        </button>
      </div>
    </div>
  )
}
