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
    sm.set('joy', 0.5)
    expect(sm.state.id).toBe('joy')
    expect(sm.state.intensity).toBe(0.5)
    // joy preset has mouthSmileLeft = 0.8 at intensity 1
    expect(sm.state.weights.mouthSmileLeft).toBeCloseTo(0.4, 5)
  })

  it('attenuates weights while speaking', () => {
    const sm = new EmotionStateMachine()
    sm.set('anger', 1.0)
    const speaking = sm.effectiveWeights(true)
    const idle = sm.effectiveWeights(false)
    const w = sm.state.weights.browDownLeft ?? 0
    expect(idle.browDownLeft).toBeCloseTo(w, 5)
    expect(speaking.browDownLeft).toBeCloseTo(w * 0.65, 5)
  })

  it('clamps intensity to [0,1]', () => {
    const sm = new EmotionStateMachine()
    sm.set('joy', 2.0)
    expect(sm.state.intensity).toBe(1)
    sm.set('joy', -1)
    expect(sm.state.intensity).toBe(0)
  })

  it('exposes all available emotion ids', () => {
    const ids = EmotionStateMachine.availableEmotions()
    expect(ids).toContain('neutral')
    expect(ids).toContain('joy')
    expect(ids).toContain('anger')
    expect(ids.length).toBeGreaterThanOrEqual(10)
  })
})
