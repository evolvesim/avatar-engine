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
