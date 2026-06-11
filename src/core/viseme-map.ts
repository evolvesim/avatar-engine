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
  'mouthOpen',
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
}

// Jaw tiers (kept ≤0.32 — higher reads as a yawn on Avaturn rigs):
//   open vowel aa : high   medium-open E/I : medium   rounded O/U : low-rounded
//   consonants    : low / closed
const JAW_AA = 0.32
const JAW_EI = 0.22
const JAW_OU = 0.18
const JAW_CONS = 0.06

export const VISEME_SUPPORT: Record<number, VisemeSupport> = {
  // ── Silence ───────────────────────────────────────────────────────────────
  0:  { support: {}, jaw: 0 },

  // ── Bilabials P/B/M — lips meet, jaw essentially closed ─────────────────────
  1:  { support: { mouthClose: 0.25, mouthPressLeft: 0.12, mouthPressRight: 0.12 }, jaw: 0 },

  // ── F/V — lower lip tucks toward upper teeth ────────────────────────────────
  2:  { support: { mouthLowerDownLeft: 0.18, mouthLowerDownRight: 0.18, mouthClose: 0.06 }, jaw: 0.05 },

  // ── TH — tongue/teeth, very light open ──────────────────────────────────────
  3:  { support: { mouthLowerDownLeft: 0.08, mouthLowerDownRight: 0.08 }, jaw: 0.08 },

  // ── DD / T / N — alveolar, low jaw ──────────────────────────────────────────
  4:  { support: {}, jaw: JAW_CONS },

  // ── kk / G — velar, low jaw ─────────────────────────────────────────────────
  5:  { support: {}, jaw: JAW_CONS },

  // ── CH / J / SH — slight pucker ─────────────────────────────────────────────
  6:  { support: { mouthFunnel: 0.12, mouthPucker: 0.08 }, jaw: 0.08 },

  // ── SS / Z — narrow, low jaw ────────────────────────────────────────────────
  7:  { support: {}, jaw: JAW_CONS },

  // ── nn / L — alveolar ───────────────────────────────────────────────────────
  8:  { support: {}, jaw: JAW_CONS },

  // ── RR — light rounding ─────────────────────────────────────────────────────
  9:  { support: { mouthFunnel: 0.08 }, jaw: 0.08 },

  // ── Open vowel aa — high jaw + subtle cheek support ─────────────────────────
  10: { support: { mouthOpen: 0.20, cheekSquintLeft: 0.06, cheekSquintRight: 0.06 }, jaw: JAW_AA },

  // ── E — medium open, faint stretch (not a smile) ────────────────────────────
  11: { support: { mouthOpen: 0.12, mouthStretchLeft: 0.06, mouthStretchRight: 0.06 }, jaw: JAW_EI },

  // ── I — medium, light stretch ───────────────────────────────────────────────
  12: { support: { mouthStretchLeft: 0.07, mouthStretchRight: 0.07 }, jaw: JAW_EI },

  // ── O — rounded, funnel + pucker, low jaw ───────────────────────────────────
  13: { support: { mouthFunnel: 0.30, mouthPucker: 0.18 }, jaw: JAW_OU },

  // ── U — most rounded, strong pucker ─────────────────────────────────────────
  14: { support: { mouthPucker: 0.30, mouthFunnel: 0.18 }, jaw: 0.10 },

  // Azure mirrors 10–14 onto 15–19 (stressed/secondary). Mirror the support too.
  15: { support: { mouthOpen: 0.20, cheekSquintLeft: 0.06, cheekSquintRight: 0.06 }, jaw: JAW_AA },
  16: { support: { mouthOpen: 0.12, mouthStretchLeft: 0.06, mouthStretchRight: 0.06 }, jaw: JAW_EI },
  17: { support: { mouthStretchLeft: 0.07, mouthStretchRight: 0.07 }, jaw: JAW_EI },
  18: { support: { mouthFunnel: 0.30, mouthPucker: 0.18 }, jaw: JAW_OU },
  19: { support: { mouthPucker: 0.30, mouthFunnel: 0.18 }, jaw: 0.10 },

  // ── Diphthongs ──────────────────────────────────────────────────────────────
  // 20 aa→O : open then round   21 O→U : round then tight-round
  20: { support: { mouthOpen: 0.14, mouthFunnel: 0.16 }, jaw: 0.24 },
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

  const weights: Record<string, number> = {}
  const w = primaryScale / primary.length
  for (const name of primary) weights[name] = w

  const support = VISEME_SUPPORT[id]
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
