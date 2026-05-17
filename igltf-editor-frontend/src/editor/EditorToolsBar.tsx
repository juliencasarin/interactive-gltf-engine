import { useEffect } from 'react'
import { useEditor } from './EditorContext'

export function EditorToolsBar() {
  const {
    viewportToolMode,
    setViewportToolMode,
    undoDepth,
    redoDepth,
    canUndoVisual,
    canRedoVisual,
    undo,
    redo,
  } = useEditor()

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
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [redo, undo])

  return (
    <div className="editorToolbarToolsHost">
      <div className="editorToolbarToolsInner">
        <button
          type="button"
          className={`editorToolbarTool${viewportToolMode === 'select' ? ' editorToolbarToolSelected' : ''}`}
          title="Select — click scene objects"
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
          title="Transform — drag gizmo axes (Translate)"
          aria-pressed={viewportToolMode === 'translate'}
          onClick={() => setViewportToolMode('translate')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphMove" aria-hidden />
        </button>

        <button
          type="button"
          className={`editorToolbarTool${viewportToolMode === 'rotate' ? ' editorToolbarToolSelected' : ''}`}
          title="Rotate — drag rotation gizmo"
          aria-pressed={viewportToolMode === 'rotate'}
          onClick={() => setViewportToolMode('rotate')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphRotate" aria-hidden />
        </button>

        <button
          type="button"
          className={`editorToolbarTool${viewportToolMode === 'scale' ? ' editorToolbarToolSelected' : ''}`}
          title="Scale — drag scale gizmo"
          aria-pressed={viewportToolMode === 'scale'}
          onClick={() => setViewportToolMode('scale')}
        >
          <span className="editorToolbarToolGlyph editorToolbarToolGlyphScale" aria-hidden />
        </button>
      </div>
    </div>
  )
}
