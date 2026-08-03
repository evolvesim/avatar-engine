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
 * 'manner' exists to break ties and to let a director ask for an on-tone variant.
 * It must never be used to restrict the candidate pool.
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

/** Optional emotional colouring. Breaks ties; never gates selection. */
export type ClipManner =
  | 'shy'
  | 'agitated'
  | 'elated'
  | 'downcast'
  | 'guarded'
  | 'formal'
  | 'relaxed'

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
  duration:  number
}

export const CLIP_FUNCTIONS: readonly ClipFunction[] = ['listening', 'explaining', 'making_point', 'agreeing', 'disagreeing', 'thinking', 'emoting', 'self_reference', 'greeting', 'rest']
export const CLIP_MANNERS:   readonly ClipManner[]   = ['shy', 'agitated', 'elated', 'downcast', 'guarded', 'formal', 'relaxed']

export const SITUATIONAL_CLIPS: Record<string, SituationalClip> = {
  'av_angry_breathing_fast': { id: 'av_angry_breathing_fast', label: 'Angry breathing fast', when: 'When agitated or annoyed', kind: 'idle', functions: ['emoting'], manner: ['agitated'], duration: 5.70 },
  'av_angry_point': { id: 'av_angry_point', label: 'Angry point', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.27 },
  'av_bashful_look_at_ground': { id: 'av_bashful_look_at_ground', label: 'Bashful look at ground', when: 'When shy or flattered', kind: 'gesture', functions: ['emoting'], manner: ['shy'], duration: 14.60 },
  'av_both_hands_foward': { id: 'av_both_hands_foward', label: 'Both hands foward', when: 'When exaplining big idea', kind: 'gesture', functions: ['explaining'], manner: [], duration: 4.43 },
  'av_eyes_up_for_a_moment': { id: 'av_eyes_up_for_a_moment', label: 'Eyes up for a moment', when: 'When thinking', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.70 },
  'av_feminine_footfoward': { id: 'av_feminine_footfoward', label: 'Feminine footfoward', when: 'When female and attentive', kind: 'idle', functions: ['rest'], manner: [], duration: 6.03 },
  'av_fist_pump': { id: 'av_fist_pump', label: 'Fist pump', when: 'When excited and feeling like they\'ve won', kind: 'gesture', functions: ['emoting'], manner: ['elated'], duration: 3.83 },
  'av_foot_foward_slouch': { id: 'av_foot_foward_slouch', label: 'Foot Foward Slouch', when: 'When relaxed or waiting', kind: 'idle', functions: ['rest'], manner: ['relaxed'], duration: 8.37 },
  'av_hand_snapped_in_front': { id: 'av_hand_snapped_in_front', label: 'Hand snapped in front', when: 'When making a sharp point', kind: 'gesture', functions: ['making_point'], manner: ['agitated'], duration: 2.97 },
  'av_hand_swiped_in_front': { id: 'av_hand_swiped_in_front', label: 'Hand swiped in front', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.43 },
  'av_hand_to_chest': { id: 'av_hand_to_chest', label: 'Hand to Chest', when: 'When talking about themselves', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], duration: 4.40 },
  'av_hand_waved_in_front': { id: 'av_hand_waved_in_front', label: 'Hand waved in front', when: 'When dismissing idea', kind: 'gesture', functions: ['disagreeing', 'explaining'], manner: [], duration: 4.43 },
  'av_head_nod': { id: 'av_head_nod', label: 'Head nod', when: 'When they agree', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 3.40 },
  'av_head_shake': { id: 'av_head_shake', label: 'Head shake', when: 'When quickly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 2.60 },
  'av_head_shake_slow': { id: 'av_head_shake_slow', label: 'Head Shake slow', when: 'When slowly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 2.67 },
  'av_head_side_to_side': { id: 'av_head_side_to_side', label: 'Head side to side', when: 'When faced with two options', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.83 },
  'av_head_side_to_side_slower': { id: 'av_head_side_to_side_slower', label: 'Head side to side slower', when: 'When making two points', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.73 },
  'av_head_turn': { id: 'av_head_turn', label: 'Head Turn', when: 'When disagreeing or making a point', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], duration: 2.57 },
  'av_head_up_then_nod': { id: 'av_head_up_then_nod', label: 'Head up then nod', when: 'When thinking then agreeing', kind: 'gesture', functions: ['agreeing', 'thinking'], manner: [], duration: 2.97 },
  'av_head_up_then_shake': { id: 'av_head_up_then_shake', label: 'Head up then shake', when: 'When thinking then disagreeing', kind: 'gesture', functions: ['disagreeing', 'thinking'], manner: [], duration: 3.10 },
  'av_idle_standard': { id: 'av_idle_standard', label: 'Idle Standard', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], duration: 10.03 },
  'av_idle_still': { id: 'av_idle_still', label: 'Idle Still', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], duration: 16.70 },
  'av_lean_back_hands_up': { id: 'av_lean_back_hands_up', label: 'Lean back hands up', when: 'When accepting an idea', kind: 'gesture', functions: ['agreeing', 'explaining'], manner: [], duration: 4.03 },
  'av_lean_forward_hands_out_yelling': { id: 'av_lean_forward_hands_out_yelling', label: 'Lean forward hands out yelling', when: 'When yelling', kind: 'gesture', functions: ['emoting'], manner: ['agitated'], duration: 7.87 },
  'av_look_at_hand_and_nails': { id: 'av_look_at_hand_and_nails', label: 'Look at hand and nails', when: 'When rejecting a statement', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], duration: 5.80 },
  'av_looking_away': { id: 'av_looking_away', label: 'Looking away', when: 'When they heard something they don\'t want', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 3.30 },
  'av_looking_down': { id: 'av_looking_down', label: 'Looking down', when: 'When they are shy or displeased', kind: 'gesture', functions: ['emoting'], manner: ['shy', 'downcast'], duration: 7.20 },
  'av_neutral_idle': { id: 'av_neutral_idle', label: 'Neutral Idle', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], duration: 3.70 },
  'av_relieved_sigh': { id: 'av_relieved_sigh', label: 'Relieved sigh', when: 'When they are relieved', kind: 'gesture', functions: ['emoting'], manner: ['elated'], duration: 3.03 },
  'av_standard_idle': { id: 'av_standard_idle', label: 'Standard Idle', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], duration: 3.03 },
  'av_step_back_hands_up': { id: 'av_step_back_hands_up', label: 'Step back hands up', when: 'When letting other person have their way', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 4.73 },
  'av_waving': { id: 'av_waving', label: 'Waving', when: 'When saying hello enthusiastically', kind: 'gesture', functions: ['greeting'], manner: ['elated'], duration: 5.43 },
  'cc_angry_breathing_fast': { id: 'cc_angry_breathing_fast', label: 'Angry breathing fast', when: 'When agitated or annoyed', kind: 'idle', functions: ['emoting'], manner: ['agitated'], duration: 5.67 },
  'cc_angry_point': { id: 'cc_angry_point', label: 'Angry point', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.23 },
  'cc_bashful_look_at_ground': { id: 'cc_bashful_look_at_ground', label: 'Bashful look at ground', when: 'When shy or flattered', kind: 'gesture', functions: ['emoting'], manner: ['shy'], duration: 14.57 },
  'cc_both_hands_foward': { id: 'cc_both_hands_foward', label: 'Both hands foward', when: 'When exaplining big idea', kind: 'gesture', functions: ['explaining'], manner: [], duration: 4.40 },
  'cc_both_hands_up_and_head_shake': { id: 'cc_both_hands_up_and_head_shake', label: 'Both hands up and head shake', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 5.23 },
  'cc_crossed_arms_looking_down': { id: 'cc_crossed_arms_looking_down', label: 'Crossed arms looking down', when: 'When detached', kind: 'idle', functions: ['rest'], manner: ['downcast'], duration: 10.17 },
  'cc_eyes_up_for_a_moment': { id: 'cc_eyes_up_for_a_moment', label: 'Eyes up for a moment', when: 'When thinking', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.67 },
  'cc_feminine_footfoward': { id: 'cc_feminine_footfoward', label: 'Feminine footfoward', when: 'When female and attentive', kind: 'idle', functions: ['rest'], manner: [], duration: 6.00 },
  'cc_feminine_hand_out_lean_back': { id: 'cc_feminine_hand_out_lean_back', label: 'Feminine hand out lean back', when: 'When finishing a big statement', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.80 },
  'cc_feminine_hand_to_chest': { id: 'cc_feminine_hand_to_chest', label: 'Feminine hand to chest', when: 'When talking about themselves', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], duration: 5.30 },
  'cc_feminine_hand_to_chest_knee_bob': { id: 'cc_feminine_hand_to_chest_knee_bob', label: 'Feminine hand to chest knee bob', when: 'When making positive point about themselves', kind: 'gesture', functions: ['making_point', 'self_reference'], manner: ['elated'], duration: 3.97 },
  'cc_feminine_hands_in_front_then_relax': { id: 'cc_feminine_hands_in_front_then_relax', label: 'Feminine hands in front then relax', when: 'When accepting', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 3.60 },
  'cc_feminine_hands_out_and_together': { id: 'cc_feminine_hands_out_and_together', label: 'Feminine hands out and together', when: 'When making big point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 4.64 },
  'cc_feminine_hands_out_then_together': { id: 'cc_feminine_hands_out_then_together', label: 'Feminine hands out then together', when: 'When agreeing', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 4.17 },
  'cc_feminine_head_up': { id: 'cc_feminine_head_up', label: 'Feminine head up', when: 'When ready and attentive', kind: 'idle', functions: ['rest'], manner: [], duration: 6.04 },
  'cc_feminine_idle': { id: 'cc_feminine_idle', label: 'Feminine Idle', when: 'When ready and attentive', kind: 'idle', functions: ['rest'], manner: [], duration: 2.96 },
  'cc_feminine_nod_and_hip_shake': { id: 'cc_feminine_nod_and_hip_shake', label: 'Feminine nod and hip shake', when: 'When agreeing', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 3.63 },
  'cc_feminine_nod_then_hand_to_chest': { id: 'cc_feminine_nod_then_hand_to_chest', label: 'Feminine nod then hand to chest', when: 'When agreeing about themselves', kind: 'gesture', functions: ['agreeing', 'self_reference'], manner: [], duration: 4.47 },
  'cc_feminine_nodding_hand_out': { id: 'cc_feminine_nodding_hand_out', label: 'Feminine nodding hand out', when: 'When giving positive statement', kind: 'gesture', functions: ['making_point'], manner: ['elated'], duration: 4.70 },
  'cc_feminine_step_side_to_side': { id: 'cc_feminine_step_side_to_side', label: 'Feminine step side to side', when: 'When listening and restless', kind: 'idle', functions: ['listening', 'rest'], manner: [], duration: 15.33 },
  'cc_fist_pump': { id: 'cc_fist_pump', label: 'Fist pump', when: 'When excited and feeling like they\'ve won', kind: 'gesture', functions: ['emoting'], manner: ['elated'], duration: 3.80 },
  'cc_foot_foward_slouch': { id: 'cc_foot_foward_slouch', label: 'Foot Foward Slouch', when: 'When relaxed or waiting', kind: 'idle', functions: ['rest'], manner: ['relaxed'], duration: 8.33 },
  'cc_hand_comes_off_hip': { id: 'cc_hand_comes_off_hip', label: 'Hand comes off hip', when: 'When tired of listening', kind: 'gesture', functions: ['listening', 'rest'], manner: ['downcast'], duration: 2.20 },
  'cc_hand_gesture_then_scratching_head': { id: 'cc_hand_gesture_then_scratching_head', label: 'Hand gesture then scratching head', when: 'When describing confusing idea', kind: 'gesture', functions: ['thinking', 'explaining'], manner: [], duration: 6.60 },
  'cc_hand_on_hip_and_shaking_head': { id: 'cc_hand_on_hip_and_shaking_head', label: 'Hand on hip and shaking head', when: 'When relaxed disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: ['relaxed'], duration: 3.67 },
  'cc_hand_on_hip_hands_out': { id: 'cc_hand_on_hip_hands_out', label: 'Hand on hip hands out', when: 'When relaxed making point', kind: 'gesture', functions: ['making_point'], manner: ['relaxed'], duration: 3.96 },
  'cc_hand_on_hip_head_movement': { id: 'cc_hand_on_hip_head_movement', label: 'Hand on hip head movement', when: 'When relaxed talking', kind: 'gesture', functions: ['explaining'], manner: ['relaxed'], duration: 2.53 },
  'cc_hand_on_hip_lean_back_and_point': { id: 'cc_hand_on_hip_lean_back_and_point', label: 'Hand on hip lean back and point', when: 'When relaxed directing to someone else', kind: 'gesture', functions: ['explaining'], manner: ['relaxed'], duration: 5.10 },
  'cc_hand_on_hip_lean_sideways': { id: 'cc_hand_on_hip_lean_sideways', label: 'Hand on hip lean sideways', when: 'When confused', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.13 },
  'cc_hand_on_hip_then_outwards': { id: 'cc_hand_on_hip_then_outwards', label: 'Hand on hip then outwards', when: 'When thinking and providing alternative', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.90 },
  'cc_hand_out_then_big_hands_up': { id: 'cc_hand_out_then_big_hands_up', label: 'Hand out then big hands up', when: 'When explaining a big idea', kind: 'gesture', functions: ['explaining'], manner: [], duration: 5.20 },
  'cc_hand_pump_pointing_clapping': { id: 'cc_hand_pump_pointing_clapping', label: 'Hand pump pointing clapping', when: 'When fired up', kind: 'gesture', functions: ['emoting'], manner: ['agitated'], duration: 6.33 },
  'cc_hand_snapped_in_front': { id: 'cc_hand_snapped_in_front', label: 'Hand snapped in front', when: 'When making a sharp point', kind: 'gesture', functions: ['making_point'], manner: ['agitated'], duration: 2.93 },
  'cc_hand_swiped_in_front': { id: 'cc_hand_swiped_in_front', label: 'Hand swiped in front', when: 'When making a point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.40 },
  'cc_hand_to_chest': { id: 'cc_hand_to_chest', label: 'Hand to Chest', when: 'When talking about themselves', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], duration: 4.37 },
  'cc_hand_up_and_head_bob': { id: 'cc_hand_up_and_head_bob', label: 'Hand up and head bob', when: 'When being curt', kind: 'gesture', functions: ['disagreeing'], manner: ['agitated'], duration: 4.53 },
  'cc_hand_up_then_the_other': { id: 'cc_hand_up_then_the_other', label: 'Hand up then the other', when: 'When asking for agreement', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 3.93 },
  'cc_hand_waved_in_front': { id: 'cc_hand_waved_in_front', label: 'Hand waved in front', when: 'When dismissing idea', kind: 'gesture', functions: ['disagreeing', 'explaining'], manner: [], duration: 4.40 },
  'cc_hands_and_then_back_on_hips': { id: 'cc_hands_and_then_back_on_hips', label: 'Hands and then back on hips', when: 'When finished making point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 4.27 },
  'cc_hands_arcing_out_front': { id: 'cc_hands_arcing_out_front', label: 'Hands arcing out front', when: 'When giving or finishing explanation', kind: 'gesture', functions: ['explaining'], manner: [], duration: 3.80 },
  'cc_hands_crossing_in_front': { id: 'cc_hands_crossing_in_front', label: 'Hands crossing in front', when: 'When explaining a no', kind: 'gesture', functions: ['disagreeing', 'explaining'], manner: [], duration: 7.00 },
  'cc_hands_held_in_front': { id: 'cc_hands_held_in_front', label: 'Hands held in front', when: 'When stoic or gaurded', kind: 'idle', functions: ['rest'], manner: ['guarded'], duration: 9.67 },
  'cc_hands_holding_in_front': { id: 'cc_hands_holding_in_front', label: 'Hands holding in front', when: 'When seeming sweet', kind: 'gesture', functions: ['emoting'], manner: ['shy'], duration: 3.33 },
  'cc_hands_holding_in_front_lean_forward': { id: 'cc_hands_holding_in_front_lean_forward', label: 'Hands holding in front lean forward', when: 'When seeming sweet and listening', kind: 'gesture', functions: ['emoting', 'listening'], manner: ['shy'], duration: 3.86 },
  'cc_hands_holding_in_front_talking': { id: 'cc_hands_holding_in_front_talking', label: 'Hands holding in front talking', when: 'When seeming sweet and talking', kind: 'gesture', functions: ['emoting', 'explaining'], manner: ['shy'], duration: 4.33 },
  'cc_hands_holding_in_front_then_out': { id: 'cc_hands_holding_in_front_then_out', label: 'Hands holding in front then out', when: 'When seeming sweet and making point', kind: 'gesture', functions: ['emoting', 'making_point'], manner: ['shy'], duration: 3.53 },
  'cc_hands_holding_in_front_with_wave': { id: 'cc_hands_holding_in_front_with_wave', label: 'Hands holding in front with wave', when: 'When seeming sweet and acknowledging', kind: 'gesture', functions: ['emoting', 'agreeing'], manner: ['shy'], duration: 4.03 },
  'cc_hands_up_in_front': { id: 'cc_hands_up_in_front', label: 'Hands up in front', when: 'When trying to appeal', kind: 'gesture', functions: ['making_point'], manner: [], duration: 5.30 },
  'cc_head_nod': { id: 'cc_head_nod', label: 'Head nod', when: 'When they agree', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 3.37 },
  'cc_head_shake': { id: 'cc_head_shake', label: 'Head shake', when: 'When quickly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 2.57 },
  'cc_head_shake_slow': { id: 'cc_head_shake_slow', label: 'Head Shake slow', when: 'When slowly disagreeing', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 2.63 },
  'cc_head_side_to_side': { id: 'cc_head_side_to_side', label: 'Head side to side', when: 'When faced with two options', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.80 },
  'cc_head_side_to_side_slower': { id: 'cc_head_side_to_side_slower', label: 'Head side to side slower', when: 'When making two points', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.70 },
  'cc_head_to_side_slight_lean_forward': { id: 'cc_head_to_side_slight_lean_forward', label: 'Head to side slight lean forward', when: 'When thinking', kind: 'gesture', functions: ['thinking'], manner: [], duration: 2.20 },
  'cc_head_turn': { id: 'cc_head_turn', label: 'Head Turn', when: 'When disagreeing or making a point', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], duration: 2.53 },
  'cc_head_up_then_nod': { id: 'cc_head_up_then_nod', label: 'Head up then nod', when: 'When thinking then agreeing', kind: 'gesture', functions: ['agreeing', 'thinking'], manner: [], duration: 2.93 },
  'cc_head_up_then_shake': { id: 'cc_head_up_then_shake', label: 'Head up then shake', when: 'When thinking then disagreeing', kind: 'gesture', functions: ['disagreeing', 'thinking'], manner: [], duration: 3.07 },
  'cc_high_hand_together_step_back': { id: 'cc_high_hand_together_step_back', label: 'High hand together step back', when: 'When listening having made point', kind: 'gesture', functions: ['making_point', 'listening'], manner: [], duration: 4.47 },
  'cc_high_hands_gesturing_out': { id: 'cc_high_hands_gesturing_out', label: 'High hands gesturing out', when: 'When talking about the other person', kind: 'gesture', functions: ['explaining', 'self_reference'], manner: [], duration: 5.07 },
  'cc_high_hands_many_hand_gestures': { id: 'cc_high_hands_many_hand_gestures', label: 'High hands many hand gestures', when: 'When explaining formally', kind: 'gesture', functions: ['explaining'], manner: ['formal'], duration: 5.96 },
  'cc_high_hands_many_hand_gestures_2': { id: 'cc_high_hands_many_hand_gestures_2', label: 'High hands many hand gestures 2', when: 'When explaining with many points', kind: 'gesture', functions: ['making_point', 'explaining'], manner: [], duration: 3.90 },
  'cc_high_hands_together_nod': { id: 'cc_high_hands_together_nod', label: 'High hands together nod', when: 'When agreeing foramlly', kind: 'gesture', functions: ['agreeing'], manner: ['formal'], duration: 2.20 },
  'cc_high_hands_together_step_forward': { id: 'cc_high_hands_together_step_forward', label: 'High hands together step forward', when: 'When expressing idea formally', kind: 'gesture', functions: ['explaining'], manner: ['formal'], duration: 3.77 },
  'cc_idle_standard': { id: 'cc_idle_standard', label: 'Idle Standard', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], duration: 10.00 },
  'cc_idle_still': { id: 'cc_idle_still', label: 'Idle Still', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], duration: 16.67 },
  'cc_lean_back_hands_up': { id: 'cc_lean_back_hands_up', label: 'Lean back hands up', when: 'When accepting an idea', kind: 'gesture', functions: ['agreeing', 'explaining'], manner: [], duration: 4.00 },
  'cc_lean_forward_hands_out_yelling': { id: 'cc_lean_forward_hands_out_yelling', label: 'Lean forward hands out yelling', when: 'When yelling', kind: 'gesture', functions: ['emoting'], manner: ['agitated'], duration: 7.83 },
  'cc_lean_sideways_scatch_chest': { id: 'cc_lean_sideways_scatch_chest', label: 'Lean sideways scatch chest', when: 'When confused but listening', kind: 'gesture', functions: ['thinking', 'listening'], manner: [], duration: 4.40 },
  'cc_look_at_hand_and_nails': { id: 'cc_look_at_hand_and_nails', label: 'Look at hand and nails', when: 'When rejecting a statement', kind: 'gesture', functions: ['disagreeing', 'making_point'], manner: [], duration: 5.77 },
  'cc_look_to_both_sides': { id: 'cc_look_to_both_sides', label: 'Look to both sides', when: 'When wary or uninterested', kind: 'idle', functions: ['rest'], manner: ['guarded'], duration: 17.67 },
  'cc_look_up_to_side_and_pointed_finger': { id: 'cc_look_up_to_side_and_pointed_finger', label: 'Look up to side and pointed finger', when: 'When coming up with big thought', kind: 'gesture', functions: ['thinking'], manner: [], duration: 4.70 },
  'cc_looking_away': { id: 'cc_looking_away', label: 'Looking away', when: 'When they heard something they don\'t want', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 3.27 },
  'cc_looking_down': { id: 'cc_looking_down', label: 'Looking down', when: 'When they are shy or displeased', kind: 'gesture', functions: ['emoting'], manner: ['shy', 'downcast'], duration: 7.17 },
  'cc_masculine_hand_to_hip_straighten': { id: 'cc_masculine_hand_to_hip_straighten', label: 'Masculine hand to hip straighten', when: 'When having made point', kind: 'gesture', functions: ['making_point'], manner: [], duration: 2.19 },
  'cc_masculine_idle': { id: 'cc_masculine_idle', label: 'Masculine Idle', when: 'When ready and attentive', kind: 'idle', functions: ['rest'], manner: [], duration: 2.17 },
  'cc_masculine_lean_side_hand_out': { id: 'cc_masculine_lean_side_hand_out', label: 'Masculine lean side hand out', when: 'When making relaxed point', kind: 'gesture', functions: ['making_point'], manner: ['relaxed'], duration: 4.89 },
  'cc_masculine_lean_with_hand_out': { id: 'cc_masculine_lean_with_hand_out', label: 'Masculine lean with hand out', when: 'When accepting', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 4.96 },
  'cc_masculine_look_around': { id: 'cc_masculine_look_around', label: 'Masculine look around', when: 'When uncomfortable', kind: 'idle', functions: ['rest'], manner: ['downcast'], duration: 6.04 },
  'cc_neutral_idle': { id: 'cc_neutral_idle', label: 'Neutral Idle', when: 'When listening and attentive', kind: 'idle', functions: ['listening', 'rest'], manner: [], duration: 3.67 },
  'cc_nodding_pumping_hands_clap': { id: 'cc_nodding_pumping_hands_clap', label: 'Nodding pumping hands clap', when: 'When excited about a win', kind: 'gesture', functions: ['emoting'], manner: ['elated'], duration: 3.80 },
  'cc_one_arm_crossed': { id: 'cc_one_arm_crossed', label: 'One arm crossed', when: 'When guarded or shy', kind: 'gesture', functions: ['emoting', 'rest'], manner: ['shy', 'guarded'], duration: 3.33 },
  'cc_one_arm_crossed_head_move': { id: 'cc_one_arm_crossed_head_move', label: 'One arm crossed head move', when: 'When shy and listening', kind: 'gesture', functions: ['emoting', 'listening'], manner: ['shy'], duration: 4.46 },
  'cc_one_arm_crossed_nodding': { id: 'cc_one_arm_crossed_nodding', label: 'One arm crossed nodding', when: 'When shy and agreeing', kind: 'gesture', functions: ['emoting', 'agreeing'], manner: ['shy'], duration: 3.76 },
  'cc_one_arm_crossed_nodding_2': { id: 'cc_one_arm_crossed_nodding_2', label: 'One arm crossed nodding 2', when: 'When shy and agreeing more', kind: 'gesture', functions: ['emoting', 'agreeing'], manner: ['shy'], duration: 3.20 },
  'cc_one_arm_crossed_shifting': { id: 'cc_one_arm_crossed_shifting', label: 'One arm crossed shifting', when: 'When uncomfortable', kind: 'gesture', functions: ['rest'], manner: ['downcast'], duration: 3.33 },
  'cc_relieved_sigh': { id: 'cc_relieved_sigh', label: 'Relieved sigh', when: 'When they are relieved', kind: 'gesture', functions: ['emoting'], manner: ['elated'], duration: 3.00 },
  'cc_side_eye': { id: 'cc_side_eye', label: 'Side eye', when: 'When wary or scared', kind: 'idle', functions: ['rest'], manner: ['guarded'], duration: 5.67 },
  'cc_side_eye_agree': { id: 'cc_side_eye_agree', label: 'Side eye agree', when: 'When wary but agreeing', kind: 'gesture', functions: ['agreeing', 'rest'], manner: ['guarded'], duration: 3.24 },
  'cc_side_eye_hands_together': { id: 'cc_side_eye_hands_together', label: 'Side eye hands together', when: 'When wary but choosing to accept', kind: 'gesture', functions: ['agreeing', 'rest'], manner: ['guarded'], duration: 5.94 },
  'cc_side_eye_pointed_finger_nod': { id: 'cc_side_eye_pointed_finger_nod', label: 'Side eye pointed finger nod', when: 'When deciding to agree', kind: 'gesture', functions: ['agreeing', 'thinking'], manner: [], duration: 5.73 },
  'cc_side_eye_still': { id: 'cc_side_eye_still', label: 'Side eye still', when: 'When disbelieving or gaurded', kind: 'idle', functions: ['disagreeing', 'rest'], manner: ['guarded'], duration: 5.67 },
  'cc_side_eye_still_2': { id: 'cc_side_eye_still_2', label: 'Side eye still', when: 'When thinking about discussion', kind: 'gesture', functions: ['thinking'], manner: [], duration: 3.00 },
  'cc_slight_look_up': { id: 'cc_slight_look_up', label: 'Slight look up', when: 'When providing no response', kind: 'gesture', functions: ['disagreeing'], manner: [], duration: 2.03 },
  'cc_slouched': { id: 'cc_slouched', label: 'Slouched', when: 'When tired', kind: 'idle', functions: ['rest'], manner: ['downcast'], duration: 11.50 },
  'cc_slow_hand_up': { id: 'cc_slow_hand_up', label: 'Slow hand up', when: 'When making appealing', kind: 'gesture', functions: ['making_point'], manner: [], duration: 3.53 },
  'cc_standard_idle': { id: 'cc_standard_idle', label: 'Standard Idle', when: 'When listening', kind: 'idle', functions: ['listening'], manner: [], duration: 3.00 },
  'cc_step_back_hands_up': { id: 'cc_step_back_hands_up', label: 'Step back hands up', when: 'When letting other person have their way', kind: 'gesture', functions: ['agreeing'], manner: [], duration: 4.70 },
  'cc_waving': { id: 'cc_waving', label: 'Waving', when: 'When saying hello enthusiastically', kind: 'gesture', functions: ['greeting'], manner: ['elated'], duration: 5.40 },
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
 * Registry clips serving a given function, optionally narrowed to idle or gesture.
 * Order is stable (registry order) so callers can apply their own preference.
 */
export function clipsForFunction(
  fn: ClipFunction,
  kind?: 'idle' | 'gesture',
): SituationalClip[] {
  return Object.values(SITUATIONAL_CLIPS).filter(
    c => c.functions.includes(fn) && (kind === undefined || c.kind === kind),
  )
}
