import {
  coerceInputValue,
  introspectScriptInputs,
  validateInputValue,
  type ScriptInputField,
  type SemanticInputValue,
} from '../scriptRuntime/scriptInputSchema'
import { isScriptAssetEntry } from './assetUtils'
import type { EditorMcpCommandHandlers, EditorMcpCommandResult } from './editorMcpCommands'
import type { InteractionSerializedPropsMap } from './types'

function fail(code: string, message: string): EditorMcpCommandResult {
  return { ok: false, error: { code, message } }
}

function ok(revision: number, result?: unknown): EditorMcpCommandResult {
  return { ok: true, revision, ...(result !== undefined ? { result } : {}) }
}

export async function handleSetScriptInputs(
  params: Record<string, unknown>,
  handlers: EditorMcpCommandHandlers,
): Promise<EditorMcpCommandResult> {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
  const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId : ''
  const rawInputs = params.inputs

  if (!nodeId || !attachmentId) {
    return fail('invalid_argument', 'nodeId and attachmentId are required')
  }
  if (!Array.isArray(rawInputs) || !rawInputs.length) {
    return fail('invalid_argument', 'inputs must be a non-empty array')
  }

  const node = handlers.getNodes().find((n) => n.id === nodeId)
  if (!node) return fail('node_not_found', `Node ${nodeId} not found`)

  const attachment = node.interactionAttachments?.find((a) => a.id === attachmentId)
  if (!attachment) {
    return fail('attachment_not_found', `Attachment ${attachmentId} not found on node ${nodeId}`)
  }

  const scriptAsset = handlers.getProjectAssets().find((a) => a.assetId === attachment.scriptAssetRef)
  if (!scriptAsset || !isScriptAssetEntry(scriptAsset)) {
    return fail('asset_not_found', `Script asset ${attachment.scriptAssetRef} not found`)
  }

  const exportName = scriptAsset.scriptExports?.[0]
  if (!exportName) {
    return fail('script_export_missing', `Script asset ${scriptAsset.assetId} has no scriptExports[0]`)
  }

  let source: string
  try {
    source = await handlers.fetchScriptSource(scriptAsset.assetId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not read script source'
    return fail('script_source_unavailable', msg)
  }

  const fields = await introspectScriptInputs(source, exportName)
  const fieldByKey = new Map<string, ScriptInputField>(
    fields.filter((f) => f.key !== 'targetId').map((f) => [f.key, f]),
  )

  const nodeIds = new Set(handlers.getNodes().map((n) => n.id))
  const assets = handlers.getProjectAssets().map((a) => ({
    assetId: a.assetId,
    assetKind: a.assetKind,
    scriptExports: a.scriptExports,
  }))
  const nodesById = new Map(handlers.getNodes().map((n) => [n.id, n]))

  const merged: InteractionSerializedPropsMap = { ...(attachment.serializedProps ?? {}) }

  for (const raw of rawInputs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return fail('invalid_argument', 'Each input must be an object with field and value')
    }
    const field = (raw as { field?: unknown }).field
    const value = (raw as { value?: unknown }).value
    if (typeof field !== 'string' || !field.trim()) {
      return fail('invalid_argument', 'Each input requires a non-empty field name')
    }
    if (field === 'targetId') {
      return fail('invalid_argument', 'Do not set targetId via MCP — runtime injects it from the host node')
    }

    const schema = fieldByKey.get(field)
    if (!schema) {
      return fail('unknown_field', `Unknown or non-writable field ${field}`)
    }

    let stored
    try {
      stored = coerceInputValue(schema, value as SemanticInputValue)
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Invalid value for ${field}`
      return fail('invalid_input_value', msg)
    }

    const err = validateInputValue(schema, stored, {
      nodeIds,
      assets,
      getNodeAttachments: (nid) => nodesById.get(nid)?.interactionAttachments,
    })
    if (err) return fail('validation_failed', err)

    merged[field] = stored
  }

  handlers.updateInteractionAttachment(nodeId, attachmentId, { serializedProps: merged })
  return ok(handlers.getRevision(), { serializedProps: merged })
}
