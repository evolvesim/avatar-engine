/**
 * mock.ts — In-memory TTS adapter for tests.
 *
 * Replays a scripted sequence of viseme / word-boundary / speech-state events
 * against the AvatarCallbacks contract. Records the last text it was asked to
 * speak so tests can assert engine wiring without touching the network.
 */

import type { TTSAdapter, AvatarCallbacks } from '../core/types'

export interface MockSpeechEvent {
  type: 'viseme' | 'wordBoundary' | 'speechStart' | 'speechEnd'
  visemeId?: number
  offsetMs?: number
  delayMs?: number
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class MockTTSAdapter implements TTSAdapter {
  readonly mode = 'oneshot' as const
  public lastText: string | null = null
  public events: MockSpeechEvent[]

  constructor(events?: MockSpeechEvent[]) {
    this.events = events ?? [
      { type: 'speechStart' },
      { type: 'viseme', visemeId: 10, offsetMs: 0 },   // 'aa'
      { type: 'wordBoundary', delayMs: 100 },
      { type: 'viseme', visemeId: 14, offsetMs: 200 }, // 'U'
      { type: 'wordBoundary', delayMs: 300 },
      { type: 'speechEnd', delayMs: 500 },
    ]
  }

  async speak(text: string, cb: AvatarCallbacks): Promise<void> {
    this.lastText = text
    for (const ev of this.events) {
      if (ev.delayMs) await delay(ev.delayMs)
      if (ev.type === 'speechStart')  cb.onSpeechStart()
      if (ev.type === 'speechEnd')    cb.onSpeechEnd()
      if (ev.type === 'wordBoundary') cb.onWordBoundary()
      if (ev.type === 'viseme')       cb.onViseme(ev.visemeId ?? 0, ev.offsetMs ?? 0)
    }
  }

  stop(): void {}
  dispose(): void {}
}
