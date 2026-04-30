import { useMemo } from 'react'
import { eulerDegreesToRad, useEditor, vec3ToEulerDegrees } from './EditorContext'
import type { Vec3 } from './types'
import './panels.css'

function VecField({
  label,
  value,
  onChange,
}: {
  label: string
  value: Vec3
  onChange: (next: Vec3) => void
}) {
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
  const idx = { x: 0, y: 1, z: 2 }
  return (
    <div className="vecRow">
      <span className="vecLabel">{label}</span>
      <div className="vecCells">
        {axes.map((a) => (
          <label key={a} className="vecCell">
            <span className="vecAxis">{a.toUpperCase()}</span>
            <input
              className="vecInput"
              type="number"
              step="any"
              value={Number.isFinite(value[idx[a]]) ? String(value[idx[a]]) : '0'}
              onChange={(ev) => {
                const v = parseFloat(ev.target.value)
                const next: Vec3 = [...value]
                next[idx[a]] = Number.isFinite(v) ? v : 0
                onChange(next)
              }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

export function InspectorPanel() {
  const { nodes, selectionId, updateNode, setPanelFocus } = useEditor()

  const node = useMemo(
    () => nodes.find((n) => n.id === selectionId) ?? null,
    [nodes, selectionId],
  )

  return (
    <div className="inspectorPanel" onMouseDown={() => setPanelFocus('inspector')}>
      <div className="inspectorHeaderLabel">
        {node ? node.name : 'Nothing selected'}
      </div>
      {!node ? (
        <p className="inspectorHint">Select an object in the viewport or hierarchy.</p>
      ) : (
        <div className="inspectorFoldout">
          <div className="inspectorFoldoutTitle">Transform</div>
          <VecField
            label="Position"
            value={node.position}
            onChange={(p) => updateNode(node.id, { position: p })}
          />
          <VecField
            label="Rotation (°)"
            value={vec3ToEulerDegrees(node.rotation)}
            onChange={(deg) => updateNode(node.id, { rotation: eulerDegreesToRad(deg) })}
          />
          <VecField
            label="Scale"
            value={node.scale}
            onChange={(s) => updateNode(node.id, { scale: s })}
          />
          {node.assetRef ? (
            <p className="inspectorHintMuted">glTF asset ({node.assetRef})</p>
          ) : null}
          {node.gltfDataUrl ? (
            <p className="inspectorHintMuted">glTF mesh (local data URL)</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
