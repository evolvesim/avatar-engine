import { describe, it, expect, vi } from 'vitest'
import { MockTTSAdapter } from '../../src/adapters/mock'
import type { AvatarCallbacks } from '../../src/core/types'

function makeCallbacks(): AvatarCallbacks & { _spies: ReturnType<typeof vi.fn>[] } {
  const onViseme = vi.fn()
  const onWordBoundary = vi.fn()
  const onSpeechStart = vi.fn()
  const onSpeechEnd = vi.fn()
  const onError = vi.fn()
  return {
    onViseme, onWordBoundary, onSpeechStart, onSpeechEnd, onError,
    _spies: [onViseme, onWordBoundary, onSpeechStart, onSpeechEnd, onError],
  }
}

describe('MockTTSAdapter', () => {
  it('reports oneshot mode', () => {
    const adapter = new MockTTSAdapter()
    expect(adapter.mode).toBe('oneshot')
  })

  it('records the last text spoken', async () => {
    const adapter = new MockTTSAdapter([{ type: 'speechEnd' }])
    const cb = makeCallbacks()
    await adapter.speak('hello world', cb)
    expect(adapter.lastText).toBe('hello world')
  })

  it('fires callbacks in scripted order', async () => {
    const adapter = new MockTTSAdapter([
      { type: 'speechStart' },
      { type: 'viseme', visemeId: 5, offsetMs: 0 },
      { type: 'wordBoundary' },
      { type: 'speechEnd' },
    ])
    const cb = makeCallbacks()
    await adapter.speak('hi', cb)
    expect(cb.onSpeechStart).toHaveBeenCalledTimes(1)
    expect(cb.onViseme).toHaveBeenCalledWith(5, 0)
    expect(cb.onWordBoundary).toHaveBeenCalledTimes(1)
    expect(cb.onSpeechEnd).toHaveBeenCalledTimes(1)
    expect(cb.onError).not.toHaveBeenCalled()
  })

  it('default script fires both speechStart and speechEnd', async () => {
    const adapter = new MockTTSAdapter()
    // Strip delays to keep the test fast
    adapter.events = adapter.events.map((e) => ({ ...e, delayMs: 0 }))
    const cb = makeCallbacks()
    await adapter.speak('x', cb)
    expect(cb.onSpeechStart).toHaveBeenCalled()
    expect(cb.onSpeechEnd).toHaveBeenCalled()
    expect(cb.onViseme).toHaveBeenCalled()
    expect(cb.onWordBoundary).toHaveBeenCalled()
  })
})
