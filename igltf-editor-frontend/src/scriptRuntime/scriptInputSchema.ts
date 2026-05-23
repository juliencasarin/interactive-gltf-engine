import {
  introspectExportedInteractionClass,
  type IntrospectedField,
} from './interactionIntrospection'

export type IgltfInputKind = 'scalar' | 'node' | 'script' | 'scriptAttachment' | 'gltfAsset' | 'object'

export type IgltfInputFieldDef = {
  kind: IgltfInputKind | 'string' | 'number' | 'boolean'
  exportName?: string
  fields?: Record<string, IgltfInputFieldDef>
}

export type ScriptInputField = IntrospectedField & {
  inputKind: IgltfInputKind
  inputDef?: IgltfInputFieldDef
}

export type IgltfNodeInputRef = { kind: 'node'; id: string }
export type IgltfScriptInputRef = { kind: 'script'; assetId: string; exportName?: string }
export type IgltfGltfAssetInputRef = { kind: 'gltfAsset'; assetId: string }
export type IgltfScriptAttachmentInputRef = {
  kind: 'scriptAttachment'
  nodeId: string
  attachmentId: string
}
export type IgltfInputRef =
  | IgltfNodeInputRef
  | IgltfScriptInputRef
  | IgltfScriptAttachmentInputRef
  | IgltfGltfAssetInputRef

export type InteractionSerializedPropObject = {
  [key: string]: InteractionSerializedPropValue
}

export type InteractionSerializedPropValue =
  | string
  | number
  | boolean
  | null
  | IgltfInputRef
  | InteractionSerializedPropObject

export type InteractionSerializedPropsMap = Record<string, InteractionSerializedPropValue>

export type ScriptInputValidationContext = {
  nodeIds?: Set<string>
  assets?: { assetId: string; assetKind?: 'gltf' | 'script'; scriptExports?: string[] }[]
  getNodeAttachments?: (nodeId: string) => { id: string; scriptAssetRef: string }[] | undefined
}

export type SemanticInputObject = {
  [key: string]: SemanticInputValue
}

export type SemanticInputValue =
  | string
  | number
  | boolean
  | null
  | { nodeId: string }
  | { scriptAssetId: string; exportName?: string }
  | { gltfAssetId: string }
  | { nodeId: string; attachmentId: string }
  | SemanticInputObject

const IGLTF_INPUT_TAG = /@igltfInput/

function parseIgltfInputJsonFromDoc(doc: string): unknown | undefined {
  if (!IGLTF_INPUT_TAG.test(doc)) return undefined
  const idx = doc.indexOf('@igltfInput')
  const brace = doc.indexOf('{', idx)
  if (brace < 0) return undefined
  let depth = 0
  for (let i = brace; i < doc.length; i += 1) {
    const ch = doc[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(doc.slice(brace, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function parseInputDef(raw: unknown): IgltfInputFieldDef | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (
    kind !== 'node' &&
    kind !== 'script' &&
    kind !== 'scriptAttachment' &&
    kind !== 'gltfAsset' &&
    kind !== 'object' &&
    kind !== 'string' &&
    kind !== 'number' &&
    kind !== 'boolean'
  ) {
    return undefined
  }
  const def: IgltfInputFieldDef = { kind }
  if (typeof o.exportName === 'string' && o.exportName.trim()) def.exportName = o.exportName.trim()
  if (kind === 'object' && o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
    const fields: Record<string, IgltfInputFieldDef> = {}
    for (const [k, v] of Object.entries(o.fields as Record<string, unknown>)) {
      const nested = parseInputDef(v)
      if (nested) fields[k] = nested
    }
    if (Object.keys(fields).length) def.fields = fields
  }
  return def
}

function extractClassBody(source: string, exportName: string): string | undefined {
  const re = new RegExp(
    `export\\s+(?:default\\s+)?class\\s+${exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[^{]*\\{`,
    'm',
  )
  const m = re.exec(source)
  if (!m || m.index === undefined) return undefined
  let i = m.index + m[0].length
  let depth = 1
  const start = i
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    i += 1
  }
  return depth === 0 ? source.slice(start, i - 1) : undefined
}

/** Parse `@igltfInput` JSDoc tags on public fields of an exported class. */
export function parseIgltfInputAnnotations(
  source: string,
  exportName: string,
): Map<string, IgltfInputFieldDef> {
  const out = new Map<string, IgltfInputFieldDef>()
  const body = extractClassBody(source, exportName)
  if (!body) return out

  const fieldRe =
    /\/\*\*([\s\S]*?)\*\/\s*(?:\/\/[^\n]*\n\s*)*(?:@\w[^\n]*\n\s*)*(\w+)\s*(?:=\s*[^;,\n]+)?/g
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(body)) !== null) {
    const doc = m[1]
    const fieldName = m[2]
    if (fieldName.startsWith('_')) continue
    const tag = parseIgltfInputJsonFromDoc(doc)
    if (tag === undefined) continue
    try {
      const parsed = parseInputDef(tag)
      if (parsed) out.set(fieldName, parsed)
    } catch {
      // ignore malformed JSON in tag
    }
  }
  return out
}

function scalarKindFromValueType(vt: IntrospectedField['valueType']): IgltfInputKind {
  if (vt === 'object') return 'object'
  return 'scalar'
}

/** Merge JSDoc `@igltfInput` with runtime field introspection. */
export async function introspectScriptInputs(
  source: string,
  exportName: string,
): Promise<ScriptInputField[]> {
  const annotations = parseIgltfInputAnnotations(source, exportName)
  const fields = await introspectExportedInteractionClass(source, exportName)
  const seen = new Set(fields.map((f) => f.key))
  const merged: ScriptInputField[] = fields.map((f) => {
    const def = annotations.get(f.key)
    if (def) {
      const ik =
        def.kind === 'string' || def.kind === 'number' || def.kind === 'boolean' ? 'scalar' : def.kind
      return { ...f, inputKind: ik, inputDef: def }
    }
    return { ...f, inputKind: scalarKindFromValueType(f.valueType) }
  })
  for (const [key, def] of annotations) {
    if (seen.has(key)) continue
    const ik =
      def.kind === 'string' || def.kind === 'number' || def.kind === 'boolean' ? 'scalar' : def.kind
    merged.push({
      key,
      valueType:
        def.kind === 'number'
          ? 'number'
          : def.kind === 'boolean'
            ? 'boolean'
            : def.kind === 'string'
              ? 'string'
              : def.kind === 'object'
                ? 'object'
                : 'unknown',
      defaultValue: undefined,
      inputKind: ik,
      inputDef: def,
    })
  }
  merged.sort((a, b) => a.key.localeCompare(b.key))
  return merged
}

export function isIgltfInputRef(v: unknown): v is IgltfInputRef {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const k = (v as { kind?: unknown }).kind
  return k === 'node' || k === 'script' || k === 'scriptAttachment' || k === 'gltfAsset'
}

export function isScriptAttachmentInputRef(v: unknown): v is IgltfScriptAttachmentInputRef {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as IgltfScriptAttachmentInputRef
  return o.kind === 'scriptAttachment' && typeof o.nodeId === 'string' && typeof o.attachmentId === 'string'
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function semanticObjectRecord(value: SemanticInputValue): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

function assetById(
  ctx: ScriptInputValidationContext | undefined,
  assetId: string,
): ScriptInputValidationContext['assets'] extends (infer U)[] | undefined ? U | undefined : never {
  return ctx?.assets?.find((a) => a.assetId === assetId)
}

export function validateInputValue(
  field: ScriptInputField,
  value: InteractionSerializedPropValue | undefined,
  ctx?: ScriptInputValidationContext,
): string | undefined {
  if (value === undefined) return undefined
  const kind = field.inputKind

  if (kind === 'scalar') {
    if (value === null) return undefined
    const t = typeof value
    if (field.valueType === 'boolean' && t === 'boolean') return undefined
    if ((field.valueType === 'number' || field.valueType === 'bigint') && t === 'number') return undefined
    if (field.valueType === 'string' && t === 'string') return undefined
    if (field.valueType === 'null' && value === null) return undefined
    if (t === 'string' || t === 'number' || t === 'boolean') return undefined
    return `Expected scalar for ${field.key}`
  }

  if (kind === 'node') {
    if (!isIgltfInputRef(value) || value.kind !== 'node') return `Expected node ref for ${field.key}`
    if (!value.id.trim()) return `Node ref id required for ${field.key}`
    if (ctx?.nodeIds && !ctx.nodeIds.has(value.id)) return `Unknown node id ${value.id} for ${field.key}`
    return undefined
  }

  if (kind === 'script') {
    if (!isIgltfInputRef(value) || value.kind !== 'script') return `Expected script ref for ${field.key}`
    if (!value.assetId.trim()) return `Script assetId required for ${field.key}`
    const asset = assetById(ctx, value.assetId)
    if (ctx?.assets && !asset) return `Unknown script asset ${value.assetId} for ${field.key}`
    if (asset && asset.assetKind && asset.assetKind !== 'script') {
      return `Asset ${value.assetId} is not a script for ${field.key}`
    }
    const requiredExport = field.inputDef?.exportName ?? value.exportName
    if (requiredExport && asset?.scriptExports?.length) {
      if (!asset.scriptExports.includes(requiredExport)) {
        return `Script asset ${value.assetId} does not export ${requiredExport}`
      }
    }
    return undefined
  }

  if (kind === 'scriptAttachment') {
    if (!isScriptAttachmentInputRef(value)) return `Expected scriptAttachment ref for ${field.key}`
    if (!value.nodeId.trim()) return `Node id required for ${field.key}`
    if (!value.attachmentId.trim()) return `Attachment id required for ${field.key}`
    if (ctx?.nodeIds && !ctx.nodeIds.has(value.nodeId)) {
      return `Unknown node id ${value.nodeId} for ${field.key}`
    }
    const atts = ctx?.getNodeAttachments?.(value.nodeId)
    if (atts) {
      const att = atts.find((a) => a.id === value.attachmentId)
      if (!att) return `Unknown attachment ${value.attachmentId} on node ${value.nodeId} for ${field.key}`
      const requiredExport = field.inputDef?.exportName
      if (requiredExport) {
        const asset = assetById(ctx, att.scriptAssetRef)
        if (asset?.scriptExports?.length && !asset.scriptExports.includes(requiredExport)) {
          return `Attachment ${value.attachmentId} script does not export ${requiredExport}`
        }
      }
    }
    return undefined
  }

  if (kind === 'gltfAsset') {
    if (!isIgltfInputRef(value) || value.kind !== 'gltfAsset') return `Expected gltfAsset ref for ${field.key}`
    if (!value.assetId.trim()) return `gltfAsset assetId required for ${field.key}`
    const asset = assetById(ctx, value.assetId)
    if (ctx?.assets && !asset) return `Unknown gltf asset ${value.assetId} for ${field.key}`
    if (asset && asset.assetKind && asset.assetKind !== 'gltf') {
      return `Asset ${value.assetId} is not gltf for ${field.key}`
    }
    return undefined
  }

  if (kind === 'object') {
    if (!isPlainObject(value) || isIgltfInputRef(value) || isScriptAttachmentInputRef(value)) {
      return `Expected object for ${field.key}`
    }
    const fields = field.inputDef?.fields ?? {}
    for (const [subKey, subDef] of Object.entries(fields)) {
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
      const err = validateInputValue(subField, value[subKey] as InteractionSerializedPropValue, ctx)
      if (err) return `${field.key}.${err}`
    }
    return undefined
  }

  return undefined
}

export function coerceInputValue(
  field: ScriptInputField,
  semantic: SemanticInputValue,
): InteractionSerializedPropValue {
  const kind = field.inputKind

  if (kind === 'node') {
    const obj = semanticObjectRecord(semantic)
    if (obj && typeof obj.nodeId === 'string') {
      return { kind: 'node', id: obj.nodeId.trim() }
    }
    if (typeof semantic === 'string') return { kind: 'node', id: semantic.trim() }
    if (isIgltfInputRef(semantic) && semantic.kind === 'node') return semantic
    throw new Error(`Invalid semantic node value for ${field.key}`)
  }

  if (kind === 'script') {
    const obj = semanticObjectRecord(semantic)
    if (obj && typeof obj.scriptAssetId === 'string') {
      const ref: IgltfScriptInputRef = {
        kind: 'script',
        assetId: obj.scriptAssetId.trim(),
      }
      const en =
        typeof obj.exportName === 'string'
          ? obj.exportName.trim()
          : field.inputDef?.exportName
      if (en) ref.exportName = en
      return ref
    }
    if (isIgltfInputRef(semantic) && semantic.kind === 'script') return semantic
    throw new Error(`Invalid semantic script value for ${field.key}`)
  }

  if (kind === 'scriptAttachment') {
    const obj = semanticObjectRecord(semantic)
    if (obj && typeof obj.nodeId === 'string' && typeof obj.attachmentId === 'string') {
      return {
        kind: 'scriptAttachment',
        nodeId: obj.nodeId.trim(),
        attachmentId: obj.attachmentId.trim(),
      }
    }
    if (isScriptAttachmentInputRef(semantic)) return semantic
    throw new Error(`Invalid semantic scriptAttachment value for ${field.key}`)
  }

  if (kind === 'gltfAsset') {
    const obj = semanticObjectRecord(semantic)
    if (obj && typeof obj.gltfAssetId === 'string') {
      return { kind: 'gltfAsset', assetId: obj.gltfAssetId.trim() }
    }
    if (isIgltfInputRef(semantic) && semantic.kind === 'gltfAsset') return semantic
    throw new Error(`Invalid semantic gltfAsset value for ${field.key}`)
  }

  if (kind === 'object') {
    const obj = semanticObjectRecord(semantic)
    if (!obj) throw new Error(`Invalid semantic object for ${field.key}`)
    const fields = field.inputDef?.fields ?? {}
    const out: Record<string, InteractionSerializedPropValue> = {}
    for (const [subKey, subDef] of Object.entries(fields)) {
      if (!(subKey in obj)) continue
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
      out[subKey] = coerceInputValue(subField, obj[subKey] as SemanticInputValue)
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k in out) continue
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v
      }
    }
    return out
  }

  if (semantic === null) return null
  if (typeof semantic === 'boolean') return semantic
  if (typeof semantic === 'number') return semantic
  if (typeof semantic === 'string') {
    if (field.valueType === 'number' || field.valueType === 'bigint') {
      const n = parseFloat(semantic)
      return Number.isFinite(n) ? n : 0
    }
    return semantic
  }
  throw new Error(`Invalid semantic scalar for ${field.key}`)
}

export function formatInputForDisplay(
  field: ScriptInputField,
  stored: InteractionSerializedPropValue | undefined,
  labels?: {
    nodeName?: (id: string) => string
    assetName?: (id: string) => string
    attachmentLabel?: (nodeId: string, attachmentId: string) => string
  },
): string {
  if (stored === undefined || stored === null) return '—'
  if (field.inputKind === 'node' && isIgltfInputRef(stored) && stored.kind === 'node') {
    return labels?.nodeName?.(stored.id) ?? stored.id
  }
  if (field.inputKind === 'scriptAttachment' && isScriptAttachmentInputRef(stored)) {
    return (
      labels?.attachmentLabel?.(stored.nodeId, stored.attachmentId) ??
      `${stored.nodeId} / ${stored.attachmentId}`
    )
  }
  if (field.inputKind === 'script' && isIgltfInputRef(stored) && stored.kind === 'script') {
    const base = labels?.assetName?.(stored.assetId) ?? stored.assetId
    return stored.exportName ? `${base} (${stored.exportName})` : base
  }
  if (field.inputKind === 'gltfAsset' && isIgltfInputRef(stored) && stored.kind === 'gltfAsset') {
    return labels?.assetName?.(stored.assetId) ?? stored.assetId
  }
  if (field.inputKind === 'object' && isPlainObject(stored)) {
    return JSON.stringify(stored)
  }
  return String(stored)
}

function coerceStoredPropValue(raw: unknown): InteractionSerializedPropValue | undefined {
  if (raw === null) return null
  const t = typeof raw
  if (t === 'string' || t === 'number' || t === 'boolean') return raw as string | number | boolean
  if (isIgltfInputRef(raw)) {
    if (raw.kind === 'node' && typeof raw.id === 'string') return { kind: 'node', id: raw.id }
    if (raw.kind === 'script' && typeof raw.assetId === 'string') {
      const ref: IgltfScriptInputRef = { kind: 'script', assetId: raw.assetId }
      if (typeof raw.exportName === 'string' && raw.exportName.trim()) ref.exportName = raw.exportName.trim()
      return ref
    }
    if (raw.kind === 'gltfAsset' && typeof raw.assetId === 'string') {
      return { kind: 'gltfAsset', assetId: raw.assetId }
    }
    if (raw.kind === 'scriptAttachment' && typeof raw.nodeId === 'string' && typeof raw.attachmentId === 'string') {
      return {
        kind: 'scriptAttachment',
        nodeId: raw.nodeId,
        attachmentId: raw.attachmentId,
      }
    }
  }
  if (isScriptAttachmentInputRef(raw)) return raw
  if (isPlainObject(raw)) {
    const out: Record<string, InteractionSerializedPropValue> = {}
    for (const [k, v] of Object.entries(raw)) {
      const coerced = coerceStoredPropValue(v)
      if (coerced !== undefined) out[k] = coerced
    }
    return Object.keys(out).length ? out : undefined
  }
  return undefined
}

/** Accept JSON-serializable props including typed refs and nested objects. */
export function safeInteractionSerializedProps(raw: unknown): InteractionSerializedPropsMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: InteractionSerializedPropsMap = {}
  for (const [k, v] of Object.entries(o)) {
    const coerced = coerceStoredPropValue(v)
    if (coerced !== undefined) out[k] = coerced
  }
  return Object.keys(out).length ? out : undefined
}

export function remapNodeRefsInSerializedProps(
  props: InteractionSerializedPropsMap | undefined,
  nodeIdToGltfIndex: (authoringNodeId: string) => string | undefined,
): InteractionSerializedPropsMap | undefined {
  if (!props) return props
  const out: InteractionSerializedPropsMap = {}
  for (const [k, v] of Object.entries(props)) {
    out[k] = remapNodeRefsInValue(v, nodeIdToGltfIndex)
  }
  return out
}

function remapNodeRefsInValue(
  v: InteractionSerializedPropValue,
  nodeIdToGltfIndex: (authoringNodeId: string) => string | undefined,
): InteractionSerializedPropValue {
  if (isIgltfInputRef(v) && v.kind === 'node') {
    const idx = nodeIdToGltfIndex(v.id)
    return idx !== undefined ? { kind: 'node', id: idx } : v
  }
  if (isScriptAttachmentInputRef(v)) {
    const idx = nodeIdToGltfIndex(v.nodeId)
    return idx !== undefined ? { ...v, nodeId: idx } : v
  }
  if (isPlainObject(v) && !isIgltfInputRef(v) && !isScriptAttachmentInputRef(v)) {
    const nested: Record<string, InteractionSerializedPropValue> = {}
    for (const [k, sub] of Object.entries(v)) {
      nested[k] = remapNodeRefsInValue(sub as InteractionSerializedPropValue, nodeIdToGltfIndex)
    }
    return nested
  }
  return v
}
