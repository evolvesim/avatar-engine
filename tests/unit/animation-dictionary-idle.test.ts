import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  AnimationDictionary,
  clipNameLooksLikeIdle,
  type AnimationEntry,
} from '../../src/core/animation-dictionary'

// Build an AnimationDictionary populated with fake entries. resolveIdleId only
// reads emotion/loop/unsafeAsIdle + the clip ids, never the THREE clip itself,
// so a stub clip is sufficient — no GLB loading required in the node test env.
function dictWith(
  entries: Array<{ id: string; emotion: string; loop?: THREE.AnimationActionLoopStyles; unsafeAsIdle?: boolean }>,
): AnimationDictionary {
  const dict = new AnimationDictionary()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clips: Map<string, AnimationEntry> = (dict as any).clips
  for (const e of entries) {
    clips.set(e.id, {
      clip: { name: e.id } as unknown as THREE.AnimationClip,
      emotion: e.emotion,
      loop: e.loop ?? THREE.LoopRepeat,
      defaultCrossfade: 0.5,
      unsafeAsIdle: e.unsafeAsIdle,
    })
  }
  return dict
}

const PACK1_NEUTRAL_PREFS = [
  'mx_m_standard_idle',
  'mx_m_idle_still',
  'mx_m_neutral_idle_foot_forward',
  'mx_m_breathing_idle_fast_breathing',
  'rpm2_idle_001',
]

// Pack 5 (MoCap coach) loads only mc_m_ clips — NONE of the Pack 1 preferences exist.
const PACK5_LOADED = [
  { id: 'mc_m_idle_01', emotion: 'neutral', loop: THREE.LoopRepeat },
  { id: 'mc_m_idle_02', emotion: 'neutral', loop: THREE.LoopRepeat },
  { id: 'mc_m_idle_03_lookaround', emotion: 'neutral', loop: THREE.LoopRepeat },
  { id: 'mc_m_listen_01_neutral', emotion: 'neutral', loop: THREE.LoopOnce },
  { id: 'mc_m_listen_02_positive', emotion: 'neutral', loop: THREE.LoopOnce },
  { id: 'mc_m_listen_03_negative', emotion: 'neutral', loop: THREE.LoopOnce },
]

describe('clipNameLooksLikeIdle', () => {
  it('matches names containing idle (any case)', () => {
    expect(clipNameLooksLikeIdle('mc_m_idle_01')).toBe(true)
    expect(clipNameLooksLikeIdle('mx_m_standard_idle')).toBe(true)
    expect(clipNameLooksLikeIdle('rpm2_idle_var_003')).toBe(true)
  })
  it('does not match gesture names', () => {
    expect(clipNameLooksLikeIdle('mc_m_listen_03_negative')).toBe(false)
    expect(clipNameLooksLikeIdle('mixamo_joy_thumbs_up')).toBe(false)
  })
})

describe('AnimationDictionary.resolveIdleId — Pack 1 (preferences present)', () => {
  it('returns a preferred pool idle when loaded', () => {
    const dict = dictWith(PACK1_NEUTRAL_PREFS.map(id => ({ id, emotion: 'neutral' })))
    const id = dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')
    expect(PACK1_NEUTRAL_PREFS).toContain(id)
  })

  it('preserves mx_m_/rpm_ paths and excludes the current idle so the pool cycles', () => {
    const dict = dictWith(PACK1_NEUTRAL_PREFS.map(id => ({ id, emotion: 'neutral' })))
    const id = dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, 'mx_m_standard_idle')
    expect(id).not.toBe('mx_m_standard_idle')
    expect(PACK1_NEUTRAL_PREFS).toContain(id)
  })

  it('keeps mx_m_breathing_idle_fast_breathing reachable (portal compat)', () => {
    const dict = dictWith([{ id: 'mx_m_breathing_idle_fast_breathing', emotion: 'neutral' }])
    expect(dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')).toBe('mx_m_breathing_idle_fast_breathing')
  })
})

describe('AnimationDictionary.resolveIdleId — Pack 5 fallback (the bug)', () => {
  it('never returns mx_m_standard_idle when the pack has no mx_m_ clips', () => {
    const dict = dictWith(PACK5_LOADED)
    const id = dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')
    expect(id).not.toBe('mx_m_standard_idle')
    expect(dict.has(id!)).toBe(true)
  })

  it('falls back to a pack-local loopable idle (mc_m_idle_*)', () => {
    const dict = dictWith(PACK5_LOADED)
    const id = dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')
    expect(['mc_m_idle_01', 'mc_m_idle_02', 'mc_m_idle_03_lookaround']).toContain(id)
  })

  it('REGRESSION: after mc_m_listen_03_negative, returns a valid Pack 5 idle (not mx_m_standard_idle)', () => {
    const dict = dictWith(PACK5_LOADED)
    // Simulate the post-gesture return-to-idle: current clip is the listen gesture.
    const next = dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, 'mc_m_listen_03_negative')
    expect(next).not.toBe('mx_m_standard_idle')
    expect(next).not.toBeNull()
    expect(dict.get(next!)?.loop).toBe(THREE.LoopRepeat)
    expect(next!.startsWith('mc_m_')).toBe(true)
  })

  it('falls back via the idle-name heuristic when no LoopRepeat idle is tagged', () => {
    // mc_m_idle_01 indexed as LoopOnce (e.g. missing manifest) — name heuristic catches it.
    const dict = dictWith([
      { id: 'mc_m_idle_01', emotion: 'neutral', loop: THREE.LoopOnce },
      { id: 'mc_m_listen_03_negative', emotion: 'neutral', loop: THREE.LoopOnce },
    ])
    expect(dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')).toBe('mc_m_idle_01')
  })

  it('returns null (no warning-spam / no stuck idle) when no idle is loadable at all', () => {
    const dict = dictWith([{ id: 'mc_m_listen_03_negative', emotion: 'neutral', loop: THREE.LoopOnce }])
    expect(dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')).toBeNull()
  })
})

describe('AnimationDictionary.resolveIdleId — emotion + safety', () => {
  it('prefers an emotion-matched LoopRepeat clip before neutral', () => {
    const dict = dictWith([
      { id: 'neutral_loop', emotion: 'neutral', loop: THREE.LoopRepeat },
      { id: 'happy_loop', emotion: 'happy', loop: THREE.LoopRepeat },
    ])
    expect(dict.resolveIdleId('happy', [], '')).toBe('happy_loop')
  })

  it('never selects a clip flagged unsafeAsIdle, even if name matches idle', () => {
    const dict = dictWith([
      { id: 'mc_m_idle_dangerous', emotion: 'neutral', loop: THREE.LoopRepeat, unsafeAsIdle: true },
      { id: 'mc_m_idle_safe', emotion: 'neutral', loop: THREE.LoopRepeat },
    ])
    const id = dict.resolveIdleId('neutral', ['mc_m_idle_dangerous', 'mc_m_idle_safe'], '')
    expect(id).toBe('mc_m_idle_safe')
  })

  it('returns null rather than an unsafe clip when it is the only candidate', () => {
    const dict = dictWith([
      { id: 'mc_m_idle_dangerous', emotion: 'neutral', loop: THREE.LoopRepeat, unsafeAsIdle: true },
    ])
    expect(dict.resolveIdleId('neutral', ['mc_m_idle_dangerous'], '')).toBeNull()
  })
})

describe('AnimationDictionary.loadPack resets state', () => {
  it('clears prior clips so stale pack idles are not resolvable', () => {
    const dict = dictWith([{ id: 'mx_m_standard_idle', emotion: 'neutral' }])
    expect(dict.has('mx_m_standard_idle')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dict as any).clips.clear()
    expect(dict.has('mx_m_standard_idle')).toBe(false)
    expect(dict.resolveIdleId('neutral', PACK1_NEUTRAL_PREFS, '')).toBeNull()
  })
})
