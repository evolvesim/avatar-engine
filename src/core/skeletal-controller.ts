/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Two-action mixer architecture:
 *
 *   BASE layer  — avaturn_animation (morph tracks stripped), weight=1 ALWAYS.
 *                 Drives all 53 body bones including arms, hips, spine.
 *                 NEVER faded, NEVER stopped. Arms stay in natural rest pose.
 *
 *   TOP layer   — emotion idle OR gesture clip, NormalBlend, weight lerps 0→1.
 *                 ARM_SAFE idle clips (head/spine only): base still owns arms.
 *                 ARM_GESTURE clips (full body): top drives arms during gesture,
 *                 then fades out → base reclaims arms back to rest automatically.
 *
 *   OUT layer   — previous top action fading weight 1→0 then stopped.
 *
 * Why Normal blend (not Additive) for gestures:
 *   Gesture clips in animations.glb were authored against bind pose
 *   (LeftArm ≈ identity quaternion). avaturn_animation frame-0 has large
 *   shoulder/arm quaternions. makeClipAdditive(gesture, 0, avaturn) subtracts
 *   those large values → produces large negative deltas → arms flap sideways.
 *   Normal blend sidesteps this: gesture drives bones directly as authored,
 *   base reclaims them cleanly when the gesture finishes.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Emotion → idle animation pools ───────────────────────────────────────────
// All clips here are ARM_SAFE (head/spine/neck tracks only — no arm tracks).
// The base action permanently drives arm bones; adding arm clips here would
// cause competition between top and base → T-pose flicker during transitions.
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
  /** avaturn_animation — permanent base, weight=1, NEVER faded */
  private baseAction: THREE.AnimationAction | null = null
  /** stripped avaturn_animation clip (stored for diagnostics) */
  private baseClip:   THREE.AnimationClip  | null = null
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
  /** Cache of arm-rest-patched clips — each clip is patched at most once */
  private armRestPatchCache: Map<string, THREE.AnimationClip> = new Map()

  // avaturn_animation frame-0 arm/shoulder quaternions — the natural rest position
  // for acts-guide.glb. Injected as constant tracks into ANY clip that lacks
  // these bones, so arms always show natural rest pose regardless of base layer.
  //
  // LeftShoulder Z≈90° (horizontal) + LeftArm X≈66° (arm bent down from shoulder)
  // = natural hanging arm position. Without LeftArm the arm stays at T-pose even
  // though shoulder is correct.
  private static readonly ARM_REST: Record<string, [number,number,number,number]> = {
    LeftShoulder:  [ 0.584305,  0.466298, -0.531432,  0.398415],
    RightShoulder: [-0.598519,  0.471551, -0.527063, -0.376324],
    LeftArm:       [ 0.537788,  0.128641, -0.045315,  0.831975],
    RightArm:      [ 0.522803, -0.096794,  0.055773,  0.845102],
    LeftForeArm:   [ 0.027497,  0.023706,  0.148167,  0.988296],
    RightForeArm:  [ 0.014204,  0.006028, -0.169052,  0.985486],
  }

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  /**
   * Return a version of the clip that is guaranteed to have all arm and shoulder
   * rotation tracks (LeftShoulder, RightShoulder, LeftArm, RightArm, LeftForeArm,
   * RightForeArm). If the clip already has a track, it is left untouched. Missing
   * tracks are injected as constant QuaternionKeyframeTracks at the avaturn_animation
   * frame-0 rest values, so arms always render at natural rest pose regardless of
   * whether the base layer is active.
   *
   * Applied to EVERY clip (both idles and gestures) before playback.
   * Results are cached — each clip is only deep-copied once.
   */
  private _ensureArmRestTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
    const cached = this.armRestPatchCache.get(clip.name)
    if (cached) return cached

    const BONES = Object.keys(SkeletalController.ARM_REST)
    const missing = BONES.filter(
      bone => !clip.tracks.some(t => t.name === bone + '.quaternion' || t.name === bone + '.rotation')
    )

    if (missing.length === 0) {
      // Clip already has all arm tracks — cache and return as-is
      this.armRestPatchCache.set(clip.name, clip)
      return clip
    }

    // Deep-copy so we don't mutate the dictionary entry
    const patched = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(clip))
    patched.name  = clip.name + '__armPatched'

    const times = new Float32Array([0, patched.duration])

    for (const bone of missing) {
      const q = SkeletalController.ARM_REST[bone]
      const values = new Float32Array([q[0],q[1],q[2],q[3], q[0],q[1],q[2],q[3]])
      patched.tracks.push(new THREE.QuaternionKeyframeTrack(bone + '.quaternion', times, values))
    }

    this.armRestPatchCache.set(clip.name, patched)
    return patched
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(avatarRoot)
    console.log('[SkeletalController] init —', avatarRoot.name || '(unnamed)')

    // Start avaturn_animation as permanent base layer.
    // Strip morph tracks so the avaturn baseline face values (brow, squint etc.)
    // don't bleed through emotion presets every frame.
    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      const stripped = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(raw))
      stripped.tracks = stripped.tracks.filter(
        t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
      )
      this.baseClip = stripped

      const base = this.mixer.clipAction(stripped)
      base.blendMode       = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation')
    } else {
      console.warn('[SkeletalController] avaturn_animation not found — arms may T-pose. Available:', clips?.map(c => c.name))
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
        base: this.baseAction ? `w=${this.baseAction.getEffectiveWeight()} running=${this.baseAction.isRunning()}` : 'MISSING',
        top:  this.topAction  ? `w=${this.topAction.getEffectiveWeight()}  running=${this.topAction.isRunning()}` : 'none',
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

    // Ensure all arm/shoulder bones are covered even if this idle clip
    // only has head/spine tracks — prevents T-pose when top action wins
    const clip = this._ensureArmRestTracks(entry.clip)
    const action = this.mixer.clipAction(clip)
    action.blendMode       = THREE.NormalAnimationBlendMode
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

    // Ensure all arm/shoulder bones are covered — same as _tryStartIdle
    const clip = this._ensureArmRestTracks(entry.clip)
    const action = this.mixer.clipAction(clip)
    action.blendMode       = THREE.NormalAnimationBlendMode
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

    // Drop base weight to 0 so gesture has EXCLUSIVE control of all bones.
    // With two NormalBlend actions at weight=1, Three.js normalises each bone
    // to 0.5 each — averaging T-pose shoulders (bind) with avaturn rest = 45°
    // flap. Zero the base weight; restore it after gesture finishes.
    if (this.baseAction) {
      this.baseAction.setEffectiveWeight(0)
    }

    // Ensure all arm/shoulder rest tracks are present. Gesture clips that already
    // have their own arm movement keep it; only missing bones get the rest constant.
    const clip = this._ensureArmRestTracks(entry.clip)

    const action = this.mixer.clipAction(clip)
    action.blendMode       = THREE.NormalAnimationBlendMode
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

      // Hard-stop the gesture immediately — don't fade as outAction.
      // Clamped gesture + base both driving arms = normalised average = T-pose.
      action.setEffectiveWeight(0)
      action.stop()
      if (this.outAction === action) this.outAction = null
      if (this.topAction === action) this.topAction = null

      // Restore base then return to idle
      if (this.baseAction) {
        this.baseAction.setEffectiveWeight(1)
      }
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
