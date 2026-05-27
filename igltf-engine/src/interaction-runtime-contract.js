/**
 * Portable interaction runtime contract (Play / igltf-engine).
 * Maps UMI3D browser-request intents to script invocation payloads — not Forge wire format.
 */

/** @typedef {'event'|'link'|'form'|'manipulation'|'parameter'|'unsupported'} InteractionKind */

/** @typedef {'toolProjected'|'toolReleased'|'hoverStateChanged'|'hovered'|'eventTriggered'|'eventStateChanged'|'parameterSetting'|'linkOpened'|'formAnswer'|'manipulationRequest'} InteractionRequestKind */

/**
 * @typedef {Object} BoneContext
 * @property {number} boneType
 * @property {{x:number,y:number,z:number}} bonePosition
 * @property {{x:number,y:number,z:number,w:number}} boneRotation
 */

/**
 * @typedef {Object} InteractionContext
 * @property {string} toolId
 * @property {string} interactionId
 * @property {number} gltfNodeIndex
 * @property {string} hoveredObjectId
 * @property {InteractionKind} interactionKind
 * @property {string} selectorId
 * @property {string} [inputId]
 * @property {BoneContext} bone
 */

/**
 * @typedef {Object} InteractionInvokePayload
 * @property {InteractionRequestKind} requestKind
 * @property {InteractionContext} context
 * @property {Record<string, unknown>} [request]
 * @property {Record<string, unknown>} umi3d
 */

export const SUPPORTED_INTERACTION_KINDS = /** @type {const} */ ([
  'event',
  'link',
  'form',
  'manipulation',
  'parameter',
])

export const UNSUPPORTED_INTERACTION_KINDS = /** @type {const} */ (['drawing'])

/**
 * @param {string|undefined} raw
 * @returns {InteractionKind}
 */
export function normalizeInteractionKind(raw) {
  const k = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (k === 'drawing') return 'unsupported'
  if (k === 'event' || k === 'link' || k === 'form' || k === 'manipulation') return k
  if (
    k === 'boolean' ||
    k === 'string' ||
    k === 'float' ||
    k === 'integer' ||
    k === 'enum' ||
    k === 'color' ||
    k === 'vector2' ||
    k === 'vector3' ||
    k === 'vector4' ||
    k === 'floatrange' ||
    k === 'integerrange' ||
    k === 'upload' ||
    k === 'parameter'
  ) {
    return 'parameter'
  }
  return 'unsupported'
}

/**
 * @param {InteractionRequestKind} requestKind
 * @param {InteractionContext} context
 * @param {Record<string, unknown>} [extra]
 * @returns {InteractionInvokePayload}
 */
export function buildInvokePayload(requestKind, context, extra = {}) {
  return {
    requestKind,
    context,
    request: extra,
    umi3d: {
      protoAttachmentId: context.interactionId,
      interactionType: context.interactionKind,
      toolId: context.toolId,
      hoveredObjectId: context.hoveredObjectId,
      selectorId: context.selectorId,
      gltfNodeIndex: context.gltfNodeIndex,
      ...extra,
    },
  }
}

/**
 * Primary script method for an interaction kind (author scripts).
 * @param {InteractionKind} kind
 * @returns {string}
 */
export function primaryMethodForKind(kind) {
  switch (kind) {
    case 'event':
      return 'onEvent'
    case 'link':
      return 'onLink'
    case 'form':
      return 'onForm'
    case 'manipulation':
      return 'onManipulation'
    case 'parameter':
      return 'onParameter'
    default:
      return 'handleInteraction'
  }
}
