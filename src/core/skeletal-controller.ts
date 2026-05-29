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

// ── Emotion → idle animation mapping ─────────────────────────────────────────

/**
 * Primary idle clip per emotion. The controller crossfades to this when
 * the emotion state changes and no gesture is queued.
 */
const EMOTION_IDLE_MAP: Record<EmotionId, string> = {
  neutral:       'quaternius_neutral_idle',
  joy:           'quaternius_joy_breathing_idle',
  anger:         'quaternius_anger_tense_idle',
  sadness:       'quaternius_sadness_slumped',
  surprise:      'quaternius_neutral_idle',   // short-lived — falls back to neutral
  fear:          'quaternius_neutral_idle',
  disgust:       'quaternius_anger_tense_idle',
  empathy:       'mixamo_empathy_leaning_forward',
  concentration: 'quaternius_concentration_idle',
  confusion:     'quaternius_neutral_idle',
}

// ── Controller ────────────────────────────────────────────────────────────────

// ── ARM_GESTURE_CLIPS — clips that have arm bone tracks requiring additive blend ─
// These clips are authored from a T-pose / neutral-arms reference. Playing them as
// Normal blend on top of avaturn_animation causes sideways T-flap because both actions
// drive the same arm bones with conflicting absolute rotations.
// Fix: convert to additive using the base idle clip as the reference pose, then play
// at AdditiveAnimationBlendMode so the delta is added on top of the running idle.
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

export class SkeletalController {
  private mixer:         THREE.AnimationMixer | null = null
  private baseAction:    THREE.AnimationAction | null = null
  private baseClip:      THREE.AnimationClip | null = null  // stripped avaturn_animation
  private topAction:     THREE.AnimationAction | null = null
  private outAction:     THREE.AnimationAction | null = null
  private topWeightTgt:  number = 0
  private topWeightCur:  number = 0
  private dictionary:    AnimationDictionary
  private pendingCues:   GestureCue[] = []
  private wordCounter:   number = 0
  private currentEmotion: EmotionId = 'neutral'
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
    console.log('[SkeletalController] init — avatarRoot:', avatarRoot.name || '(unnamed)', 'clips provided:', clips?.length ?? 0)

    // Extract avaturn_animation embedded in the GLB scene itself
    // (not in animations.glb — it's baked into every Avaturn export)
    const animations: THREE.AnimationClip[] =
      (clips && clips.length > 0)
        ? clips
        : ((avatarRoot as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [])

    const rawBase = animations.find(c => c.name === 'avaturn_animation')

    if (rawBase) {
      // Strip morph tracks — applyWeightsToMeshes owns the face; avaturn baseline brow values bleed through otherwise
      const baseClip = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(rawBase))
      const beforeCount = baseClip.tracks.length
      baseClip.tracks = baseClip.tracks.filter(
        t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
      )
      const afterCount = baseClip.tracks.length
      console.log(`[SkeletalController] avaturn_animation found — ${afterCount} bone tracks (stripped ${beforeCount - afterCount} morph tracks)`)
      this.baseClip   = baseClip  // keep reference for makeClipAdditive calls
      this.baseAction = this.mixer.clipAction(baseClip)
      this.baseAction.setLoop(THREE.LoopRepeat, Infinity)
      this.baseAction.clampWhenFinished = false
      this.baseAction.setEffectiveWeight(1)
      this.baseAction.play()
      console.log('[SkeletalController] baseAction playing — weight:', this.baseAction.getEffectiveWeight(), 'enabled:', this.baseAction.enabled, 'isRunning:', this.baseAction.isRunning())
    } else {
      console.warn('[SkeletalController] avaturn_animation not found in GLB — arms may T-pose')
    }

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
        const id = EMOTION_IDLE_MAP[this.currentEmotion] ?? 'quaternius_neutral_idle'
        console.warn('[SkeletalController] pendingIdle still true after 120 frames — dict never resolved clip:', id)
      }
    } else {
      this.pendingIdleFrames = 0
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
    const id    = EMOTION_IDLE_MAP[this.currentEmotion] ?? 'quaternius_neutral_idle'
    const entry = this.dictionary.get(id)
    if (!entry) return

    console.log('[SkeletalController] idle started:', id)
    this.pendingIdle = false

    // topAction runs in Normal mode. topAction clips have only head/spine tracks
    // so arms are driven 100% by baseAction (avaturn_animation). SkeletonUtils.clone
    // ensures the SkinnedMesh skeleton is rebound to cloned bones so the mixer
    // drives the correct objects.
    const action = this.mixer.clipAction(entry.clip)
    action.blendMode = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction = action
    this.topWeightTgt = 1.0
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
    const idleId = EMOTION_IDLE_MAP[emotion] ?? EMOTION_IDLE_MAP.neutral
    this.playIdle(emotion, idleId)
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
    const id    = idleId ?? EMOTION_IDLE_MAP[emotion] ?? 'quaternius_neutral_idle'
    const entry = this.dictionary.get(id)
    if (!entry) return

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

    const isArmGesture = ARM_GESTURE_CLIP_IDS.has(animId)
    const clip   = isArmGesture ? this._toAdditive(entry.clip) : entry.clip
    const action = this.mixer.clipAction(clip)
    action.blendMode = isArmGesture
      ? THREE.AdditiveAnimationBlendMode
      : THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset()
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    // Arm gestures: cap at 0.45 so shoulder-abduction deltas don't flap wildly
    this.topWeightTgt = isArmGesture ? 0.45 : 1

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer!.removeEventListener('finished', onFinished)
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
    this.pendingCues    = []
    this.wordCounter    = 0
    this.currentEmotion = 'neutral'
    this.topAction      = null
    this.outAction      = null
    this.baseAction     = null
    this.topWeightCur   = 0
    this.topWeightTgt   = 0
    this.pendingIdle    = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mixer = null
  }
}
