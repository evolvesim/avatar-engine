/**
 * situational-clips.ts — GENERATED. Do not edit by hand.
 *
 * Source: scripts/situational-mapping.json
 * Regenerate: node scripts/gen-situational-clips.mjs
 *
 * The situational clip registry. Every clip records WHAT IT DOES IN DIALOGUE
 * ('functions') and HOW IT IS COLOURED ('manner') — deliberately NOT an emotion.
 *
 * Emotion no longer decides which body clip may play. It persists on the FACE via
 * the emotion state machine, so a character who turns sad stays visibly sad across
 * exchanges while still gesturing appropriately for what they are saying. Coupling
 * the two is what previously pinned an avatar to one emotion's clips and made every
 * conversation read as the same mood.
 *
 * 'manner' exists to break ties, to let a director ask for an on-tone variant, and
 * to keep a CHARACTERISED resting pose out of rotation when nothing in the
 * conversation calls for it. It must never restrict the pool of GESTURES.
 *
 * 'scale' is the MEASURED size of the motion (see scripts/measure-clip-amplitude
 * and merge-clip-amplitude), not a guess from the clip's name. Guessing from names
 * is exactly how 37 arm-throwing clips came to be advertised as restrained head
 * beats. A director should default to 'subtle' and escalate only when the moment
 * earns it.
 */

/** What a clip does in dialogue. */
export type ClipFunction =
  | 'listening'
  | 'explaining'
  | 'making_point'
  | 'agreeing'
  | 'disagreeing'
  | 'thinking'
  | 'emoting'
  | 'self_reference'
  | 'greeting'
  | 'rest'

/** Optional emotional colouring. Breaks ties; never gates gesture selection. */
export type ClipManner =
  | 'shy'
  | 'agitated'
  | 'elated'
  | 'downcast'
  | 'guarded'
  | 'formal'
  | 'relaxed'

/**
 * Measured size of the motion, banded from armDeg.
 *
 *   subtle    <= 20°  head, eyes, a small weight shift
 *   moderate  <= 70°  a contained hand movement
 *   broad      >  70°  a full arm throw, visible across the frame
 */
export type ClipScale =
  | 'subtle'
  | 'moderate'
  | 'broad'

export interface SituationalClip {
  id:        string
  /** Human label for admin UIs. */
  label:     string
  /** Author's description of the moment it fits. This is what a director is shown. */
  when:      string
  /** 'idle' loops as a resting pose; 'gesture' plays once. */
  kind:      'idle' | 'gesture'
  functions: ClipFunction[]
  manner:    ClipManner[]
  /** Banded motion size. Prefer the smallest that fits the moment. */
  scale:     ClipScale
  /** Max angular excursion of any shoulder/arm/forearm/hand bone, in degrees. */
  armDeg:    number
  /** Max angular excursion of any hip/spine/head/neck bone, in degrees. */
  bodyDeg:   number
  duration:  number
}

export const CLIP_FUNCTIONS: readonly ClipFunction[] = ['listening', 'explaining', 'making_point', 'agreeing', 'disagreeing', 'thinking', 'emoting', 'self_reference', 'greeting', 'rest']
export const CLIP_MANNERS:   readonly ClipManner[]   = ['shy', 'agitated', 'elated', 'downcast', 'guarded', 'formal', 'relaxed']
export const CLIP_SCALES:    readonly ClipScale[]    = ['subtle', 'moderate', 'broad']

/** Ascending motion size, for "prefer the smallest that fits" ordering. */
export const SCALE_ORDER: Readonly<Record<ClipScale, number>> = { subtle: 0, moderate: 1, broad: 2 }

export const SITUATIONAL_CLIPS: Record<string, SituationalClip> = {
  'av_angry_breathing_fast': { id: 'av_angry_breathing_fast', label: 'Angry breathing fast', when: 'When agitated or annoyed', kind: 'idle', functions: ['emoting'], manner: ['agitated'], scale: 'subtle', armDeg: 4, bodyDeg: 2, duration: 5.70 },
  'av_angry_point': { id: 'av_angry_point', label: 'Angry point', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 84, bodyDeg: 19, duration: 3.27 },
  'av_bashful_look_at_ground': { id: 'av_bashful_look_at_ground', label: 'Bashful look at ground', when: 'When shy or flattered', kind: 'gesture', functions: ['emoting'], manner: ['shy'], scale: 'broad', armDeg: 117, bodyDeg: 43, duration: 14.60 },
  'av_both_hands_foward': { id: 'av_both_hands_foward', label: 'Both hands foward', when: 'When exaplining big idea', kind: 'gesture', functions: ['explaining'], manner: [], scale: 'broad', armDeg: 85, bodyDeg: 13, duration: 4.43 },
  'av_eyes_up_for_a_moment': { id: 'av_eyes_up_for_a_moment', label: 'Eyes up for a moment', when: 'When thinking', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'moderate', armDeg: 21, bodyDeg: 7, duration: 2.70 },
  'av_feminine_footfoward': { id: 'av_feminine_footfoward', label: 'Feminine footfoward', when: 'When female and attentive', kind: 'idle', functions: ['rest'], manner: [], scale: 'subtle', armDeg: 11, bodyDeg: 2, duration: 6.03 },
  'av_fist_pump': { id: 'av_fist_pump', label: 'Fist pump', when: 'When excited and feeling like they\'ve won', kind: 'gesture', functions: ['emoting'], manner: ['elated'], scale: 'broad', armDeg: 114, bodyDeg: 34, duration: 3.83 },
  'av_foot_foward_slouch': { id: 'av_foot_foward_slouch', label: 'Foot Foward Slouch', when: 'When relaxed or waiting', kind: 'idle', functions: ['rest'], manner: ['relaxed'], scale: 'subtle', armDeg: 11, bodyDeg: 1, duration: 8.37 },
  'av_hand_snapped_in_front': { id: 'av_hand_snapped_in_front', label: 'Hand snapped in front', when: 'When making a sharp point', kind: 'gesture', functions: ['making_point'], manner: ['agitated'], scale: 'moderate', armDeg: 42, bodyDeg: 15, duration: 2.97 },
  'av_hand_swiped_in_front': { id: 'av_hand_swiped_in_front', label: 'Hand swiped in front', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 77, bodyDeg: 17, duration: 3.43 },
  'av_hand_to_chest': { id: 'av_hand_to_chest', label: 'Hand to Chest', when: 'When talking about themselves', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], scale: 'broad', armDeg: 118, bodyDeg: 32, duration: 4.40 },
  'av_hand_waved_in_front': { id: 'av_hand_waved_in_front', label: 'Hand waved in front', when: 'When dismissing idea', kind: 'gesture', functions: ['disagreeing', 'explaining'], manner: [], scale: 'broad', armDeg: 116, bodyDeg: 24, duration: 4.43 },
  'av_head_nod': { id: 'av_head_nod', label: 'Head nod', when: 'When they agree', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'subtle', armDeg: 9, bodyDeg: 17, duration: 3.40 },
  'av_head_shake': { id: 'av_head_shake', label: 'Head shake', when: 'When quickly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'subtle', armDeg: 16, bodyDeg: 35, duration: 2.60 },
  'av_head_shake_slow': { id: 'av_head_shake_slow', label: 'Head Shake slow', when: 'When slowly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'subtle', armDeg: 6, bodyDeg: 30, duration: 2.67 },
  'av_head_side_to_side': { id: 'av_head_side_to_side', label: 'Head side to side', when: 'When faced with two options', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'moderate', armDeg: 41, bodyDeg: 17, duration: 2.83 },
  'av_head_side_to_side_slower': { id: 'av_head_side_to_side_slower', label: 'Head side to side slower', when: 'When making two points', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'moderate', armDeg: 41, bodyDeg: 17, duration: 3.73 },
  'av_head_turn': { id: 'av_head_turn', label: 'Head Turn', when: 'When disagreeing or making a point', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], scale: 'moderate', armDeg: 43, bodyDeg: 26, duration: 2.57 },
  'av_head_up_then_nod': { id: 'av_head_up_then_nod', label: 'Head up then nod', when: 'When thinking then agreeing', kind: 'gesture', functions: ['agreeing', 'thinking'], manner: [], scale: 'subtle', armDeg: 20, bodyDeg: 21, duration: 2.97 },
  'av_head_up_then_shake': { id: 'av_head_up_then_shake', label: 'Head up then shake', when: 'When thinking then disagreeing', kind: 'gesture', functions: ['disagreeing', 'thinking'], manner: [], scale: 'subtle', armDeg: 6, bodyDeg: 22, duration: 3.10 },
  'av_idle_standard': { id: 'av_idle_standard', label: 'Idle Standard', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], scale: 'subtle', armDeg: 7, bodyDeg: 2, duration: 10.03 },
  'av_idle_still': { id: 'av_idle_still', label: 'Idle Still', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], scale: 'subtle', armDeg: 3, bodyDeg: 2, duration: 16.70 },
  'av_lean_back_hands_up': { id: 'av_lean_back_hands_up', label: 'Lean back hands up', when: 'When accepting an idea', kind: 'gesture', functions: ['agreeing', 'explaining'], manner: [], scale: 'moderate', armDeg: 57, bodyDeg: 24, duration: 4.03 },
  'av_lean_forward_hands_out_yelling': { id: 'av_lean_forward_hands_out_yelling', label: 'Lean forward hands out yelling', when: 'When yelling', kind: 'gesture', functions: ['emoting'], manner: ['agitated'], scale: 'broad', armDeg: 107, bodyDeg: 31, duration: 7.87 },
  'av_look_at_hand_and_nails': { id: 'av_look_at_hand_and_nails', label: 'Look at hand and nails', when: 'When rejecting a statement', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], scale: 'broad', armDeg: 123, bodyDeg: 25, duration: 5.80 },
  'av_looking_away': { id: 'av_looking_away', label: 'Looking away', when: 'When they heard something they don\'t want', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'moderate', armDeg: 26, bodyDeg: 33, duration: 3.30 },
  'av_looking_down': { id: 'av_looking_down', label: 'Looking down', when: 'When they are shy or displeased', kind: 'gesture', functions: ['emoting'], manner: ['shy', 'downcast'], scale: 'subtle', armDeg: 19, bodyDeg: 36, duration: 7.20 },
  'av_neutral_idle': { id: 'av_neutral_idle', label: 'Neutral Idle', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], scale: 'subtle', armDeg: 3, bodyDeg: 2, duration: 3.70 },
  'av_relieved_sigh': { id: 'av_relieved_sigh', label: 'Relieved sigh', when: 'When they are relieved', kind: 'gesture', functions: ['emoting'], manner: ['elated'], scale: 'subtle', armDeg: 9, bodyDeg: 15, duration: 3.03 },
  'av_standard_idle': { id: 'av_standard_idle', label: 'Standard Idle', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], scale: 'subtle', armDeg: 7, bodyDeg: 3, duration: 3.03 },
  'av_step_back_hands_up': { id: 'av_step_back_hands_up', label: 'Step back hands up', when: 'When letting other person have their way', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'broad', armDeg: 89, bodyDeg: 46, duration: 4.73 },
  'av_waving': { id: 'av_waving', label: 'Waving', when: 'When saying hello enthusiastically', kind: 'gesture', functions: ['greeting'], manner: ['elated'], scale: 'broad', armDeg: 121, bodyDeg: 20, duration: 5.43 },
  'cc_angry_breathing_fast': { id: 'cc_angry_breathing_fast', label: 'Angry breathing fast', when: 'When agitated or annoyed', kind: 'idle', functions: ['emoting'], manner: ['agitated'], scale: 'subtle', armDeg: 4, bodyDeg: 2, duration: 5.67 },
  'cc_angry_point': { id: 'cc_angry_point', label: 'Angry point', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 84, bodyDeg: 21, duration: 3.23 },
  'cc_bashful_look_at_ground': { id: 'cc_bashful_look_at_ground', label: 'Bashful look at ground', when: 'When shy or flattered', kind: 'gesture', functions: ['emoting'], manner: ['shy'], scale: 'broad', armDeg: 117, bodyDeg: 43, duration: 14.57 },
  'cc_both_hands_foward': { id: 'cc_both_hands_foward', label: 'Both hands foward', when: 'When exaplining big idea', kind: 'gesture', functions: ['explaining'], manner: [], scale: 'broad', armDeg: 85, bodyDeg: 14, duration: 4.40 },
  'cc_both_hands_up_and_head_shake': { id: 'cc_both_hands_up_and_head_shake', label: 'Both hands up and head shake', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'moderate', armDeg: 68, bodyDeg: 23, duration: 5.23 },
  'cc_crossed_arms_looking_down': { id: 'cc_crossed_arms_looking_down', label: 'Crossed arms looking down', when: 'When detached', kind: 'idle', functions: ['rest'], manner: ['downcast'], scale: 'subtle', armDeg: 2, bodyDeg: 6, duration: 10.17 },
  'cc_eyes_up_for_a_moment': { id: 'cc_eyes_up_for_a_moment', label: 'Eyes up for a moment', when: 'When thinking', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'moderate', armDeg: 21, bodyDeg: 9, duration: 2.67 },
  'cc_feminine_footfoward': { id: 'cc_feminine_footfoward', label: 'Feminine footfoward', when: 'When female and attentive', kind: 'idle', functions: ['rest'], manner: [], scale: 'subtle', armDeg: 11, bodyDeg: 1, duration: 6.00 },
  'cc_feminine_hand_out_lean_back': { id: 'cc_feminine_hand_out_lean_back', label: 'Feminine hand out lean back', when: 'When finishing a big statement', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 101, bodyDeg: 15, duration: 3.80 },
  'cc_feminine_hand_to_chest': { id: 'cc_feminine_hand_to_chest', label: 'Feminine hand to chest', when: 'When talking about themselves', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], scale: 'broad', armDeg: 120, bodyDeg: 28, duration: 5.30 },
  'cc_feminine_hand_to_chest_knee_bob': { id: 'cc_feminine_hand_to_chest_knee_bob', label: 'Feminine hand to chest knee bob', when: 'When making positive point about themselves', kind: 'gesture', functions: ['making_point', 'self_reference'], manner: ['elated'], scale: 'broad', armDeg: 114, bodyDeg: 23, duration: 3.97 },
  'cc_feminine_hands_in_front_then_relax': { id: 'cc_feminine_hands_in_front_then_relax', label: 'Feminine hands in front then relax', when: 'When accepting', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'broad', armDeg: 89, bodyDeg: 22, duration: 3.60 },
  'cc_feminine_hands_out_and_together': { id: 'cc_feminine_hands_out_and_together', label: 'Feminine hands out and together', when: 'When making big point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 89, bodyDeg: 33, duration: 4.64 },
  'cc_feminine_hands_out_then_together': { id: 'cc_feminine_hands_out_then_together', label: 'Feminine hands out then together', when: 'When agreeing', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'broad', armDeg: 100, bodyDeg: 28, duration: 4.17 },
  'cc_feminine_head_up': { id: 'cc_feminine_head_up', label: 'Feminine head up', when: 'When ready and attentive', kind: 'idle', functions: ['rest'], manner: [], scale: 'subtle', armDeg: 2, bodyDeg: 4, duration: 6.04 },
  'cc_feminine_idle': { id: 'cc_feminine_idle', label: 'Feminine Idle', when: 'When ready and attentive', kind: 'idle', functions: ['rest'], manner: [], scale: 'subtle', armDeg: 3, bodyDeg: 3, duration: 2.96 },
  'cc_feminine_nod_and_hip_shake': { id: 'cc_feminine_nod_and_hip_shake', label: 'Feminine nod and hip shake', when: 'When agreeing', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'broad', armDeg: 108, bodyDeg: 15, duration: 3.63 },
  'cc_feminine_nod_then_hand_to_chest': { id: 'cc_feminine_nod_then_hand_to_chest', label: 'Feminine nod then hand to chest', when: 'When agreeing about themselves', kind: 'gesture', functions: ['agreeing', 'self_reference'], manner: [], scale: 'broad', armDeg: 125, bodyDeg: 33, duration: 4.47 },
  'cc_feminine_nodding_hand_out': { id: 'cc_feminine_nodding_hand_out', label: 'Feminine nodding hand out', when: 'When giving positive statement', kind: 'gesture', functions: ['making_point'], manner: ['elated'], scale: 'broad', armDeg: 90, bodyDeg: 23, duration: 4.70 },
  'cc_feminine_step_side_to_side': { id: 'cc_feminine_step_side_to_side', label: 'Feminine step side to side', when: 'When listening and restless', kind: 'idle', functions: ['listening', 'rest'], manner: [], scale: 'subtle', armDeg: 13, bodyDeg: 14, duration: 15.33 },
  'cc_fist_pump': { id: 'cc_fist_pump', label: 'Fist pump', when: 'When excited and feeling like they\'ve won', kind: 'gesture', functions: ['emoting'], manner: ['elated'], scale: 'broad', armDeg: 114, bodyDeg: 38, duration: 3.80 },
  'cc_foot_foward_slouch': { id: 'cc_foot_foward_slouch', label: 'Foot Foward Slouch', when: 'When relaxed or waiting', kind: 'idle', functions: ['rest'], manner: ['relaxed'], scale: 'subtle', armDeg: 8, bodyDeg: 1, duration: 8.33 },
  'cc_hand_comes_off_hip': { id: 'cc_hand_comes_off_hip', label: 'Hand comes off hip', when: 'When tired of listening', kind: 'gesture', functions: ['listening', 'rest'], manner: ['downcast'], scale: 'moderate', armDeg: 64, bodyDeg: 20, duration: 2.20 },
  'cc_hand_gesture_then_scratching_head': { id: 'cc_hand_gesture_then_scratching_head', label: 'Hand gesture then scratching head', when: 'When describing confusing idea', kind: 'gesture', functions: ['thinking', 'explaining'], manner: [], scale: 'broad', armDeg: 123, bodyDeg: 32, duration: 6.60 },
  'cc_hand_on_hip_and_shaking_head': { id: 'cc_hand_on_hip_and_shaking_head', label: 'Hand on hip and shaking head', when: 'When relaxed disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: ['relaxed'], scale: 'moderate', armDeg: 65, bodyDeg: 20, duration: 3.67 },
  'cc_hand_on_hip_hands_out': { id: 'cc_hand_on_hip_hands_out', label: 'Hand on hip hands out', when: 'When relaxed making point', kind: 'gesture', functions: ['making_point'], manner: ['relaxed'], scale: 'broad', armDeg: 79, bodyDeg: 13, duration: 3.96 },
  'cc_hand_on_hip_head_movement': { id: 'cc_hand_on_hip_head_movement', label: 'Hand on hip head movement', when: 'When relaxed talking', kind: 'gesture', functions: ['explaining'], manner: ['relaxed'], scale: 'subtle', armDeg: 9, bodyDeg: 16, duration: 2.53 },
  'cc_hand_on_hip_lean_back_and_point': { id: 'cc_hand_on_hip_lean_back_and_point', label: 'Hand on hip lean back and point', when: 'When relaxed directing to someone else', kind: 'gesture', functions: ['explaining'], manner: ['relaxed'], scale: 'moderate', armDeg: 64, bodyDeg: 11, duration: 5.10 },
  'cc_hand_on_hip_lean_sideways': { id: 'cc_hand_on_hip_lean_sideways', label: 'Hand on hip lean sideways', when: 'When confused', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'broad', armDeg: 82, bodyDeg: 14, duration: 2.13 },
  'cc_hand_on_hip_then_outwards': { id: 'cc_hand_on_hip_then_outwards', label: 'Hand on hip then outwards', when: 'When thinking and providing alternative', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'broad', armDeg: 150, bodyDeg: 31, duration: 2.90 },
  'cc_hand_out_then_big_hands_up': { id: 'cc_hand_out_then_big_hands_up', label: 'Hand out then big hands up', when: 'When explaining a big idea', kind: 'gesture', functions: ['explaining'], manner: [], scale: 'broad', armDeg: 98, bodyDeg: 21, duration: 5.20 },
  'cc_hand_pump_pointing_clapping': { id: 'cc_hand_pump_pointing_clapping', label: 'Hand pump pointing clapping', when: 'When fired up', kind: 'gesture', functions: ['emoting'], manner: ['agitated'], scale: 'broad', armDeg: 101, bodyDeg: 28, duration: 6.33 },
  'cc_hand_snapped_in_front': { id: 'cc_hand_snapped_in_front', label: 'Hand snapped in front', when: 'When making a sharp point', kind: 'gesture', functions: ['making_point'], manner: ['agitated'], scale: 'moderate', armDeg: 42, bodyDeg: 10, duration: 2.93 },
  'cc_hand_swiped_in_front': { id: 'cc_hand_swiped_in_front', label: 'Hand swiped in front', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 77, bodyDeg: 18, duration: 3.40 },
  'cc_hand_to_chest': { id: 'cc_hand_to_chest', label: 'Hand to Chest', when: 'When talking about themselves', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], scale: 'broad', armDeg: 118, bodyDeg: 33, duration: 4.37 },
  'cc_hand_up_and_head_bob': { id: 'cc_hand_up_and_head_bob', label: 'Hand up and head bob', when: 'When being curt', kind: 'gesture', functions: ['disagreeing'], manner: ['agitated'], scale: 'broad', armDeg: 75, bodyDeg: 10, duration: 4.53 },
  'cc_hand_up_then_the_other': { id: 'cc_hand_up_then_the_other', label: 'Hand up then the other', when: 'When asking for agreement', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'moderate', armDeg: 49, bodyDeg: 12, duration: 3.93 },
  'cc_hand_waved_in_front': { id: 'cc_hand_waved_in_front', label: 'Hand waved in front', when: 'When dismissing idea', kind: 'gesture', functions: ['disagreeing', 'explaining'], manner: [], scale: 'broad', armDeg: 116, bodyDeg: 20, duration: 4.40 },
  'cc_hands_and_then_back_on_hips': { id: 'cc_hands_and_then_back_on_hips', label: 'Hands and then back on hips', when: 'When finished making point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'moderate', armDeg: 55, bodyDeg: 8, duration: 4.27 },
  'cc_hands_arcing_out_front': { id: 'cc_hands_arcing_out_front', label: 'Hands arcing out front', when: 'When giving or finishing explanation', kind: 'gesture', functions: ['explaining'], manner: [], scale: 'broad', armDeg: 82, bodyDeg: 22, duration: 3.80 },
  'cc_hands_crossing_in_front': { id: 'cc_hands_crossing_in_front', label: 'Hands crossing in front', when: 'When explaining a no', kind: 'gesture', functions: ['disagreeing', 'explaining'], manner: [], scale: 'broad', armDeg: 86, bodyDeg: 18, duration: 7.00 },
  'cc_hands_held_in_front': { id: 'cc_hands_held_in_front', label: 'Hands held in front', when: 'When stoic or gaurded', kind: 'idle', functions: ['rest'], manner: ['guarded'], scale: 'subtle', armDeg: 10, bodyDeg: 19, duration: 9.67 },
  'cc_hands_holding_in_front': { id: 'cc_hands_holding_in_front', label: 'Hands holding in front', when: 'When seeming sweet', kind: 'gesture', functions: ['emoting'], manner: ['shy'], scale: 'moderate', armDeg: 21, bodyDeg: 7, duration: 3.33 },
  'cc_hands_holding_in_front_lean_forward': { id: 'cc_hands_holding_in_front_lean_forward', label: 'Hands holding in front lean forward', when: 'When seeming sweet and listening', kind: 'gesture', functions: ['emoting', 'listening'], manner: ['shy'], scale: 'moderate', armDeg: 21, bodyDeg: 29, duration: 3.86 },
  'cc_hands_holding_in_front_talking': { id: 'cc_hands_holding_in_front_talking', label: 'Hands holding in front talking', when: 'When seeming sweet and talking', kind: 'gesture', functions: ['emoting', 'explaining'], manner: ['shy'], scale: 'moderate', armDeg: 26, bodyDeg: 29, duration: 4.33 },
  'cc_hands_holding_in_front_then_out': { id: 'cc_hands_holding_in_front_then_out', label: 'Hands holding in front then out', when: 'When seeming sweet and making point', kind: 'gesture', functions: ['emoting', 'making_point'], manner: ['shy'], scale: 'broad', armDeg: 80, bodyDeg: 26, duration: 3.53 },
  'cc_hands_holding_in_front_with_wave': { id: 'cc_hands_holding_in_front_with_wave', label: 'Hands holding in front with wave', when: 'When seeming sweet and acknowledging', kind: 'gesture', functions: ['emoting', 'agreeing'], manner: ['shy'], scale: 'broad', armDeg: 82, bodyDeg: 28, duration: 4.03 },
  'cc_hands_up_in_front': { id: 'cc_hands_up_in_front', label: 'Hands up in front', when: 'When trying to appeal', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'broad', armDeg: 81, bodyDeg: 16, duration: 5.30 },
  'cc_head_nod': { id: 'cc_head_nod', label: 'Head nod', when: 'When they agree', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'subtle', armDeg: 9, bodyDeg: 20, duration: 3.37 },
  'cc_head_shake': { id: 'cc_head_shake', label: 'Head shake', when: 'When quickly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'subtle', armDeg: 16, bodyDeg: 37, duration: 2.57 },
  'cc_head_shake_slow': { id: 'cc_head_shake_slow', label: 'Head Shake slow', when: 'When slowly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'subtle', armDeg: 6, bodyDeg: 32, duration: 2.63 },
  'cc_head_side_to_side': { id: 'cc_head_side_to_side', label: 'Head side to side', when: 'When faced with two options', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'moderate', armDeg: 41, bodyDeg: 20, duration: 2.80 },
  'cc_head_side_to_side_slower': { id: 'cc_head_side_to_side_slower', label: 'Head side to side slower', when: 'When making two points', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'moderate', armDeg: 41, bodyDeg: 20, duration: 3.70 },
  'cc_head_to_side_slight_lean_forward': { id: 'cc_head_to_side_slight_lean_forward', label: 'Head to side slight lean forward', when: 'When thinking', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'moderate', armDeg: 34, bodyDeg: 32, duration: 2.20 },
  'cc_head_turn': { id: 'cc_head_turn', label: 'Head Turn', when: 'When disagreeing or making a point', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], scale: 'moderate', armDeg: 43, bodyDeg: 28, duration: 2.53 },
  'cc_head_up_then_nod': { id: 'cc_head_up_then_nod', label: 'Head up then nod', when: 'When thinking then agreeing', kind: 'gesture', functions: ['agreeing', 'thinking'], manner: [], scale: 'subtle', armDeg: 20, bodyDeg: 23, duration: 2.93 },
  'cc_head_up_then_shake': { id: 'cc_head_up_then_shake', label: 'Head up then shake', when: 'When thinking then disagreeing', kind: 'gesture', functions: ['disagreeing', 'thinking'], manner: [], scale: 'subtle', armDeg: 6, bodyDeg: 23, duration: 3.07 },
  'cc_high_hand_together_step_back': { id: 'cc_high_hand_together_step_back', label: 'High hand together step back', when: 'When listening having made point', kind: 'gesture', functions: ['making_point', 'listening'], manner: [], scale: 'moderate', armDeg: 35, bodyDeg: 18, duration: 4.47 },
  'cc_high_hands_gesturing_out': { id: 'cc_high_hands_gesturing_out', label: 'High hands gesturing out', when: 'When talking about the other person', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], scale: 'broad', armDeg: 92, bodyDeg: 16, duration: 5.07 },
  'cc_high_hands_many_hand_gestures': { id: 'cc_high_hands_many_hand_gestures', label: 'High hands many hand gestures', when: 'When explaining formally', kind: 'gesture', functions: ['explaining'], manner: ['formal'], scale: 'broad', armDeg: 101, bodyDeg: 21, duration: 5.96 },
  'cc_high_hands_many_hand_gestures_2': { id: 'cc_high_hands_many_hand_gestures_2', label: 'High hands many hand gestures 2', when: 'When explaining with many points', kind: 'gesture', functions: ['making_point', 'explaining'], manner: [], scale: 'broad', armDeg: 87, bodyDeg: 19, duration: 3.90 },
  'cc_high_hands_together_nod': { id: 'cc_high_hands_together_nod', label: 'High hands together nod', when: 'When agreeing foramlly', kind: 'gesture', functions: ['agreeing'], manner: ['formal'], scale: 'moderate', armDeg: 41, bodyDeg: 9, duration: 2.20 },
  'cc_high_hands_together_step_forward': { id: 'cc_high_hands_together_step_forward', label: 'High hands together step forward', when: 'When expressing idea formally', kind: 'gesture', functions: ['explaining'], manner: ['formal'], scale: 'broad', armDeg: 100, bodyDeg: 16, duration: 3.77 },
  'cc_idle_standard': { id: 'cc_idle_standard', label: 'Idle Standard', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], scale: 'subtle', armDeg: 7, bodyDeg: 2, duration: 10.00 },
  'cc_idle_still': { id: 'cc_idle_still', label: 'Idle Still', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], scale: 'subtle', armDeg: 3, bodyDeg: 2, duration: 16.67 },
  'cc_lean_back_hands_up': { id: 'cc_lean_back_hands_up', label: 'Lean back hands up', when: 'When accepting an idea', kind: 'gesture', functions: ['agreeing', 'explaining'], manner: [], scale: 'moderate', armDeg: 57, bodyDeg: 27, duration: 4.00 },
  'cc_lean_forward_hands_out_yelling': { id: 'cc_lean_forward_hands_out_yelling', label: 'Lean forward hands out yelling', when: 'When yelling', kind: 'gesture', functions: ['emoting'], manner: ['agitated'], scale: 'broad', armDeg: 107, bodyDeg: 31, duration: 7.83 },
  'cc_lean_sideways_scatch_chest': { id: 'cc_lean_sideways_scatch_chest', label: 'Lean sideways scatch chest', when: 'When confused but listening', kind: 'gesture', functions: ['thinking', 'listening'], manner: [], scale: 'broad', armDeg: 119, bodyDeg: 30, duration: 4.40 },
  'cc_look_at_hand_and_nails': { id: 'cc_look_at_hand_and_nails', label: 'Look at hand and nails', when: 'When rejecting a statement', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], scale: 'broad', armDeg: 123, bodyDeg: 26, duration: 5.77 },
  'cc_look_to_both_sides': { id: 'cc_look_to_both_sides', label: 'Look to both sides', when: 'When wary or uninterested', kind: 'idle', functions: ['rest'], manner: ['guarded'], scale: 'moderate', armDeg: 25, bodyDeg: 27, duration: 17.67 },
  'cc_look_up_to_side_and_pointed_finger': { id: 'cc_look_up_to_side_and_pointed_finger', label: 'Look up to side and pointed finger', when: 'When coming up with big thought', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'broad', armDeg: 91, bodyDeg: 29, duration: 4.70 },
  'cc_looking_away': { id: 'cc_looking_away', label: 'Looking away', when: 'When they heard something they don\'t want', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'moderate', armDeg: 26, bodyDeg: 36, duration: 3.27 },
  'cc_looking_down': { id: 'cc_looking_down', label: 'Looking down', when: 'When they are shy or displeased', kind: 'gesture', functions: ['emoting'], manner: ['shy', 'downcast'], scale: 'subtle', armDeg: 19, bodyDeg: 40, duration: 7.17 },
  'cc_masculine_hand_to_hip_straighten': { id: 'cc_masculine_hand_to_hip_straighten', label: 'Masculine hand to hip straighten', when: 'When having made point', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'subtle', armDeg: 7, bodyDeg: 10, duration: 2.19 },
  'cc_masculine_idle': { id: 'cc_masculine_idle', label: 'Masculine Idle', when: 'When ready and attentive', kind: 'idle', functions: ['rest'], manner: [], scale: 'subtle', armDeg: 2, bodyDeg: 2, duration: 2.17 },
  'cc_masculine_lean_side_hand_out': { id: 'cc_masculine_lean_side_hand_out', label: 'Masculine lean side hand out', when: 'When making relaxed point', kind: 'gesture', functions: ['making_point'], manner: ['relaxed'], scale: 'moderate', armDeg: 69, bodyDeg: 14, duration: 4.89 },
  'cc_masculine_lean_with_hand_out': { id: 'cc_masculine_lean_with_hand_out', label: 'Masculine lean with hand out', when: 'When accepting', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'broad', armDeg: 97, bodyDeg: 13, duration: 4.96 },
  'cc_masculine_look_around': { id: 'cc_masculine_look_around', label: 'Masculine look around', when: 'When uncomfortable', kind: 'idle', functions: ['rest'], manner: ['downcast'], scale: 'subtle', armDeg: 9, bodyDeg: 16, duration: 6.04 },
  'cc_neutral_idle': { id: 'cc_neutral_idle', label: 'Neutral Idle', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], scale: 'subtle', armDeg: 3, bodyDeg: 2, duration: 3.67 },
  'cc_nodding_pumping_hands_clap': { id: 'cc_nodding_pumping_hands_clap', label: 'Nodding pumping hands clap', when: 'When excited about a win', kind: 'gesture', functions: ['emoting'], manner: ['elated'], scale: 'broad', armDeg: 117, bodyDeg: 26, duration: 3.80 },
  'cc_one_arm_crossed': { id: 'cc_one_arm_crossed', label: 'One arm crossed', when: 'When guarded or shy', kind: 'gesture', functions: ['emoting', 'rest'], manner: ['shy', 'guarded'], scale: 'subtle', armDeg: 9, bodyDeg: 21, duration: 3.33 },
  'cc_one_arm_crossed_head_move': { id: 'cc_one_arm_crossed_head_move', label: 'One arm crossed head move', when: 'When shy and listening', kind: 'gesture', functions: ['emoting', 'listening'], manner: ['shy'], scale: 'moderate', armDeg: 30, bodyDeg: 22, duration: 4.46 },
  'cc_one_arm_crossed_nodding': { id: 'cc_one_arm_crossed_nodding', label: 'One arm crossed nodding', when: 'When shy and agreeing', kind: 'gesture', functions: ['emoting', 'agreeing'], manner: ['shy'], scale: 'moderate', armDeg: 23, bodyDeg: 26, duration: 3.76 },
  'cc_one_arm_crossed_nodding_2': { id: 'cc_one_arm_crossed_nodding_2', label: 'One arm crossed nodding 2', when: 'When shy and agreeing more', kind: 'gesture', functions: ['emoting', 'agreeing'], manner: ['shy'], scale: 'moderate', armDeg: 22, bodyDeg: 21, duration: 3.20 },
  'cc_one_arm_crossed_shifting': { id: 'cc_one_arm_crossed_shifting', label: 'One arm crossed shifting', when: 'When uncomfortable', kind: 'gesture', functions: ['rest'], manner: ['downcast'], scale: 'moderate', armDeg: 21, bodyDeg: 22, duration: 3.33 },
  'cc_relieved_sigh': { id: 'cc_relieved_sigh', label: 'Relieved sigh', when: 'When they are relieved', kind: 'gesture', functions: ['emoting'], manner: ['elated'], scale: 'subtle', armDeg: 9, bodyDeg: 16, duration: 3.00 },
  'cc_side_eye': { id: 'cc_side_eye', label: 'Side eye', when: 'When wary or scared', kind: 'idle', functions: ['rest'], manner: ['guarded'], scale: 'subtle', armDeg: 4, bodyDeg: 3, duration: 5.67 },
  'cc_side_eye_agree': { id: 'cc_side_eye_agree', label: 'Side eye agree', when: 'When wary but agreeing', kind: 'gesture', functions: ['agreeing', 'rest'], manner: ['guarded'], scale: 'moderate', armDeg: 39, bodyDeg: 5, duration: 3.24 },
  'cc_side_eye_hands_together': { id: 'cc_side_eye_hands_together', label: 'Side eye hands together', when: 'When wary but choosing to accept', kind: 'gesture', functions: ['agreeing', 'rest'], manner: ['guarded'], scale: 'broad', armDeg: 93, bodyDeg: 14, duration: 5.94 },
  'cc_side_eye_pointed_finger_nod': { id: 'cc_side_eye_pointed_finger_nod', label: 'Side eye pointed finger nod', when: 'When deciding to agree', kind: 'gesture', functions: ['agreeing', 'thinking'], manner: [], scale: 'broad', armDeg: 115, bodyDeg: 26, duration: 5.73 },
  'cc_side_eye_still': { id: 'cc_side_eye_still', label: 'Side eye still', when: 'When disbelieving or gaurded', kind: 'idle', functions: ['disagreeing', 'rest'], manner: ['guarded'], scale: 'subtle', armDeg: 5, bodyDeg: 4, duration: 5.67 },
  'cc_side_eye_still_2': { id: 'cc_side_eye_still_2', label: 'Side eye still', when: 'When thinking about discussion', kind: 'gesture', functions: ['thinking'], manner: [], scale: 'subtle', armDeg: 12, bodyDeg: 5, duration: 3.00 },
  'cc_slight_look_up': { id: 'cc_slight_look_up', label: 'Slight look up', when: 'When providing no response', kind: 'gesture', functions: ['disagreeing'], manner: [], scale: 'subtle', armDeg: 3, bodyDeg: 4, duration: 2.03 },
  'cc_slouched': { id: 'cc_slouched', label: 'Slouched', when: 'When tired', kind: 'idle', functions: ['rest'], manner: ['downcast'], scale: 'subtle', armDeg: 2, bodyDeg: 2, duration: 11.50 },
  'cc_slow_hand_up': { id: 'cc_slow_hand_up', label: 'Slow hand up', when: 'When making appealing', kind: 'gesture', functions: ['making_point'], manner: [], scale: 'moderate', armDeg: 44, bodyDeg: 7, duration: 3.53 },
  'cc_standard_idle': { id: 'cc_standard_idle', label: 'Standard Idle', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], scale: 'subtle', armDeg: 7, bodyDeg: 3, duration: 3.00 },
  'cc_step_back_hands_up': { id: 'cc_step_back_hands_up', label: 'Step back hands up', when: 'When letting other person have their way', kind: 'gesture', functions: ['agreeing'], manner: [], scale: 'broad', armDeg: 89, bodyDeg: 50, duration: 4.70 },
  'cc_waving': { id: 'cc_waving', label: 'Waving', when: 'When saying hello enthusiastically', kind: 'gesture', functions: ['greeting'], manner: ['elated'], scale: 'broad', armDeg: 121, bodyDeg: 25, duration: 5.40 },
}

/** Clip ids that loop as resting poses. */
export const IDLE_CLIP_IDS: ReadonlySet<string> = new Set(
  Object.values(SITUATIONAL_CLIPS).filter(c => c.kind === 'idle').map(c => c.id),
)

/** Registry lookup. Returns undefined for clips from an unmapped legacy pack. */
export function clipInfo(id: string): SituationalClip | undefined {
  return SITUATIONAL_CLIPS[id]
}

/**
 * Is this clip a resting loop?
 *
 * Falls back to a name heuristic for clips outside the registry, so loading a
 * legacy pack degrades gracefully instead of treating its idles as one-shot
 * gestures (which crossfades through the bind pose and flashes a T-pose).
 */
export function isIdleClip(id: string): boolean {
  if (IDLE_CLIP_IDS.has(id)) return true
  if (SITUATIONAL_CLIPS[id]) return false
  return /(^|_)idle(_|$)|(^|_)still(_|$)|breathing/.test(id.toLowerCase())
}

/**
 * Registry clips serving a given function, optionally narrowed to idle or gesture
 * and to a maximum motion size.
 *
 * Order is stable (registry order) so callers can apply their own preference;
 * pass `smallestFirst` to get them ordered by measured size instead, which is what
 * a caller wanting restraint should use.
 */
export function clipsForFunction(
  fn: ClipFunction,
  kind?: 'idle' | 'gesture',
  opts?: { maxScale?: ClipScale; smallestFirst?: boolean },
): SituationalClip[] {
  const ceiling = opts?.maxScale ? SCALE_ORDER[opts.maxScale] : Infinity
  const out = Object.values(SITUATIONAL_CLIPS).filter(
    c => c.functions.includes(fn) &&
         (kind === undefined || c.kind === kind) &&
         SCALE_ORDER[c.scale] <= ceiling,
  )
  return opts?.smallestFirst ? out.sort((a, b) => a.armDeg - b.armDeg) : out
}

/**
 * Resting poses whose emotional colouring the current moment permits.
 *
 * A clip qualifies when EVERY one of its manner tags is in `allowed` — so
 * `allowed = []` yields only the uncharacterised idles. This is the fix for an
 * avatar dropping into a visibly tired or wary stance in a conversation that never
 * called for one: most resting poses in the CC pack carry a manner, and drawing
 * uniformly from all of them means the character spends most of its time
 * characterised by accident.
 *
 * Gestures are deliberately NOT filtered this way — manner must never restrict
 * what a character can do with their hands, only how they stand at rest.
 */
export function idlesForManner(allowed: readonly ClipManner[]): SituationalClip[] {
  const ok = new Set(allowed)
  return Object.values(SITUATIONAL_CLIPS).filter(
    c => c.kind === 'idle' && c.manner.every(m => ok.has(m)),
  )
}

/** True when the clip carries no emotional colouring at all. */
export function isUncharacterisedClip(id: string): boolean {
  const c = SITUATIONAL_CLIPS[id]
  return !!c && c.manner.length === 0
}
