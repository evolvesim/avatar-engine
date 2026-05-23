import { describe, it, expect, vi, afterEach } from 'vitest'
import { VirtualDirector } from '../../src/core/virtual-director'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(content: string) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  ) as unknown as typeof fetch
}

describe('VirtualDirector', () => {
  it('returns neutral fallback on empty input', async () => {
    const vd = new VirtualDirector({ endpoint: 'x', apiKey: 'y' }, [])
    const result = await vd.analyse('')
    expect(result.base_emotion).toBe('neutral')
    expect(result.gesture_cues).toEqual([])
  })

  it('parses a valid LLM response', async () => {
    mockFetch(JSON.stringify({
      base_emotion: 'joy',
      emotion_intensity: 0.6,
      gesture_cues: [],
    }))
    const vd = new VirtualDirector({ endpoint: 'x', apiKey: 'y' }, [])
    const result = await vd.analyse('hello there')
    expect(result.base_emotion).toBe('joy')
    expect(result.emotion_intensity).toBeCloseTo(0.6, 5)
  })

  it('filters out unknown anim_ids', async () => {
    mockFetch(JSON.stringify({
      base_emotion: 'neutral',
      emotion_intensity: 0,
      gesture_cues: [
        { anim_id: 'known_clip', target_word: 'hi', word_index: 0, crossfade_duration: 0.25 },
        { anim_id: 'unknown_clip', target_word: 'there', word_index: 1, crossfade_duration: 0.25 },
      ],
    }))
    const vd = new VirtualDirector({ endpoint: 'x', apiKey: 'y' }, ['known_clip'])
    const result = await vd.analyse('hi there')
    expect(result.gesture_cues).toHaveLength(1)
    expect(result.gesture_cues[0].anim_id).toBe('known_clip')
  })

  it('falls back gracefully on schema mismatch', async () => {
    mockFetch(JSON.stringify({ garbage: true }))
    const vd = new VirtualDirector({ endpoint: 'x', apiKey: 'y' }, [])
    const result = await vd.analyse('something')
    expect(result.base_emotion).toBe('neutral')
  })

  it('honours a systemPrompt override', () => {
    const vd = new VirtualDirector(
      { endpoint: 'x', apiKey: 'y' },
      [],
      'CUSTOM_INTRO_PROMPT',
    )
    // @ts-expect-error — accessing private for white-box assertion
    const prompt: string = vd.buildSystemPrompt()
    expect(prompt.startsWith('CUSTOM_INTRO_PROMPT')).toBe(true)
  })
})
