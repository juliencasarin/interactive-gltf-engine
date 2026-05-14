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
  const {
    nodes,
    selectionId,
    updateNode,
    setPanelFocus,
    deleteSceneSubtreesConfirm,
    duplicateSceneNode,
    projectAssets,
  } = useEditor()

  const node = useMemo(
    () => nodes.find((n) => n.id === selectionId) ?? null,
    [nodes, selectionId],
  )

  return (
    <div className="inspectorPanel" onMouseDown={() => setPanelFocus('inspector')}>
      <div className="inspectorInspectorTop">
        <div className="inspectorHeaderLabel">
          {node ? node.name : 'Nothing selected'}
        </div>
        {node && node.id !== 'root' ? (
          <div className="inspectorToolbar">
            <button
              type="button"
              className="inspectorIconBtn dangerGhost"
              title="Delete selection"
              aria-label="Delete selection"
              onClick={() => deleteSceneSubtreesConfirm([node.id])}
            >
              🗑
            </button>
            <button
              type="button"
              className="inspectorIconBtn"
              title="Duplicate"
              aria-label="Duplicate selection"
              onClick={() => duplicateSceneNode(node.id)}
            >
              ⧉
            </button>
          </div>
        ) : null}
      </div>
      {!node ? (
        <p className="inspectorHint">Select an object in the viewport or hierarchy.</p>
      ) : (
        <div className="inspectorFoldout">
          <label className="inspectorBoolRow">
            <input
              type="checkbox"
              checked={node.visible !== false}
              onChange={() =>
                updateNode(node.id, { visible: node.visible === false ? undefined : false })
              }
            />
            <span className="inspectorBoolLbl">Visible in viewport</span>
          </label>
          {!node.assetRef && !node.gltfDataUrl ? (
            <div
              className="inspectorAssetDropSlot"
              onDragOver={(e) => {
                if ([...e.dataTransfer.types].includes('application/x-igltf-asset')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const aid =
                  e.dataTransfer.getData('application/x-igltf-asset') ||
                  e.dataTransfer.getData('text/plain').trim()
                if (!aid || !projectAssets.some((a) => a.assetId === aid)) return
                updateNode(node.id, { assetRef: aid })
              }}
            >
              Drop project glTF here to attach (Sketch DragAssetInput — US-SK-073)
            </div>
          ) : null}
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
