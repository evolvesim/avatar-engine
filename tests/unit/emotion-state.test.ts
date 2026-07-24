import { describe, it, expect } from 'vitest'
import { EmotionStateMachine } from '../../src/core/emotion-state'

describe('EmotionStateMachine', () => {
  it('starts neutral with zero intensity', () => {
    const sm = new EmotionStateMachine()
    expect(sm.state.id).toBe('neutral')
    expect(sm.state.intensity).toBe(0)
    expect(Object.keys(sm.state.weights)).toHaveLength(0)
  })

  it('scales weights by intensity', () => {
    const sm = new EmotionStateMachine()
    sm.set('happy', 0.5)
    expect(sm.state.id).toBe('happy')
    expect(sm.state.intensity).toBe(0.5)
    // happy preset has mouthSmileLeft = 0.55 at intensity 1; the machine scales
    // by pow(intensity, 0.8).
    expect(sm.state.weights.mouthSmileLeft).toBeCloseTo(0.55 * Math.pow(0.5, 0.8), 5)
  })

  it('attenuates weights while speaking (when a speechAttenuation < 1 is given)', () => {
    const sm = new EmotionStateMachine()
    sm.set('displeasure', 1.0, 0.65)
    const speaking = sm.effectiveWeights(true)
    const idle = sm.effectiveWeights(false)
    const w = sm.state.weights.browDownLeft ?? 0
    expect(idle.browDownLeft).toBeCloseTo(w, 5)
    expect(speaking.browDownLeft).toBeCloseTo(w * 0.65, 5)
  })

  it('clamps intensity to [0,1]', () => {
    const sm = new EmotionStateMachine()
    sm.set('happy', 2.0)
    expect(sm.state.intensity).toBe(1)
    sm.set('happy', -1)
    expect(sm.state.intensity).toBe(0)
  })

  it('exposes the current 7-emotion palette', () => {
    const ids = EmotionStateMachine.availableEmotions()
    for (const e of ['neutral', 'happy', 'thoughtful', 'sadness', 'displeasure', 'shy', 'empathy']) {
      expect(ids).toContain(e)
    }
    // surprise + tension were removed in v0.5.34.
    expect(ids).not.toContain('surprise')
    expect(ids).not.toContain('tension')
  })
})
