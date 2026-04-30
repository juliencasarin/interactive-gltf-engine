import { useEditor } from './EditorContext'
import './panels.css'

export function HierarchyPanel() {
  const { nodes, selectionId, setSelectionId, setPanelFocus } = useEditor()

  const ordered = (() => {
    const walk = (pid: string | null): typeof nodes => {
      return nodes
        .filter((n) => n.parentId === pid)
        .flatMap((n) => [n, ...walk(n.id)])
    }
    return walk(null)
  })()

  return (
    <div
      className="hierarchyPanel"
      role="tree"
      onMouseDown={() => setPanelFocus('hierarchy')}
    >
      {ordered.map((n) => (
        <button
          key={n.id}
          type="button"
          className={`hierarchyRow${selectionId === n.id ? ' hierarchyRowSelected' : ''}`}
          role="treeitem"
          onClick={() => {
            setSelectionId(n.id)
            setPanelFocus('hierarchy')
          }}
        >
          {n.parentId ? `↳ ${n.name}` : n.name}
        </button>
      ))}
    </div>
  )
}
