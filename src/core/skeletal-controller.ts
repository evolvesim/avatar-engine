/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Two-action mixer architecture:
 *
 *   BASE layer  — avaturn_animation (stripped of morph tracks), weight=1 ALWAYS.
 *                 Drives all 53 body bones including arms, hips, legs, spine.
 *                 NEVER faded, NEVER stopped, NEVER crossFaded.
 *                 Arms are always in natural rest pose because base owns them.
 *
 *   TOP layer   — emotion idle or gesture clip.
 *                 ARM_SAFE idle clips (head/spine only): NormalBlend, weight lerps 0→1.
 *                   Base still drives arms — no conflict.
 *                 ARM_GESTURE clips (full body): AdditiveBlend, weight lerps 0→0.45.
 *                   Additive deltas are relative to avaturn_animation frame-0, so
 *                   arms move naturally FROM the rest pose, not from T-pose.
 *
 *   OUT layer   — previous top action fading weight 1→0 then stopped.
 *
 * Word boundary → gesture flow:
 *   VirtualDirector → PerformanceData.gesture_cues[]
 *                              ↓
 *             SkeletalController.loadPerformance(cues)
 *                              ↓
 *    Azure WordBoundary event → wordIndex increments
 *                              ↓
 *    playGesture(clip) at matching word_index
 *                              ↓
 *    LoopOnce gesture finishes → playIdle() returns to idle pool
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Emotion → idle animation pools ───────────────────────────────────────────
//
// All clips here are ARM_SAFE (head/spine/neck tracks only — no LeftArm/RightArm).
// The base action (avaturn_animation) permanently owns all arm bones.
// Adding an ARM_GESTURE clip here would fight the base and cause T-pose flicker.
const EMOTION_IDLE_POOLS: Record<EmotionId, string[]> = {
  neutral: [
    'quaternius_neutral_idle',              // subtle head/spine sway
    'mesh2motion_neutral_weight_shift',     // gentle weight shift, spine only
    'evolve_listening_interested_lean',     // slight forward lean, engaged
    'mixamo_neutral_looking_around',        // natural head look-around
  ],
  joy: [
    'evolve_empathy_gentle_nod',            // warm upbeat nod
    'mixamo_neutral_thoughtful_nod',        // lighter nod variation
    'quaternius_neutral_idle',
  ],
  anger: [
    'mesh2motion_neutral_weight_shift',
    'quaternius_neutral_idle',
  ],
  sadness: [
    'evolve_sadness_resigned_sigh',         // head bow, resigned
    'quaternius_neutral_idle',
  ],
  surprise: [
    'mixamo_neutral_looking_around',        // rapid head scan
    'quaternius_neutral_idle',
  ],
  fear: [
    'quaternius_neutral_idle',
    'mesh2motion_neutral_weight_shift',
  ],
  disgust: [
    'mesh2motion_neutral_weight_shift',
    'quaternius_neutral_idle',
  ],
  empathy: [
    'mixamo_empathy_leaning_forward',       // gentle forward lean
    'evolve_empathy_gentle_nod',
    'evolve_listening_interested_lean',
  ],
  concentration: [
    'mixamo_neutral_looking_around',
    'mixamo_neutral_thoughtful_nod',
    'evolve_idle_look_down_notes',
  ],
  confusion: [
    'evolve_confusion_double_head_tilt',    // double head tilt
    'mixamo_neutral_looking_around',
    'quaternius_neutral_idle',
  ],
}

// ARM_GESTURE clips — these have arm/shoulder/hand tracks.
// They are played additively on top of the base action at weight ≤ 0.45.
// The additive delta is computed relative to avaturn_animation frame-0,
// so gestures move arms FROM the natural rest pose, not from T-pose.
const ARM_GESTURE_CLIP_IDS = new Set([
  'evolve_neutral_explain_both_hands',
  'mixamo_joy_talking_hands',
  'mixamo_joy_thumbs_up',
  'evolve_joy_present_good_news',
  'mixamo_anger_pointing',
  'evolve_anger_finger_wag',
  'mixamo_sadness_apologetic_hands',
  'evolve_surprise_lean_in',
  'mixamo_empathy_open_hands',
  'evolve_empathy_reach_out',
  'evolve_empathy_hand_over_heart',
  'mixamo_concentration_chin_stroke',
  'evolve_concentration_finger_tap_temple',
  'evolve_concentration_deliberate_point',
  'evolve_confusion_shrug',
  'evolve_professional_present_data',
  'evolve_professional_steeple_fingers',
  'mesh2motion_joy_celebratory_clap',
  'mixamo_anger_dismissive_wave',
  'evolve_anger_emphatic_table',
  'evolve_surprise_hands_on_face',
  'evolve_professional_authority_stance',
])

// Additive gesture weight cap — full weight (1.0) causes arm flapping on clips
// with large shoulder-abduction keyframes. 0.45 gives visible, natural movement.
const GESTURE_ADDITIVE_WEIGHT = 0.45

export class SkeletalController {
  private mixer:         THREE.AnimationMixer | null = null
  /** avaturn_animation — permanent base, weight=1, NEVER faded */
  private baseAction:    THREE.AnimationAction | null = null
  /** avaturn_animation stripped of morph tracks — used as additive reference */
  private baseClip:      THREE.AnimationClip | null = null
  private topAction:     THREE.AnimationAction | null = null
  private outAction:     THREE.AnimationAction | null = null
  private topWeightTgt:  number = 0
  private topWeightCur:  number = 0
  private topWeightMax:  number = 1.0   // 1.0 for idle, GESTURE_ADDITIVE_WEIGHT for gestures
  private dictionary:    AnimationDictionary
  private pendingCues:   GestureCue[] = []
  private wordCounter:   number = 0
  private currentEmotion:    EmotionId = 'neutral'
  private currentIdleClipId: string    = ''
  private idlePoolTimer:     number    = 0
  private idlePoolInterval:  number    = 10
  private isInGesture:       boolean   = false
  private pendingIdle:       boolean   = false
  private pendingIdleFrames  = 0
  private diagnosticFrame    = 0
  /** Cache of additive-converted clips keyed by original clip name */
  private additiveCache: Map<string, THREE.AnimationClip> = new Map()

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Initialise ─────────────────────────────────────────────────────────────

  /**
   * Bind the mixer to the avatar's root scene object.
   * Starts the avaturn_animation base layer immediately if found in clips.
   * Call this once after the GLB has loaded.
   */
  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(avatarRoot)
    console.log('[SkeletalController] init — avatarRoot:', avatarRoot.name || '(unnamed)')

    // ── Base layer: avaturn_animation ─────────────────────────────────────
    // Find avaturn_animation in the provided clips array (comes from gltf.animations).
    // Strip morph tracks so the avaturn baseline brow/eye values don't bleed through
    // emotion presets. Keep all bone tracks — these drive arms + full body.
    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      // Deep copy so we don't mutate the original gltf.animations entry
      const stripped = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(raw))
      stripped.tracks = stripped.tracks.filter(
        t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
      )
      this.baseClip = stripped

      const base = this.mixer.clipAction(stripped)
      base.blendMode = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation (morph tracks stripped)')
    } else {
      console.warn('[SkeletalController] avaturn_animation not found in clips — arms may T-pose. Clips available:', clips?.map(c => c.name))
    }

    this.pendingIdle = true
    this._tryStartIdle()
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.pendingIdle) {
      this._tryStartIdle()
      this.pendingIdleFrames++
      if (this.pendingIdleFrames === 120) {
        const pool = EMOTION_IDLE_POOLS[this.currentEmotion] ?? EMOTION_IDLE_POOLS.neutral
        console.warn('[SkeletalController] pendingIdle still true after 120 frames — dict never resolved pool[0]:', pool[0])
      }
    } else {
      this.pendingIdleFrames = 0
    }

    // Idle pool cycling — only when in idle (not gesturing) and top is settled
    if (!this.isInGesture && !this.pendingIdle && this.topWeightCur >= 0.99) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer    = 0
        this.idlePoolInterval = 8 + Math.random() * 7
        const nextId = this._pickNextIdle(this.currentEmotion)
        if (nextId !== this.currentIdleClipId) {
          this.playIdle(this.currentEmotion, nextId)
        }
      }
    }

    // Lerp top layer weight in (toward topWeightMax — 1.0 for idle, 0.45 for gesture)
    if (this.topAction && this.topWeightCur < this.topWeightTgt) {
      this.topWeightCur = Math.min(this.topWeightTgt, this.topWeightCur + delta * 4)
      this.topAction.setEffectiveWeight(this.topWeightCur)
    }

    // Lerp outgoing action weight down then stop it
    if (this.outAction) {
      const w    = this.outAction.getEffectiveWeight()
      const next = Math.max(0, w - delta * 4)
      this.outAction.setEffectiveWeight(next)
      if (next === 0) {
        this.outAction.stop()
        this.outAction = null
      }
    }

    this.mixer?.update(delta)

    // Diagnostic at frame 10
    this.diagnosticFrame++
    if (this.diagnosticFrame === 10) {
      console.log('[SkeletalController] frame-10 diag', {
        baseExists:    !!this.baseAction,
        baseWeight:    this.baseAction?.getEffectiveWeight(),
        baseRunning:   this.baseAction?.isRunning(),
        baseClip:      this.baseClip?.name ?? 'none',
        topExists:     !!this.topAction,
        topWeight:     this.topAction?.getEffectiveWeight(),
        topRunning:    this.topAction?.isRunning(),
        isInGesture:   this.isInGesture,
      })
    }
  }

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) return   // dict not ready — retry next frame

    console.log('[SkeletalController] idle started:', id)
    this.pendingIdle       = false
    this.currentIdleClipId = id
    this.isInGesture       = false

    const action = this.mixer.clipAction(entry.clip)
    action.blendMode       = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0
    this.topWeightMax = 1.0
  }

  private _pickNextIdle(emotion: EmotionId): string {
    const pool       = EMOTION_IDLE_POOLS[emotion] ?? EMOTION_IDLE_POOLS.neutral
    if (pool.length === 1) return pool[0]
    const candidates = pool.filter(id => id !== this.currentIdleClipId)
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  // ── Additive clip conversion ────────────────────────────────────────────────

  /**
   * Convert a gesture clip to additive mode relative to avaturn_animation frame-0.
   * Result is cached — each clip is only converted once.
   *
   * makeClipAdditive(clip, 0, baseClip) subtracts the base pose at t=0 from every
   * keyframe in the gesture clip. At runtime the additive action adds those deltas
   * ON TOP of whatever the base action is playing — arms move from natural rest pose,
   * not from T-pose bind pose.
   */
  private _toAdditive(clip: THREE.AnimationClip): THREE.AnimationClip {
    const cached = this.additiveCache.get(clip.name)
    if (cached) return cached

    const addClip  = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(clip))
    addClip.name   = clip.name + '__additive'

    if (this.baseClip) {
      THREE.AnimationUtils.makeClipAdditive(addClip, 0, this.baseClip)
    } else {
      // No base clip — fall back to self-reference (deltas from clip's own frame-0)
      THREE.AnimationUtils.makeClipAdditive(addClip)
    }

    this.additiveCache.set(clip.name, addClip)
    return addClip
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  private playIdle(emotion: EmotionId, idleId?: string): void {
    if (!this.mixer) return
    const id    = idleId ?? this._pickNextIdle(emotion)
    const entry = this.dictionary.get(id)
    if (!entry) return

    this.currentIdleClipId = id
    this.isInGesture       = false
    this.idlePoolTimer     = 0

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    const action = this.mixer.clipAction(entry.clip)
    action.blendMode       = THREE.NormalAnimationBlendMode
    action.setLoop(entry.loop, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0
    this.topWeightMax = 1.0
  }

  private playGesture(animId: string, crossfadeDuration: number): void {
    if (!this.mixer) return
    const entry = this.dictionary.get(animId)
    if (!entry) {
      console.warn(`[SkeletalController] "${animId}" not found in dictionary`)
      return
    }

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    this.isInGesture   = true
    this.idlePoolTimer = 0

    const isArmGesture = ARM_GESTURE_CLIP_IDS.has(animId)

    let clip: THREE.AnimationClip
    let blendMode: THREE.AnimationBlendMode
    let weightMax: number

    if (isArmGesture) {
      // Additive blend: delta from avaturn_animation frame-0 layered on top of base.
      // Arms move naturally from rest pose.
      clip      = this._toAdditive(entry.clip)
      blendMode = THREE.AdditiveAnimationBlendMode
      weightMax = GESTURE_ADDITIVE_WEIGHT
    } else {
      // Normal blend: head/spine clip on top layer, base still owns arms.
      clip      = entry.clip
      blendMode = THREE.NormalAnimationBlendMode
      weightMax = 1.0
    }

    const action = this.mixer.clipAction(clip)
    action.blendMode       = blendMode
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset()
    action.setEffectiveWeight(0)
    action.play()

    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = weightMax
    this.topWeightMax = weightMax

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer!.removeEventListener('finished', onFinished)
      this.isInGesture = false
      this.playIdle(this.currentEmotion)
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  loadPerformance(cues: GestureCue[]): void {
    this.pendingCues = [...cues].sort((a, b) => a.word_index - b.word_index)
    this.wordCounter = 0
  }

  onWordBoundary(): void {
    const idx = this.wordCounter++
    while (this.pendingCues.length > 0 && this.pendingCues[0].word_index <= idx) {
      const cue = this.pendingCues.shift()!
      this.playGesture(cue.anim_id, cue.crossfade_duration)
    }
  }

  onEmotionChange(emotion: EmotionId): void {
    if (emotion === this.currentEmotion) return
    this.currentEmotion = emotion
    if (!this.isInGesture) {
      this.playIdle(emotion)
    }
  }

  reset(): void {
    this.mixer?.stopAllAction()
    this.pendingCues       = []
    this.wordCounter       = 0
    this.currentEmotion    = 'neutral'
    this.currentIdleClipId = ''
    this.isInGesture       = false
    this.idlePoolTimer     = 0
    this.topAction         = null
    this.outAction         = null
    this.baseAction        = null
    this.topWeightCur      = 0
    this.topWeightTgt      = 0
    this.topWeightMax      = 1.0
    this.pendingIdle       = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mixer = null
  }
}
