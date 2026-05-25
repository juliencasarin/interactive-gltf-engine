import { useEffect, useMemo, useState } from 'react'
import { fetchAssetSource, isApiConfigured } from '@/api/projectApi'
import type { IntrospectedField } from '@/scriptRuntime/interactionIntrospection'
import {
  coerceInputValue,
  formatInputForDisplay,
  introspectScriptInputs,
  isIgltfInputRef,
  isScriptAttachmentInputRef,
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

function scriptCatalogCandidates(
  projectAssets: ProjectAssetEntry[],
  exportName?: string,
): ProjectAssetEntry[] {
  return projectAssets.filter((a) => {
    if (!isScriptAssetEntry(a)) return false
    const req = exportName?.trim()
    if (!req) return true
    if (!a.scriptExports?.length) return true
    return a.scriptExports.includes(req)
  })
}

function gltfCatalogCandidates(projectAssets: ProjectAssetEntry[]): ProjectAssetEntry[] {
  return projectAssets.filter((a) => isGltfAssetEntry(a))
}

function dropZonePlaceholder(field: ScriptInputField): string {
  switch (field.inputKind) {
    case 'node':
      return 'Drop hierarchy node here'
    case 'script':
      return field.inputDef?.exportName
        ? `Drop script asset (export ${field.inputDef.exportName}) or pick below`
        : 'Drop script asset here or pick below'
    case 'gltfAsset':
      return 'Drop glTF asset here or pick below'
    default:
      return 'Drop here'
  }
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
  const rawEffective = stored !== undefined ? stored : (defaultValue as InteractionSerializedPropValue)
  const effective = isUnsetRefValue(field, rawEffective) ? undefined : rawEffective
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const assetById = useMemo(() => new Map(projectAssets.map((a) => [a.assetId, a])), [projectAssets])
  const scriptCandidates = useMemo(
    () => scriptCatalogCandidates(projectAssets, field.inputDef?.exportName),
    [projectAssets, field.inputDef?.exportName],
  )
  const gltfCandidates = useMemo(() => gltfCatalogCandidates(projectAssets), [projectAssets])

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

  const kindLabel = field.inputKind === 'scalar' ? field.valueType : field.inputKind

  if (field.inputKind === 'scriptAttachment') {
    const ref = isScriptAttachmentInputRef(effective) ? effective : undefined
    const hostNode = ref ? nodeById.get(ref.nodeId) : undefined
    const candidates = attachmentsForNode(hostNode, projectAssets, field.inputDef?.exportName)

    return (
      <label className="inspectorBoolRow" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 8 }}>
        <span className="inspectorBoolLbl">
          {field.key} <span className="inspectorHintMuted">(scriptAttachment)</span>
        </span>
        <select
          className="vecInput"
          value={ref?.nodeId ?? ''}
          onChange={(ev) => {
            const nid = ev.target.value
            if (!nid) {
              onChange(undefined)
              return
            }
            const first = attachmentsForNode(nodeById.get(nid), projectAssets, field.inputDef?.exportName)[0]
            if (!first) {
              onChange(undefined)
              return
            }
            onChange(coerceInputValue(field, { nodeId: nid, attachmentId: first.id }))
          }}
        >
          <option value="">— select node —</option>
          {nodes.filter((n) => n.id !== 'root').map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <select
          className="vecInput"
          style={{ marginTop: 4 }}
          value={ref?.attachmentId ?? ''}
          disabled={!ref?.nodeId || !candidates.length}
          onChange={(ev) => {
            const aid = ev.target.value
            if (!ref?.nodeId || !aid) {
              onChange(undefined)
              return
            }
            onChange(coerceInputValue(field, { nodeId: ref.nodeId, attachmentId: aid }))
          }}
        >
          <option value="">— select script attachment —</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>
              {attachmentDisplayLabel(hostNode, a, projectAssets)}
            </option>
          ))}
        </select>
        {ref ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span className="inspectorHintMuted">{display}</span>
            <button type="button" className="inspectorIconBtn dangerGhost" onClick={() => onChange(undefined)}>
              Clear
            </button>
          </div>
        ) : (
          <span className="inspectorHintMuted" style={{ marginTop: 4 }}>
            Pick a node, then the script attachment on that node
            {field.inputDef?.exportName ? ` (${field.inputDef.exportName})` : ''}.
          </span>
        )}
      </label>
    )
  }

  if (field.inputKind === 'node' || field.inputKind === 'script' || field.inputKind === 'gltfAsset') {
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

    return (
      <label className="inspectorBoolRow" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 8 }}>
        <span className="inspectorBoolLbl">
          {field.key} <span className="inspectorHintMuted">({kindLabel})</span>
        </span>
        <div
          className="inspectorDropZoneRoot"
          style={{ padding: '6px 8px', minHeight: 32, display: 'flex', alignItems: 'center', gap: 8 }}
          onDragOver={(e) => {
            if (
              (field.inputKind === 'node' && dragOverLooksLikeHierarchyNode(e.dataTransfer)) ||
              (acceptAssetDrop && dragOverLooksLikeAsset(e.dataTransfer))
            ) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (field.inputKind === 'node') {
              const nid = readHierarchyNodeDragId(e.dataTransfer)
              if (!nid) return
              onChange(coerceInputValue(field, { nodeId: nid }))
              return
            }
            const aid = readAssetIdFromDataTransfer(e.dataTransfer)
            if (!aid || !acceptAssetDrop?.(aid)) return
            if (field.inputKind === 'script') {
              onChange(coerceInputValue(field, { scriptAssetId: aid }))
            } else {
              onChange(coerceInputValue(field, { gltfAssetId: aid }))
            }
          }}
        >
          <span className="inspectorHintMuted" style={{ flex: 1 }}>
            {display === '—' ? dropZonePlaceholder(field) : display}
          </span>
          {!isUnsetRefValue(field, effective) ? (
            <button type="button" className="inspectorIconBtn dangerGhost" onClick={() => onChange(undefined)}>
              Clear
            </button>
          ) : null}
        </div>
        {field.inputKind === 'node' ? (
          <select
            className="vecInput"
            style={{ marginTop: 4 }}
            value={isIgltfInputRef(effective) && effective.kind === 'node' ? effective.id : ''}
            onChange={(ev) => {
              const v = ev.target.value
              if (!v) onChange(undefined)
              else onChange(coerceInputValue(field, { nodeId: v }))
            }}
          >
            <option value="">— select node —</option>
            {nodes.filter((n) => n.id !== 'root').map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        ) : null}
        {field.inputKind === 'script' ? (
          <>
            <select
              className="vecInput"
              style={{ marginTop: 4 }}
              value={isIgltfInputRef(effective) && effective.kind === 'script' ? effective.assetId : ''}
              onChange={(ev) => {
                const v = ev.target.value
                if (!v) onChange(undefined)
                else onChange(coerceInputValue(field, { scriptAssetId: v }))
              }}
            >
              <option value="">— select script asset —</option>
              {scriptCandidates.map((a) => (
                <option key={a.assetId} value={a.assetId}>
                  {assetDisplayLabel(a)}
                  {a.scriptExports?.length ? ` (${a.scriptExports.join(', ')})` : ''}
                </option>
              ))}
            </select>
            {!scriptCandidates.length ? (
              <span className="inspectorHintMuted" style={{ marginTop: 4 }}>
                No script assets in catalog
                {field.inputDef?.exportName ? ` exporting ${field.inputDef.exportName}` : ''}. Add one under{' '}
                <code>assets/</code> and refresh.
              </span>
            ) : null}
          </>
        ) : null}
        {field.inputKind === 'gltfAsset' ? (
          <select
            className="vecInput"
            style={{ marginTop: 4 }}
            value={isIgltfInputRef(effective) && effective.kind === 'gltfAsset' ? effective.assetId : ''}
            onChange={(ev) => {
              const v = ev.target.value
              if (!v) onChange(undefined)
              else onChange(coerceInputValue(field, { gltfAssetId: v }))
            }}
          >
            <option value="">— select glTF asset —</option>
            {gltfCandidates.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {assetDisplayLabel(a)}
              </option>
            ))}
          </select>
        ) : null}
      </label>
    )
  }

  if (field.inputKind === 'object' && field.inputDef?.fields) {
    const objVal =
      effective && typeof effective === 'object' && !Array.isArray(effective) && !isIgltfInputRef(effective)
        ? (effective as Record<string, InteractionSerializedPropValue>)
        : {}
    return (
      <div style={{ marginTop: 8 }}>
        <div className="inspectorBoolLbl">
          {field.key} <span className="inspectorHintMuted">(object)</span>
        </div>
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
    )
  }

  const isBool = field.valueType === 'boolean'
  const isNum = field.valueType === 'number' || field.valueType === 'bigint'
  const textVal =
    effective === null || effective === undefined
      ? ''
      : isNum && typeof effective === 'number'
        ? String(effective)
        : String(effective)

  return (
    <label className="inspectorBoolRow" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 8 }}>
      <span className="inspectorBoolLbl">
        {field.key} <span className="inspectorHintMuted">({kindLabel})</span>
      </span>
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
    </label>
  )
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
