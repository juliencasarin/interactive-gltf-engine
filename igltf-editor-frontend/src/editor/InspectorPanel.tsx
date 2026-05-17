import { useEffect, useMemo, useState } from 'react'
import { fetchAssetSource, isApiConfigured } from '@/api/projectApi'
import {
  introspectExportedInteractionClass,
  type IntrospectedField,
} from '@/scriptRuntime/interactionIntrospection'
import { eulerDegreesToRad, useEditor, vec3ToEulerDegrees } from './EditorContext'
import { isGltfAssetEntry, isScriptAssetEntry } from './assetUtils'
import { MIME_ASSET, dragOverLooksLikeAsset } from './dndTypes'
import type { InteractionSerializedPropsMap, Vec3 } from './types'
import './panels.css'

/** Hide `targetId` from script parameter rows; it is set at runtime from the anchor node's id. */
const INSPECTOR_SCRIPT_FIELD_EXCLUDE = new Set(['targetId'])

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

function coerceInteractionPropValue(
  field: IntrospectedField,
  text: string,
  checkbox: boolean,
): string | number | boolean | null {
  switch (field.valueType) {
    case 'boolean':
      return checkbox
    case 'number':
    case 'bigint': {
      const n = parseFloat(text)
      return Number.isFinite(n) ? n : 0
    }
    case 'null':
      return text.trim() === '' ? null : text
    default:
      return text
  }
}

function InteractionInstanceFieldsBlock({
  projectId,
  scriptAssetRef,
  scriptExportsName,
  sourceFingerprint,
  propsMap,
  onPatchProps,
  assetFetchRev,
}: {
  projectId: string
  scriptAssetRef: string
  scriptExportsName: string
  /** Changes when in-memory script source changes (Monaco). */
  sourceFingerprint: string
  propsMap: InteractionSerializedPropsMap | undefined
  onPatchProps: (next: InteractionSerializedPropsMap | undefined) => void
  assetFetchRev: number
}) {
  const [fields, setFields] = useState<IntrospectedField[] | null>(null)

  useEffect(() => {
    if (!scriptExportsName) {
      setFields([])
      return
    }
    let cancelled = false
    setFields(null)
    void (async () => {
      let src: string | undefined
      if (sourceFingerprint !== '') {
        src = sourceFingerprint
      } else if (isApiConfigured()) {
        try {
          src = await fetchAssetSource(projectId, scriptAssetRef)
        } catch {
          if (!cancelled) setFields([])
          return
        }
      }
      if (!src || cancelled) {
        if (!cancelled) setFields([])
        return
      }
      const list = await introspectExportedInteractionClass(src, scriptExportsName)
      if (!cancelled)
        setFields(list.filter((f) => !INSPECTOR_SCRIPT_FIELD_EXCLUDE.has(f.key)))
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, scriptAssetRef, scriptExportsName, sourceFingerprint, assetFetchRev])

  if (fields === null) {
    return <p className="inspectorHintMuted" style={{ marginTop: 8 }}>Loading script fields…</p>
  }
  if (!fields.length) {
    return (
      <p className="inspectorHintMuted" style={{ marginTop: 8 }}>
        No introspectable public fields on export <code>{scriptExportsName || '—'}</code>. Add a class export or fix
        imports (see <code>/igltf-core/interaction-bases.js</code>).
      </p>
    )
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="inspectorFoldoutTitle" style={{ marginBottom: 6 }}>Script parameters</div>
      <p className="inspectorHintMuted" style={{ marginTop: 0, marginBottom: 8 }}>
        Public fields from your interaction class (merged before <code>onLoaded</code>). Stored as{' '}
        <code>serializedProps</code> on this script attachment.
      </p>
      {fields.map((f) => {
        const stored = propsMap?.[f.key]
        const effective = stored !== undefined ? stored : f.defaultValue
        const isBool = f.valueType === 'boolean'
        const isNum = f.valueType === 'number' || f.valueType === 'bigint'
        const textVal =
          effective === null || effective === undefined
            ? ''
            : isNum && typeof effective === 'number'
              ? String(effective)
              : String(effective)

        return (
          <label key={f.key} className="inspectorBoolRow" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 8 }}>
            <span className="inspectorBoolLbl">
              {f.key} <span className="inspectorHintMuted">({f.valueType})</span>
            </span>
            {isBool ? (
              <input
                type="checkbox"
                checked={Boolean(effective)}
                onChange={(ev) => {
                  const next = { ...(propsMap ?? {}), [f.key]: ev.target.checked }
                  onPatchProps(Object.keys(next).length ? next : undefined)
                }}
              />
            ) : (
              <input
                className="vecInput"
                type={isNum ? 'number' : 'text'}
                step={isNum ? 'any' : undefined}
                value={isNum && !Number.isFinite(Number(textVal)) ? '0' : textVal}
                onChange={(ev) => {
                  const v = coerceInteractionPropValue(f, ev.target.value, ev.target.checked)
                  const next = { ...(propsMap ?? {}), [f.key]: v }
                  onPatchProps(Object.keys(next).length ? next : undefined)
                }}
              />
            )}
          </label>
        )
      })}
      <button
        type="button"
        className="inspectorIconBtn dangerGhost"
        style={{ marginTop: 10 }}
        onClick={() => onPatchProps(undefined)}
      >
        Reset script properties
      </button>
    </div>
  )
}

function readAssetIdFromDataTransfer(dt: DataTransfer | null): string {
  if (!dt) return ''
  return (dt.getData(MIME_ASSET) || dt.getData('text/plain')).trim()
}

export function InspectorPanel() {
  const {
    nodes,
    selectionId,
    updateNode,
    addInteractionAttachment,
    removeInteractionAttachment,
    updateInteractionAttachment,
    setPanelFocus,
    deleteSceneSubtreesConfirm,
    duplicateSceneNode,
    projectAssets,
    projectId,
    assetFetchRev,
  } = useEditor()

  const node = useMemo(
    () => nodes.find((n) => n.id === selectionId) ?? null,
    [nodes, selectionId],
  )

  const attachmentIdsKey = useMemo(
    () => (node?.interactionAttachments ?? []).map((a) => a.id).join('|'),
    [node?.interactionAttachments],
  )

  const [scriptFoldOpen, setScriptFoldOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const list = node?.interactionAttachments ?? []
    setScriptFoldOpen((prev) => {
      const next = { ...prev }
      for (const a of list) {
        if (next[a.id] === undefined) next[a.id] = true
      }
      for (const k of Object.keys(next)) {
        if (!list.some((a) => a.id === k)) delete next[k]
      }
      return next
    })
  }, [node?.id, attachmentIdsKey])

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
        <div
          className={
            node.id !== 'root'
              ? 'inspectorFoldout inspectorDropZoneRoot'
              : 'inspectorFoldout'
          }
          onDragOver={
            node.id === 'root'
              ? undefined
              : (e) => {
                  if (dragOverLooksLikeAsset(e.dataTransfer)) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }
                }
          }
          onDrop={
            node.id === 'root'
              ? undefined
              : (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const aid = readAssetIdFromDataTransfer(e.dataTransfer)
                  const ast = projectAssets.find((a) => a.assetId === aid)
                  if (!aid || !ast || !isScriptAssetEntry(ast)) return
                  addInteractionAttachment(node.id, aid)
                }
          }
        >
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
                if (dragOverLooksLikeAsset(e.dataTransfer)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const aid = readAssetIdFromDataTransfer(e.dataTransfer)
                const ast = projectAssets.find((a) => a.assetId === aid)
                if (!aid || !ast) return
                if (isScriptAssetEntry(ast)) {
                  addInteractionAttachment(node.id, aid)
                  return
                }
                if (isGltfAssetEntry(ast)) {
                  updateNode(node.id, { assetRef: aid })
                }
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

          {node.id !== 'root' ? (
            <>
              <div className="inspectorFoldoutTitle" style={{ marginTop: 14 }}>
                Scripts
              </div>
              <p className="inspectorHintMuted">
                Add one or more interaction scripts and tune their parameters. Each script&apos;s{' '}
                <code>targetId</code> is the selected scene object&apos;s id (the transform it is attached to). Drop a
                script asset anywhere in this panel (when no mesh is attached, use the dashed slot above for glTF
                only). <strong>TODO (export):</strong> map ids to glTF / UMI3D.
              </p>
              <div className="inspectorAssetDropSlot inspectorScriptDropHint">
                Drop interaction script from Assets here or anywhere below (Transform included)
              </div>

              {(node.interactionAttachments ?? []).map((att) => {
                const interactionAsset = projectAssets.find((a) => a.assetId === att.scriptAssetRef)
                const interactionExportName = interactionAsset?.scriptExports?.[0] ?? ''
                const scriptSourceFingerprint = interactionAsset?.sourceText ?? ''
                const assetLabel =
                  interactionAsset?.name?.trim() || att.scriptAssetRef
                return (
                  <details
                    key={att.id}
                    className="inspectorComponentFoldout"
                    open={scriptFoldOpen[att.id] ?? true}
                    onToggle={(e) => {
                      const nextOpen = e.currentTarget.open
                      setScriptFoldOpen((m) => ({ ...m, [att.id]: nextOpen }))
                    }}
                  >
                    <summary className="inspectorComponentFoldoutHeader">
                      <span className="inspectorComponentFoldoutChevron" aria-hidden>
                        ▸
                      </span>
                      <span className="inspectorComponentFoldoutTitle">{assetLabel}</span>
                      <button
                        type="button"
                        className="inspectorComponentRemoveBtn"
                        title="Remove script"
                        aria-label="Remove script"
                        onPointerDown={(ev) => {
                          ev.preventDefault()
                        }}
                        onClick={(ev) => {
                          ev.preventDefault()
                          ev.stopPropagation()
                          removeInteractionAttachment(node.id, att.id)
                        }}
                      >
                        ✕
                      </button>
                    </summary>
                    <div className="inspectorComponentBody">
                      {interactionExportName ? (
                        <InteractionInstanceFieldsBlock
                          projectId={projectId}
                          scriptAssetRef={att.scriptAssetRef}
                          scriptExportsName={interactionExportName}
                          sourceFingerprint={scriptSourceFingerprint}
                          propsMap={att.serializedProps}
                          assetFetchRev={assetFetchRev}
                          onPatchProps={(next) =>
                            updateInteractionAttachment(node.id, att.id, {
                              serializedProps:
                                next !== undefined && Object.keys(next).length > 0 ? next : undefined,
                            })
                          }
                        />
                      ) : (
                        <p className="inspectorHintMuted" style={{ marginTop: 8 }}>
                          No <code>scriptExports</code> on this asset; assign a script export name on the asset or pick
                          another script.
                        </p>
                      )}
                    </div>
                  </details>
                )
              })}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
