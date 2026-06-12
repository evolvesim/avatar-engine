/**
 * viseme-map.ts
 *
 * Azure (and ElevenLabs) emit 22 viseme IDs (0–21).
 * These are the same 22 IDs regardless of TTS provider.
 * Maps each ID to the ARKit blendshape name(s) used on the Avaturn GLB.
 *
 * This file is the single source of truth for all three products:
 *   Evolve B2B | EvySim | ACTS Education
 *
 * If you swap avatar vendors, update the right-hand side values only.
 * The IDs on the left are fixed by the Azure/ElevenLabs speech protocol.
 */

export const VISEME_TO_ARKIT: Record<number, string[]> = {
  0:  ['viseme_sil'],
  1:  ['viseme_PP'],
  2:  ['viseme_FF'],
  3:  ['viseme_TH'],
  4:  ['viseme_DD'],
  5:  ['viseme_kk'],
  6:  ['viseme_CH'],
  7:  ['viseme_SS'],
  8:  ['viseme_nn'],
  9:  ['viseme_RR'],
  10: ['viseme_aa'],
  11: ['viseme_E'],
  12: ['viseme_I'],
  13: ['viseme_O'],
  14: ['viseme_U'],
  15: ['viseme_aa'],
  16: ['viseme_E'],
  17: ['viseme_I'],
  18: ['viseme_O'],
  19: ['viseme_U'],
  20: ['viseme_aa', 'viseme_O'],
  21: ['viseme_O', 'viseme_U'],
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

/** Ceiling for expressive support shapes (cheeks, stretch, funnel, pucker…). */
export const SUPPORT_CAP = 0.35
/** Ceiling for closure/roll shapes — higher so plosive seals actually read. */
export const CLOSURE_CAP = 0.55

// Jaw tiers (kept ≤0.32 — higher reads as a yawn on Avaturn rigs):
//   open vowel aa : high   medium-open E/I : medium   rounded O/U : low-rounded
//   consonants    : low / closed
const JAW_AA = 0.30
const JAW_EI = 0.20
const JAW_OU = 0.16
const JAW_CONS = 0.05

// Primary-morph drive tiers:
//   plosive closure : hard (lips must visibly seal)
//   default vowels  : standard 0.6 (set in buildVisemeTargets)
//   open vowel aa   : slightly eased so the mouth shape comes from jaw, not a
//                     permanently stretched viseme_aa morph.
const PRIMARY_PLOSIVE = 0.85
const PRIMARY_OPEN_VOWEL = 0.52

export const VISEME_SUPPORT: Record<number, VisemeSupport> = {
  // ── Silence ───────────────────────────────────────────────────────────────
  0:  { support: {}, jaw: 0 },

  // ── Bilabials P/B/M — lips meet firmly, jaw closed ──────────────────────────
  // The Oculus viseme_PP morph alone reads as a soft pout on Avaturn rigs. Layer
  // a strong mouthClose + lip roll + bilateral press and drive the primary morph
  // hard so the closure is unmistakable. jaw stays 0 (lips sealed). The fast
  // attack lerp in the render loop snaps this closed quickly; the slow release
  // lets it part naturally into the following vowel.
  1:  { support: { mouthClose: 0.45, mouthRollLower: 0.18, mouthRollUpper: 0.14, mouthPressLeft: 0.16, mouthPressRight: 0.16 }, jaw: 0, primaryScale: PRIMARY_PLOSIVE },

  // ── F/V — lower lip tucks under upper teeth (labiodental) ───────────────────
  // Lower lip rolls in + draws down while upper lip lifts slightly to bare the
  // teeth edge. Light close keeps the gap small.
  2:  { support: { mouthLowerDownLeft: 0.20, mouthLowerDownRight: 0.20, mouthRollLower: 0.16, mouthUpperUpLeft: 0.08, mouthUpperUpRight: 0.08, mouthClose: 0.06 }, jaw: 0.05 },

  // ── TH — tongue tip to teeth, very light open + slight upper-lip lift ────────
  3:  { support: { mouthLowerDownLeft: 0.10, mouthLowerDownRight: 0.10, mouthUpperUpLeft: 0.06, mouthUpperUpRight: 0.06 }, jaw: 0.08 },

  // ── DD / T / N — alveolar, low jaw ──────────────────────────────────────────
  4:  { support: {}, jaw: JAW_CONS },

  // ── kk / G — velar, low jaw ─────────────────────────────────────────────────
  5:  { support: {}, jaw: JAW_CONS },

  // ── CH / J / SH — protruded, rounded (pucker + funnel) ──────────────────────
  6:  { support: { mouthFunnel: 0.16, mouthPucker: 0.12 }, jaw: 0.08 },

  // ── SS / Z — narrow, low jaw, faint stretch ─────────────────────────────────
  7:  { support: { mouthStretchLeft: 0.05, mouthStretchRight: 0.05 }, jaw: JAW_CONS },

  // ── nn / L — alveolar ───────────────────────────────────────────────────────
  8:  { support: {}, jaw: JAW_CONS },

  // ── RR — light rounding ─────────────────────────────────────────────────────
  9:  { support: { mouthFunnel: 0.10, mouthPucker: 0.06 }, jaw: 0.08 },

  // ── Open vowel aa — jaw-driven open + subtle cheek support ───────────────────
  // Drive the primary viseme_aa a touch softer and let jawOpen carry the opening
  // so the mouth does not read as a permanently stretched morph.
  10: { support: { mouthOpen: 0.16, cheekSquintLeft: 0.05, cheekSquintRight: 0.05 }, jaw: JAW_AA, primaryScale: PRIMARY_OPEN_VOWEL },

  // ── E — medium open, faint stretch (not a smile) ────────────────────────────
  11: { support: { mouthOpen: 0.10, mouthStretchLeft: 0.06, mouthStretchRight: 0.06 }, jaw: JAW_EI },

  // ── I — medium, light stretch ───────────────────────────────────────────────
  12: { support: { mouthStretchLeft: 0.07, mouthStretchRight: 0.07 }, jaw: JAW_EI },

  // ── O — rounded, funnel + pucker, low jaw ───────────────────────────────────
  13: { support: { mouthFunnel: 0.30, mouthPucker: 0.18 }, jaw: JAW_OU },

  // ── U — most rounded, tightest pucker (tighter than O) ──────────────────────
  14: { support: { mouthPucker: 0.34, mouthFunnel: 0.16 }, jaw: 0.10 },

  // Azure mirrors 10–14 onto 15–19 (stressed/secondary). Mirror the support too.
  15: { support: { mouthOpen: 0.16, cheekSquintLeft: 0.05, cheekSquintRight: 0.05 }, jaw: JAW_AA, primaryScale: PRIMARY_OPEN_VOWEL },
  16: { support: { mouthOpen: 0.10, mouthStretchLeft: 0.06, mouthStretchRight: 0.06 }, jaw: JAW_EI },
  17: { support: { mouthStretchLeft: 0.07, mouthStretchRight: 0.07 }, jaw: JAW_EI },
  18: { support: { mouthFunnel: 0.30, mouthPucker: 0.18 }, jaw: JAW_OU },
  19: { support: { mouthPucker: 0.34, mouthFunnel: 0.16 }, jaw: 0.10 },

  // ── Diphthongs ──────────────────────────────────────────────────────────────
  // 20 aa→O : open then round   21 O→U : round then tight-round
  20: { support: { mouthOpen: 0.14, mouthFunnel: 0.16 }, jaw: 0.22 },
  21: { support: { mouthFunnel: 0.20, mouthPucker: 0.22 }, jaw: JAW_OU },
}

/**
 * Build the full target-weight map for a viseme: the primary Oculus mouth
 * shape(s) at `primaryScale`, plus conservative ARKit support shapes.
 *
 * Returns `{ weights, jaw }`. `weights` excludes jawOpen (the caller owns the
 * jaw key so it can be zeroed independently by the recentlyFired gate).
 *
 * Unknown / silence IDs return empty weights and jaw 0. Callers must still
 * guard id===0 if they want to skip applying silence at all.
 */
export function buildVisemeTargets(
  id: number,
  primaryScale = 0.6
): { weights: Record<string, number>; jaw: number } {
  const primary = VISEME_TO_ARKIT[id]
  if (!primary) return { weights: {}, jaw: 0 }

  const support = VISEME_SUPPORT[id]
  // A viseme may override how hard its primary Oculus morph is driven (plosive
  // closures harder, open vowels softer). Falls back to the caller's scale.
  const effectiveScale = support?.primaryScale ?? primaryScale

  const weights: Record<string, number> = {}
  const w = effectiveScale / primary.length
  for (const name of primary) weights[name] = w

  if (support) {
    for (const [name, val] of Object.entries(support.support)) {
      // Add (don't overwrite) in case a support key coincides with a primary key.
      weights[name] = Math.min(1, (weights[name] ?? 0) + val)
    }
    return { weights, jaw: support.jaw }
  }

  // Legacy fallback: generic jaw for any vowel-ish primary shape.
  const jaw = primary.some(s => JAW_OPEN_SHAPES.has(s)) ? 0.3 : 0
  return { weights, jaw }
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
