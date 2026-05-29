/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Architecture (0.3.56 — DIAGNOSTIC BUILD):
 *
 *   BASE layer  — avaturn_animation (morph tracks stripped), weight=1 ALWAYS.
 *                 Full body including arms — drives natural rest arm pose.
 *                 NEVER faded, NEVER stopped, NEVER zeroed — not even during gestures.
 *
 *   TOP layer (idle + gesture) — entry.clip used DIRECTLY, NO filtering.
 *                 Clips in animations.glb already contain only spine/head tracks.
 *                 Since clips have no arm tracks, base exclusively owns arm bones.
 *
 *   OUT layer   — previous top action fading weight 1→0 then stopped.
 *
 * 0.3.56 adds heavy console diagnostics to identify why arms T-pose:
 *   - Full track list logged for every clip played (idle + gesture)
 *   - Arm bone quaternions at frame 10, 60, 120
 *   - All active mixer actions + weights at frame 10
 *   - avaturn_animation frame-0 keyframe values for LeftArm + RightArm
 *   - Three.js normalisation analysis: which bones have >1 driver
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Arm bone names to watch ───────────────────────────────────────────────────
const ARM_BONES = [
  'LeftShoulder', 'RightShoulder',
  'LeftArm',      'RightArm',
  'LeftForeArm',  'RightForeArm',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Log all track names in a clip, flagging any arm tracks */
function logClipTracks(label: string, clip: THREE.AnimationClip): void {
  const allBones = [...new Set(clip.tracks.map(t => t.name.split('.')[0]))]
  const armTracks = clip.tracks.filter(t => /Shoulder|Arm|ForeArm|Hand/i.test(t.name))
  console.log(
    `[Clip] ${label} "${clip.name}": ${clip.tracks.length} tracks, dur=${clip.duration.toFixed(2)}s`,
    '\n  bones:', allBones.join(', '),
    armTracks.length > 0
      ? `\n  ⚠️ ARM TRACKS (${armTracks.length}): ${armTracks.map(t => t.name).join(', ')}`
      : '\n  ✅ no arm tracks'
  )
}

/** Log arm bone world quaternions from the scene */
function logArmBoneQuats(label: string, root: THREE.Object3D): void {
  const lines: string[] = []
  root.traverse((obj) => {
    if (ARM_BONES.includes(obj.name)) {
      const q = obj.quaternion
      lines.push(`  ${obj.name}: [${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)}]`)
    }
  })
  if (lines.length === 0) {
    console.warn(`[ArmBones] ${label}: none of the expected arm bones found in scene graph`)
  } else {
    console.log(`[ArmBones] ${label}:\n${lines.join('\n')}`)
  }
}

/** Log frame-0 keyframe values for arm bones from avaturn_animation */
function logBaseClipArmKeyframes(clip: THREE.AnimationClip): void {
  const armTracks = clip.tracks.filter(t => /Shoulder|Arm|ForeArm/.test(t.name) && t.name.includes('.quaternion'))
  if (armTracks.length === 0) {
    console.warn('[BaseClip] No arm quaternion tracks found in avaturn_animation!')
    console.log('[BaseClip] All track names:', clip.tracks.map(t => t.name).join(', '))
    return
  }
  console.log(`[BaseClip] avaturn_animation arm quaternion tracks (frame-0 values):`)
  for (const track of armTracks) {
    const vals = (track as THREE.QuaternionKeyframeTrack).values
    if (vals && vals.length >= 4) {
      console.log(`  ${track.name.split('.')[0]}: [${vals[0].toFixed(3)}, ${vals[1].toFixed(3)}, ${vals[2].toFixed(3)}, ${vals[3].toFixed(3)}]`)
    }
  }
}

/** Analyse all active mixer actions and which bones they compete on */
function logMixerState(label: string, mixer: THREE.AnimationMixer): void {
  // Access internal _actions array (undocumented but stable in Three.js r150+)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: THREE.AnimationAction[] = (mixer as any)._actions ?? []
  console.log(`[Mixer] ${label}: ${actions.length} active action(s)`)
  for (const action of actions) {
    const clip = action.getClip()
    const bones = [...new Set(clip.tracks.map((t: THREE.KeyframeTrack) => t.name.split('.')[0]))]
    const armBones = bones.filter(b => /Shoulder|Arm|ForeArm|Hand/i.test(b))
    console.log(
      `  action "${clip.name}": w=${action.getEffectiveWeight().toFixed(3)} running=${action.isRunning()} enabled=${action.enabled}`,
      `\n    bones (${bones.length}):`, bones.join(', '),
      armBones.length > 0 ? `\n    ⚠️ arm bones: ${armBones.join(', ')}` : '\n    ✅ no arm bones'
    )
  }

  // Check for arm bone competition (>1 action driving same bone)
  const boneCounts: Record<string, number> = {}
  for (const action of actions) {
    if (!action.isRunning()) continue
    for (const track of action.getClip().tracks) {
      const bone = track.name.split('.')[0]
      boneCounts[bone] = (boneCounts[bone] ?? 0) + 1
    }
  }
  const competing = Object.entries(boneCounts).filter(([, c]) => c > 1)
  if (competing.length > 0) {
    console.warn(`[Mixer] ⚠️ BONE COMPETITION (${competing.length} bones driven by >1 action):`,
      competing.map(([b, c]) => `${b}×${c}`).join(', '))
  } else {
    console.log(`[Mixer] ✅ No bone competition — each bone driven by at most 1 action`)
  }
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

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init —', avatarRoot.name || '(unnamed)')
    console.log('[SkeletalController] clips provided:', clips?.length ?? 0, clips?.map(c => c.name))

    // Log scene bone structure
    const boneNames: string[] = []
    avatarRoot.traverse(obj => { if (obj.name) boneNames.push(obj.name) })
    const armBonesFound = boneNames.filter(n => /Shoulder|^Left|^Right|Arm|ForeArm/.test(n))
    console.log('[SkeletalController] arm bones in scene:', armBonesFound.join(', ') || 'NONE FOUND')

    // Base layer: full avaturn_animation with morph tracks stripped.
    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      console.log(`[SkeletalController] avaturn_animation found: ${raw.tracks.length} raw tracks`)

      // Log arm keyframes from raw clip before stripping
      logBaseClipArmKeyframes(raw)

      const stripped = new THREE.AnimationClip(
        raw.name,
        raw.duration,
        raw.tracks.filter(
          t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
        )
      )

      const armTracks = stripped.tracks.filter(t => /Arm|Shoulder/.test(t.name))
      console.log(
        '[SkeletalController] base stripped tracks:', stripped.tracks.length,
        '\n  arm tracks:', armTracks.map(t => t.name).join(', ') || 'NONE — arms will T-pose!'
      )

      const base = this.mixer.clipAction(stripped)
      base.blendMode        = THREE.NormalAnimationBlendMode
      base.setLoop(THREE.LoopRepeat, Infinity)
      base.clampWhenFinished = false
      base.setEffectiveWeight(1)
      base.play()
      this.baseAction = base
      console.log('[SkeletalController] base layer started: avaturn_animation weight=1')
    } else {
      console.warn('[SkeletalController] ❌ avaturn_animation NOT FOUND — arms will T-pose!')
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

    this.diagnosticFrame++

    // Frame 10: mixer state + arm bone quaternions
    if (this.diagnosticFrame === 10) {
      console.log('[SkeletalController] ── FRAME 10 DIAGNOSTIC ──────────────────────')
      console.log('[SkeletalController] base:', this.baseAction
        ? `w=${this.baseAction.getEffectiveWeight().toFixed(3)} running=${this.baseAction.isRunning()} enabled=${this.baseAction.enabled}`
        : '❌ MISSING')
      console.log('[SkeletalController] top:', this.topAction
        ? `w=${this.topAction.getEffectiveWeight().toFixed(3)} clip="${this.topAction.getClip().name}" running=${this.topAction.isRunning()}`
        : 'none')
      console.log('[SkeletalController] out:', this.outAction
        ? `w=${this.outAction.getEffectiveWeight().toFixed(3)} clip="${this.outAction.getClip().name}"`
        : 'none')
      console.log('[SkeletalController] state: idle=' + this.currentIdleClipId + ' gesture=' + this.isInGesture)
      if (this.mixer) logMixerState('frame-10', this.mixer)
      if (this.avatarRoot) logArmBoneQuats('frame-10 (after mixer.update)', this.avatarRoot)
    }

    // Frame 60: arm bones again (after top action has ramped up)
    if (this.diagnosticFrame === 60) {
      console.log('[SkeletalController] ── FRAME 60 DIAGNOSTIC ──────────────────────')
      if (this.mixer) logMixerState('frame-60', this.mixer)
      if (this.avatarRoot) logArmBoneQuats('frame-60', this.avatarRoot)
    }

    // Frame 120: check if arms have stabilised
    if (this.diagnosticFrame === 120) {
      console.log('[SkeletalController] ── FRAME 120 DIAGNOSTIC ─────────────────────')
      if (this.mixer) logMixerState('frame-120', this.mixer)
      if (this.avatarRoot) logArmBoneQuats('frame-120', this.avatarRoot)
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) return

    console.log('[SkeletalController] idle started:', id)
    logClipTracks('IDLE', entry.clip)

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
    logClipTracks('IDLE-SWITCH', entry.clip)

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
    logClipTracks('GESTURE', entry.clip)
    console.log('[SkeletalController] base weight at gesture start:',
      this.baseAction?.getEffectiveWeight().toFixed(3) ?? 'NO BASE')

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    this.isInGesture   = true
    this.idlePoolTimer = 0

    // Base stays at weight=1 — never touched, never zeroed.
    // Clips have only spine/head tracks; base exclusively owns arm bones throughout.
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
