/**
 * @typedef {import('./interaction-runtime-contract.js').InteractionContext} InteractionContext
 * @typedef {import('./interaction-runtime-contract.js').InteractionInvokePayload} InteractionInvokePayload
 */

import { buildInvokePayload } from './interaction-runtime-contract.js'

/**
 * @typedef {Object} ProjectionDeps
 * @property {(attachmentId: string, handlerId: string, payload: InteractionInvokePayload, method: string) => Promise<unknown>} invoke
 * @property {(environmentId: string, animationId: string|number) => void} [animate]
 */

/**
 * @typedef {Object} Projection
 * @property {import('./selector.js').Selector} selector
 * @property {import('./tool-registry.js').ToolRecord} tool
 * @property {import('./interaction-registry.js').InteractionRecord} interaction
 * @property {import('./pc-input-layer.js').BoundInput|null} input
 * @property {() => void} clear
 * @property {(active: boolean) => Promise<void>} sendEventStateChanged
 * @property {() => Promise<void>} sendEventTriggered
 * @property {() => Promise<void>} sendParameterSetting
 * @property {(url: string) => Promise<void>} sendLinkOpened
 * @property {(answers: Record<string, unknown>) => Promise<void>} sendFormAnswer
 * @property {(translation: {x:number,y:number,z:number}, rotation: {x:number,y:number,z:number,w:number}) => Promise<void>} sendManipulation
 */

/**
 * @param {import('./selector.js').Selector} selector
 * @param {import('./tool-registry.js').ToolRecord} tool
 * @param {import('./interaction-registry.js').InteractionRecord} interaction
 * @param {import('./pc-input-layer.js').BoundInput|null} input
 * @param {ProjectionDeps} deps
 * @returns {Projection}
 */
export function createProjection(selector, tool, interaction, input, deps) {
  const baseContext = () => /** @type {InteractionContext} */ ({
    toolId: tool.id,
    interactionId: interaction.attachmentId,
    gltfNodeIndex: tool.gltfNodeIndex,
    hoveredObjectId: selector.hoveredObjectId ?? String(tool.gltfNodeIndex),
    interactionKind: interaction.kind,
    selectorId: selector.id,
    inputId: input?.id,
    bone: selector.getBoneContext(),
  })

  const invoke = async (requestKind, extra = {}, methodOverride) => {
    const payload = buildInvokePayload(requestKind, baseContext(), extra)
    const method =
      methodOverride ??
      (interaction.kind === 'event'
        ? 'onEvent'
        : interaction.kind === 'link'
          ? 'onLink'
          : interaction.kind === 'form'
            ? 'onForm'
            : interaction.kind === 'manipulation'
              ? 'onManipulation'
              : 'handleInteraction')
    return deps.invoke(interaction.attachmentId, interaction.scriptHandlerId, payload, method)
  }

  /** @type {Projection} */
  const projection = {
    selector,
    tool,
    interaction,
    input,
    clear: () => {
      input?.clear?.()
    },
    async sendEventStateChanged(active) {
      await invoke('eventStateChanged', { active, eventType: active ? 'holdStart' : 'holdEnd' }, 'onEvent')
    },
    async sendEventTriggered() {
      await invoke('eventTriggered', { eventType: 'trigger' }, 'onEvent')
    },
    async sendParameterSetting() {
      await invoke('parameterSetting', { parameter: interaction.dto }, 'onParameter')
    },
    async sendLinkOpened(url) {
      await invoke('linkOpened', { url }, 'onLink')
    },
    async sendFormAnswer(answers) {
      await invoke('formAnswer', { answers }, 'onForm')
    },
    async sendManipulation(translation, rotation) {
      await invoke('manipulationRequest', { translation, rotation }, 'onManipulation')
    },
  }

  return projection
}
