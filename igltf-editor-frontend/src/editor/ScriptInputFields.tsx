import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchAssetSource, isApiConfigured } from '@/api/projectApi'
import type { IntrospectedField } from '@/scriptRuntime/interactionIntrospection'
import {
  coerceInputValue,
  formatInputForDisplay,
  introspectScriptInputs,
  isIgltfInputRef,
  type InteractionSerializedPropValue,
  type InteractionSerializedPropsMap,
  type ScriptInputField,
} from '@/scriptRuntime/scriptInputSchema'
import { assetDisplayLabel, isGltfAssetEntry, isScriptAssetEntry } from './assetUtils'
import {
  dragOverLooksLikeAsset,
  dragOverLooksLikeHierarchyNode,
  MIME_ASSET,
  readHierarchyNodeDragId,
} from './dndTypes'
import type { EditorNode, InteractionScriptAttachment, ProjectAssetEntry } from './types'

/** Hide `targetId` from script parameter rows; it is set at runtime from the anchor node's id. */
const INSPECTOR_SCRIPT_FIELD_EXCLUDE = new Set(['targetId'])

type PendingScriptAttachmentPick = {
  nodeId: string
  attachments: InteractionScriptAttachment[]
}

function attachmentsForNode(
  node: EditorNode | undefined,
  projectAssets: ProjectAssetEntry[],
  exportName?: string,
): InteractionScriptAttachment[] {
  const atts = node?.interactionAttachments ?? []
  if (!exportName?.trim()) return atts
  return atts.filter((a) => {
    const asset = projectAssets.find((p) => p.assetId === a.scriptAssetRef)
    return asset?.scriptExports?.includes(exportName)
  })
}

function attachmentDisplayLabel(
  node: EditorNode | undefined,
  att: InteractionScriptAttachment,
  projectAssets: ProjectAssetEntry[],
): string {
  const asset = projectAssets.find((p) => p.assetId === att.scriptAssetRef)
  const exportName = asset?.scriptExports?.[0] ?? att.scriptAssetRef
  const nodeName = node?.name ?? '?'
  return `${nodeName} / ${exportName}`
}

function readAssetIdFromDataTransfer(dt: DataTransfer | null): string {
  if (!dt) return ''
  return (dt.getData(MIME_ASSET) || dt.getData('text/plain')).trim()
}

function isUnsetRefValue(field: ScriptInputField, value: InteractionSerializedPropValue | undefined): boolean {
  if (value === undefined || value === null) return true
  if (
    typeof value === 'string' &&
    !value.trim() &&
    (field.inputKind === 'node' ||
      field.inputKind === 'script' ||
      field.inputKind === 'gltfAsset' ||
      field.inputKind === 'scriptAttachment')
  ) {
    return true
  }
  return false
}

function refPlaceholder(field: ScriptInputField): string {
  switch (field.inputKind) {
    case 'node':
      return 'Drop node'
    case 'script':
      return field.inputDef?.exportName ? `Drop script (${field.inputDef.exportName})` : 'Drop script'
    case 'gltfAsset':
      return 'Drop glTF asset'
    case 'scriptAttachment':
      return field.inputDef?.exportName
        ? `Drop node (${field.inputDef.exportName})`
        : 'Drop node with script'
    default:
      return '—'
  }
}

function fieldKindTitle(field: ScriptInputField): string {
  if (field.inputKind === 'scalar') return field.valueType
  return field.inputKind
}

function coerceScalarPropValue(
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

function ScriptInputRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="scriptInputRow">
      <span className="scriptInputLabel" title={title ?? label}>
        {label}
      </span>
      <div className="scriptInputValue">{children}</div>
    </div>
  )
}

function ScriptInputClearBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="scriptInputClear" title="Clear" aria-label="Clear" onClick={onClick}>
      ✕
    </button>
  )
}

function ScriptInputScalarRow({
  field,
  effective,
  onChange,
}: {
  field: ScriptInputField
  effective: InteractionSerializedPropValue | undefined
  onChange: (value: InteractionSerializedPropValue | undefined) => void
}) {
  const isBool = field.valueType === 'boolean'
  const isNum = field.valueType === 'number' || field.valueType === 'bigint'
  const textVal =
    effective === null || effective === undefined
      ? ''
      : isNum && typeof effective === 'number'
        ? String(effective)
        : String(effective)

  return (
    <ScriptInputRow label={field.key} title={fieldKindTitle(field)}>
      {isBool ? (
        <input
          type="checkbox"
          checked={Boolean(effective)}
          onChange={(ev) => onChange(ev.target.checked)}
        />
      ) : (
        <input
          className="vecInput"
          type={isNum ? 'number' : 'text'}
          step={isNum ? 'any' : undefined}
          value={isNum && !Number.isFinite(Number(textVal)) ? '0' : textVal}
          onChange={(ev) => {
            onChange(coerceScalarPropValue(field, ev.target.value, ev.target.checked))
          }}
        />
      )}
    </ScriptInputRow>
  )
}

function ScriptInputRefRow({
  field,
  display,
  hasValue,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onClear,
  pendingPick,
  onPickAttachment,
  onCancelPick,
  nodeById,
  projectAssets,
}: {
  field: ScriptInputField
  display: string
  hasValue: boolean
  dragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onClear: () => void
  pendingPick?: PendingScriptAttachmentPick
  onPickAttachment?: (attachmentId: string) => void
  onCancelPick?: () => void
  nodeById: Map<string, EditorNode>
  projectAssets: ProjectAssetEntry[]
}) {
  const hostNode = pendingPick ? nodeById.get(pendingPick.nodeId) : undefined

  if (pendingPick && pendingPick.attachments.length > 1 && onPickAttachment) {
    return (
      <ScriptInputRow label={field.key} title={fieldKindTitle(field)}>
        <select
          className="vecInput"
          value=""
          autoFocus
          onChange={(ev) => {
            const aid = ev.target.value
            if (aid) onPickAttachment(aid)
          }}
        >
          <option value="">— pick script —</option>
          {pendingPick.attachments.map((a) => (
            <option key={a.id} value={a.id}>
              {attachmentDisplayLabel(hostNode, a, projectAssets)}
            </option>
          ))}
        </select>
        {onCancelPick ? (
          <button type="button" className="scriptInputClear" title="Cancel" aria-label="Cancel" onClick={onCancelPick}>
            ✕
          </button>
        ) : null}
      </ScriptInputRow>
    )
  }

  return (
    <ScriptInputRow label={field.key} title={fieldKindTitle(field)}>
      <input
        readOnly
        className={`vecInput scriptInputRef${dragOver ? ' scriptInputRef--dragOver' : ''}`}
        value={hasValue ? display : ''}
        placeholder={hasValue ? undefined : refPlaceholder(field)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
      {hasValue ? <ScriptInputClearBtn onClick={onClear} /> : null}
    </ScriptInputRow>
  )
}

function ScriptInputFieldRow({
  field,
  stored,
  defaultValue,
  nodes,
  projectAssets,
  onChange,
}: {
  field: ScriptInputField
  stored: InteractionSerializedPropValue | undefined
  defaultValue: unknown
  nodes: EditorNode[]
  projectAssets: ProjectAssetEntry[]
  onChange: (value: InteractionSerializedPropValue | undefined) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [pendingPick, setPendingPick] = useState<PendingScriptAttachmentPick | undefined>()

  const rawEffective = stored !== undefined ? stored : (defaultValue as InteractionSerializedPropValue)
  const effective = isUnsetRefValue(field, rawEffective) ? undefined : rawEffective
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const assetById = useMemo(() => new Map(projectAssets.map((a) => [a.assetId, a])), [projectAssets])

  const display = formatInputForDisplay(field, effective, {
    nodeName: (id) => nodeById.get(id)?.name ?? id,
    assetName: (id) => {
      const a = assetById.get(id)
      return a ? assetDisplayLabel(a) : id
    },
    attachmentLabel: (nodeId, attachmentId) => {
      const node = nodeById.get(nodeId)
      const att = node?.interactionAttachments?.find((a) => a.id === attachmentId)
      if (!node || !att) return `${nodeId} / ${attachmentId}`
      return attachmentDisplayLabel(node, att, projectAssets)
    },
  })

  const acceptAssetDrop =
    field.inputKind === 'script'
      ? (aid: string) => {
          const ast = projectAssets.find((a) => a.assetId === aid)
          if (!ast || !isScriptAssetEntry(ast)) return false
          const req = field.inputDef?.exportName
          if (req && ast.scriptExports?.length && !ast.scriptExports.includes(req)) return false
          return true
        }
      : field.inputKind === 'gltfAsset'
        ? (aid: string) => {
            const ast = projectAssets.find((a) => a.assetId === aid)
            return Boolean(ast && isGltfAssetEntry(ast))
          }
        : undefined

  const canAcceptDrag = (dt: DataTransfer | null): boolean => {
    if (!dt) return false
    if (field.inputKind === 'node' || field.inputKind === 'scriptAttachment') {
      return dragOverLooksLikeHierarchyNode(dt)
    }
    if (field.inputKind === 'script' || field.inputKind === 'gltfAsset') {
      return Boolean(acceptAssetDrop && dragOverLooksLikeAsset(dt))
    }
    return false
  }

  const handleRefDragOver = (e: React.DragEvent) => {
    if (!canAcceptDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const handleRefDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    setPendingPick(undefined)

    if (field.inputKind === 'node') {
      const nid = readHierarchyNodeDragId(e.dataTransfer)
      if (!nid) return
      onChange(coerceInputValue(field, { nodeId: nid }))
      return
    }

    if (field.inputKind === 'scriptAttachment') {
      const nid = readHierarchyNodeDragId(e.dataTransfer)
      if (!nid) return
      const node = nodeById.get(nid)
      const candidates = attachmentsForNode(node, projectAssets, field.inputDef?.exportName)
      if (!candidates.length) return
      if (candidates.length === 1) {
        onChange(coerceInputValue(field, { nodeId: nid, attachmentId: candidates[0].id }))
        return
      }
      setPendingPick({ nodeId: nid, attachments: candidates })
      return
    }

    const aid = readAssetIdFromDataTransfer(e.dataTransfer)
    if (!aid || !acceptAssetDrop?.(aid)) return
    if (field.inputKind === 'script') {
      onChange(coerceInputValue(field, { scriptAssetId: aid }))
    } else if (field.inputKind === 'gltfAsset') {
      onChange(coerceInputValue(field, { gltfAssetId: aid }))
    }
  }

  if (
    field.inputKind === 'node' ||
    field.inputKind === 'script' ||
    field.inputKind === 'gltfAsset' ||
    field.inputKind === 'scriptAttachment'
  ) {
    const hasValue = !isUnsetRefValue(field, effective)
    return (
      <ScriptInputRefRow
        field={field}
        display={display === '—' ? '' : display}
        hasValue={hasValue}
        dragOver={dragOver}
        onDragOver={handleRefDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleRefDrop}
        onClear={() => {
          setPendingPick(undefined)
          onChange(undefined)
        }}
        pendingPick={field.inputKind === 'scriptAttachment' ? pendingPick : undefined}
        onPickAttachment={
          field.inputKind === 'scriptAttachment' && pendingPick
            ? (attachmentId) => {
                onChange(
                  coerceInputValue(field, { nodeId: pendingPick.nodeId, attachmentId }),
                )
                setPendingPick(undefined)
              }
            : undefined
        }
        onCancelPick={() => setPendingPick(undefined)}
        nodeById={nodeById}
        projectAssets={projectAssets}
      />
    )
  }

  if (field.inputKind === 'object' && field.inputDef?.fields) {
    const objVal =
      effective && typeof effective === 'object' && !Array.isArray(effective) && !isIgltfInputRef(effective)
        ? (effective as Record<string, InteractionSerializedPropValue>)
        : {}
    return (
      <div className="scriptInputObjectBlock">
        <ScriptInputRow label={field.key} title="object">
          <span className="inspectorHintMuted">object</span>
        </ScriptInputRow>
        <div className="scriptInputObjectGroup">
          {Object.entries(field.inputDef.fields).map(([subKey, subDef]) => {
            const subField: ScriptInputField = {
              key: subKey,
              valueType:
                subDef.kind === 'number'
                  ? 'number'
                  : subDef.kind === 'boolean'
                    ? 'boolean'
                    : subDef.kind === 'string'
                      ? 'string'
                      : 'unknown',
              defaultValue: undefined,
              inputKind:
                subDef.kind === 'string' || subDef.kind === 'number' || subDef.kind === 'boolean'
                  ? 'scalar'
                  : subDef.kind,
              inputDef: subDef,
            }
            return (
              <ScriptInputFieldRow
                key={subKey}
                field={subField}
                stored={objVal[subKey]}
                defaultValue={undefined}
                nodes={nodes}
                projectAssets={projectAssets}
                onChange={(v) => {
                  const nextObj = { ...objVal }
                  if (v === undefined) delete nextObj[subKey]
                  else nextObj[subKey] = v
                  onChange(Object.keys(nextObj).length ? nextObj : undefined)
                }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return <ScriptInputScalarRow field={field} effective={effective} onChange={onChange} />
}

export function InteractionInstanceFieldsBlock({
  projectId,
  scriptAssetRef,
  scriptExportsName,
  sourceFingerprint,
  propsMap,
  onPatchProps,
  assetFetchRev,
  nodes,
  projectAssets,
}: {
  projectId: string
  scriptAssetRef: string
  scriptExportsName: string
  sourceFingerprint: string
  propsMap: InteractionSerializedPropsMap | undefined
  onPatchProps: (next: InteractionSerializedPropsMap | undefined) => void
  assetFetchRev: number
  nodes: EditorNode[]
  projectAssets: ProjectAssetEntry[]
}) {
  const [fields, setFields] = useState<ScriptInputField[] | null>(null)

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
      const list = await introspectScriptInputs(src, scriptExportsName)
      if (!cancelled) setFields(list.filter((f) => !INSPECTOR_SCRIPT_FIELD_EXCLUDE.has(f.key)))
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
        Public fields from your interaction class (merged before <code>onLoaded</code>). Use{' '}
        <code>@igltfInput</code> for typed refs. Stored as <code>serializedProps</code>.
      </p>
      {fields.map((f) => (
        <ScriptInputFieldRow
          key={f.key}
          field={f}
          stored={propsMap?.[f.key]}
          defaultValue={f.defaultValue}
          nodes={nodes}
          projectAssets={projectAssets}
          onChange={(v) => {
            const next = { ...(propsMap ?? {}) }
            if (v === undefined) delete next[f.key]
            else next[f.key] = v
            onPatchProps(Object.keys(next).length ? next : undefined)
          }}
        />
      ))}
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
