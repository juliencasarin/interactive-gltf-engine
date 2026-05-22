/**
 * Interaction script templates (plain JS modules, class-based — Unity/MonoBehaviour-style).
 * @see interactive-gltf-specs proposals/proposal-umi3d-interaction-model.md
 */

import { INTERACTION_BASES_IMPORT_PATH } from './interactionBasesUrl'

/** Non-parameter interaction rows (v1 template set). */
export type InteractionTemplateKind = 'event' | 'link' | 'form' | 'manipulation' | 'drawing'

export const INTERACTION_TEMPLATE_MENU: { kind: InteractionTemplateKind; label: string }[] = [
  { kind: 'event', label: 'Event' },
  { kind: 'link', label: 'Link' },
  { kind: 'form', label: 'Form' },
  { kind: 'manipulation', label: 'Manipulation' },
  { kind: 'drawing', label: 'Drawing' },
]

export function interactionMainMethodForKind(kind: InteractionTemplateKind): string {
  switch (kind) {
    case 'event':
      return 'onEvent'
    case 'link':
      return 'onLink'
    case 'form':
      return 'onForm'
    case 'manipulation':
      return 'onManipulation'
    case 'drawing':
      return 'onDrawing'
  }
}

function defaultClassName(kind: InteractionTemplateKind): string {
  switch (kind) {
    case 'event':
      return 'OnEventInteraction'
    case 'link':
      return 'OnLinkInteraction'
    case 'form':
      return 'OnFormInteraction'
    case 'manipulation':
      return 'OnManipulationInteraction'
    case 'drawing':
      return 'OnDrawingInteraction'
  }
}

/** Valid JS class name (PascalCase fallback). */
export function sanitizeClassBaseName(raw: string | undefined, kind: InteractionTemplateKind): string {
  const fallback = defaultClassName(kind)
  if (!raw?.trim()) return fallback
  let s = raw.trim().replace(/[^a-zA-Z0-9_$]/g, '_')
  if (/^[0-9]/.test(s)) s = `_${s}`
  if (!/^[A-Z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1)
  return s || fallback
}

function baseClassForKind(kind: InteractionTemplateKind): string {
  switch (kind) {
    case 'event':
      return 'EventInteraction'
    case 'link':
      return 'LinkInteraction'
    case 'form':
      return 'FormInteraction'
    case 'manipulation':
      return 'ManipulationInteraction'
    case 'drawing':
      return 'DrawingInteraction'
  }
}

function gltfTypeForKind(kind: InteractionTemplateKind): string {
  switch (kind) {
    case 'event':
      return 'Event'
    case 'link':
      return 'Link'
    case 'form':
      return 'Form'
    case 'manipulation':
      return 'Manipulation'
    case 'drawing':
      return 'Drawing'
  }
}

function payloadUmi3dHint(kind: InteractionTemplateKind): string {
  switch (kind) {
    case 'event':
      return 'EventTriggeredDto-style fields: interaction id, optional hover/tool context — see UMI3D SDK / proposal text (not a full SDK paste).'
    case 'link':
      return 'Link / navigation request shape: target URI or resource id.'
    case 'form':
      return 'Form submit / field values map.'
    case 'manipulation':
      return 'Manipulation / grab: tool id, bone, constraint flags.'
    case 'drawing':
      return 'Drawing stroke / anchor updates — informative.'
  }
}

function templateComment(kind: InteractionTemplateKind, className: string, gltfType: string): string {
  return `
/**
 * —— Illustrative glTF interaction DTO (extension placement TBD) ——
 * {
 *   "id": "TODO_INTERACTION_ID",
 *   "type": "${gltfType}",
 *   "name": "TODO_LABEL",
 *   "callback": "${className}",
 *   "payload": { }
 * }
 *
 * Class hierarchy: ${baseClassForKind(kind)} → Interaction → GlTFScript (/igltf-core/interaction-bases.js).
 * Public fields (targetId, …) come from the kind base; override per attachment via serializedProps.
 *
 * —— payload.umi3d ——
 * ${payloadUmi3dHint(kind)}
 *
 * Runtime provides global GLTF (host API) with getObjectByUmi3dId, createTransaction, etc.
 */
`.trim()
}

function classStub(
  kind: InteractionTemplateKind,
  className: string,
  baseClass: string,
  mainMethod: string,
): string {
  const returnTx =
    kind === 'manipulation'
      ? `    return GLTF.createTransaction()
      .addSetLocalEulerDegrees(entityId, { x: 0, y: 5, z: 0 })
      .toJSON()`
      : `    return GLTF.createTransaction()
      .addSetLocalPosition(entityId, { x: pos.x, y: pos.y + 0.1, z: pos.z })
      .toJSON()`

  return `
export class ${className} extends ${baseClass} {
  constructor() {
    super()
  }

  /** Called once after attachment props are merged (Play boot). */
  onLoaded() {
    // TODO
  }

  /** Optional — called each frame in Play (delta in seconds, same as R3F useFrame). */
  onUpdate(delta) {
    // TODO
  }

  /** Optional — called when the scene unmounts or reloads. */
  onDelete() {
    // TODO
  }

  ${mainMethod}(payload) {
    const entityId = this.targetId || (payload && payload.targetId) || 'TODO_ENTITY_ID'
    const obj = GLTF.getObjectByUmi3dId(entityId)
    const pos = obj ? obj.getLocalPosition() : { x: 0, y: 0, z: 0 }
    if (payload && payload.umi3d) {
      void payload.umi3d
    }
    // TODO: read ${kind}-specific fields from payload / payload.umi3d.
${returnTx}
  }
}
`.trim()
}

export type BuiltInteractionTemplate = {
  source: string
  fileName: string
  /** Exported class name (same as glTF callback string). */
  className: string
  kind: InteractionTemplateKind
}

export function buildInteractionScriptTemplate(
  kind: InteractionTemplateKind,
  opts?: { baseName?: string },
): BuiltInteractionTemplate {
  const className = sanitizeClassBaseName(opts?.baseName, kind)
  const gltfType = gltfTypeForKind(kind)
  const mainMethod = interactionMainMethodForKind(kind)
  const baseClass = baseClassForKind(kind)
  const importLine = `import { ${baseClass} } from '${INTERACTION_BASES_IMPORT_PATH}'`
  const parts = [
    importLine,
    '',
    templateComment(kind, className, gltfType),
    '',
    classStub(kind, className, baseClass, mainMethod),
  ]
  const source = `${parts.join('\n\n')}\n`
  return {
    source,
    fileName: `${className}.js`,
    className,
    kind,
  }
}
