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

// ─────────────────────────────────────────────────────────────────────────────
// Azure viseme ID → mouth shape, verified against Microsoft's official table:
//   https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
// These tests are the regression guard against the old scrambled mapping that
// treated id 1 as the bilabial closure (PP) and offset every other shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('Azure viseme ID → ARKit mapping (official Microsoft table)', () => {
  it('id 0 is silence', () => {
    expect(VISEME_TO_ARKIT[0]).toEqual(['viseme_sil'])
  })

  it('bilabial p/b/m is id 21 (NOT id 1)', () => {
    // Regression: the old map put the lip-seal on id 1. Azure puts p/b/m at 21.
    expect(VISEME_TO_ARKIT[21]).toContain('viseme_PP')
    expect(VISEME_TO_ARKIT[1]).not.toContain('viseme_PP')
  })

  it('labiodental f/v is id 18 (NOT id 2)', () => {
    expect(VISEME_TO_ARKIT[18]).toEqual(['viseme_FF'])
    expect(VISEME_TO_ARKIT[2]).not.toContain('viseme_FF')
  })

  it('dental ð is id 17', () => {
    expect(VISEME_TO_ARKIT[17]).toEqual(['viseme_TH'])
  })

  it('alveolar d/t/n/θ is id 19', () => {
    expect(VISEME_TO_ARKIT[19]).toEqual(['viseme_DD'])
  })

  it('velar k/g/ŋ is id 20', () => {
    expect(VISEME_TO_ARKIT[20]).toEqual(['viseme_kk'])
  })

  it('post-alveolar ʃ/tʃ/dʒ/ʒ is id 16', () => {
    expect(VISEME_TO_ARKIT[16]).toEqual(['viseme_CH'])
  })

  it('sibilant s/z is id 15', () => {
    expect(VISEME_TO_ARKIT[15]).toEqual(['viseme_SS'])
  })

  it('alveolar lateral l is id 14', () => {
    expect(VISEME_TO_ARKIT[14]).toEqual(['viseme_nn'])
  })

  it('r approximant ɹ is id 13 and r-coloured ɝ is id 5', () => {
    expect(VISEME_TO_ARKIT[13]).toEqual(['viseme_RR'])
    expect(VISEME_TO_ARKIT[5]).toEqual(['viseme_RR'])
  })

  it('open vowels æ/ə/ʌ (id 1) and ɑ (id 2) map to viseme_aa', () => {
    expect(VISEME_TO_ARKIT[1]).toEqual(['viseme_aa'])
    expect(VISEME_TO_ARKIT[2]).toEqual(['viseme_aa'])
  })

  it('rounded vowels ɔ (id 3) and o (id 8) map to viseme_O', () => {
    expect(VISEME_TO_ARKIT[3]).toEqual(['viseme_O'])
    expect(VISEME_TO_ARKIT[8]).toEqual(['viseme_O'])
  })

  it('mid vowel ɛ/ʊ is id 4 (viseme_E)', () => {
    expect(VISEME_TO_ARKIT[4]).toEqual(['viseme_E'])
  })

  it('close front j/i/ɪ is id 6 (viseme_I)', () => {
    expect(VISEME_TO_ARKIT[6]).toEqual(['viseme_I'])
  })

  it('close back rounded w/u is id 7 (viseme_U)', () => {
    expect(VISEME_TO_ARKIT[7]).toEqual(['viseme_U'])
  })

  it('diphthongs blend two shapes (9 aʊ, 10 ɔɪ, 11 aɪ)', () => {
    expect(VISEME_TO_ARKIT[9]).toEqual(['viseme_aa', 'viseme_U'])
    expect(VISEME_TO_ARKIT[10]).toEqual(['viseme_O', 'viseme_I'])
    expect(VISEME_TO_ARKIT[11]).toEqual(['viseme_aa', 'viseme_I'])
  })

  it('every id 0–21 has a primary and a support entry', () => {
    for (let id = 0; id <= 21; id++) {
      expect(VISEME_TO_ARKIT[id], `primary map missing id ${id}`).toBeDefined()
      expect(VISEME_SUPPORT[id], `support map missing id ${id}`).toBeDefined()
    }
  })
})

describe('viseme-map enrichment', () => {
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

  it('consonants/closures use a fast-release hold class; vowels carry over', () => {
    // Plosive/fricative/alveolar/velar consonants must not smear into the next
    // phoneme — they release fast. Vowels carry over for natural co-articulation.
    expect(VISEME_SUPPORT[21].hold).toBe('closure') // p/b/m
    expect(VISEME_SUPPORT[0].hold).toBe('closure')  // silence
    expect(VISEME_SUPPORT[18].hold).toBe('consonant') // f/v
    expect(VISEME_SUPPORT[19].hold).toBe('consonant') // d/t/n
    expect(VISEME_SUPPORT[20].hold).toBe('consonant') // k/g
    expect(VISEME_SUPPORT[15].hold).toBe('consonant') // s/z
    expect(VISEME_SUPPORT[1].hold).toBe('vowel')      // æ/ə/ʌ
    expect(VISEME_SUPPORT[7].hold).toBe('vowel')      // w/u
  })
})

describe('buildVisemeTargets', () => {
  it('silence (id 0) adds no support shapes and zero jaw', () => {
    const { weights, jaw } = buildVisemeTargets(0)
    expect(jaw).toBe(0)
    expect(Object.keys(weights)).toEqual(['viseme_sil'])
  })

  it('unknown id returns empty harmlessly', () => {
    const { weights, jaw, hold } = buildVisemeTargets(999)
    expect(jaw).toBe(0)
    expect(Object.keys(weights)).toHaveLength(0)
    expect(hold).toBe('vowel')
  })

  it('returns the hold class for the viseme', () => {
    expect(buildVisemeTargets(21).hold).toBe('closure') // p/b/m
    expect(buildVisemeTargets(19).hold).toBe('consonant') // d/t/n
    expect(buildVisemeTargets(1).hold).toBe('vowel') // æ/ə/ʌ
  })

  it('preserves the primary Oculus mouth shape at the requested scale (no override)', () => {
    // id 4 (ɛ/ʊ → E) has no primaryScale override, so the caller's scale is used.
    const { weights } = buildVisemeTargets(4, 0.6)
    expect(weights['viseme_E']).toBeCloseTo(0.6, 5)
  })

  it('per-viseme primaryScale overrides the caller scale (plosive harder, open vowel softer)', () => {
    // id 21 (p/b/m) overrides to a hard drive; id 1 (æ/ə/ʌ) to a soft one.
    expect(buildVisemeTargets(21, 0.6).weights['viseme_PP']).toBeGreaterThan(0.6)
    expect(buildVisemeTargets(1, 0.6).weights['viseme_aa']).toBeLessThan(0.6)
  })

  it('splits primary scale across multi-shape diphthongs (id 9 aʊ)', () => {
    const { weights } = buildVisemeTargets(9, 0.6) // ['viseme_aa','viseme_U']
    expect(weights['viseme_aa']).toBeGreaterThan(0)
    expect(weights['viseme_U']).toBeGreaterThan(0)
  })

  // ── Bilabial closure: p/b/m (id 21) must read as lips meeting + jaw closed ───
  it('bilabial p/b/m (id 21) includes a closure/press shape and zero jaw', () => {
    const { weights, jaw } = buildVisemeTargets(21)
    expect(jaw).toBe(0)
    const hasClosure =
      (weights['mouthClose'] ?? 0) > 0 ||
      (weights['mouthPressLeft'] ?? 0) > 0 ||
      (weights['mouthPressRight'] ?? 0) > 0
    expect(hasClosure).toBe(true)
  })

  it('bilabial p/b/m (id 21) drives a STRONG, visible lip seal', () => {
    const { weights } = buildVisemeTargets(21, 0.6)
    expect(weights['mouthClose']).toBeGreaterThanOrEqual(0.4)
    expect(weights['viseme_PP']).toBeGreaterThan(0.6)
    expect(weights['mouthRollLower'] ?? 0).toBeGreaterThan(0)
  })

  // ── F/V (id 18): lower-lip shaping ──────────────────────────────────────────
  it('f/v (id 18) includes lower-lip shaping and bares teeth edge', () => {
    const { weights } = buildVisemeTargets(18)
    const hasLowerLip =
      (weights['mouthLowerDownLeft'] ?? 0) > 0 ||
      (weights['mouthLowerDownRight'] ?? 0) > 0
    expect(hasLowerLip).toBe(true)
    const upperLift =
      (weights['mouthUpperUpLeft'] ?? 0) > 0 ||
      (weights['mouthUpperUpRight'] ?? 0) > 0
    expect(upperLift).toBe(true)
    expect(weights['mouthRollLower'] ?? 0).toBeGreaterThan(0)
  })

  // ── Rounded vowels: funnel + pucker ─────────────────────────────────────────
  it('ɔ (id 3) and o (id 8) include rounded mouth shapes (funnel/pucker)', () => {
    for (const id of [3, 8]) {
      const { weights } = buildVisemeTargets(id)
      expect(weights['mouthFunnel'], `id ${id}`).toBeGreaterThan(0)
      expect(weights['mouthPucker'], `id ${id}`).toBeGreaterThan(0)
    }
  })

  it('w/u (id 7) puckers tighter than the open-mid rounded ɔ (id 3)', () => {
    const u = buildVisemeTargets(7).weights
    const o = buildVisemeTargets(3).weights
    expect(u['mouthPucker']).toBeGreaterThan(o['mouthPucker'] ?? 0)
  })

  it('open vowels æ/ə/ʌ (id 1) and ɑ (id 2) are jaw-driven, not gaping morphs', () => {
    for (const id of [1, 2]) {
      const { weights, jaw } = buildVisemeTargets(id, 0.6)
      expect(weights['viseme_aa'], `id ${id}`).toBeLessThan(0.6)
      expect(jaw, `id ${id}`).toBeGreaterThan(0.2)
    }
  })

  // ── Differentiated jaw intensity ────────────────────────────────────────────
  it('jaw is differentiated: open vowel > mid > rounded > consonant > closure', () => {
    const aa = buildVisemeTargets(1).jaw  // æ/ə/ʌ open vowel
    const e  = buildVisemeTargets(4).jaw  // ɛ/ʊ mid
    const o  = buildVisemeTargets(3).jaw  // ɔ rounded low
    const dd = buildVisemeTargets(19).jaw // d/t/n consonant
    const pp = buildVisemeTargets(21).jaw // p/b/m bilabial closed

    expect(aa).toBeGreaterThan(e)
    expect(e).toBeGreaterThan(o)
    expect(o).toBeGreaterThan(dd)
    expect(dd).toBeGreaterThan(pp)
    expect(pp).toBe(0)
    expect(aa).toBeLessThanOrEqual(0.35) // open but not a yawn
  })

  it('open vowel id 1 adds subtle cheek support but stays subtle', () => {
    const { weights } = buildVisemeTargets(1)
    const cheek = weights['cheekSquintLeft'] ?? 0
    expect(cheek).toBeGreaterThan(0)
    expect(cheek).toBeLessThanOrEqual(0.1)
  })

  it('all produced weights stay within [0,1] for every id 0–21', () => {
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
