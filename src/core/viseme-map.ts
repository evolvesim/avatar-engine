/**
 * viseme-map.ts
 *
 * Azure Neural TTS emits 22 viseme IDs (0–21) via the `visemeReceived` event.
 * These IDs are fixed by Microsoft's Speech SDK and are the SAME 22 IDs used by
 * the ElevenLabs / Mascotbot proxy viseme stream (which mirrors the Azure set).
 *
 * Each ID maps to the ARKit blendshape name(s) used on the Avaturn GLB.
 *
 * ─── Source of truth for the ID → phoneme grouping ────────────────────────────
 * Microsoft Azure "Get facial position with viseme":
 *   https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 *
 * The official Azure table groups phonemes by *visual mouth pose*, NOT by a
 * sequential vowel-then-consonant ordering. The mapping below follows that table
 * exactly:
 *
 *   ID  IPA phonemes        Mouth pose                ARKit primary
 *   0   silence             closed / rest             viseme_sil
 *   1   æ ə ʌ               open-mid front/central    viseme_aa
 *   2   ɑ                   open back                 viseme_aa
 *   3   ɔ                   open-mid rounded          viseme_O
 *   4   ɛ ʊ                 mid                       viseme_E
 *   5   ɝ                   r-coloured central        viseme_RR
 *   6   j i ɪ               close front (spread)      viseme_I
 *   7   w u                 close back rounded        viseme_U
 *   8   o                   close-mid rounded         viseme_O
 *   9   aʊ                  diphthong open→round      viseme_aa → viseme_U
 *   10  ɔɪ                  diphthong round→front     viseme_O  → viseme_I
 *   11  aɪ                  diphthong open→front      viseme_aa → viseme_I
 *   12  h                   breath, slightly open     viseme_E  (neutral open)
 *   13  ɹ                   r approximant             viseme_RR
 *   14  l                   alveolar lateral          viseme_nn
 *   15  s z                 sibilant (narrow)         viseme_SS
 *   16  ʃ tʃ dʒ ʒ           post-alveolar (rounded)   viseme_CH
 *   17  ð                   dental (tongue-teeth)     viseme_TH
 *   18  f v                 labiodental               viseme_FF
 *   19  d t n θ             alveolar                  viseme_DD
 *   20  k g ŋ               velar                     viseme_kk
 *   21  p b m               bilabial closure          viseme_PP
 *
 * NOTE (0.4.2): prior versions used a scrambled mapping that treated ID 1 as the
 * bilabial closure (PP) and offset every other shape, so phoneme shapes were
 * wrong mid-utterance even though start/end timing was correct. This table
 * replaces that with the verified Azure grouping above.
 *
 * If you swap avatar vendors, update the right-hand side ARKit names only — the
 * left-hand IDs and their phoneme groupings are fixed by the Azure protocol.
 */

export const VISEME_TO_ARKIT: Record<number, string[]> = {
  0:  ['viseme_sil'],                 // silence
  1:  ['viseme_aa'],                  // æ ə ʌ  — open-mid front/central
  2:  ['viseme_aa'],                  // ɑ      — open back
  3:  ['viseme_O'],                   // ɔ      — open-mid rounded
  4:  ['viseme_E'],                   // ɛ ʊ    — mid
  5:  ['viseme_RR'],                  // ɝ      — r-coloured central
  6:  ['viseme_I'],                   // j i ɪ  — close front (spread)
  7:  ['viseme_U'],                   // w u    — close back rounded
  8:  ['viseme_O'],                   // o      — close-mid rounded
  9:  ['viseme_aa', 'viseme_U'],      // aʊ     — diphthong open→round
  10: ['viseme_O',  'viseme_I'],      // ɔɪ     — diphthong round→front
  11: ['viseme_aa', 'viseme_I'],      // aɪ     — diphthong open→front
  12: ['viseme_E'],                   // h      — breath, neutral slightly-open
  13: ['viseme_RR'],                  // ɹ      — r approximant
  14: ['viseme_nn'],                  // l      — alveolar lateral
  15: ['viseme_SS'],                  // s z    — sibilant
  16: ['viseme_CH'],                  // ʃ tʃ dʒ ʒ — post-alveolar
  17: ['viseme_TH'],                  // ð      — dental
  18: ['viseme_FF'],                  // f v    — labiodental
  19: ['viseme_DD'],                  // d t n θ — alveolar
  20: ['viseme_kk'],                  // k g ŋ  — velar
  21: ['viseme_PP'],                  // p b m  — bilabial closure
}

/** All ARKit blendshape names that the engine writes. Used for bulk-zero operations. */
export const ALL_VISEME_NAMES: string[] = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk',  'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  'viseme_aa',  'viseme_E',  'viseme_I',  'viseme_O',  'viseme_U',
  'mouthOpen',  'jawOpen',
]

/**
 * Viseme shapes that require jawOpen to be set.
 * jawOpen = 0.25 when any of these are active. Higher values look unnatural.
 */
export const JAW_OPEN_SHAPES = new Set([
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'mouthOpen',
])

/**
 * Per-viseme supporting ARKit blendshapes + jaw intensity.
 *
 * The primary mouth shape (VISEME_TO_ARKIT) still drives the Oculus-style
 * `viseme_*` morph that the Avaturn GLB ships with. This table layers *subtle*
 * standard-ARKit support shapes on top so closures, rounding, and open vowels
 * read more naturally — without overriding the established mouth movement.
 *
 * Conservative by design:
 *   - support weights are small (≤0.35) so this never becomes an exaggerated
 *     cartoon mouth or a constant smile;
 *   - `jaw` is differentiated per viseme rather than one generic 0.3;
 *   - every support key is a valid ARKit name. Meshes that lack a given morph
 *     ignore it harmlessly (see applyWeightsToMeshes — undefined idx is skipped).
 *
 * IDs not present here fall back to the legacy generic behaviour.
 */
export interface VisemeSupport {
  /** Extra ARKit blendshapes layered under the primary viseme shape. */
  support: Record<string, number>
  /** jawOpen weight for this viseme (0 = closed). */
  jaw: number
  /**
   * Optional override for how hard the primary Oculus `viseme_*` morph is driven
   * for this viseme. When omitted, buildVisemeTargets uses its `primaryScale`
   * argument (default 0.6). Plosives use a higher value so the lip seal is
   * actually visible; open vowels use a slightly lower value so the mouth does
   * not gape permanently. Backwards compatible — absent = legacy behaviour.
   */
  primaryScale?: number
  /**
   * Hold class for temporal tuning in the render loop. Vowels can carry over a
   * little between events; consonants (especially stops/closures) should release
   * fast so the wrong shape never lingers mid-word. Absent = 'vowel'.
   */
  hold?: 'vowel' | 'consonant' | 'closure'
}

/**
 * Lip-closure / lip-roll shapes. These are allowed a higher per-shape ceiling
 * (CLOSURE_CAP) than expressive shapes (cheeks, stretch, funnel) because a
 * believable bilabial seal needs the lips driven harder than a subtle cheek
 * raise — but they are still bounded so the mouth never deforms unnaturally.
 */
export const CLOSURE_SHAPES = new Set([
  'mouthClose', 'mouthRollLower', 'mouthRollUpper',
  'mouthPressLeft', 'mouthPressRight',
])

/**
 * Lip-rounding shapes (funnel/pucker). Given their own ceiling above
 * SUPPORT_CAP (v0.6.7): at ≤0.35 the rounded vowels never visually beat the
 * wide primaries (viseme_aa/E/I run 0.5+), so the mouth corners read as
 * permanently spread — "lips always at full extension". Rounding needs to be
 * driven hard enough to actually pull the corners together on O/U/CH.
 */
export const ROUNDING_SHAPES = new Set(['mouthFunnel', 'mouthPucker'])

/** Ceiling for expressive support shapes (cheeks, stretch, lower-lip…). */
export const SUPPORT_CAP = 0.35
/** Ceiling for lip-rounding shapes — higher so O/U corners visibly narrow. */
export const ROUNDING_CAP = 0.50
/** Ceiling for closure/roll shapes — higher so plosive seals actually read. */
export const CLOSURE_CAP = 0.55

/**
 * Soft rest target driven when a silence viseme (id 0) fires mid-utterance.
 * The drain loop maps it onto `viseme_sil` (CC4: Mouth_Close) so the lips
 * settle toward a relaxed near-closed pose between words instead of holding
 * the previous vowel at full extension. Deliberately partial — a full 1.0
 * would read as the mouth clapping shut on every word gap.
 */
export const SILENCE_REST_WEIGHT = 0.30

// Jaw tiers:
//   open vowel aa : high   medium-open E/I : medium   rounded O/U : low-rounded
//   consonants    : low / closed
// v0.6.7 — eased from JAW_AA 0.30. Combined with the CC4 jaw BONE assist, 0.30
// gaped wide enough to expose both molar rows to the camera. The first cut
// (0.24, bone 0.52 → 0.40) over-corrected on CC rigs — jaw morph and jaw bone
// multiply, so cutting both dropped peak chin travel to ~60% and the mouth
// read as barely moving. 0.27 with bone 0.46 lands at ~80% of the original
// excursion: clearly open vowels, molars still out of view.
const JAW_AA = 0.27
const JAW_EI = 0.18
const JAW_OU = 0.14
const JAW_CONS = 0.05
// Diphthong jaw (open→glide ids 9/11) — between JAW_AA and JAW_EI.
const JAW_DIPH = 0.21

// Primary-morph drive tiers:
//   plosive closure : hard (lips must visibly seal)
//   default vowels  : standard 0.6 (set in buildVisemeTargets)
//   open vowel aa   : slightly eased so the mouth shape comes from jaw, not a
//                     permanently stretched viseme_aa morph.
const PRIMARY_PLOSIVE = 0.85
const PRIMARY_OPEN_VOWEL = 0.52

export const VISEME_SUPPORT: Record<number, VisemeSupport> = {
  // ── 0  Silence ──────────────────────────────────────────────────────────────
  0:  { support: {}, jaw: 0, hold: 'closure' },

  // ── 1  æ ə ʌ — open-mid front/central vowel, jaw-driven open ─────────────────
  // Drive the primary viseme_aa a touch softer and let jawOpen carry the opening
  // so the mouth does not read as a permanently stretched morph. The small
  // mouthClose keeps lip tension over the teeth so the open vowel shows the
  // incisor edge, not the whole upper row (v0.6.7).
  1:  { support: { mouthOpen: 0.16, mouthClose: 0.10, cheekSquintLeft: 0.05, cheekSquintRight: 0.05 }, jaw: JAW_AA, primaryScale: PRIMARY_OPEN_VOWEL, hold: 'vowel' },

  // ── 2  ɑ — fully open back vowel, widest jaw ─────────────────────────────────
  2:  { support: { mouthOpen: 0.18, mouthClose: 0.10 }, jaw: JAW_AA, primaryScale: PRIMARY_OPEN_VOWEL, hold: 'vowel' },

  // ── 3  ɔ — open-mid rounded vowel (funnel, low jaw) ──────────────────────────
  3:  { support: { mouthFunnel: 0.34, mouthPucker: 0.24 }, jaw: JAW_OU, hold: 'vowel' },

  // ── 4  ɛ ʊ — mid vowel, faint stretch (not a smile) ──────────────────────────
  4:  { support: { mouthOpen: 0.10, mouthClose: 0.08, mouthStretchLeft: 0.05, mouthStretchRight: 0.05 }, jaw: JAW_EI, hold: 'vowel' },

  // ── 5  ɝ — r-coloured central vowel, light rounding ──────────────────────────
  5:  { support: { mouthFunnel: 0.16, mouthPucker: 0.12 }, jaw: 0.10, hold: 'vowel' },

  // ── 6  j i ɪ — close front vowel/glide, spread, light stretch ────────────────
  6:  { support: { mouthClose: 0.06, mouthStretchLeft: 0.07, mouthStretchRight: 0.07 }, jaw: 0.12, hold: 'vowel' },

  // ── 7  w u — close back rounded vowel/glide, tight pucker ────────────────────
  7:  { support: { mouthPucker: 0.46, mouthFunnel: 0.26 }, jaw: 0.10, hold: 'vowel' },

  // ── 8  o — close-mid rounded vowel (funnel + pucker) ─────────────────────────
  8:  { support: { mouthFunnel: 0.40, mouthPucker: 0.30 }, jaw: JAW_OU, hold: 'vowel' },

  // ── 9  aʊ — diphthong open→round (open then funnel) ──────────────────────────
  9:  { support: { mouthOpen: 0.14, mouthClose: 0.08, mouthFunnel: 0.16 }, jaw: JAW_DIPH, hold: 'vowel' },

  // ── 10 ɔɪ — diphthong round→front (funnel then spread) ───────────────────────
  10: { support: { mouthFunnel: 0.20, mouthStretchLeft: 0.05, mouthStretchRight: 0.05 }, jaw: JAW_OU, hold: 'vowel' },

  // ── 11 aɪ — diphthong open→front (open then spread) ──────────────────────────
  11: { support: { mouthOpen: 0.14, mouthClose: 0.08, mouthStretchLeft: 0.06, mouthStretchRight: 0.06 }, jaw: JAW_DIPH, hold: 'vowel' },

  // ── 12 h — breath, neutral slightly-open mouth ───────────────────────────────
  12: { support: { mouthOpen: 0.08 }, jaw: 0.12, hold: 'vowel' },

  // ── 13 ɹ — r approximant, light rounding ─────────────────────────────────────
  13: { support: { mouthFunnel: 0.14, mouthPucker: 0.10 }, jaw: 0.08, hold: 'consonant' },

  // ── 14 l — alveolar lateral (tongue up, low jaw) ─────────────────────────────
  14: { support: {}, jaw: JAW_CONS, hold: 'consonant' },

  // ── 15 s z — sibilant, narrow, low jaw, faint stretch ────────────────────────
  15: { support: { mouthStretchLeft: 0.05, mouthStretchRight: 0.05 }, jaw: JAW_CONS, hold: 'consonant' },

  // ── 16 ʃ tʃ dʒ ʒ — post-alveolar, protruded + rounded (pucker + funnel) ──────
  16: { support: { mouthFunnel: 0.24, mouthPucker: 0.18 }, jaw: 0.08, hold: 'consonant' },

  // ── 17 ð — dental, tongue tip to teeth, very light open ──────────────────────
  17: { support: { mouthLowerDownLeft: 0.10, mouthLowerDownRight: 0.10, mouthUpperUpLeft: 0.06, mouthUpperUpRight: 0.06 }, jaw: 0.08, hold: 'consonant' },

  // ── 18 f v — labiodental: lower lip tucks under upper teeth ──────────────────
  // Lower lip rolls in + draws down while upper lip lifts slightly to bare the
  // teeth edge. Light close keeps the gap small.
  18: { support: { mouthLowerDownLeft: 0.20, mouthLowerDownRight: 0.20, mouthRollLower: 0.16, mouthUpperUpLeft: 0.08, mouthUpperUpRight: 0.08, mouthClose: 0.06 }, jaw: 0.05, hold: 'consonant' },

  // ── 19 d t n θ — alveolar, low jaw ───────────────────────────────────────────
  19: { support: {}, jaw: JAW_CONS, hold: 'consonant' },

  // ── 20 k g ŋ — velar, low jaw ────────────────────────────────────────────────
  20: { support: {}, jaw: JAW_CONS, hold: 'consonant' },

  // ── 21 p b m — bilabial closure: lips meet firmly, jaw closed ────────────────
  // The Oculus viseme_PP morph alone reads as a soft pout on Avaturn rigs. Layer
  // a strong mouthClose + lip roll + bilateral press and drive the primary morph
  // hard so the closure is unmistakable. jaw stays 0 (lips sealed). The fast
  // attack lerp in the render loop snaps this closed quickly; the fast release
  // (consonant hold) lets it part cleanly into the following vowel.
  21: { support: { mouthClose: 0.45, mouthRollLower: 0.18, mouthRollUpper: 0.14, mouthPressLeft: 0.16, mouthPressRight: 0.16 }, jaw: 0, primaryScale: PRIMARY_PLOSIVE, hold: 'closure' },
}

/**
 * Build the full target-weight map for a viseme: the primary Oculus mouth
 * shape(s) at `primaryScale`, plus conservative ARKit support shapes.
 *
 * `driveScale` (v0.6.7) multiplies the RESOLVED primary scale — including
 * per-viseme `primaryScale` overrides, which otherwise replace the caller's
 * scale outright — so a product-level articulation knob softens plosives and
 * open vowels alike. Support shapes are deliberately NOT scaled: a quieter
 * mouth should still seal its closures and round its O/U.
 *
 * Returns `{ weights, jaw, hold }`. `weights` excludes jawOpen (the caller owns
 * the jaw key so it can be zeroed independently by the recentlyFired gate).
 * `hold` is the temporal class the render loop uses to pick a release speed.
 *
 * Unknown / silence IDs return empty weights and jaw 0. Callers must still
 * guard id===0 if they want to skip applying silence at all.
 */
export function buildVisemeTargets(
  id: number,
  primaryScale = 0.6,
  driveScale = 1
): { weights: Record<string, number>; jaw: number; hold: 'vowel' | 'consonant' | 'closure' } {
  const primary = VISEME_TO_ARKIT[id]
  if (!primary) return { weights: {}, jaw: 0, hold: 'vowel' }

  const support = VISEME_SUPPORT[id]
  // A viseme may override how hard its primary Oculus morph is driven (plosive
  // closures harder, open vowels softer). Falls back to the caller's scale.
  const effectiveScale = Math.min(1, (support?.primaryScale ?? primaryScale) * driveScale)

  const weights: Record<string, number> = {}
  const w = effectiveScale / primary.length
  for (const name of primary) weights[name] = w

  if (support) {
    for (const [name, val] of Object.entries(support.support)) {
      // Add (don't overwrite) in case a support key coincides with a primary key.
      weights[name] = Math.min(1, (weights[name] ?? 0) + val)
    }
    return { weights, jaw: support.jaw, hold: support.hold ?? 'vowel' }
  }

  // Legacy fallback: generic jaw for any vowel-ish primary shape.
  const jaw = primary.some(s => JAW_OPEN_SHAPES.has(s)) ? 0.3 : 0
  return { weights, jaw, hold: 'vowel' }
}

/**
 * Mesh names used by Avaturn GLB exports.
 * All of these are traversed and stored as refs for morph target writes.
 */
export const AVATURN_MESH_NAMES = [
  'Head_Mesh',
  'Teeth_Mesh',
  'Tongue_Mesh',
  'Eye_Mesh',
  'EyeAO_Mesh',
  'Eyelash_Mesh',
] as const
