import { describe, it, expect } from 'vitest'
import {
  VISEME_TO_ARKIT,
  VISEME_SUPPORT,
  buildVisemeTargets,
  CLOSURE_SHAPES,
  SUPPORT_CAP,
  CLOSURE_CAP,
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

  it('keeps support conservative — expressive shapes ≤ SUPPORT_CAP, closures ≤ CLOSURE_CAP', () => {
    // Expressive shapes (cheeks/stretch/funnel/pucker) stay subtle so the mouth
    // never becomes a cartoon. Lip-closure/roll shapes are allowed a higher
    // ceiling because a believable bilabial seal needs the lips driven harder.
    for (const [id, entry] of Object.entries(VISEME_SUPPORT)) {
      for (const [key, val] of Object.entries(entry.support)) {
        const cap = CLOSURE_SHAPES.has(key) ? CLOSURE_CAP : SUPPORT_CAP
        expect(val, `id ${id} ${key} too strong (cap ${cap})`).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('expressive (non-closure) support shapes never exceed SUPPORT_CAP', () => {
    for (const [id, entry] of Object.entries(VISEME_SUPPORT)) {
      for (const [key, val] of Object.entries(entry.support)) {
        if (CLOSURE_SHAPES.has(key)) continue
        expect(val, `id ${id} expressive ${key} too strong`).toBeLessThanOrEqual(SUPPORT_CAP)
      }
    }
  })

  it('optional primaryScale, when present, stays within (0,1]', () => {
    for (const [id, entry] of Object.entries(VISEME_SUPPORT)) {
      if (entry.primaryScale === undefined) continue
      expect(entry.primaryScale, `id ${id} primaryScale`).toBeGreaterThan(0)
      expect(entry.primaryScale, `id ${id} primaryScale`).toBeLessThanOrEqual(1)
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

  it('preserves the primary Oculus mouth shape at the requested scale (no override)', () => {
    // id 11 (E) has no primaryScale override, so the caller's scale is used as-is.
    const { weights } = buildVisemeTargets(11, 0.6)
    expect(weights['viseme_E']).toBeCloseTo(0.6, 5)
  })

  it('per-viseme primaryScale overrides the caller scale (plosive harder, open vowel softer)', () => {
    // id 1 (P/B/M) overrides to a hard drive; id 10 (aa) overrides to a soft one.
    // Both ignore the passed-in 0.6 default.
    expect(buildVisemeTargets(1, 0.6).weights['viseme_PP']).toBeGreaterThan(0.6)
    expect(buildVisemeTargets(10, 0.6).weights['viseme_aa']).toBeLessThan(0.6)
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

  it('bilabial P/B/M (id 1) drives a STRONG, visible lip seal', () => {
    // The prior soft 0.25 closure read as a pout. The seal must be unmistakable:
    // a firm mouthClose plus the primary viseme_PP morph driven harder than the
    // default vowel scale so the lips clearly meet.
    const { weights } = buildVisemeTargets(1, 0.6)
    expect(weights['mouthClose']).toBeGreaterThanOrEqual(0.4)
    // primary viseme_PP driven above the default 0.6 vowel scale
    expect(weights['viseme_PP']).toBeGreaterThan(0.6)
    // lip roll reinforces the seal
    expect(weights['mouthRollLower'] ?? 0).toBeGreaterThan(0)
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

  it('U (id 14) puckers tighter than O (id 13) — distinct rounded vowels', () => {
    const o = buildVisemeTargets(13).weights
    const u = buildVisemeTargets(14).weights
    expect(u['mouthPucker']).toBeGreaterThan(o['mouthPucker'] ?? 0)
  })

  it('F/V (id 2) bares teeth edge via upper-lip lift + lower-lip roll', () => {
    const { weights } = buildVisemeTargets(2)
    const upperLift =
      (weights['mouthUpperUpLeft'] ?? 0) > 0 ||
      (weights['mouthUpperUpRight'] ?? 0) > 0
    expect(upperLift).toBe(true)
    expect(weights['mouthRollLower'] ?? 0).toBeGreaterThan(0)
  })

  it('open vowel aa (id 10) eases the primary morph so it is jaw-driven, not gaping', () => {
    // Primary viseme_aa is driven below the default 0.6 so the opening reads
    // from jawOpen rather than a permanently stretched morph.
    const { weights, jaw } = buildVisemeTargets(10, 0.6)
    expect(weights['viseme_aa']).toBeLessThan(0.6)
    expect(jaw).toBeGreaterThan(weights['viseme_aa'] - 0.6) // jaw carries openness
    expect(jaw).toBeGreaterThan(0.2)
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
