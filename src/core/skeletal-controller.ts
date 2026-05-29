/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Architecture (0.3.58 — additive gestures referenced against avaturn base):
 *
 *   BASE layer  — avaturn_animation (morph tracks stripped), weight=1 ALWAYS.
 *                 Full body including arms — drives natural rest arm pose.
 *                 NEVER faded, NEVER stopped. Arms stay in avaturn rest pose at all times.
 *
 *   IDLE TOP layer — idle clips (head/spine only) at NormalBlend weight=1.
 *                 No arm tracks → base owns arms during idle. No competition.
 *
 *   GESTURE TOP layer — gesture clips converted to ADDITIVE using avaturn_animation
 *                 as the reference pose. Deltas = gesture_absolute - avaturn_rest.
 *                 Applied ON TOP of base: result = base_pose + delta = exact gesture pose.
 *                 Weight capped at 0.9 for smooth transitions.
 *                 When gesture ends, additive action removed → base reclaims arms.
 *
 * WHY additive with avaturn reference works (vs 0.3.10 failure):
 *   0.3.10 used makeClipAdditive(gestureClip) — reference = gesture's own frame-0 ≈ T-pose.
 *   Deltas from T-pose ≈ zero for arm bones already near T-pose → arms didn't move.
 *   0.3.58 uses makeClipAdditive(gestureClip, 0, avaturnClip) — reference = avaturn frame-0.
 *   Deltas = (gesture absolute pose) - (avaturn rest pose).
 *   When added to base (already at avaturn rest), result = intended absolute gesture pose.
 *
 * PDF Section 5 reference: Track Filtering and Sub-Skeletal Masking.
 * The base/top architecture is our equivalent of Unity Avatar Masks.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Emotion → idle animation pools ───────────────────────────────────────────
// All idle clips must be ARM-SAFE (no arm/shoulder/forearm tracks).
// Base owns arm bones; idle clips drive head/spine/neck only.
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

// ── Diagnostic helpers ────────────────────────────────────────────────────────

function logClipSummary(label: string, clip: THREE.AnimationClip): void {
  const bones = [...new Set(clip.tracks.map(t => t.name.split('.')[0]))]
  const armBones = bones.filter(b => /Shoulder|(?<![a-z])Arm(?![a-z])|ForeArm/i.test(b))
  console.log(
    `[Clip] ${label} "${clip.name}": ${clip.tracks.length} tracks, blendMode=${clip.blendMode ?? 'Normal'}`,
    `\n  bones (${bones.length}):`, bones.join(', '),
    armBones.length > 0
      ? `\n  ⚠️ arm bones: ${armBones.join(', ')}`
      : '\n  ✅ no arm tracks'
  )
}

function logArmBoneQuats(label: string, root: THREE.Object3D): void {
  const ARM_NAMES = ['LeftShoulder','RightShoulder','LeftArm','RightArm','LeftForeArm','RightForeArm']
  const lines: string[] = []
  root.traverse((obj) => {
    if (ARM_NAMES.includes(obj.name)) {
      const q = obj.quaternion
      lines.push(`  ${obj.name}: [${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)}]`)
    }
  })
  if (lines.length === 0) {
    console.warn(`[ArmBones] ${label}: no arm bones found in scene`)
  } else {
    console.log(`[ArmBones] ${label}:\n${lines.join('\n')}`)
  }
}

export class SkeletalController {
  private mixer:      THREE.AnimationMixer | null = null
  /** Full avaturn_animation (morph stripped) — weight=1, NEVER faded */
  private baseAction: THREE.AnimationAction | null = null
  /** Stored stripped base clip — used as additive reference for gesture clips */
  private baseClip:   THREE.AnimationClip  | null = null

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
  private diagnosticFrame    = 0

  /** Cache of additive-converted clips: original clip name → additive version */
  private additiveCache = new Map<string, THREE.AnimationClip>()

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init —', avatarRoot.name || '(unnamed)')
    console.log('[SkeletalController] clips provided:', clips?.length ?? 0, clips?.map(c => c.name))

    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      console.log(`[SkeletalController] avaturn_animation found: ${raw.tracks.length} raw tracks`)

      // Strip morph tracks — applyWeightsToMeshes owns the face
      // Keep ALL bone tracks including arm tracks — base drives full body
      const stripped = new THREE.AnimationClip(
        raw.name,
        raw.duration,
        raw.tracks.filter(
          t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
        )
      )
      this.baseClip = stripped

      const armTracks = stripped.tracks.filter(t => /Shoulder|Arm|ForeArm/i.test(t.name))
      console.log(
        `[SkeletalController] base: ${stripped.tracks.length} bone tracks`,
        `\n  arm tracks: ${armTracks.map(t => t.name).join(', ') || 'NONE — arms will T-pose!'}`
      )

      // Log frame-0 arm values for reference
      for (const t of armTracks.slice(0, 6)) {
        const vals = (t as THREE.QuaternionKeyframeTrack).values
        if (vals?.length >= 4) {
          console.log(`  [BaseArmQ] ${t.name.split('.')[0]}: [${vals[0].toFixed(3)}, ${vals[1].toFixed(3)}, ${vals[2].toFixed(3)}, ${vals[3].toFixed(3)}]`)
        }
      }

      const base = this.mixer.clipAction(stripped)
      base.blendMode        = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation weight=1 NormalBlend')
    } else {
      console.warn('[SkeletalController] ❌ avaturn_animation NOT FOUND — arms will T-pose!')
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

    this.diagnosticFrame++

    // Frame 10: log full state
    if (this.diagnosticFrame === 10) {
      console.log('[SkeletalController] ── FRAME 10 ──────────────────────────────')
      console.log('[SkeletalController] base:', this.baseAction
        ? `w=${this.baseAction.getEffectiveWeight().toFixed(3)} blendMode=${this.baseAction.blendMode} running=${this.baseAction.isRunning()}`
        : '❌ MISSING')
      console.log('[SkeletalController] top:', this.topAction
        ? `w=${this.topAction.getEffectiveWeight().toFixed(3)} clip="${this.topAction.getClip().name}" blendMode=${this.topAction.blendMode} running=${this.topAction.isRunning()}`
        : 'none')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allActions: THREE.AnimationAction[] = (this.mixer as any)?._actions ?? []
      console.log(`[SkeletalController] mixer._actions count: ${allActions.length}`)
      allActions.forEach(a => {
        console.log(`  "${a.getClip().name}" w=${a.getEffectiveWeight().toFixed(3)} blendMode=${a.blendMode} running=${a.isRunning()}`)
      })
      if (this.avatarRoot) logArmBoneQuats('frame-10', this.avatarRoot)
    }

    // Frame 120
    if (this.diagnosticFrame === 120) {
      console.log('[SkeletalController] ── FRAME 120 ─────────────────────────────')
      if (this.avatarRoot) logArmBoneQuats('frame-120', this.avatarRoot)
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Convert a gesture clip to additive mode referenced against the avaturn base clip.
   * makeClipAdditive(gestureClip, 0, avaturnClip) computes per-track deltas:
   *   delta[bone] = gesture[bone] - avaturn_frame0[bone]
   * When played additively on top of base (which plays avaturn_animation),
   * the result is: avaturn_pose + delta = gesture intended absolute pose.
   *
   * For idle clips (no arm tracks), there's nothing to subtract from — they're
   * played as NormalBlend and don't affect arm bones.
   */
  private _toAdditiveGesture(clip: THREE.AnimationClip): THREE.AnimationClip {
    const cached = this.additiveCache.get(clip.name)
    if (cached) return cached

    if (!this.baseClip) {
      // No base clip — can't compute additive. Fall back to normal blend.
      console.warn(`[SkeletalController] no baseClip for additive conversion of "${clip.name}" — using clip as-is`)
      return clip
    }

    // Deep-copy the gesture clip (preserve original in dictionary)
    const addClip = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(clip))
    // Compute additive deltas using avaturn_animation frame-0 as the reference pose
    THREE.AnimationUtils.makeClipAdditive(addClip, 0, this.baseClip)

    console.log(`[SkeletalController] converted "${clip.name}" to additive (ref=avaturn frame-0)`)
    const armTracks = addClip.tracks.filter(t => /Shoulder|Arm|ForeArm/i.test(t.name))
    if (armTracks.length > 0) {
      // Log first delta value for diagnosis
      const t = armTracks[0] as THREE.QuaternionKeyframeTrack
      const v = t.values
      if (v?.length >= 4) {
        console.log(`  first arm delta "${t.name.split('.')[0]}": [${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}, ${v[3].toFixed(3)}]`)
      }
    }

    this.additiveCache.set(clip.name, addClip)
    return addClip
  }

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) return

    console.log('[SkeletalController] idle started:', id)
    logClipSummary('IDLE', entry.clip)

    this.pendingIdle       = false
    this.currentIdleClipId = id
    this.isInGesture       = false

    // Idle clips: NormalBlend, no arm tracks → base owns arms
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
    logClipSummary('IDLE-SWITCH', entry.clip)

    this.currentIdleClipId = id
    this.isInGesture       = false
    this.idlePoolTimer     = 0

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    // Idle clips: NormalBlend, no arm tracks — base owns arms during idle
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
    logClipSummary('GESTURE', entry.clip)
    console.log('[SkeletalController] base weight at gesture start:',
      this.baseAction?.getEffectiveWeight().toFixed(3) ?? 'NO BASE')

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    this.isInGesture   = true
    this.idlePoolTimer = 0

    const hasArmTracks = entry.clip.tracks.some(t => /Shoulder|(?<![a-z])Arm(?![a-z])|ForeArm/i.test(t.name))

    let clip: THREE.AnimationClip
    let blendMode: THREE.AnimationBlendMode
    let maxWeight: number

    if (hasArmTracks && this.baseClip) {
      // Arm gesture: convert to additive using avaturn base as reference.
      // Additive delta = gesture_absolute - avaturn_rest → when added to base = correct gesture pose.
      clip      = this._toAdditiveGesture(entry.clip)
      blendMode = THREE.AdditiveAnimationBlendMode
      // Cap at 0.9 — smooth feel, avoids over-rotation on large gestures
      maxWeight = 0.9
      console.log(`[SkeletalController] gesture "${animId}" → ADDITIVE blend (ref=avaturn), maxW=0.9`)
    } else {
      // Head/spine-only gesture: NormalBlend, no arm competition with base
      clip      = entry.clip
      blendMode = THREE.NormalAnimationBlendMode
      maxWeight = 1.0
      console.log(`[SkeletalController] gesture "${animId}" → NORMAL blend (no arm tracks)`)
    }

    const action = this.mixer.clipAction(clip)
    action.blendMode        = blendMode
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset()
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = maxWeight

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer!.removeEventListener('finished', onFinished)

      console.log('[SkeletalController] gesture finished:', animId)
      if (this.avatarRoot) logArmBoneQuats('post-gesture', this.avatarRoot)

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
