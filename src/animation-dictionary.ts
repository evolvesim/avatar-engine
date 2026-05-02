/**
 * animation-dictionary.ts — Binary animation dictionary loader
 *
 * The research spec is explicit: do NOT load individual .fbx files at runtime.
 * Instead, compile all chosen animations into a single binary GLB (packed via
 * the Mesh2Motion platform or Blender) and load it once during app init.
 *
 * Architecture:
 *
 *   BUILD TIME (scripts/compile-animations.ts):
 *     Source GLBs/FBXs from Quaternius + Mesh2Motion + Mixamo
 *       → Blender --background --python pack_animations.py
 *       → Single animations.glb (all tracks, no mesh geometry, <500KB target)
 *       → public/avatar-engine/animations.glb
 *
 *   RUNTIME (this file):
 *     AnimationDictionary.load('/avatar-engine/animations.glb')
 *       → THREE.AnimationClip[] parsed from GLB
 *       → Indexed by clip.name (string)
 *       → AnimationMixer.clipAction(clip) on demand
 *
 * Animation naming convention (strict — Virtual Director must match exactly):
 *   <source>_<emotion>_<action>
 *   e.g. 'quaternius_neutral_idle'
 *        'mixamo_anger_dismissive_wave'
 *        'quaternius_joy_talking_hands'
 *        'mesh2motion_sadness_head_down'
 *
 * Sources & licensing:
 *   Quaternius Universal Animation Library — CC0 Public Domain
 *   Mesh2Motion — CC0 / MIT
 *   Mixamo (Adobe) — Free for commercial use
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnimationEntry {
  clip:      THREE.AnimationClip
  /** Emotion context this animation is appropriate for */
  emotion:   string
  /** Whether this clip loops (idle) or plays once (gesture) */
  loop:      THREE.AnimationActionLoopStyles
  /** Default crossfade duration when transitioning to/from this clip */
  defaultCrossfade: number
}

export type AnimationDictionaryState = 'idle' | 'loading' | 'ready' | 'error'

// ── Curated animation manifest ────────────────────────────────────────────────

/**
 * Defines which clips from the packed GLB correspond to which emotions.
 * Add entries here as animations are added to the compiled dictionary.
 *
 * This manifest is the single source of truth fed to the Virtual Director
 * prompt builder so the LLM knows exactly what animation IDs are valid.
 */
export const ANIMATION_MANIFEST: Record<string, Omit<AnimationEntry, 'clip'>> = {

  // ── NEUTRAL (9) ──────────────────────────────────────────────────────────
  'quaternius_neutral_idle':                    { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mesh2motion_neutral_weight_shift':           { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mixamo_neutral_talking_default':             { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'mixamo_neutral_thoughtful_nod':              { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'mixamo_neutral_head_shake':                  { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'mixamo_neutral_looking_around':              { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mixamo_neutral_listening_sway':              { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_neutral_explain_both_hands':          { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_neutral_self_reference':              { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },

  // ── JOY (7) ──────────────────────────────────────────────────────────────
  'quaternius_joy_breathing_idle':              { emotion: 'joy',           loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mixamo_joy_talking_hands':                   { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'mixamo_joy_thumbs_up':                       { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'mesh2motion_joy_celebratory_clap':           { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_joy_enthusiastic_agree':              { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_joy_warm_smile_nod':                  { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_joy_present_good_news':               { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },

  // ── ANGER (7) ────────────────────────────────────────────────────────────
  'quaternius_anger_tense_idle':                { emotion: 'anger',         loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mixamo_anger_dismissive_wave':               { emotion: 'anger',         loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'mixamo_anger_pointing':                      { emotion: 'anger',         loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'mixamo_anger_arms_crossed':                  { emotion: 'anger',         loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_anger_finger_wag':                    { emotion: 'anger',         loop: THREE.LoopOnce,   defaultCrossfade: 0.15 },
  'evolve_anger_controlled_release':            { emotion: 'anger',         loop: THREE.LoopOnce,   defaultCrossfade: 0.5  },
  'evolve_anger_emphatic_table':                { emotion: 'anger',         loop: THREE.LoopOnce,   defaultCrossfade: 0.15 },

  // ── SADNESS (6) ──────────────────────────────────────────────────────────
  'quaternius_sadness_slumped':                 { emotion: 'sadness',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mixamo_sadness_apologetic_hands':            { emotion: 'sadness',       loop: THREE.LoopOnce,   defaultCrossfade: 0.35 },
  'mixamo_sadness_head_down':                   { emotion: 'sadness',       loop: THREE.LoopOnce,   defaultCrossfade: 0.35 },
  'mesh2motion_sadness_shoulder_slump':         { emotion: 'sadness',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_sadness_slow_head_shake':             { emotion: 'sadness',       loop: THREE.LoopOnce,   defaultCrossfade: 0.35 },
  'evolve_sadness_resigned_sigh':               { emotion: 'sadness',       loop: THREE.LoopOnce,   defaultCrossfade: 0.4  },

  // ── SURPRISE (5) ─────────────────────────────────────────────────────────
  'mixamo_surprise_step_back':                  { emotion: 'surprise',      loop: THREE.LoopOnce,   defaultCrossfade: 0.15 },
  'evolve_surprise_double_take':                { emotion: 'surprise',      loop: THREE.LoopOnce,   defaultCrossfade: 0.1  },
  'evolve_surprise_lean_in':                    { emotion: 'surprise',      loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_surprise_hands_on_face':              { emotion: 'surprise',      loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_surprise_recover':                    { emotion: 'surprise',      loop: THREE.LoopOnce,   defaultCrossfade: 0.4  },

  // ── FEAR (5) ─────────────────────────────────────────────────────────────
  'quaternius_fear_frozen_idle':                { emotion: 'fear',          loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_fear_shrink_back':                    { emotion: 'fear',          loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_fear_protective_arms':                { emotion: 'fear',          loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_fear_furtive_glance':                 { emotion: 'fear',          loop: THREE.LoopOnce,   defaultCrossfade: 0.15 },
  'evolve_fear_tension_tremble':                { emotion: 'fear',          loop: THREE.LoopRepeat, defaultCrossfade: 0.3  },

  // ── DISGUST (4) ──────────────────────────────────────────────────────────
  'quaternius_disgust_recoil_idle':             { emotion: 'disgust',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_disgust_look_away':                   { emotion: 'disgust',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_disgust_lean_back_cross':             { emotion: 'disgust',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_disgust_sharp_recoil':                { emotion: 'disgust',       loop: THREE.LoopOnce,   defaultCrossfade: 0.1  },

  // ── EMPATHY (6) ──────────────────────────────────────────────────────────
  'mixamo_empathy_open_hands':                  { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'mixamo_empathy_leaning_forward':             { emotion: 'empathy',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_empathy_gentle_nod':                  { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_empathy_reach_out':                   { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_empathy_hand_over_heart':             { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.35 },
  'evolve_empathy_soft_head_tilt':              { emotion: 'empathy',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },

  // ── CONCENTRATION (6) ────────────────────────────────────────────────────
  'quaternius_concentration_idle':              { emotion: 'concentration', loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'mixamo_concentration_chin_stroke':           { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_concentration_arms_folded_think':     { emotion: 'concentration', loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_concentration_step_forward':          { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_concentration_finger_tap_temple':     { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_concentration_deliberate_point':      { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },

  // ── CONFUSION (5) ────────────────────────────────────────────────────────
  'mixamo_confusion_head_tilt':                 { emotion: 'confusion',     loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_confusion_shrug':                     { emotion: 'confusion',     loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_confusion_look_around':               { emotion: 'confusion',     loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_confusion_double_head_tilt':          { emotion: 'confusion',     loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_confusion_quizzical_raise':           { emotion: 'confusion',     loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },

  // ── PROFESSIONAL (7) — Evolve B2B enterprise scenarios ───────────────────
  'evolve_professional_authority_stance':       { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_professional_present_data':           { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_professional_steeple_fingers':        { emotion: 'concentration', loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_professional_formal_nod':             { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_professional_open_pitch':             { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_professional_confident_cross':        { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_professional_handshake_prep':         { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },

  // ── LISTENING (5) ────────────────────────────────────────────────────────
  'evolve_listening_active_sway':               { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_listening_affirm_micro_nod':          { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_listening_interested_lean':           { emotion: 'empathy',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_listening_reflective_pause':          { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.4  },
  'evolve_listening_attentive_still':           { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },

  // ── v3: LISTENING & AGREEMENT (6) ────────────────────────────────────────
  'evolve_listening_micro_nod_continuous':      { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_listening_lean_and_settle':           { emotion: 'empathy',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_listening_chin_raise_affirm':         { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_listening_mmm_body':                  { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_listening_hold_space':                { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_listening_reflective_tilt':           { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },

  // ── v3: AGREEMENT SPECTRUM (5) ───────────────────────────────────────────
  'evolve_agreement_strong_nod':                { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.2  },
  'evolve_agreement_warm_verbal_affirm':        { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_agreement_considered_nod':            { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_agreement_yes_but_pause':             { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_agreement_gentle_disagree':           { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },

  // ── v3: COACHING & FEEDBACK (5) ──────────────────────────────────────────
  'evolve_coaching_praise_delivery':            { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_coaching_constructive_frame':         { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_coaching_check_understanding':        { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_coaching_summarise_gesture':          { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_coaching_invite_reflection':          { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.35 },

  // ── v3: PROFESSIONAL CONVERSATION (3) ────────────────────────────────────
  'evolve_professional_invite_to_speak':        { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_professional_topic_transition':       { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_professional_wrap_up_signal':         { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },

  // ── v3: SUBTLE IDLE VARIETY (3) ──────────────────────────────────────────
  'evolve_idle_seated_upright':                 { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5  },
  'evolve_idle_look_down_notes':                { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.4  },
  'evolve_idle_micro_posture_reset':            { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.4  },

  // ── v3: THINKING & PROCESSING (4) ────────────────────────────────────────
  'evolve_thinking_recall_look_up':             { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_thinking_weigh_options':              { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_thinking_calculate_still':            { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_thinking_decide_forward':             { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },

  // ── v3: EDUCATION-SPECIFIC (5) ───────────────────────────────────────────
  'evolve_education_step_by_step':              { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_education_point_to_content':          { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_education_writing_gesture':           { emotion: 'concentration', loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_education_check_understand_question': { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_education_encourage_student':         { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },

  // ── v3: SOCIAL & RAPPORT (4) ─────────────────────────────────────────────
  'evolve_rapport_calm_reassurance':            { emotion: 'empathy',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_rapport_mirroring_lean':              { emotion: 'empathy',       loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_rapport_professional_smile_hold':     { emotion: 'joy',           loop: THREE.LoopOnce,   defaultCrossfade: 0.4  },
  'evolve_rapport_inclusive_gesture':           { emotion: 'neutral',       loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },

  // ── v3: STRESS & PRESSURE (5) ────────────────────────────────────────────
  'evolve_stress_suppressed_still':             { emotion: 'fear',          loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_stress_contained_retreat':            { emotion: 'fear',          loop: THREE.LoopOnce,   defaultCrossfade: 0.3  },
  'evolve_stress_self_anchor':                  { emotion: 'fear',          loop: THREE.LoopRepeat, defaultCrossfade: 0.4  },
  'evolve_stress_brief_look_away':              { emotion: 'fear',          loop: THREE.LoopOnce,   defaultCrossfade: 0.25 },
  'evolve_stress_micro_tension':                { emotion: 'fear',          loop: THREE.LoopRepeat, defaultCrossfade: 0.3  },
}

// ── Animation dictionary ──────────────────────────────────────────────────────

export class AnimationDictionary {
  private clips:  Map<string, AnimationEntry> = new Map()
  private state:  AnimationDictionaryState = 'idle'
  private error:  Error | null = null
  private _onReady: (() => void)[] = []

  get status(): AnimationDictionaryState { return this.state }
  get loadError(): Error | null           { return this.error  }

  /**
   * Returns all animation IDs currently loaded.
   * Fed to VirtualDirector.updateAnimIds() after load completes.
   */
  get animationIds(): string[] {
    return Array.from(this.clips.keys())
  }

  /**
   * Load the packed animation GLB asynchronously.
   * Called once during app initialisation — does not block rendering.
   *
   * @param url  Path to the compiled animations.glb in /public
   */
  async load(url: string): Promise<void> {
    if (this.state === 'loading' || this.state === 'ready') return
    this.state = 'loading'

    return new Promise((resolve) => {
      const loader = new GLTFLoader()
      loader.load(
        url,
        (gltf) => {
          for (const clip of gltf.animations) {
            const manifest = ANIMATION_MANIFEST[clip.name]
            if (!manifest) {
              // Unknown clip in dictionary — still index it, use neutral defaults
              console.warn(`[AnimationDictionary] No manifest entry for clip "${clip.name}" — indexing with neutral defaults`)
              this.clips.set(clip.name, {
                clip,
                emotion:           'neutral',
                loop:              THREE.LoopOnce,
                defaultCrossfade:  0.25,
              })
              continue
            }
            this.clips.set(clip.name, { clip, ...manifest })
          }
          this.state = 'ready'
          console.info(`[AnimationDictionary] Loaded ${this.clips.size} animation clips from ${url}`)
          this._onReady.forEach(cb => cb())
          this._onReady = []
          resolve()
        },
        undefined,
        (err) => {
          this.error = err instanceof Error ? err : new Error(String(err))
          this.state = 'error'
          console.error('[AnimationDictionary] Failed to load:', this.error)
          resolve() // Don't reject — graceful degradation (no gestures, still functional)
        }
      )
    })
  }

  /**
   * Register a callback to fire when the dictionary finishes loading.
   * If already loaded, fires immediately.
   */
  onReady(cb: () => void): void {
    if (this.state === 'ready') { cb(); return }
    this._onReady.push(cb)
  }

  /**
   * Retrieve an AnimationEntry by ID.
   * Returns null if not loaded or ID unknown.
   */
  get(id: string): AnimationEntry | null {
    return this.clips.get(id) ?? null
  }

  /**
   * Return all clips for a given emotion, sorted with LoopRepeat (idle) clips last.
   * Used by the skeletal controller to pick a context-appropriate idle animation.
   */
  getByEmotion(emotion: string): AnimationEntry[] {
    return Array.from(this.clips.values())
      .filter(e => e.emotion === emotion)
      .sort((a, b) => {
        if (a.loop === THREE.LoopRepeat && b.loop !== THREE.LoopRepeat) return 1
        if (a.loop !== THREE.LoopRepeat && b.loop === THREE.LoopRepeat) return -1
        return 0
      })
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const animationDictionary = new AnimationDictionary()
