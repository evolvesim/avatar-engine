/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Track-Filtering architecture (0.3.52):
 *
 *   BASE layer  — avaturn_animation (morph tracks stripped), weight=1 ALWAYS.
 *                 Drives hips/legs/feet (lower body only after track filter).
 *                 NEVER faded, NEVER stopped.
 *
 *   TOP layer   — emotion idle OR gesture clip.
 *                 Idles:    UPPER_BODY_ONLY filtered version (spine/arms/neck/head).
 *                           These were authored for T-pose but track-filtered so they
 *                           own the upper body exclusively — no SLERP averaging with base.
 *                 Gestures: UPPER_BODY_ONLY filtered version. Same clip, lower-body
 *                           tracks stripped so legs continue from base idle.
 *
 *   OUT layer   — previous top action fading weight 1→0 then stopped.
 *
 * Why track filtering fixes the T-pose / flapping arm problem:
 *   When two NormalBlend actions BOTH have a track for the same bone, Three.js
 *   normalises them: each contributes weight/(weight_a+weight_b). With base=1 and
 *   top=1 on the SAME arm bone the result is the average (halfway between T-pose
 *   and rest) = 45° flap. With track filtering, idles/gestures OWN the upper body
 *   exclusively and the base owns the lower body exclusively → zero averaging,
 *   zero T-pose bleed, elbows articulate correctly.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Bone masks ────────────────────────────────────────────────────────────────

/**
 * Upper-body bone name fragments. Any track whose name matches one of these
 * (case-insensitive) is kept in the upper-body filtered clip and removed from
 * the lower-body base.
 *
 * Matches Avaturn / Mixamo bone naming: Spine, Spine1, Spine2, Neck, Head,
 * LeftShoulder, RightShoulder, LeftArm, RightArm, LeftForeArm, RightForeArm,
 * LeftHand, RightHand, and all finger bones.
 */
const UPPER_BODY_RE = /Spine|Neck|Head|Shoulder|Arm|ForeArm|Hand|Finger|Thumb|Index|Middle|Ring|Pinky/i

/**
 * Return a version of clip containing ONLY upper-body tracks.
 * Results are cached per clip name.
 */
const upperBodyCache = new Map<string, THREE.AnimationClip>()
function upperBodyOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cached = upperBodyCache.get(clip.name)
  if (cached) return cached

  const filtered = new THREE.AnimationClip(
    clip.name + '__upper',
    clip.duration,
    clip.tracks.filter(t => UPPER_BODY_RE.test(t.name))
  )
  upperBodyCache.set(clip.name, filtered)
  return filtered
}

/**
 * Return a version of clip containing ONLY lower-body tracks (everything NOT
 * matching UPPER_BODY_RE, e.g. Hips, LeftUpLeg, RightUpLeg, LeftLeg, etc.).
 */
const lowerBodyCache = new Map<string, THREE.AnimationClip>()
function lowerBodyOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cached = lowerBodyCache.get(clip.name)
  if (cached) return cached

  const filtered = new THREE.AnimationClip(
    clip.name + '__lower',
    clip.duration,
    clip.tracks.filter(t => !UPPER_BODY_RE.test(t.name))
  )
  lowerBodyCache.set(clip.name, filtered)
  return filtered
}

// ── Emotion → idle animation pools ───────────────────────────────────────────
const EMOTION_IDLE_POOLS: Record<EmotionId, string[]> = {
  neutral: [
    'quaternius_neutral_idle',
    'mesh2motion_neutral_weight_shift',
    'evolve_listening_interested_lean',
    'mixamo_neutral_looking_around',
  ],
  joy: [
    'evolve_empathy_gentle_nod',
    'mixamo_neutral_thoughtful_nod',
    'quaternius_neutral_idle',
  ],
  anger: [
    'mesh2motion_neutral_weight_shift',
    'quaternius_neutral_idle',
  ],
  sadness: [
    'evolve_sadness_resigned_sigh',
    'quaternius_neutral_idle',
  ],
  surprise: [
    'mixamo_neutral_looking_around',
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
    'mixamo_empathy_leaning_forward',
    'evolve_empathy_gentle_nod',
    'evolve_listening_interested_lean',
  ],
  concentration: [
    'mixamo_neutral_looking_around',
    'mixamo_neutral_thoughtful_nod',
    'evolve_idle_look_down_notes',
  ],
  confusion: [
    'evolve_confusion_double_head_tilt',
    'mixamo_neutral_looking_around',
    'quaternius_neutral_idle',
  ],
}

export class SkeletalController {
  private mixer:      THREE.AnimationMixer | null = null
  /** avaturn_animation lower-body-only — permanent base, weight=1, NEVER faded */
  private baseAction: THREE.AnimationAction | null = null
  private topAction:  THREE.AnimationAction | null = null
  private outAction:  THREE.AnimationAction | null = null
  private topWeightTgt: number = 0
  private topWeightCur: number = 0

  private dictionary:        AnimationDictionary
  private pendingCues:       GestureCue[] = []
  private wordCounter:       number       = 0
  private currentEmotion:    EmotionId    = 'neutral'
  private currentIdleClipId: string       = ''
  private idlePoolTimer:     number       = 0
  private idlePoolInterval:  number       = 10
  private isInGesture:       boolean      = false
  private pendingIdle:       boolean      = false
  private pendingIdleFrames  = 0
  private diagnosticFrame    = 0

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(avatarRoot)
    console.log('[SkeletalController] init —', avatarRoot.name || '(unnamed)')

    // Start avaturn_animation lower-body-only as permanent base layer.
    // Strip morph tracks + upper body tracks so:
    //   1. avaturn baseline face values don't bleed through emotion presets
    //   2. base has zero overlap with top layer → no SLERP averaging on arm bones
    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      // First strip morph tracks
      const noMorph = new THREE.AnimationClip(
        raw.name,
        raw.duration,
        raw.tracks.filter(
          t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
        )
      )
      // Then filter to lower body only
      const lowerClip = lowerBodyOnly(noMorph)

      console.log('[SkeletalController] base lower-body tracks:', lowerClip.tracks.length,
        lowerClip.tracks.map(t => t.name.split('.')[0]).join(', '))

      const base = this.mixer.clipAction(lowerClip)
      base.blendMode        = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation (lower body only)')
    } else {
      console.warn('[SkeletalController] avaturn_animation not found. Available:', clips?.map(c => c.name))
    }

    this.pendingIdle = true
    this._tryStartIdle()
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  update(delta: number): void {
    // Retry idle start until dict is ready
    if (this.pendingIdle) {
      this._tryStartIdle()
      if (++this.pendingIdleFrames === 120) {
        const pool = EMOTION_IDLE_POOLS[this.currentEmotion] ?? EMOTION_IDLE_POOLS.neutral
        console.warn('[SkeletalController] pendingIdle after 120 frames — dict missing:', pool[0])
      }
    } else {
      this.pendingIdleFrames = 0
    }

    // Idle pool cycling (only when settled, not mid-gesture)
    if (!this.isInGesture && !this.pendingIdle && this.topWeightCur >= 0.99) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer    = 0
        this.idlePoolInterval = 8 + Math.random() * 7
        const next = this._pickNextIdle(this.currentEmotion)
        if (next !== this.currentIdleClipId) this.playIdle(this.currentEmotion, next)
      }
    }

    // Lerp top layer weight in
    if (this.topAction && this.topWeightCur < this.topWeightTgt) {
      this.topWeightCur = Math.min(this.topWeightTgt, this.topWeightCur + delta * 4)
      this.topAction.setEffectiveWeight(this.topWeightCur)
    }

    // Lerp out action weight down, then stop
    if (this.outAction) {
      const next = Math.max(0, this.outAction.getEffectiveWeight() - delta * 4)
      this.outAction.setEffectiveWeight(next)
      if (next === 0) { this.outAction.stop(); this.outAction = null }
    }

    this.mixer?.update(delta)

    // Frame-10 diagnostic
    if (++this.diagnosticFrame === 10) {
      console.log('[SkeletalController] frame-10', {
        base: this.baseAction
          ? `w=${this.baseAction.getEffectiveWeight()} running=${this.baseAction.isRunning()}`
          : 'MISSING',
        top:  this.topAction
          ? `w=${this.topAction.getEffectiveWeight()}  running=${this.topAction.isRunning()}`
          : 'none',
        idle: this.currentIdleClipId,
        gesture: this.isInGesture,
      })
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) return  // not ready yet — retry next frame

    console.log('[SkeletalController] idle started:', id)
    this.pendingIdle       = false
    this.currentIdleClipId = id
    this.isInGesture       = false

    // Upper-body-only version — base owns lower body, top owns upper body
    const clip   = upperBodyOnly(entry.clip)
    console.log('[SkeletalController] idle upper-body tracks:', clip.tracks.length,
      clip.tracks.map(t => t.name.split('.')[0]).join(', '))

    const action = this.mixer.clipAction(clip)
    action.blendMode        = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0
  }

  private _pickNextIdle(emotion: EmotionId): string {
    const pool = EMOTION_IDLE_POOLS[emotion] ?? EMOTION_IDLE_POOLS.neutral
    if (pool.length === 1) return pool[0]
    const candidates = pool.filter(id => id !== this.currentIdleClipId)
    return candidates[Math.floor(Math.random() * candidates.length)]
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
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    // Upper-body-only — no overlap with base lower-body layer
    const clip   = upperBodyOnly(entry.clip)
    const action = this.mixer.clipAction(clip)
    action.blendMode        = THREE.NormalAnimationBlendMode
    action.setLoop(entry.loop, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0
  }

  private playGesture(animId: string, _crossfadeDuration: number): void {
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

    // Upper-body-only gesture — base continues driving lower body throughout
    // No need to zero base weight — base has NO upper-body tracks → zero overlap
    const clip   = upperBodyOnly(entry.clip)
    const action = this.mixer.clipAction(clip)
    action.blendMode        = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset()
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer!.removeEventListener('finished', onFinished)

      action.setEffectiveWeight(0)
      action.stop()
      if (this.outAction === action) this.outAction = null
      if (this.topAction === action) this.topAction = null

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
    if (!this.isInGesture) this.playIdle(emotion)
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
    this.pendingIdle       = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.mixer = null
  }
}
