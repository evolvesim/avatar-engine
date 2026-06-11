import { describe, it, expect } from 'vitest'
import {
  VISEME_TO_ARKIT,
  VISEME_SUPPORT,
  buildVisemeTargets,
} from '../../src/core/viseme-map'

// Canonical ARKit (52) blendshape names used for support shapes, plus the
// Oculus-style viseme_* names + mouthOpen/jawOpen the Avaturn rig ships with.
// Any support key not in here would be a typo that silently no-ops on the GLB.
const VALID_ARKIT = new Set<string>([
  // jaw
  'jawOpen', 'jawForward', 'jawLeft', 'jawRight',
  // mouth
  'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight',
  'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  // cheeks / nose
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'noseSneerLeft', 'noseSneerRight',
  // engine extras
  'mouthOpen',
])

describe('viseme-map enrichment', () => {
  it('every VISEME_TO_ARKIT id has a support entry (0–21)', () => {
    for (let id = 0; id <= 21; id++) {
      expect(VISEME_TO_ARKIT[id], `primary map missing id ${id}`).toBeDefined()
      expect(VISEME_SUPPORT[id], `support map missing id ${id}`).toBeDefined()
    }
  })

  it('all support keys are valid ARKit names', () => {
    for (const [id, entry] of Object.entries(VISEME_SUPPORT)) {
      for (const key of Object.keys(entry.support)) {
        expect(VALID_ARKIT.has(key), `id ${id} uses unknown shape "${key}"`).toBe(true)
      }
    }
  })

  it('all support weights and jaw values are within [0,1]', () => {
    for (const [id, entry] of Object.entries(VISEME_SUPPORT)) {
      expect(entry.jaw, `id ${id} jaw out of range`).toBeGreaterThanOrEqual(0)
      expect(entry.jaw, `id ${id} jaw out of range`).toBeLessThanOrEqual(1)
      for (const [key, val] of Object.entries(entry.support)) {
        expect(val, `id ${id} ${key} out of range`).toBeGreaterThanOrEqual(0)
        expect(val, `id ${id} ${key} out of range`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps support conservative — no support shape exceeds 0.35 (no cartoon mouth)', () => {
    for (const [id, entry] of Object.entries(VISEME_SUPPORT)) {
      for (const [key, val] of Object.entries(entry.support)) {
        expect(val, `id ${id} ${key} too strong`).toBeLessThanOrEqual(0.35)
      }
    }
  })

  it('does not apply a constant smile (no mouthSmile on any viseme)', () => {
    for (const entry of Object.values(VISEME_SUPPORT)) {
      expect(entry.support['mouthSmileLeft']).toBeUndefined()
      expect(entry.support['mouthSmileRight']).toBeUndefined()
    }
  })
})

describe('buildVisemeTargets', () => {
  it('silence (id 0) adds no support shapes and zero jaw', () => {
    const { weights, jaw } = buildVisemeTargets(0)
    expect(jaw).toBe(0)
    // Only the primary viseme_sil key; no extra support shapes layered on.
    expect(Object.keys(weights)).toEqual(['viseme_sil'])
  })

  it('unknown id returns empty harmlessly', () => {
    const { weights, jaw } = buildVisemeTargets(999)
    expect(jaw).toBe(0)
    expect(Object.keys(weights)).toHaveLength(0)
  })

  it('preserves the primary Oculus mouth shape at the requested scale', () => {
    const { weights } = buildVisemeTargets(10, 0.6) // aa → viseme_aa
    expect(weights['viseme_aa']).toBeCloseTo(0.6, 5)
  })

  it('splits primary scale across multi-shape visemes (diphthong 21)', () => {
    const { weights } = buildVisemeTargets(21, 0.6) // ['viseme_O','viseme_U']
    expect(weights['viseme_O']).toBeGreaterThan(0)
    expect(weights['viseme_U']).toBeGreaterThan(0)
  })

  // ── Bilabial closure: P/B/M must read as lips meeting + jaw closed ──────────
  it('bilabial P/B/M (id 1) includes a closure/press shape and zero jaw', () => {
    const { weights, jaw } = buildVisemeTargets(1)
    expect(jaw).toBe(0)
    const hasClosure =
      (weights['mouthClose'] ?? 0) > 0 ||
      (weights['mouthPressLeft'] ?? 0) > 0 ||
      (weights['mouthPressRight'] ?? 0) > 0
    expect(hasClosure).toBe(true)
  })

  // ── F/V: lower-lip shaping ──────────────────────────────────────────────────
  it('F/V (id 2) includes lower-lip shaping', () => {
    const { weights } = buildVisemeTargets(2)
    const hasLowerLip =
      (weights['mouthLowerDownLeft'] ?? 0) > 0 ||
      (weights['mouthLowerDownRight'] ?? 0) > 0
    expect(hasLowerLip).toBe(true)
  })

  // ── Rounded vowels O/U: funnel + pucker ─────────────────────────────────────
  it('O (id 13) includes rounded mouth shapes (funnel/pucker)', () => {
    const { weights } = buildVisemeTargets(13)
    expect(weights['mouthFunnel']).toBeGreaterThan(0)
    expect(weights['mouthPucker']).toBeGreaterThan(0)
  })

  it('U (id 14) includes rounded mouth shapes (pucker/funnel)', () => {
    const { weights } = buildVisemeTargets(14)
    expect(weights['mouthPucker']).toBeGreaterThan(0)
    expect(weights['mouthFunnel']).toBeGreaterThan(0)
  })

  // ── Differentiated jaw intensity ────────────────────────────────────────────
  it('jaw is differentiated: aa > E/I > O/U > consonant', () => {
    const aa = buildVisemeTargets(10).jaw // open vowel
    const e  = buildVisemeTargets(11).jaw // medium
    const o  = buildVisemeTargets(13).jaw // rounded low
    const pp = buildVisemeTargets(1).jaw  // bilabial closed

    expect(aa).toBeGreaterThan(e)
    expect(e).toBeGreaterThan(o)
    expect(o).toBeGreaterThanOrEqual(pp)
    expect(pp).toBe(0)
    // aa is the most open but still natural, not a yawn
    expect(aa).toBeLessThanOrEqual(0.35)
  })

  it('open vowel aa (id 10) adds subtle cheek support but stays subtle', () => {
    const { weights } = buildVisemeTargets(10)
    const cheek = weights['cheekSquintLeft'] ?? 0
    expect(cheek).toBeGreaterThan(0)
    expect(cheek).toBeLessThanOrEqual(0.1)
  })

  it('all produced weights stay within [0,1]', () => {
    for (let id = 0; id <= 21; id++) {
      const { weights, jaw } = buildVisemeTargets(id)
      expect(jaw).toBeGreaterThanOrEqual(0)
      expect(jaw).toBeLessThanOrEqual(1)
      for (const [key, val] of Object.entries(weights)) {
        expect(val, `id ${id} ${key}`).toBeGreaterThanOrEqual(0)
        expect(val, `id ${id} ${key}`).toBeLessThanOrEqual(1)
      }
    }
  })
})
