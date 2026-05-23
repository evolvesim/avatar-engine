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

export class SkeletalController {
  private mixer:         THREE.AnimationMixer | null = null
  private currentAction: THREE.AnimationAction | null = null
  private dictionary:    AnimationDictionary
  private pendingCues:   GestureCue[] = []
  private wordCounter:   number = 0
  private currentEmotion: EmotionId = 'neutral'
  private pendingIdle:   boolean = false

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Initialise with a scene object ─────────────────────────────────────────

  /**
   * Bind the mixer to the avatar's root scene object.
   * Call this once after the GLB has loaded.
   */
  init(avatarRoot: THREE.Object3D): void {
    this.mixer = new THREE.AnimationMixer(avatarRoot)
    this.pendingIdle = true
    this._tryStartIdle()
  }

  /**
   * Must be called every frame from the useFrame loop.
   * @param delta  Seconds since last frame (from R3F useFrame state)
   */
  update(delta: number): void {
    // AnimationDictionary loads async; retry idle each frame until ready.
    if (this.pendingIdle) this._tryStartIdle()
    this.mixer?.update(delta)
  }

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id    = EMOTION_IDLE_MAP[this.currentEmotion] ?? 'quaternius_neutral_idle'
    const entry = this.dictionary.get(id)
    if (!entry) return

    this.pendingIdle = false
    const action = this.mixer.clipAction(entry.clip)
    action.setLoop(entry.loop, Infinity)
    action.clampWhenFinished = false
    action.play()
    this.currentAction = action
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

  private playIdle(emotion: EmotionId, idleId?: string): void {
    if (!this.mixer) return
    const id    = idleId ?? EMOTION_IDLE_MAP[emotion] ?? 'quaternius_neutral_idle'
    const entry = this.dictionary.get(id)
    if (!entry) {
      // Dictionary not loaded yet or clip not found — no-op (graceful)
      return
    }

    const action = this.mixer.clipAction(entry.clip)
    action.setLoop(entry.loop, Infinity)
    action.clampWhenFinished = false

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, entry.defaultCrossfade, true)
      action.play()
    } else if (!this.currentAction) {
      action.play()
    }
    this.currentAction = action
  }

  private playGesture(animId: string, crossfadeDuration: number): void {
    if (!this.mixer) return
    const entry = this.dictionary.get(animId)
    if (!entry) {
      console.warn(`[SkeletalController] Animation "${animId}" not found in dictionary`)
      return
    }

    const action = this.mixer.clipAction(entry.clip)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset()

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, crossfadeDuration, true)
    }
    action.play()
    this.currentAction = action

    // When gesture finishes, return to emotion-appropriate idle
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
    this.pendingCues  = []
    this.wordCounter  = 0
    this.currentEmotion = 'neutral'
    this.currentAction  = null
    this.pendingIdle    = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mixer = null
  }
}
