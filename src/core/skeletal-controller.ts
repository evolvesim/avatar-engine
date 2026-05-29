/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Track-Filtering architecture (0.3.53):
 *
 *   BASE layer  — avaturn_animation (morph tracks stripped), weight=1 ALWAYS.
 *                 Full body including arms — drives natural rest arm pose.
 *                 NEVER faded, NEVER stopped, NEVER touched during idles.
 *
 *   TOP layer (idle) — HEAD_SPINE_ONLY filtered clip.
 *                 Only Spine/Spine1/Spine2/Neck/Head tracks.
 *                 Arms have NO tracks here → base 100% owns arm bones → no averaging.
 *                 Body sway/nod animations work; arms stay naturally at sides.
 *
 *   TOP layer (gesture) — UPPER_BODY filtered clip (Spine + Shoulder + Arm + Hand).
 *                 Gesture clips authored for T-pose BUT now played at weight=1 over
 *                 base weight=1. Because gesture HAS arm tracks and base also has arm
 *                 tracks, Three.js normalises them 50/50 → mid-pose.
 *                 Solution: zero base weight for the gesture duration only, restore after.
 *
 *   OUT layer   — previous top action fading weight 1→0 then stopped.
 *
 * Root cause of T-pose (all versions up to 0.3.52):
 *   Idle clips (quaternius_neutral_idle etc.) only have Spine/Spine1/Head tracks.
 *   When played as top action at weight=1, arm bones have NO top-layer driver.
 *   Three.js normalises: base_arm_weight / (base + top) = 1/2 if top action exists
 *   even though top has no arm track? No — actually Three.js only normalises bones
 *   that HAVE competing tracks. Arm bones with only base driving them should be fine.
 *
 *   REAL cause: avaturn_animation was being filtered to lower-body-only in 0.3.52,
 *   stripping the arm tracks from the base. Then idle top = 3 tracks (no arms) and
 *   base = 0 arm tracks → no driver → bind pose T-pose.
 *
 * Correct architecture:
 *   - Base = full avaturn_animation (arms intact). Arms always have a driver.
 *   - Idle top = HEAD_SPINE_ONLY (no arm tracks → base wins arms, no averaging).
 *   - Gesture top = upper body clip, base weight zeroed during gesture, restored after.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Track filters ─────────────────────────────────────────────────────────────

/**
 * HEAD_SPINE_ONLY: only keep tracks for Spine, Spine1, Spine2, Neck, Head.
 * Everything else (Shoulder, Arm, ForeArm, Hand, Hips, Leg…) is stripped.
 * Applied to idle clips so base layer exclusively drives arm bones.
 */
const HEAD_SPINE_RE = /^(Spine\d?|Neck|Head)\./i

const headSpineCache = new Map<string, THREE.AnimationClip>()
function headSpineOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cached = headSpineCache.get(clip.name)
  if (cached) return cached

  const tracks = clip.tracks.filter(t => HEAD_SPINE_RE.test(t.name))
  const filtered = new THREE.AnimationClip(clip.name + '__headspine', clip.duration, tracks)
  headSpineCache.set(clip.name, filtered)

  console.log(`[trackFilter] headSpineOnly "${clip.name}": ${tracks.length} tracks`,
    tracks.map(t => t.name.split('.')[0]).join(', '))
  return filtered
}

/**
 * UPPER_BODY_ONLY: keep Spine + Shoulder + Arm + ForeArm + Hand + Neck + Head.
 * Applied to gesture clips. Used when base is zeroed so gestures drive arms exclusively.
 */
const UPPER_BODY_RE = /Spine|Neck|Head|Shoulder|Arm|ForeArm|Hand|Finger|Thumb|Index|Middle|Ring|Pinky/i

const upperBodyCache = new Map<string, THREE.AnimationClip>()
function upperBodyOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cached = upperBodyCache.get(clip.name)
  if (cached) return cached

  const tracks = clip.tracks.filter(t => UPPER_BODY_RE.test(t.name))
  const filtered = new THREE.AnimationClip(clip.name + '__upper', clip.duration, tracks)
  upperBodyCache.set(clip.name, filtered)

  console.log(`[trackFilter] upperBodyOnly "${clip.name}": ${tracks.length} tracks`)
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
  /** avaturn_animation full body (morph stripped) — weight=1, NEVER faded during idle */
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

    // Base layer: full avaturn_animation with morph tracks stripped.
    // Full body (including arms) so arms always have a driver at rest pose.
    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      const stripped = new THREE.AnimationClip(
        raw.name,
        raw.duration,
        raw.tracks.filter(
          t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
        )
      )
      console.log('[SkeletalController] base tracks:', stripped.tracks.length,
        '— arm tracks:', stripped.tracks.filter(t => /Arm|Shoulder/.test(t.name)).map(t => t.name.split('.')[0]).join(', '))

      const base = this.mixer.clipAction(stripped)
      base.blendMode        = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation (full body, morph stripped)')
    } else {
      console.warn('[SkeletalController] avaturn_animation not found — arms will T-pose. Available:', clips?.map(c => c.name))
    }

    this.pendingIdle = true
    this._tryStartIdle()
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.pendingIdle) {
      this._tryStartIdle()
      if (++this.pendingIdleFrames === 120) {
        const pool = EMOTION_IDLE_POOLS[this.currentEmotion] ?? EMOTION_IDLE_POOLS.neutral
        console.warn('[SkeletalController] pendingIdle after 120 frames — dict missing:', pool[0])
      }
    } else {
      this.pendingIdleFrames = 0
    }

    if (!this.isInGesture && !this.pendingIdle && this.topWeightCur >= 0.99) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer    = 0
        this.idlePoolInterval = 8 + Math.random() * 7
        const next = this._pickNextIdle(this.currentEmotion)
        if (next !== this.currentIdleClipId) this.playIdle(this.currentEmotion, next)
      }
    }

    if (this.topAction && this.topWeightCur < this.topWeightTgt) {
      this.topWeightCur = Math.min(this.topWeightTgt, this.topWeightCur + delta * 4)
      this.topAction.setEffectiveWeight(this.topWeightCur)
    }

    if (this.outAction) {
      const next = Math.max(0, this.outAction.getEffectiveWeight() - delta * 4)
      this.outAction.setEffectiveWeight(next)
      if (next === 0) { this.outAction.stop(); this.outAction = null }
    }

    this.mixer?.update(delta)

    if (++this.diagnosticFrame === 10) {
      console.log('[SkeletalController] frame-10', {
        base: this.baseAction
          ? `w=${this.baseAction.getEffectiveWeight()} running=${this.baseAction.isRunning()}`
          : 'MISSING',
        top: this.topAction
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
    if (!entry) return

    console.log('[SkeletalController] idle started:', id)
    this.pendingIdle       = false
    this.currentIdleClipId = id
    this.isInGesture       = false

    // HEAD_SPINE_ONLY: strip arm/shoulder/hand tracks from idle.
    // Base layer owns arm bones at rest — no competition, no averaging.
    const clip   = headSpineOnly(entry.clip)
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

    // Ensure base is at full weight when returning to idle
    if (this.baseAction) this.baseAction.setEffectiveWeight(1)

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    const clip   = headSpineOnly(entry.clip)
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

    // Zero base so gesture has exclusive control of arm bones.
    // Gesture clip authored for T-pose: with base at w=1, Three.js averages
    // avaturn-rest-arms and T-pose-arms → 45° flap. Zeroing base eliminates this.
    if (this.baseAction) this.baseAction.setEffectiveWeight(0)

    // Upper-body-only gesture (strips leg/hips tracks — legs hold last pose via clamp)
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

      // Restore base weight before returning to idle
      if (this.baseAction) this.baseAction.setEffectiveWeight(1)

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
