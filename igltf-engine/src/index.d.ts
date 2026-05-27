export type InteractionKind =
  | 'event'
  | 'link'
  | 'form'
  | 'manipulation'
  | 'parameter'
  | 'unsupported'

export type InteractionRequestKind =
  | 'toolProjected'
  | 'toolReleased'
  | 'hoverStateChanged'
  | 'hovered'
  | 'eventTriggered'
  | 'eventStateChanged'
  | 'parameterSetting'
  | 'linkOpened'
  | 'formAnswer'
  | 'manipulationRequest'

export interface InteractionInvokePayload {
  requestKind: InteractionRequestKind
  context: Record<string, unknown>
  request?: Record<string, unknown>
  umi3d: Record<string, unknown>
}

export function normalizeInteractionKind(raw: string | undefined): InteractionKind
export function buildInvokePayload(
  requestKind: InteractionRequestKind,
  context: Record<string, unknown>,
  extra?: Record<string, unknown>,
): InteractionInvokePayload
export function primaryMethodForKind(kind: InteractionKind): string

export class ToolRegistry {
  get(id: string): ToolRecord | undefined
  all(): ToolRecord[]
}

export interface ToolRecord {
  id: string
  gltfNodeIndex: number
  interactions: InteractionRecord[]
  selectorId: string | null
  isHovered: boolean
}

export interface InteractionRecord {
  id: string
  kind: InteractionKind
  dto: Record<string, unknown>
  scriptHandlerId: string
  attachmentId: string
  serializedProps: Record<string, unknown>
}

export class ProjectionManager {
  projections: unknown[]
}

export class PlayInteractionRuntime {
  toolRegistry: ToolRegistry
  hoveredTool: ToolRecord | null
  selectedTool: ToolRecord | null
  setBoneFromCamera(
    cameraPosition: { x: number; y: number; z: number },
    cameraRotation?: { x: number; y: number; z: number; w: number },
  ): void
  projectTool(tool: ToolRecord): void
  releaseTool(tool: ToolRecord): void
  setHover(tool: ToolRecord, enter: boolean): void
  handlePointerDownOnTool(tool: ToolRecord): void
  handlePointerUpOnTool(): void
  handleKeyboard(e: KeyboardEvent, phase: 'down' | 'up'): void
  handlePrimaryPointer(phase: 'down' | 'up'): void
  destroy(): void
}

export interface PlayInteractionRuntimeOptions {
  gltfNodes: Array<{ extensions?: Record<string, unknown> }>
  protoExtensionKey?: string
  invokeInteraction: (
    attachmentId: string,
    handlerId: string,
    payload: InteractionInvokePayload,
    method: string,
  ) => Promise<unknown>
  resolveHoveredId?: (tool: ToolRecord) => string
  uiMount?: HTMLElement
  openLink?: (url: string) => void
}

export function createPlayInteractionRuntime(
  options: PlayInteractionRuntimeOptions,
): PlayInteractionRuntime

export const PC_SELECTOR_ID: string

export type BoundInputSource =
  | 'mouseLeft'
  | 'keyboard'
  | 'uiButton'
  | 'uiDouble'
  | 'uiPlaceholder'

export interface BoundInput {
  id: string
  source: BoundInputSource
  key?: string
}

export function associateInteractionAndInput(
  eventInteractions: InteractionRecord[],
  otherInteractions: InteractionRecord[],
  inputsByInteraction: Map<InteractionRecord, BoundInput[]>,
  reserveLeftMouseForUi: boolean,
): Array<{ interaction: InteractionRecord; input: BoundInput }>

export function isHoldEvent(interaction: InteractionRecord): boolean

export function createPcEventInputs(): BoundInput[]
