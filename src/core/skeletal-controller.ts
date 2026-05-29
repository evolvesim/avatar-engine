/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Architecture (0.3.57 — arm-track-stripped base):
 *
 *   BASE layer  — avaturn_animation with BOTH morph tracks AND arm/shoulder/forearm
 *                 quaternion tracks stripped. Drives only body/spine/legs/hips/head.
 *                 Weight=1 ALWAYS. NEVER faded, NEVER stopped.
 *
 *                 WHY strip arm tracks from base:
 *                   avaturn_animation frame-0 LeftArm quaternion = [0.538, 0.129, -0.045, 0.832]
 *                   This is ~65° X rotation from bind pose — arms extended outward/forward.
 *                   Bind pose LeftArm ≈ identity — arms naturally at sides (A-pose).
 *                   Stripping arm tracks from base lets arms sit at bind pose (A-pose, natural).
 *                   This matches the 0.3.38 known-good state where the GLB itself had
 *                   arm tracks stripped from avaturn_animation.
 *
 *   TOP layer (idle + gesture) — entry.clip used DIRECTLY, NormalAnimationBlendMode.
 *                 • Idle clips (62 clips): head/spine/neck tracks only — no arm tracks.
 *                   Arms stay at bind pose. base + top together = correct full-body look.
 *                 • Gesture clips (50 clips): include arm tracks.
 *                   NormalBlend at weight=1 drives arms directly from bind pose reference.
 *                   Since gesture clips are authored from bind/A-pose, they look natural.
 *                   When gesture finishes, topAction stops → arms return to bind pose.
 *
 *   OUT layer   — previous top action fading weight 1→0 then stopped.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Track name filters ────────────────────────────────────────────────────────

/**
 * Track names matching this pattern are STRIPPED from the base clip.
 * This covers:
 *   - .morphTargetInfluences / .weights — emotion/viseme system owns the face
 *   - Shoulder/Arm/ForeArm .quaternion — arm tracks cause "arms out to side" bug
 *     (avaturn_animation rest pose ≠ bind pose; stripping lets bind pose own arms)
 *
 * Hand finger bones are NOT stripped — they're safe (no visible flapping issue).
 * Only the primary upper-arm chain needs stripping.
 */
function shouldStripFromBase(trackName: string): boolean {
  // Face/morph tracks
  if (trackName.includes('.morphTargetInfluences') || trackName.endsWith('.weights')) {
    return true
  }
  // Arm chain: Shoulder, Arm (but not ForeArm yet — test if needed), ForeArm
  // Match: LeftShoulder, RightShoulder, LeftArm, RightArm, LeftForeArm, RightForeArm
  // Do NOT match: LeftHand, finger bones (they're fine at bind pose with avatar_animation)
  if (/(?:Left|Right)(?:Shoulder|Arm|ForeArm)\.quaternion$/.test(trackName)) {
    return true
  }
  return false
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
  /** avaturn_animation with morph + arm tracks stripped — weight=1 ALWAYS */
  private baseAction: THREE.AnimationAction | null = null
  private topAction:  THREE.AnimationAction | null = null
  private outAction:  THREE.AnimationAction | null = null
  private topWeightTgt: number = 0
  private topWeightCur: number = 0

  private dictionary:        AnimationDictionary
  private avatarRoot:        THREE.Object3D | null = null
  private pendingCues:       GestureCue[] = []
  private wordCounter:       number       = 0
  private currentEmotion:    EmotionId    = 'neutral'
  private currentIdleClipId: string       = ''
  private idlePoolTimer:     number       = 0
  private idlePoolInterval:  number       = 10
  private isInGesture:       boolean      = false
  private pendingIdle:       boolean      = false
  private pendingIdleFrames  = 0

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init —', avatarRoot.name || '(unnamed)')
    console.log('[SkeletalController] clips provided:', clips?.length ?? 0, clips?.map(c => c.name))

    // Base layer: avaturn_animation with morph tracks AND arm tracks stripped.
    // Arm tracks stripped because avaturn_animation rest pose ≠ bind pose —
    // keeping them causes arms to appear extended outward (the "flapping" bug).
    // Without arm tracks in base, arms sit at bind pose (A-pose, natural at sides).
    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      console.log(`[SkeletalController] avaturn_animation found: ${raw.tracks.length} raw tracks`)

      const stripped = new THREE.AnimationClip(
        raw.name,
        raw.duration,
        raw.tracks.filter(t => !shouldStripFromBase(t.name))
      )

      const armTracksStripped = raw.tracks.filter(t => shouldStripFromBase(t.name)).length
      const armBoneTracksKept = stripped.tracks.filter(t => /Shoulder|Arm|ForeArm/.test(t.name)).length
      console.log(
        '[SkeletalController] base stripped tracks:', stripped.tracks.length,
        `(removed ${armTracksStripped} morph+arm tracks)`,
        `\n  remaining arm/shoulder tracks: ${armBoneTracksKept}`,
        '\n  ✅ arms will sit at bind pose (A-pose, natural at sides)'
      )

      const base = this.mixer.clipAction(stripped)
      base.blendMode        = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation weight=1 (body+spine, no arms)')
    } else {
      console.warn('[SkeletalController] ❌ avaturn_animation NOT FOUND — body animation missing!')
      console.warn('[SkeletalController] available clips:', clips?.map(c => c.name))
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

    const action = this.mixer.clipAction(entry.clip)
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

    console.log('[SkeletalController] playIdle:', id)

    this.currentIdleClipId = id
    this.isInGesture       = false
    this.idlePoolTimer     = 0

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    const action = this.mixer.clipAction(entry.clip)
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

    console.log('[SkeletalController] playGesture:', animId)

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    this.isInGesture   = true
    this.idlePoolTimer = 0

    // NormalBlend at weight=1 drives all tracks in the gesture clip directly.
    // For arm gesture clips (50 clips with Shoulder/Arm/ForeArm tracks):
    //   - base has NO arm tracks (stripped) → no competition → arm bones driven 100% by gesture
    //   - When gesture finishes, topAction stops → arms return to bind pose (A-pose, natural)
    // For head/spine gesture clips (62 clips without arm tracks):
    //   - arms stay at bind pose throughout
    const action = this.mixer.clipAction(entry.clip)
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

      console.log('[SkeletalController] gesture finished:', animId)

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
