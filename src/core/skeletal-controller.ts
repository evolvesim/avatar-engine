/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Manages the Three.js AnimationMixer and implements the WordBoundary-triggered
 * gesture system from the research spec.
 *
 * Architecture:
 *
 *   VirtualDirector → PerformanceData.gesture_cues[]
 *                              ↓
 *             SkeletalController.loadPerformance(cues, words)
 *                              ↓
 *    Azure WordBoundary event → wordIndex increments
 *                              ↓
 *    crossFadeTo(clip, duration) at matching word_index
 *                              ↓
 *    AnimationMixer.update(delta) in useFrame loop
 *
 * Emotion → idle animation mapping:
 *   When an emotion changes (EmotionStateMachine.set()), the controller
 *   automatically crossfades to the appropriate emotion-tinted idle clip.
 *   This keeps body language consistent with the persistent emotional state.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Emotion → idle animation pools ───────────────────────────────────────────
//
// Every idle clip here MUST have arm bone coverage (LeftArm + RightArm minimum)
// so the arms never T-pose. The idle is the full-body owner of all bones when no
// gesture is playing — avaturn_animation (base) no longer drives arms.
//
// Pool design rules:
//   - All clips in a pool must cover both arms
//   - First clip in each pool is the primary (most played)
//   - Pool cycles every 8–15 s for natural variation (non-repeating pick)
//   - Head/spine only (ARM_SAFE) — base action owns arm bones permanently at bind pose
//   - avaturn_animation arm tracks are frozen at bind-pose quaternions (arms at sides)
//   - Any clip with arm tracks would fight the base → use ARM_SAFE clips only here

// All clips in these pools are ARM_SAFE (head/spine/neck tracks only).
// Verified present in animations.glb and confirmed no LeftArm/RightArm tracks.
// Arms are held at sides by the procedural Z-correction in update().
const EMOTION_IDLE_POOLS: Record<EmotionId, string[]> = {
  neutral: [
    'quaternius_neutral_idle',              // subtle head/spine sway — confirmed ARM_SAFE
    'mesh2motion_neutral_weight_shift',     // gentle weight shift, spine only
    'evolve_listening_interested_lean',     // slight forward lean, engaged
    'mixamo_neutral_looking_around',        // natural head look-around
  ],
  joy: [
    'evolve_empathy_gentle_nod',            // warm upbeat nod — ARM_SAFE
    'mixamo_neutral_thoughtful_nod',        // lighter nod variation
    'quaternius_neutral_idle',              // fallback
  ],
  anger: [
    'mesh2motion_neutral_weight_shift',     // controlled weight shift — simmering
    'quaternius_neutral_idle',              // stillness — contained anger
  ],
  sadness: [
    'evolve_sadness_resigned_sigh',         // head bow, resigned — ARM_SAFE
    'quaternius_neutral_idle',              // subdued stillness
  ],
  surprise: [
    'mixamo_neutral_looking_around',        // rapid head scan — ARM_SAFE
    'quaternius_neutral_idle',              // frozen moment fallback
  ],
  fear: [
    'quaternius_neutral_idle',              // frozen, minimal movement — ARM_SAFE
    'mesh2motion_neutral_weight_shift',     // slight unease
  ],
  disgust: [
    'mesh2motion_neutral_weight_shift',     // shifting away — ARM_SAFE
    'quaternius_neutral_idle',              // recoil stillness
  ],
  empathy: [
    'mixamo_empathy_leaning_forward',       // gentle forward lean — ARM_SAFE
    'evolve_empathy_gentle_nod',            // warm engaged nod
    'evolve_listening_interested_lean',     // attentive lean
  ],
  concentration: [
    'mixamo_neutral_looking_around',        // scanning/processing look — ARM_SAFE
    'mixamo_neutral_thoughtful_nod',        // processing nod
    'evolve_idle_look_down_notes',          // looking down, thinking
  ],
  confusion: [
    'evolve_confusion_double_head_tilt',    // double head tilt — ARM_SAFE
    'mixamo_neutral_looking_around',        // uncertain look-around
    'quaternius_neutral_idle',              // fallback
  ],
}

// Keep ARM_GESTURE_CLIP_IDS for future reference / VD prompt building
// (no longer used for additive blend logic — all gestures now NormalBlend)
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

// Arm bones we procedurally lerp to arms-at-sides pose after every mixer tick.
// Target: LeftArm/RightArm X → ARM_X_TARGET (≈31°), matching avaturn_animation frame-0.
// Skip while a gesture is playing so ARM_GESTURE clips can move arms freely.
const ARM_BONE_NAMES = ['LeftArm', 'RightArm'] as const

// How fast arms lerp to sides pose (~0.6s to fully correct at 60fps)
const ARM_LERP_SPEED = 8
// Target X rotation for LeftArm/RightArm — matches avaturn_animation frame-0 pose.
// Shoulder bind pose (X=97°,Z=-90°) + LeftArm X=31° = arms hanging naturally at sides.
const ARM_X_TARGET = 0.537  // radians ≈ 31°

export class SkeletalController {
  private mixer:         THREE.AnimationMixer | null = null
  private baseAction:    THREE.AnimationAction | null = null
  private baseClip:      THREE.AnimationClip | null = null  // stripped avaturn_animation
  private topAction:     THREE.AnimationAction | null = null
  private outAction:     THREE.AnimationAction | null = null
  /** Arm bones captured at init — used for procedural arms-at-sides correction */
  private armBones: Map<string, THREE.Bone> = new Map()
  private topWeightTgt:  number = 0
  private topWeightCur:  number = 0
  private dictionary:    AnimationDictionary
  private pendingCues:   GestureCue[] = []
  private wordCounter:   number = 0
  private currentEmotion:    EmotionId = 'neutral'
  private currentIdleClipId: string    = ''      // which clip is currently the idle
  private idlePoolTimer:     number    = 0        // seconds since last idle switch
  private idlePoolInterval:  number    = 10       // randomised 8–15s per cycle
  private isInGesture:       boolean   = false    // true while a gesture (not idle) is top
  private pendingIdle:   boolean = false
  private pendingIdleFrames = 0
  private diagnosticFrame = 0
  /** Cache of additive-converted clips keyed by original clip name */
  private additiveCache: Map<string, THREE.AnimationClip> = new Map()

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Initialise with a scene object ─────────────────────────────────────────

  /**
   * Bind the mixer to the avatar's root scene object.
   * Call this once after the GLB has loaded.
   */
  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(avatarRoot)
    console.log('[SkeletalController] init — avatarRoot:', avatarRoot.name || '(unnamed)')

    // Capture arm bone references for procedural arms-at-sides correction.
    // After every mixer tick we lerp LeftArm/RightArm Z back toward 0°
    // so arms hang naturally at sides regardless of what the idle clip drives.
    this.armBones.clear()
    avatarRoot.traverse((obj) => {
      if ((obj as THREE.Bone).isBone && ARM_BONE_NAMES.includes(obj.name as typeof ARM_BONE_NAMES[number])) {
        this.armBones.set(obj.name, obj as THREE.Bone)
      }
    })
    console.log(`[SkeletalController] arm bones captured: ${[...this.armBones.keys()].join(', ')}`)

    this.pendingIdle = true
    this._tryStartIdle()
  }

  /**
   * Must be called every frame from the useFrame loop.
   * @param delta  Seconds since last frame (from R3F useFrame state)
   */
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

    // Idle pool cycling — only when we are in idle (not mid-gesture) and top is settled
    if (!this.isInGesture && !this.pendingIdle && this.topWeightCur >= 0.99) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer = 0
        this.idlePoolInterval = 8 + Math.random() * 7  // 8–15 s
        const nextId = this._pickNextIdle(this.currentEmotion)
        if (nextId !== this.currentIdleClipId) {
          this.playIdle(this.currentEmotion, nextId)
        }
      }
    }

    // Lerp top layer weight in
    if (this.topAction && this.topWeightCur < this.topWeightTgt) {
      this.topWeightCur = Math.min(this.topWeightTgt, this.topWeightCur + delta * 4)
      this.topAction.setEffectiveWeight(this.topWeightCur)
    }

    // Lerp outgoing action weight down then stop it
    if (this.outAction) {
      const w = this.outAction.getEffectiveWeight()
      const next = Math.max(0, w - delta * 4)
      this.outAction.setEffectiveWeight(next)
      if (next === 0) {
        this.outAction.stop()
        this.outAction = null
      }
    }

    this.mixer?.update(delta)

    // ── Procedural arms-at-sides correction ────────────────────────────────
    // After the mixer ticks, lerp LeftArm/RightArm X back toward ARM_X_TARGET (≈31°).
    // The shoulder bind pose (X=97°, Z=-90°) + LeftArm X=31° = arms hanging at sides.
    // avaturn_animation used to hold LeftArm at exactly this X — we replicate that.
    // Skip while a gesture is active so ARM_GESTURE clips can move arms freely.
    if (this.armBones.size > 0 && !this.isInGesture) {
      const t = Math.min(1, ARM_LERP_SPEED * delta)
      for (const [, bone] of this.armBones) {
        const euler = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ')
        euler.x = THREE.MathUtils.lerp(euler.x, ARM_X_TARGET, t)
        bone.quaternion.setFromEuler(euler)
      }
    }

    // One-time diagnostic at frame 10
    this.diagnosticFrame++
    if (this.diagnosticFrame === 10) {
      console.log('[SkeletalController] frame-10 diag — baseAction:', {
        exists: !!this.baseAction,
        weight: this.baseAction?.getEffectiveWeight(),
        enabled: this.baseAction?.enabled,
        isRunning: this.baseAction?.isRunning(),
        paused: this.baseAction?.paused,
        time: this.baseAction?.time,
      })
      console.log('[SkeletalController] frame-10 diag — topAction:', {
        exists: !!this.topAction,
        weight: this.topAction?.getEffectiveWeight(),
        isRunning: this.topAction?.isRunning(),
      })
    }
  }

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) return  // dict not ready yet — keep pendingIdle=true, retry next frame

    console.log('[SkeletalController] idle started:', id)
    this.pendingIdle = false
    this.currentIdleClipId = id
    this.isInGesture = false

    const action = this.mixer.clipAction(entry.clip)
    action.blendMode = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0
  }

  /** Pick a random clip from the emotion’s pool, avoiding immediate repeat. */
  private _pickNextIdle(emotion: EmotionId): string {
    const pool = EMOTION_IDLE_POOLS[emotion] ?? EMOTION_IDLE_POOLS.neutral
    if (pool.length === 1) return pool[0]
    const candidates = pool.filter(id => id !== this.currentIdleClipId)
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  // ── Performance loading ─────────────────────────────────────────────────────

  /**
   * Load a new set of gesture cues from the Virtual Director.
   * Resets the word counter — call this when a new TTS utterance begins.
   *
   * @param cues    Validated gesture_cues from VirtualDirector.analyse()
   */
  loadPerformance(cues: GestureCue[]): void {
    this.pendingCues  = [...cues].sort((a, b) => a.word_index - b.word_index)
    this.wordCounter  = 0
  }

  // ── WordBoundary hook ───────────────────────────────────────────────────────

  /**
   * Called by the TTS adapter on every WordBoundary event from Azure TTS.
   * The controller increments an internal word counter and fires any pending
   * gesture cues whose word_index matches.
   *
   * For non-Azure TTS providers (ElevenLabs, Mascotbot), call this at each
   * sentence chunk boundary with the running word count.
   */
  onWordBoundary(): void {
    const idx = this.wordCounter++

    while (this.pendingCues.length > 0 && this.pendingCues[0].word_index <= idx) {
      const cue = this.pendingCues.shift()!
      this.playGesture(cue.anim_id, cue.crossfade_duration)
    }
  }

  // ── Emotion-aware idle ──────────────────────────────────────────────────────

  /**
   * Called by AvatarEngine when EmotionStateMachine.set() fires.
   * Crossfades the body to the appropriate idle animation for the new emotion.
   * The avatar's body language will match its persistent emotional state.
   */
  onEmotionChange(emotion: EmotionId): void {
    if (emotion === this.currentEmotion) return
    this.currentEmotion = emotion
    // Don’t interrupt a mid-gesture — the gesture’s onFinished will call playIdle
    if (!this.isInGesture) {
      this.playIdle(emotion)
    }
  }

  // ── Playback helpers ────────────────────────────────────────────────────────

  /**
   * Convert a clip to additive mode using the base idle clip (avaturn_animation) as
   * the reference pose. This ensures arm gesture deltas are relative to the avatar's
   * actual idle pose, not T-pose — so they layer correctly on top of the base action.
   *
   * THREE.AnimationUtils.makeClipAdditive(clip, referenceTime, referenceClip) subtracts
   * referenceClip's pose at referenceTime from every keyframe in clip. Using the base
   * idle at t=0 as reference means each gesture keyframe stores the delta from idle.
   * At runtime the additive action adds that delta on top of whatever the base action
   * is currently playing — giving the intended arm movement without T-flap.
   *
   * Results are cached: each source clip is only converted once.
   */
  private _toAdditive(clip: THREE.AnimationClip): THREE.AnimationClip {
    const cached = this.additiveCache.get(clip.name)
    if (cached) return cached

    // Deep-copy the clip so we don't mutate the original in the dictionary
    const addClip = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(clip))
    addClip.name  = clip.name + '__additive'

    if (this.baseClip) {
      // Subtract the idle pose at t=0 from every keyframe of the gesture clip.
      // This gives arm deltas relative to the avatar's actual idle breathing pose.
      THREE.AnimationUtils.makeClipAdditive(addClip, 0, this.baseClip)
    } else {
      // No base clip available (no avaturn_animation in GLB) — fall back to
      // self-reference additive (deltas from the clip's own frame-0).
      THREE.AnimationUtils.makeClipAdditive(addClip)
    }

    this.additiveCache.set(clip.name, addClip)
    return addClip
  }

  private playIdle(emotion: EmotionId, idleId?: string): void {
    if (!this.mixer) return
    const id    = idleId ?? this._pickNextIdle(emotion)
    const entry = this.dictionary.get(id)
    if (!entry) return
    this.currentIdleClipId = id
    this.isInGesture       = false
    this.idlePoolTimer     = 0

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) {
        this.outAction.stop()
      }
      this.outAction = this.topAction
    }

    const action = this.mixer.clipAction(entry.clip)
    action.blendMode = THREE.NormalAnimationBlendMode
    action.setLoop(entry.loop, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction   = action
    this.topWeightCur = 0
    this.topWeightTgt = 1
  }

  private playGesture(animId: string, crossfadeDuration: number): void {
    if (!this.mixer) return
    const entry = this.dictionary.get(animId)
    if (!entry) {
      console.warn(`[SkeletalController] Animation "${animId}" not found in dictionary`)
      return
    }

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) {
        this.outAction.stop()
      }
      this.outAction = this.topAction
    }

    // Normal blend for all gestures. avaturn_animation (base) no longer drives arm
    // bones (arm tracks stripped from GLB) so gesture clips fully own arm bones at
    // weight=1 with no conflict. No additive delta correction needed.
    this.isInGesture = true
    this.idlePoolTimer = 0  // don’t cycle idle while gesturing
    const action = this.mixer.clipAction(entry.clip)
    action.blendMode = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset()
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer!.removeEventListener('finished', onFinished)
      this.isInGesture = false
      this.playIdle(this.currentEmotion)
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  /**
   * Stop all animations and reset to neutral idle.
   * Call when the session ends or avatar resets.
   */
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
    this.pendingIdle       = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mixer = null
  }
}
