/**
 * cc4-morph-alias.ts
 *
 * Runtime alias mapping from ARKit/Oculus blendshape names (which the engine
 * writes) to CC4 Standard morph names (which Character Creator 4 exports use).
 *
 * The entire engine drives face state through ARKit names (e.g. `jawOpen`,
 * `eyeBlinkLeft`, `mouthSmileRight`, `viseme_aa`). CC4 avatars ship with the
 * same underlying muscles but named in CC4 Standard style (`Jaw_Open`,
 * `Eye_Blink_L`, `Mouth_Smile_R`, `V_Open`).
 *
 * Rather than rename every reference across viseme-map / emotion-state /
 * procedural-animations / fft-fallback, we install a per-avatar alias map
 * inside `applyWeightsToMeshes` that redirects the write to the CC4 morph
 * whenever the ARKit name isn't present but its CC4 sibling is.
 *
 * The map is detected once per avatar at load time by scanning the SkinnedMesh
 * `morphTargetDictionary` for CC4 tell-tales (`V_Open`, `Jaw_Open`,
 * `Eye_Blink_L`). No effect on Avaturn/RPM avatars because their dictionaries
 * carry the ARKit names natively → alias never fires.
 */

/**
 * Static ARKit → CC4 Standard rename table. Left side is the ARKit name the
 * engine writes; right side is the CC4 Standard name on the CC_Base_Body /
 * CC_Base_Eye / CC_Base_TearLine / CC_Base_Tongue meshes.
 *
 * When a name has no direct CC4 counterpart (e.g. combined `browInnerUp`),
 * the fallback picks the closest muscle group (left+right inner brow raise).
 * `applyWeightsToMeshes` uses this table read-only.
 */
export const ARKIT_TO_CC4: Readonly<Record<string, string>> = {
  // ── Azure/Oculus viseme shapes ──────────────────────────────────────────
  // CC4 provides 8 canonical viseme shapes (V_Open, V_Explosive, V_Dental_Lip,
  // V_Tight_O, V_Tight, V_Wide, V_Affricate, V_Lip_Open). Map each engine
  // viseme to the closest CC4 phoneme shape.
  viseme_sil: 'Mouth_Close',       // silence — mouth closed
  viseme_PP:  'V_Explosive',       // p b m  — bilabial closure
  viseme_FF:  'V_Dental_Lip',      // f v    — labiodental
  viseme_TH:  'V_Dental_Lip',      // ð      — dental (closest CC4 shape)
  viseme_DD:  'V_Lip_Open',        // d t n θ — alveolar
  viseme_kk:  'V_Tight',           // k g ŋ  — velar
  viseme_CH:  'V_Affricate',       // ʃ tʃ dʒ ʒ — post-alveolar
  viseme_SS:  'V_Tight',           // s z    — sibilant
  viseme_nn:  'V_Lip_Open',        // l      — alveolar lateral
  viseme_RR:  'V_Tight_O',         // ɹ ɝ    — r-coloured
  viseme_aa:  'V_Open',            // æ ə ʌ ɑ — open vowels
  viseme_E:   'V_Wide',            // ɛ ʊ h  — mid
  viseme_I:   'V_Wide',            // i ɪ j  — close front (spread)
  viseme_O:   'V_Tight_O',         // o ɔ    — rounded
  viseme_U:   'V_Tight_O',         // u w    — close back rounded
  mouthOpen:  'V_Open',
  mouthClose: 'Mouth_Close',

  // ── Jaw ─────────────────────────────────────────────────────────────────
  jawOpen:      'Jaw_Open',
  jawForward:   'Jaw_Forward',
  jawLeft:      'Jaw_L',
  jawRight:     'Jaw_R',

  // ── Eye blinks / squints / wide ────────────────────────────────────────
  eyeBlinkLeft:   'Eye_Blink_L',
  eyeBlinkRight:  'Eye_Blink_R',
  eyeSquintLeft:  'Eye_Squint_L',
  eyeSquintRight: 'Eye_Squint_R',
  eyeWideLeft:    'Eye_Wide_L',
  eyeWideRight:   'Eye_Wide_R',

  // ── Eye gaze ───────────────────────────────────────────────────────────
  // ARKit "In/Out" is relative to nose; CC4 uses absolute L/R per eye.
  // eyeLookInLeft = left eye looking right (toward nose) = Eye_L_Look_R
  // eyeLookOutLeft = left eye looking left (away from nose) = Eye_L_Look_L
  // eyeLookInRight = right eye looking left (toward nose) = Eye_R_Look_L
  // eyeLookOutRight = right eye looking right (away from nose) = Eye_R_Look_R
  eyeLookInLeft:   'Eye_L_Look_R',
  eyeLookOutLeft:  'Eye_L_Look_L',
  eyeLookInRight:  'Eye_R_Look_L',
  eyeLookOutRight: 'Eye_R_Look_R',
  eyeLookUpLeft:   'Eye_L_Look_Up',
  eyeLookUpRight:  'Eye_R_Look_Up',
  eyeLookDownLeft: 'Eye_L_Look_Down',
  eyeLookDownRight:'Eye_R_Look_Down',
  // Legacy short names sometimes used in procedural-animations
  lookLeft:  'Eye_L_Look_L',   // primary — right eye rerouted separately
  lookRight: 'Eye_L_Look_R',

  // ── Brows ──────────────────────────────────────────────────────────────
  browInnerUp:      'Brow_Raise_Inner_L',   // engine writes single, will pick L; R covered by aliasBothEyes helper
  browInnerUpLeft:  'Brow_Raise_Inner_L',
  browInnerUpRight: 'Brow_Raise_Inner_R',
  browOuterUpLeft:  'Brow_Raise_Outer_L',
  browOuterUpRight: 'Brow_Raise_Outer_R',
  browDownLeft:     'Brow_Drop_L',
  browDownRight:    'Brow_Drop_R',

  // ── Nose ───────────────────────────────────────────────────────────────
  noseSneerLeft:    'Nose_Sneer_L',
  noseSneerRight:   'Nose_Sneer_R',

  // ── Cheeks ─────────────────────────────────────────────────────────────
  cheekSquintLeft:  'Cheek_Raise_L',
  cheekSquintRight: 'Cheek_Raise_R',
  cheekPuff:        'Cheek_Puff_L',  // primary L, R paired via helper

  // ── Mouth smile / frown / press / stretch / dimple ─────────────────────
  mouthSmileLeft:    'Mouth_Smile_L',
  mouthSmileRight:   'Mouth_Smile_R',
  mouthFrownLeft:    'Mouth_Frown_L',
  mouthFrownRight:   'Mouth_Frown_R',
  mouthDimpleLeft:   'Mouth_Dimple_L',
  mouthDimpleRight:  'Mouth_Dimple_R',
  mouthPressLeft:    'Mouth_Press_L',
  mouthPressRight:   'Mouth_Press_R',
  mouthStretchLeft:  'Mouth_Stretch_L',
  mouthStretchRight: 'Mouth_Stretch_R',

  // ── Mouth funnel / pucker / roll / shrug ───────────────────────────────
  mouthFunnel:      'Mouth_Funnel_Up_L',   // engine writes single value; pair L+R via helper
  mouthPucker:      'Mouth_Pucker_Up_L',
  mouthShrugLower:  'Mouth_Shrug_Lower',
  mouthShrugUpper:  'Mouth_Shrug_Upper',
  mouthRollLower:   'Mouth_Roll_In_Lower_L',
  mouthRollUpper:   'Mouth_Roll_In_Upper_L',

  // ── Mouth upper up / lower down ────────────────────────────────────────
  mouthUpperUpLeft:    'Mouth_Up_Upper_L',
  mouthUpperUpRight:   'Mouth_Up_Upper_R',
  mouthLowerDownLeft:  'Mouth_Down_Lower_L',
  mouthLowerDownRight: 'Mouth_Down_Lower_R',

  // ── Tongue ─────────────────────────────────────────────────────────────
  tongueOut: 'Tongue_Out',
} as const

/**
 * Some ARKit names (mouthFunnel, mouthPucker, cheekPuff, browInnerUp, mouthRollLower)
 * write a single scalar that CC4 splits into L+R shapes. This helper returns
 * BOTH the L and R names for a given ARKit key so the same value is applied
 * to each side, keeping the face symmetric.
 */
export const ARKIT_TO_CC4_PAIRS: Readonly<Record<string, readonly string[]>> = {
  browInnerUp:     ['Brow_Raise_Inner_L', 'Brow_Raise_Inner_R'],
  cheekPuff:       ['Cheek_Puff_L', 'Cheek_Puff_R'],
  mouthFunnel:     ['Mouth_Funnel_Up_L', 'Mouth_Funnel_Up_R', 'Mouth_Funnel_Down_L', 'Mouth_Funnel_Down_R'],
  mouthPucker:     ['Mouth_Pucker_Up_L', 'Mouth_Pucker_Up_R', 'Mouth_Pucker_Down_L', 'Mouth_Pucker_Down_R'],
  mouthRollLower:  ['Mouth_Roll_In_Lower_L', 'Mouth_Roll_In_Lower_R'],
  mouthRollUpper:  ['Mouth_Roll_In_Upper_L', 'Mouth_Roll_In_Upper_R'],
  // "eyeBlink" (unified) — some code paths write a single value expecting
  // both eyes to close together. Left+Right individual keys are still
  // preferred where available.
  eyeBlinkBoth:    ['Eye_Blink_L', 'Eye_Blink_R'],
} as const

/**
 * Probe morphs that indicate a CC4 dictionary is present. If any of these
 * keys appear in the SkinnedMesh's morphTargetDictionary, the aliasing layer
 * treats the mesh as CC4 and starts routing writes.
 */
export const CC4_PROBE_KEYS: readonly string[] = [
  'V_Open', 'Jaw_Open', 'Eye_Blink_L', 'Mouth_Smile_L',
]

/**
 * Returns true when the given morphTargetDictionary looks like CC4 Standard.
 * Cheap probe — checks for a couple of tell-tale keys.
 */
export function isCC4Dictionary(dict: Record<string, number> | undefined): boolean {
  if (!dict) return false
  let hits = 0
  for (const key of CC4_PROBE_KEYS) if (key in dict) hits++
  return hits >= 2  // need at least 2 to avoid false positive on partial rigs
}
