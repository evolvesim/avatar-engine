/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Architecture (0.3.64 — smooth arm return via clamp+fade overlap):
 *
 *   FIX 6 — Arm snap on gesture end (0.3.64):
 *     All gesture clips are single-frame static poses. With clampWhenFinished=false
 *     (0.3.62), Three.js released arm PropertyMixers the instant LoopOnce ended.
 *     Arms had no driver for the entire fadeOut window while base-full ramped back
 *     from 0 → snap to bind pose.
 *     Fix: clampWhenFinished=true for arm gestures. The clamp holds the final pose
 *     while fadeOut(0.6s) runs. base-full simultaneously ramps 0→1 via playIdle().
 *     Both actions drive arm bones together: gesture fades 1→0, base grows 0→1 —
 *     smooth interpolation from gesture pose to rest. No driver gap at any point.
 *     Head/spine gestures retain clampWhenFinished=false with 0.25s fade (safe).
 *
 * Architecture (0.3.62 — UUID binding + full arm mask + de-clamping):
 *
 *   FIX 1 — UUID binding (Strategic Fix 1 from deep research):
 *     All gesture/idle clip tracks are retargeted from string names (e.g. "LeftForeArm.quaternion")
 *     to UUID-based names (e.g. "${uuid}.quaternion") before entering the mixer.
 *     This bypasses PropertyBinding.findNode string search entirely, which previously fell back
 *     to rootNode when capitalisation or GLTFLoader sanitisation caused a mismatch.
 *     The root-node fallback was silently eating all LeftForeArm/RightForeArm keyframes,
 *     leaving the elbow with no driver → rigid T-pose flap.
 *
 *   FIX 2 — Full arm + hand + finger mask (Strategic Fix 2 from deep research):
 *     ARM_BONE_RE expanded to include Hand, Thumb, Index, Middle, Ring, Pinky.
 *     The old /Shoulder|Arm/i left LeftHand/RightHand and all finger bones in the base action
 *     at weight=1, creating interpolative resistance (parent=gesture, child=base) that damped
 *     elbow flexion. Full kinematic isolation from shoulder to fingertip.
 *
 *   FIX 5 — De-clamping (Strategic Fix 5 from deep research):
 *     clampWhenFinished = false on all gesture actions.
 *     On finish: fadeOut(0.3) then explicit stop() after fade completes.
 *     Prevents frozen near-straight quaternions accumulating in PropertyMixer buffers
 *     and stiffening subsequent gestures over time.
 *
 * Architecture (0.3.60 — re-baked GLB + dual-base masked swap):
 *
 *   BASE FULL layer  — avaturn_animation (morph tracks stripped, arm tracks KEPT).
 *                      weight=1, LoopRepeat. Default state during idle.
 *                      Drives ALL 53 bones including arms → avaturn rest arm pose.
 *                      NEVER cross-faded. Only swapped out during arm gestures.
 *
 *   BASE ARM-STRIPPED layer — avaturn_animation (morph tracks stripped AND arm tracks stripped).
 *                      weight=0 at rest. Fades IN during arm gestures, replacing baseActionFull.
 *                      No arm tracks → gesture clip is the sole driver of arm bones.
 *                      Drives head/spine/hips/legs only.
 *
 *   IDLE TOP layer — idle clips (head/spine only, no arm tracks), NormalBlend w=1.
 *                    Base-full owns arms during idle. No competition.
 *
 *   GESTURE TOP layer — re-baked gesture clip, NormalBlend w=1.
 *                    During arm gestures: base swapped to arm-stripped version first.
 *                    Re-baked clip authored in avaturn rest frame → correct absolute pose
 *                    when base-arm-stripped is the only other action (which has NO arm tracks).
 *                    Result: gesture clip drives arms 100% at weight=1. No 50/50 split.
 *
 *   BASE SWAP sequence:
 *     gesture start → fade baseActionFull 1→0, fade baseActionArmStripped 0→1
 *                   → play re-baked gesture clip NormalBlend w=1
 *     gesture end   → fade baseActionArmStripped 1→0, fade baseActionFull 0→1
 *                   → return to idle
 *
 * WHY NOT additive (0.3.59):
 *   Re-baked clips express poses in avaturn rest frame — they are already "absolute" poses
 *   relative to the rest. Playing them as NormalBlend while base is arm-stripped gives
 *   full 100% override of arm bones. No additive math needed.
 *   Additive required the base to be present; that caused 50/50 NormalBlend weight split
 *   when both base (arm tracks) and gesture (arm tracks) played simultaneously at w=1.
 *
 * WHY re-baked clips work:
 *   Original clips authored from T-pose bind. avaturn rest arms are 66° from bind.
 *   Additive delta = orig - bind ≈ orig (since bind≈identity) → only ~half the correction.
 *   Re-baked formula: q_rebaked = q_avaturn_rest * inv(q_bind) * q_gesture_original
 *   → full arm pose in avaturn rest frame → plays correctly with NormalBlend.
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Emotion → idle animation pools ───────────────────────────────────────────
// All idle clips must be ARM-SAFE (no arm/shoulder/forearm tracks).
// Base owns arm bones; idle clips drive head/spine/neck only.
//
// 0.3.63 audit:
//   REMOVED from idle pools (gesture-only clips):
//     - evolve_empathy_gentle_nod: is a nodding action — fine as a one-shot
//       gesture but looks repetitive and unnatural when looped as an idle.
//       More importantly: after a gesture it was being immediately re-selected
//       as the idle, so the avatar appeared to loop the nod continuously.
//     - mixamo_neutral_looking_around: ±6.9° yaw pan — intentional head-turn
//       gesture, not a resting posture. Use as gesture only via VD.
//   ADDED:
//     - evolve_listening_interested_lean promoted into more pools
//       (subtle Spine/Spine1/Head, 0° yaw — good universal resting posture)
const EMOTION_IDLE_POOLS: Record<EmotionId, string[]> = {
  neutral: [
    'quaternius_neutral_idle',
    'mesh2motion_neutral_weight_shift',
    'evolve_listening_interested_lean',
  ],
  joy: [
    'mixamo_neutral_thoughtful_nod',
    'quaternius_neutral_idle',
    'evolve_listening_interested_lean',
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
    'quaternius_neutral_idle',
    'mesh2motion_neutral_weight_shift',
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
    'evolve_listening_interested_lean',
    'quaternius_neutral_idle',
  ],
  concentration: [
    'mixamo_neutral_thoughtful_nod',
    'evolve_idle_look_down_notes',
    'quaternius_neutral_idle',
  ],
  confusion: [
    'quaternius_neutral_idle',
    'mesh2motion_neutral_weight_shift',
    'evolve_listening_interested_lean',
  ],
}

// ── Diagnostic helpers ────────────────────────────────────────────────────────

function logClipSummary(label: string, clip: THREE.AnimationClip): void {
  const bones = [...new Set(clip.tracks.map(t => t.name.split('.')[0]))]
  const armBones = bones.filter(b => ARM_BONE_RE.test(b))
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

// ── Arm bone name pattern ─────────────────────────────────────────────────────
// FIX 2 (0.3.62): Expanded to full limb hierarchy — shoulder → fingertips.
// Old /Shoulder|Arm/i left Hand + all finger bones in base action (weight=1),
// creating hierarchical interpolative resistance: parent (LeftArm) owned by gesture,
// child (LeftHand) owned by base → forearm elbow flexion damped to near-zero.
// New pattern strips ALL bones from clavicle to fingertips from base during arm gestures,
// giving the gesture clip the sole PropertyMixer authority over the entire limb chain.
const ARM_BONE_RE = /Shoulder|Arm|Hand|Thumb|Index|Middle|Ring|Pinky/i

// ── UUID-based track retargeting (FIX 1 — 0.3.62) ───────────────────────────
/**
 * Rewrites every track.name in a clip from "BoneName.property" to "${uuid}.property".
 * This forces Three.js PropertyBinding to bind by UUID (direct object reference)
 * instead of string search — completely bypassing the findNode() root-fallback bug
 * that silently discards forearm tracks when names are mis-capitalised or
 * sanitised differently by GLTFLoader (e.g. LeftForearm vs LeftForeArm).
 *
 * Call this on EVERY clip (both base and gesture) immediately after loading,
 * before passing to mixer.clipAction().
 *
 * Returns the same clip object (mutated in-place) for chaining.
 */
function retargetClipToUUIDs(
  clip: THREE.AnimationClip,
  avatarRoot: THREE.Object3D
): THREE.AnimationClip {
  // Build case-insensitive normalised name → UUID map
  const uuidMap = new Map<string, string>()
  avatarRoot.traverse((obj) => {
    if (obj.name) {
      uuidMap.set(obj.name.toLowerCase(), obj.uuid)
    }
  })

  let bound = 0
  let missed = 0
  const missedNames: string[] = []

  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf('.')
    if (dotIdx === -1) continue
    const boneName = track.name.slice(0, dotIdx)
    const property = track.name.slice(dotIdx + 1)

    // Skip tracks that are already UUID-bound (36-char UUID format)
    if (boneName.length === 36 && boneName.includes('-')) {
      bound++
      continue
    }

    const uuid = uuidMap.get(boneName.toLowerCase())
    if (uuid) {
      track.name = `${uuid}.${property}`
      bound++
    } else {
      missed++
      missedNames.push(boneName)
    }
  }

  console.log(
    `[retargetClipToUUIDs] "${clip.name}": ${bound} bound, ${missed} missed`,
    missed > 0 ? `\n  missed bones: ${[...new Set(missedNames)].join(', ')}` : ''
  )
  return clip
}

export class SkeletalController {
  private mixer: THREE.AnimationMixer | null = null

  /** Cache of UUID-retargeted clips, keyed by original clip UUID. */
  private retargetedClipCache = new Map<string, THREE.AnimationClip>()

  /** Full avaturn_animation (morph stripped, arm tracks KEPT) — default idle state */
  private baseActionFull:       THREE.AnimationAction | null = null
  /** Arm-stripped avaturn_animation (morph + arm tracks stripped) — active during arm gestures */
  private baseActionArmStripped: THREE.AnimationAction | null = null

  /** The stripped-full clip — stored for diagnostic reference */
  private baseClipFull: THREE.AnimationClip | null = null

  private topAction:  THREE.AnimationAction | null = null
  private outAction:  THREE.AnimationAction | null = null
  private topWeightTgt: number = 0
  private topWeightCur: number = 0

  /** True while baseActionArmStripped is active (swap in progress or arm gesture playing) */
  private baseSwapped = false
  /** Lerp targets for base swap. 0=full active, 1=arm-stripped active */
  private baseSwapCur = 0   // tracks baseActionFull weight (starts at 1)
  private baseSwapTgt = 0   // 0 = full base dominant, 1 = arm-stripped dominant

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
    console.log('[SkeletalController] init 0.3.62 —', avatarRoot.name || '(unnamed)')
    console.log('[SkeletalController] clips provided:', clips?.length ?? 0, clips?.map(c => c.name))

    const raw = clips?.find(c => c.name === 'avaturn_animation')
    if (raw) {
      console.log(`[SkeletalController] avaturn_animation found: ${raw.tracks.length} raw tracks`)

      // ── BASE FULL: morph tracks stripped, arm tracks KEPT ─────────────────
      const strippedFull = new THREE.AnimationClip(
        raw.name + '_full',
        raw.duration,
        raw.tracks.filter(
          t => !t.name.includes('.morphTargetInfluences') && !t.name.endsWith('.weights')
        )
      )
      // Diagnose arm tracks BEFORE retargeting (names are still readable strings)
      const armTracksFull = strippedFull.tracks.filter(t => ARM_BONE_RE.test(t.name))
      console.log(
        `[SkeletalController] baseClipFull: ${strippedFull.tracks.length} bone tracks`,
        `\n  arm tracks (${armTracksFull.length}):`,
        armTracksFull.length > 0
          ? armTracksFull.map(t => t.name.split('.')[0]).join(', ')
          : '❌ NONE — arms will T-pose!'
      )
      // Log frame-0 arm quaternions from the full base
      for (const t of armTracksFull.slice(0, 6)) {
        const vals = (t as THREE.QuaternionKeyframeTrack).values
        if (vals?.length >= 4) {
          console.log(`  [BaseFullArmQ] ${t.name.split('.')[0]}: [${vals[0].toFixed(3)}, ${vals[1].toFixed(3)}, ${vals[2].toFixed(3)}, ${vals[3].toFixed(3)}]`)
        }
      }

      // FIX 1: retarget base full clip to UUIDs (AFTER diagnostics above)
      retargetClipToUUIDs(strippedFull, avatarRoot)
      this.baseClipFull = strippedFull

      const baseFull = this.mixer.clipAction(strippedFull)
      baseFull.blendMode        = THREE.NormalAnimationBlendMode
      baseFull.setLoop(THREE.LoopRepeat, Infinity)
      baseFull.clampWhenFinished = false
      baseFull.setEffectiveWeight(1)
      baseFull.play()
      this.baseActionFull = baseFull
      console.log('[SkeletalController] baseActionFull started: weight=1 NormalBlend (full arms)')

      // ── BASE ARM-STRIPPED: morph AND arm tracks stripped ──────────────────
      const strippedArms = new THREE.AnimationClip(
        raw.name + '_armstripped',
        raw.duration,
        raw.tracks.filter(
          t =>
            !t.name.includes('.morphTargetInfluences') &&
            !t.name.endsWith('.weights') &&
            !ARM_BONE_RE.test(t.name)
        )
      )
      // armTracksStripped diagnostic: count how many arm tracks were excluded
      // strippedFull tracks are now UUID-named so we use armTracksFull count from above
      console.log(
        `[SkeletalController] baseClipArmStripped: ${strippedArms.tracks.length} bone tracks`,
        `(stripped ${armTracksFull.length} arm tracks from base)`
      )
      // FIX 1: retarget arm-stripped base clip to UUIDs
      retargetClipToUUIDs(strippedArms, avatarRoot)

      const baseArmStripped = this.mixer.clipAction(strippedArms)
      baseArmStripped.blendMode        = THREE.NormalAnimationBlendMode
      baseArmStripped.setLoop(THREE.LoopRepeat, Infinity)
      baseArmStripped.clampWhenFinished = false
      baseArmStripped.setEffectiveWeight(0)  // starts at 0 — only active during arm gestures
      baseArmStripped.play()
      this.baseActionArmStripped = baseArmStripped
      console.log('[SkeletalController] baseActionArmStripped ready: weight=0 (standby)')
    } else {
      console.warn('[SkeletalController] ❌ avaturn_animation NOT FOUND — arms will T-pose!')
    }

    this.baseSwapped  = false
    this.baseSwapCur  = 0   // tracks distance to arm-stripped: 0=full, 1=stripped
    this.baseSwapTgt  = 0
    this.pendingIdle  = true
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

    // ── Idle pool cycling (only when fully idle, base not swapped) ────────────
    if (!this.isInGesture && !this.pendingIdle && !this.baseSwapped && this.topWeightCur >= 0.99) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer    = 0
        this.idlePoolInterval = 8 + Math.random() * 7
        const next = this._pickNextIdle(this.currentEmotion)
        if (next !== this.currentIdleClipId) this.playIdle(this.currentEmotion, next)
      }
    }

    // ── Top layer weight lerp ─────────────────────────────────────────────────
    if (this.topAction && this.topWeightCur < this.topWeightTgt) {
      this.topWeightCur = Math.min(this.topWeightTgt, this.topWeightCur + delta * 4)
      this.topAction.setEffectiveWeight(this.topWeightCur)
    }

    // ── Out layer fade out ────────────────────────────────────────────────────
    if (this.outAction) {
      const next = Math.max(0, this.outAction.getEffectiveWeight() - delta * 4)
      this.outAction.setEffectiveWeight(next)
      if (next === 0) { this.outAction.stop(); this.outAction = null }
    }

    // ── Base swap lerp ────────────────────────────────────────────────────────
    // baseSwapCur: 0 = baseActionFull dominant (weight=1), 1 = baseActionArmStripped dominant (weight=1)
    if (this.baseSwapCur !== this.baseSwapTgt) {
      const speed = delta * 5  // swap completes in ~0.2s
      if (this.baseSwapTgt > this.baseSwapCur) {
        this.baseSwapCur = Math.min(this.baseSwapTgt, this.baseSwapCur + speed)
      } else {
        this.baseSwapCur = Math.max(this.baseSwapTgt, this.baseSwapCur - speed)
      }
      const wFull    = 1 - this.baseSwapCur
      const wStripped = this.baseSwapCur
      this.baseActionFull?.setEffectiveWeight(wFull)
      this.baseActionArmStripped?.setEffectiveWeight(wStripped)

      // Track whether swap is "complete enough" for the gesture to have full arm ownership
      this.baseSwapped = this.baseSwapCur >= 0.95
    }

    this.mixer?.update(delta)

    this.diagnosticFrame++

    // Frame 10: log full state
    if (this.diagnosticFrame === 10) {
      console.log('[SkeletalController] ── FRAME 10 (0.3.62) ────────────────────────')
      console.log('[SkeletalController] baseActionFull:',
        this.baseActionFull
          ? `w=${this.baseActionFull.getEffectiveWeight().toFixed(3)} blendMode=${this.baseActionFull.blendMode} running=${this.baseActionFull.isRunning()}`
          : '❌ MISSING')
      console.log('[SkeletalController] baseActionArmStripped:',
        this.baseActionArmStripped
          ? `w=${this.baseActionArmStripped.getEffectiveWeight().toFixed(3)} blendMode=${this.baseActionArmStripped.blendMode} running=${this.baseActionArmStripped.isRunning()}`
          : '❌ MISSING')
      console.log('[SkeletalController] topAction:',
        this.topAction
          ? `w=${this.topAction.getEffectiveWeight().toFixed(3)} clip="${this.topAction.getClip().name}" blendMode=${this.topAction.blendMode} running=${this.topAction.isRunning()}`
          : 'none')
      console.log('[SkeletalController] baseSwapCur:', this.baseSwapCur.toFixed(3),
        '| baseSwapped:', this.baseSwapped,
        '| isInGesture:', this.isInGesture)
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
      console.log('[SkeletalController] ── FRAME 120 ────────────────────────────────')
      if (this.avatarRoot) logArmBoneQuats('frame-120', this.avatarRoot)
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Returns a UUID-retargeted clone of a clip, cached by the clip's original uuid.
   * Safe to call multiple times for the same clip — re-clones only once per source.
   * This is used for idle clips so their head/spine/neck tracks also bind by UUID.
   */
  private _getRetargeted(clip: THREE.AnimationClip): THREE.AnimationClip {
    const cached = this.retargetedClipCache.get(clip.uuid)
    if (cached) return cached
    const cloned = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(clip))
    cloned.uuid = THREE.MathUtils.generateUUID()
    retargetClipToUUIDs(cloned, this.avatarRoot!)
    this.retargetedClipCache.set(clip.uuid, cloned)
    return cloned
  }

  private _swapBaseToArmStripped(): void {
    if (this.baseSwapTgt === 1) return  // already swapping/swapped
    console.log('[SkeletalController] BASE SWAP → arm-stripped (gesture starting)')
    this.baseSwapTgt = 1
  }

  /**
   * Swap base back to full version.
   * Called when an arm gesture ends.
   */
  private _swapBaseToFull(): void {
    if (this.baseSwapTgt === 0) return  // already full
    console.log('[SkeletalController] BASE SWAP → full (gesture ended)')
    this.baseSwapTgt = 0
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

    // Idle clips: NormalBlend, no arm tracks → base-full owns arms
    // FIX 1: use UUID-retargeted clip so head/spine/neck tracks bind correctly
    const idleClip = this._getRetargeted(entry.clip)
    const action = this.mixer.clipAction(idleClip)
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

    // If returning from a gesture, swap base back to full
    this._swapBaseToFull()

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    // Idle clips: NormalBlend, no arm tracks — base-full owns arms during idle
    // FIX 1: use UUID-retargeted clip so head/spine/neck tracks bind correctly
    const idleClip = this._getRetargeted(entry.clip)
    const action = this.mixer.clipAction(idleClip)
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

    // Check for arm tracks on the ORIGINAL clip (string-named) BEFORE retargeting.
    // After retargetClipToUUIDs, track names become UUIDs so ARM_BONE_RE won't match.
    const hasArmTracks = entry.clip.tracks.some(t => ARM_BONE_RE.test(t.name))
    console.log('[SkeletalController] gesture hasArmTracks:', hasArmTracks)
    console.log('[SkeletalController] baseActionFull weight at gesture start:',
      this.baseActionFull?.getEffectiveWeight().toFixed(3) ?? 'NO BASE')

    if (this.topAction) {
      if (this.outAction && this.outAction !== this.topAction) this.outAction.stop()
      this.outAction = this.topAction
    }

    this.isInGesture   = true
    this.idlePoolTimer = 0

    // For arm gestures: swap base to arm-stripped so gesture clip fully owns arm bones
    if (hasArmTracks) {
      this._swapBaseToArmStripped()
      console.log('[SkeletalController] arm gesture → base swapping to arm-stripped. Gesture NormalBlend will own arms 100%.')
    } else {
      console.log('[SkeletalController] head/spine gesture → base stays FULL. No arm competition.')
    }

    // ALL gestures now use NormalBlend — re-baked clips are in avaturn rest frame.
    // Arm gestures: base-arm-stripped has no arm tracks → gesture owns arms 100% at w=1.
    // Head/spine gestures: base-full drives arms, gesture drives head/spine only.
    //
    // FIX 1: retarget clip tracks to UUIDs before passing to mixer.
    // Deep-clone so the dictionary entry (original string names) is NOT mutated —
    // we need the original string names to remain intact for the hasArmTracks check above
    // on subsequent gesture calls.
    const retargetedClip = retargetClipToUUIDs(
      THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(entry.clip)),
      this.avatarRoot!
    )
    retargetedClip.uuid = THREE.MathUtils.generateUUID()  // unique UUID → bypasses mixer cache

    const action = this.mixer.clipAction(retargetedClip)
    action.blendMode        = THREE.NormalAnimationBlendMode
    action.setLoop(THREE.LoopOnce, 1)
    // ARM GESTURE SNAP FIX (0.3.64):
    // Root cause: all gesture clips are single-frame static poses.
    // With clampWhenFinished=false, Three.js releases the arm PropertyMixers the
    // instant LoopOnce ends. Arms have NO driver for the entire fadeOut window
    // while base-full ramps back up → snap to bind pose.
    //
    // Fix: clampWhenFinished=true for arm gestures holds the final pose through
    // fadeOut. base-full simultaneously ramps from 0→1 (started in playIdle below).
    // Three.js normalises both contributors: gesture fades 1→0, base grows 0→1,
    // producing a smooth interpolation from gesture pose → rest. No driver gap.
    //
    // Head/spine gestures: clampWhenFinished=false is safe — base-full always
    // owns arm bones regardless, only spine/head return to rest which is smooth.
    action.clampWhenFinished = hasArmTracks
    action.reset()
    action.setEffectiveWeight(0)
    action.play()
    this.topAction    = action
    this.topWeightCur = 0
    this.topWeightTgt = 1.0

    // Arm gestures: 0.6s fade — long enough for base-full to ramp to weight≈1
    //   before the clamp releases. Also slow the base swap-back rate for arm
    //   gestures so base-full is still rising during the overlap window.
    // Head/spine gestures: 0.25s fade — no arm snap risk, shorter = snappier feel.
    const fadeDuration = hasArmTracks ? 0.6 : 0.25
    const fadeMs       = Math.round(fadeDuration * 1000) + 50

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer!.removeEventListener('finished', onFinished)

      console.log('[SkeletalController] gesture finished:', animId,
        hasArmTracks ? '(arm — clamp+fade ' + fadeDuration + 's)' : '(head/spine — fade ' + fadeDuration + 's)')
      if (this.avatarRoot) logArmBoneQuats('post-gesture', this.avatarRoot)

      this.isInGesture = false

      // Fade the gesture out. For arm gestures, clampWhenFinished=true keeps
      // the final pose driving the bones throughout the fade so there is never
      // a window with zero arm authority.
      action.fadeOut(fadeDuration)

      // Start the idle (and base-full swap-back) immediately — now safe because
      // the gesture clamp keeps arm bones driven throughout the fade overlap.
      this.playIdle(this.currentEmotion)

      // Stop after fade completes — clamp hold no longer needed at this point.
      setTimeout(() => {
        action.stop()
        if (this.outAction === action) this.outAction = null
        if (this.topAction === action) this.topAction = null
      }, fadeMs)
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
    this.retargetedClipCache.clear()
    this.pendingCues       = []
    this.wordCounter       = 0
    this.currentEmotion    = 'neutral'
    this.currentIdleClipId = ''
    this.isInGesture       = false
    this.idlePoolTimer     = 0
    this.topAction         = null
    this.outAction         = null
    this.baseActionFull    = null
    this.baseActionArmStripped = null
    this.topWeightCur      = 0
    this.topWeightTgt      = 0
    this.baseSwapCur       = 0
    this.baseSwapTgt       = 0
    this.baseSwapped       = false
    this.pendingIdle       = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.retargetedClipCache.clear()
    this.mixer = null
  }
}
