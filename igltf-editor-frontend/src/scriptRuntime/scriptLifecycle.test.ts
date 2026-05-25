import { describe, expect, it } from 'vitest'

import { EXT_IGLTF_UMI3D_PROTO, type GltfJson } from '@/play/umi3dProtoTypes'
import { ScriptInstanceManager } from '@/scriptRuntime/scriptLifecycle'

class TestEventInteraction {
  targetId = ''
  loadedCount = 0
  updateCount = 0
  deleteCount = 0
  eventCount = 0
  lastPayload: Record<string, unknown> | undefined

  lastDelta = 0

  onLoaded() {
    this.loadedCount += 1
  }

  onUpdate(delta: number) {
    this.updateCount += 1
    this.lastDelta = delta
  }

  onDelete() {
    this.deleteCount += 1
  }

  onEvent(payload: Record<string, unknown>) {
    this.eventCount += 1
    this.lastPayload = payload
    return { version: 1, operations: [] }
  }
}

const TestEventInteractionCtor = TestEventInteraction as unknown as new () => Record<string, unknown>

function nodesWithAttachment(
  attachmentId: string,
  handlerId: string,
  props: Record<string, unknown> = {},
): GltfJson['nodes'] {
  return [
    {
      extensions: {
        [EXT_IGLTF_UMI3D_PROTO]: {
          umi3d: {
            protoVersion: 1,
            gltfNodeIndex: 0,
            attachments: [
              {
                attachmentId,
                scriptAssetRef: 'asset-1',
                scriptRelativePath: 'assets/Test.js',
                scriptHandlerId: handlerId,
                interactionKind: 'event',
                serializedProps: props,
              },
            ],
          },
        },
      },
    },
  ]
}

describe('ScriptInstanceManager', () => {
  it('calls onLoaded once at bootstrap, onUpdate on tick, onDelete on destroy', async () => {
    const manager = new ScriptInstanceManager()
    manager.registerClass('TestEventInteraction', TestEventInteractionCtor, 'event')
    await manager.bootstrap(nodesWithAttachment('att-1', 'TestEventInteraction', { targetId: '42' }))

    const inst = manager.getInstance('att-1') as unknown as TestEventInteraction
    expect(inst).toBeDefined()
    expect(inst.targetId).toBe('42')
    expect(inst.loadedCount).toBe(1)

    manager.tick(0.016)
    manager.tick(0.032)
    expect(inst.updateCount).toBe(2)
    expect(inst.lastDelta).toBe(0.032)

    manager.destroy()
    expect(inst.deleteCount).toBe(1)
    expect(manager.getInstance('att-1')).toBeUndefined()
  })

  it('reuses the same instance for handler invocation', async () => {
    const manager = new ScriptInstanceManager()
    manager.registerClass('TestEventInteraction', TestEventInteractionCtor, 'event')
    await manager.bootstrap(nodesWithAttachment('att-1', 'TestEventInteraction'))

    const instBefore = manager.getInstance('att-1')
    manager.invokeOnAttachment('att-1', { eventType: 'click' })
    manager.invokeOnAttachment('att-1', { eventType: 'click' })

    const inst = manager.getInstance('att-1') as unknown as TestEventInteraction
    expect(inst).toBe(instBefore)
    expect(inst.eventCount).toBe(2)
    expect(inst.loadedCount).toBe(1)
    expect(inst.lastPayload?.eventType).toBe('click')
  })

  it('forwards hook return values to onHookResult', async () => {
    const seen: unknown[] = []
    const manager = new ScriptInstanceManager((result) => seen.push(result))
    manager.registerClass('TestEventInteraction', TestEventInteractionCtor, 'event')
    await manager.bootstrap(nodesWithAttachment('att-1', 'TestEventInteraction'))
    manager.tick(0.01)
    manager.invokeOnAttachment('att-1', { eventType: 'click' })

    expect(seen.length).toBe(1)
    expect(seen.some((r) => typeof r === 'object' && r !== null && (r as { version?: number }).version === 1)).toBe(
      true,
    )
  })

  it('calls afterLoading after all onLoaded hooks including async', async () => {
    class AsyncLoad {
      order: string[] = []
      async onLoaded() {
        await Promise.resolve()
        this.order.push('loaded')
      }
      afterLoading() {
        this.order.push('after')
      }
    }
    const Ctor = AsyncLoad as unknown as new () => Record<string, unknown>
    const manager = new ScriptInstanceManager()
    manager.registerClass('AsyncLoad', Ctor, 'event')
    await manager.bootstrap(nodesWithAttachment('att-1', 'AsyncLoad'))
    const inst = manager.getInstance('att-1') as unknown as AsyncLoad
    expect(inst.order).toEqual(['loaded', 'after'])
  })
})
