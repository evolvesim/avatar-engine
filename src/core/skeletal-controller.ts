/**
 * skeletal-controller.ts — Skeletal animation controller
 *
 * Architecture (0.3.72 — Real RPM mocap, single-layer, no dual-base swap):
 *
 *   The T-pose Avaturn GLB has NO embedded avaturn_animation.
 *   All motion comes from real RPM mocap clips in animations.glb.
 *   Clips are authored from the same T-pose bind as the avatar → same
 *   coordinate space → plays directly, no rebake needed.
 *
 *   SINGLE LAYER:
 *     - One AnimationAction plays at a time (idle or gesture)
 *     - Transition: action.crossFadeTo(nextAction, duration, false)
 *     - No base layer, no dual-base swap, no avaturn_animation lookup
 *
 *   UUID RETARGETING (FIX 1 from 0.3.62, retained):
 *     retargetClipToUUIDs() rewrites track names from "BoneName.prop"
 *     to "${uuid}.prop" so Three.js bypasses PropertyBinding string search.
 *     This prevents the elbow-disappearing bug where capitalisation
 *     mismatches (LeftForeArm vs leftforearm) cause tracks to bind to root.
 *
 *   IDLE POOL CYCLING:
 *     Each emotion has a pool of RPM idle/gesture clips.
 *     The controller randomly cycles between them every 8–15s for variation.
 *
 *   GESTURE FLOW:
 *     - crossFadeTo(gestureAction, 0.3s)
 *     - on LoopOnce finish: crossFadeTo(nextIdle, 0.4s)
 *     - No base swap. No clampWhenFinished override needed.
 *
 *   Why this works:
 *     - RPM clips have real ForeArm rotation (24–131°)
 *     - T-pose bind = clip bind → no coordinate space offset
 *     - Single crossFade: no dual-layer weight competition
 */

import * as THREE from 'three'
import type { AnimationDictionary } from './animation-dictionary'
import type { EmotionId } from './emotion-state'
import type { GestureCue } from './virtual-director'

// ── Emotion → idle animation pools ───────────────────────────────────────────
// All RPM clips are full-body with real arm motion, so any clip works as idle.
// Prefer quieter (low ForeArm °) clips as idles, expressive ones as gestures.
// ── Emotion → idle pool ──────────────────────────────────────────────────────
// RPM mocap idles drive all 52 bones (including arms) — great as base loops.
// ACTS head/spine loops (quaternius_, mesh2motion_, evolve_listening_*,
// evolve_idle_*) also work as idles in single-layer mode: they drive
// head/spine only, leaving arms at their last-keyframed position.
// Mixing both gives natural variation while keeping arms alive.
const EMOTION_IDLE_POOLS: Record<EmotionId, string[]> = {
  neutral: [
    // rpm (original 34 — confirmed working)
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_002',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_var_002',
    'rpm_neutral_idle_var_003',
    'quaternius_neutral_idle',
    'mesh2motion_neutral_weight_shift',
    'evolve_listening_active_sway',
    'evolve_listening_interested_lean',
    'evolve_idle_seated_upright',
    // rpm2 (new RPM library — same skeleton, real mocap)
    'rpm2_idle_001',
    'rpm2_idle_002',
    'rpm2_idle_var_001',
    'rpm2_idle_var_002',
    'rpm2_idle_var_003',
    'rpm2_idle_var_004',
    'rpm2_idle_var_005',
    'rpm2_idle_var_006',
    'rpm2_idle_var_007',
    'rpm2_idle_var_008',
    'rpm2_idle_var_009',
    'rpm2_idle_var_010',
    // rpm2f (feminine mocap — more subtle, corporate-appropriate)
    'rpm2f_idle_001',
    'rpm2f_idle_var_001',
    'rpm2f_idle_var_002',
    'rpm2f_idle_var_003',
    'rpm2f_idle_var_004',
    'rpm2f_idle_var_005',
    'rpm2f_idle_var_006',
    'rpm2f_idle_var_007',
    'rpm2f_idle_var_008',
    'rpm2f_idle_var_009',
  ],
  joy: [
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_expressive_001',
    'quaternius_joy_breathing_idle',
    'evolve_rapport_mirroring_lean',
    'rpm2_idle_001',
    'rpm2_idle_var_003',
    'rpm2f_idle_001',
    'rpm2f_idle_var_002',
  ],
  anger: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_002',
    'quaternius_anger_tense_idle',
    'mixamo_anger_arms_crossed',
    'rpm2_idle_002',
    'rpm2_idle_var_007',
  ],
  sadness: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_003',
    'quaternius_sadness_slumped',
    'mesh2motion_sadness_shoulder_slump',
    'rpm2_idle_001',
    'rpm2_idle_var_005',
  ],
  surprise: [
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_002',
    'quaternius_neutral_idle',
    'rpm2_idle_var_001',
    'rpm2_idle_var_004',
  ],
  fear: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_002',
    'quaternius_fear_frozen_idle',
    'evolve_stress_suppressed_still',
    'rpm2_idle_002',
    'rpm2_idle_var_006',
  ],
  disgust: [
    'rpm_neutral_idle_var_002',
    'rpm_neutral_idle_001',
    'quaternius_disgust_recoil_idle',
    'rpm2_idle_var_008',
    'rpm2_idle_var_009',
  ],
  empathy: [
    'rpm_neutral_idle_var_003',
    'rpm_neutral_idle_expressive_002',
    'evolve_listening_interested_lean',
    'mixamo_empathy_leaning_forward',
    'evolve_rapport_mirroring_lean',
    'rpm2_idle_001',
    'rpm2_idle_var_002',
    'rpm2f_idle_var_004',
    'rpm2f_idle_var_005',
  ],
  concentration: [
    'rpm_neutral_idle_002',
    'rpm_neutral_idle_var_001',
    'quaternius_concentration_idle',
    'evolve_concentration_arms_folded_think',
    'evolve_professional_steeple_fingers',
    'rpm2_idle_var_010',
    'rpm2_idle_var_006',
    'rpm2f_idle_var_006',
    'rpm2f_idle_var_007',
  ],
  confusion: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_var_002',
    'quaternius_neutral_idle',
    'rpm2_idle_var_003',
    'rpm2_idle_var_007',
  ],
}

// ── Diagnostic helpers ────────────────────────────────────────────────────────

function logArmBoneQuats(label: string, root: THREE.Object3D): void {
  const ARM_NAMES = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']
  const lines: string[] = []
  root.traverse((obj) => {
    if (ARM_NAMES.includes(obj.name)) {
      const q = obj.quaternion
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
      const deg = (r: number) => (r * 180 / Math.PI).toFixed(1)
      lines.push(`  ${obj.name}: q[${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)}] euler[${deg(e.x)}°,${deg(e.y)}°,${deg(e.z)}°]`)
    }
  })
  if (lines.length === 0) {
    console.warn(`[ArmBones] ${label}: no arm bones found`)
  } else {
    console.log(`[ArmBones] ${label}:\n${lines.join('\n')}`)
  }
}

// ── UUID-based track retargeting (FIX 1 from 0.3.62 — retained) ─────────────
/**
 * Rewrites every track.name from "BoneName.property" to "${uuid}.property".
 * Bypass PropertyBinding.findNode() string search entirely — immune to
 * capitalisation differences (LeftForeArm vs leftforearm etc).
 *
 * MUTATES the clip in-place. Call on a deep-clone, not the dict entry.
 */
function retargetClipToUUIDs(
  clip: THREE.AnimationClip,
  avatarRoot: THREE.Object3D
): THREE.AnimationClip {
  const nameToUUID = new Map<string, string>()
  avatarRoot.traverse((obj) => {
    if (obj.name) nameToUUID.set(obj.name.toLowerCase(), obj.uuid)
  })

  let bound = 0, missed = 0
  const missedNames: string[] = []
  const keptTracks: typeof clip.tracks = []
  for (const track of clip.tracks) {
    const dotIdx  = track.name.lastIndexOf('.')
    const boneName = track.name.slice(0, dotIdx)
    const prop     = track.name.slice(dotIdx)

    // Three.js GLTFLoader deduplicates nodes with identical names by appending
    // a numeric suffix: "LeftArm" → "LeftArm_1", "LeftArm_2", etc.
    // When animations.glb contains 34 clips each with a "LeftArm" node,
    // clip 0 gets track "LeftArm.quaternion" but clip 17 gets "LeftArm_17.quaternion".
    // The avatar skeleton has no bone named "LeftArm_17" → retargeting drops it → arms frozen.
    // Fix: strip the _N suffix before UUID lookup so all suffixed names resolve to the real bone.
    const cleanName = boneName.replace(/_\d+$/, '')

    const uuid = nameToUUID.get(cleanName.toLowerCase())
    if (uuid) {
      track.name = uuid + prop
      keptTracks.push(track)
      bound++
    } else {
      // Drop tracks for bones not present in this avatar (e.g. finger joints
      // in RPM clips that Avaturn doesn't have). Keeping them causes hundreds
      // of THREE.PropertyBinding warnings per clip.
      missedNames.push(boneName)
      missed++
    }
  }
  clip.tracks = keptTracks  // remove unbound tracks
  console.log(
    `[retargetClipToUUIDs] "${clip.name}": ${bound} bound` +
    (missed > 0 ? `, ${missed} dropped (finger/toe not in skeleton)` : ', 0 dropped ✅')
  )
  return clip
}

export class SkeletalController {
  private mixer: THREE.AnimationMixer | null = null

  /** Cache of UUID-retargeted clips, keyed by original clip UUID. */
  private retargetedClipCache = new Map<string, THREE.AnimationClip>()

  /** Currently playing action (idle or gesture). */
  private currentAction: THREE.AnimationAction | null = null
  /** Previous action fading out (managed by Three.js crossFadeTo). */
  private fadingAction:  THREE.AnimationAction | null = null

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
  /** Incremented on every new gesture. onFinished handlers compare against
   *  this token — stale handlers (from interrupted gestures) are no-ops. */
  private gestureToken       = 0

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init 0.3.84 (89 clips: 34 RPM + 39 RPM2 + 16 RPM2f, no ACTS) —', avatarRoot.name || '(unnamed)')

    // No avaturn_animation lookup — this is the T-pose GLB with no embedded anim.
    // Verify there are no embedded clips that could interfere.
    if (clips && clips.length > 0) {
      console.log('[SkeletalController] embedded clips provided:', clips.map(c => c.name))
      console.log('[SkeletalController] ⚠️  These will be ignored — single-layer mode uses animations.glb only')
    } else {
      console.log('[SkeletalController] ✅ No embedded clips (T-pose GLB) — clean slate')
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

    // ── Idle pool cycling (only when fully idle, no gesture active) ───────────
    if (!this.isInGesture && !this.pendingIdle) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer    = 0
        this.idlePoolInterval = 8 + Math.random() * 7
        const next = this._pickNextIdle(this.currentEmotion)
        if (next !== this.currentIdleClipId) this._playIdle(this.currentEmotion, next)
      }
    }

    this.mixer?.update(delta)

    this.diagnosticFrame++

    // Frame 10: log full state
    if (this.diagnosticFrame === 10) {
      console.log('[SkeletalController] ── FRAME 10 (0.3.72) ────────────────────────')
      console.log('[SkeletalController] currentAction:',
        this.currentAction
          ? `clip="${this.currentAction.getClip().name}" w=${this.currentAction.getEffectiveWeight().toFixed(3)} running=${this.currentAction.isRunning()}`
          : '❌ NONE')
      console.log('[SkeletalController] isInGesture:', this.isInGesture,
        '| pendingIdle:', this.pendingIdle,
        '| idleClip:', this.currentIdleClipId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allActions: THREE.AnimationAction[] = (this.mixer as any)?._actions ?? []
      console.log(`[SkeletalController] mixer._actions count: ${allActions.length}`)
      allActions.forEach(a => {
        console.log(`  "${a.getClip().name}" w=${a.getEffectiveWeight().toFixed(3)} running=${a.isRunning()}`)
      })
      if (this.avatarRoot) logArmBoneQuats('frame-10', this.avatarRoot)
    }

    // Frame 120: check arm bones are animating
    if (this.diagnosticFrame === 120) {
      console.log('[SkeletalController] ── FRAME 120 ────────────────────────────────')
      if (this.avatarRoot) logArmBoneQuats('frame-120', this.avatarRoot)
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Returns a UUID-retargeted deep-clone of a clip, cached by the original clip's UUID.
   * The dictionary entry's clip is never mutated — retargeting mutates the clone only.
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

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) return  // dict not ready yet — retry next frame

    console.log('[SkeletalController] first idle:', id)

    this.pendingIdle       = false
    this.currentIdleClipId = id
    this.isInGesture       = false

    const idleClip = this._getRetargeted(entry.clip)
    const action = this.mixer.clipAction(idleClip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.setEffectiveWeight(1)
    action.play()
    this.currentAction = action
  }

  private _pickNextIdle(emotion: EmotionId): string {
    const pool = EMOTION_IDLE_POOLS[emotion] ?? EMOTION_IDLE_POOLS.neutral
    if (pool.length === 1) return pool[0]
    const candidates = pool.filter(id => id !== this.currentIdleClipId)
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  private _playIdle(emotion: EmotionId, idleId?: string): void {
    if (!this.mixer) return
    const id    = idleId ?? this._pickNextIdle(emotion)
    const entry = this.dictionary.get(id)
    if (!entry) return

    console.log('[SkeletalController] idle →', id)
    this.currentIdleClipId = id
    this.isInGesture       = false
    this.idlePoolTimer     = 0

    const idleClip = this._getRetargeted(entry.clip)
    const nextAction = this.mixer.clipAction(idleClip)
    nextAction.setLoop(THREE.LoopRepeat, Infinity)
    nextAction.clampWhenFinished = false
    // Same rule as gesture: let crossFadeTo own the weight ramp.
    // Pre-setting weight=0 overrides the interpolant → idle stays at 0.
    nextAction.reset().play()

    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.crossFadeTo(nextAction, 0.4, false)
      this.fadingAction  = this.currentAction
    } else {
      nextAction.setEffectiveWeight(1)
    }
    this.currentAction = nextAction
  }

  private _playGesture(animId: string, crossfadeDuration: number): void {
    if (!this.mixer) return
    const entry = this.dictionary.get(animId)
    if (!entry) {
      console.warn(`[SkeletalController] "${animId}" not found in dictionary`)
      return
    }

    // Mint a new token. Any onFinished handler holding an old token will
    // see a mismatch and no-op — prevents stale listeners from firing
    // _returnToIdleDirect multiple times when gestures are interrupted.
    const token = ++this.gestureToken

    console.log('[SkeletalController] gesture →', animId, `(token ${token})`)
    this.isInGesture   = true
    this.idlePoolTimer = 0

    // Deep-clone + retarget for each gesture call (gesture clips play LoopOnce
    // and may be re-triggered — a fresh clone + fresh UUID avoids mixer
    // returning a cached already-played action for the same clip).
    const gestureClip = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(entry.clip))
    gestureClip.uuid  = THREE.MathUtils.generateUUID()
    retargetClipToUUIDs(gestureClip, this.avatarRoot!)

    const nextAction = this.mixer.clipAction(gestureClip)
    nextAction.setLoop(THREE.LoopOnce, 1)
    // clampWhenFinished=true: holds the final pose after the clip ends.
    // This is critical for the no-flash return-to-idle: the gesture keeps
    // driving bones while the crossfade to idle ramps up (0.4s). Without
    // clamp, Three.js disables the action on 'finished' → zero bone driver
    // for one frame → bind-pose flash before idle takes over.
    nextAction.clampWhenFinished = true
    // Do NOT pre-set weight to 0. crossFadeTo owns the weight ramp (0→1
    // over fadeDuration). Pre-setting weight=0 overrides the interpolant
    // and keeps the gesture at weight 0 for its entire duration → bind pose.
    nextAction.reset().play()

    const fadeDuration = crossfadeDuration > 0 ? crossfadeDuration : 0.3
    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.crossFadeTo(nextAction, fadeDuration, false)
      this.fadingAction  = this.currentAction
    } else {
      nextAction.setEffectiveWeight(1)
    }
    this.currentAction = nextAction

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      // Guard 1: wrong action (Three.js fires 'finished' for any action that ends)
      if (e.action !== nextAction) return
      // Guard 2: stale token — this gesture was interrupted by a newer one
      if (this.gestureToken !== token) {
        this.mixer!.removeEventListener('finished', onFinished)
        return
      }
      this.mixer!.removeEventListener('finished', onFinished)
      console.log('[SkeletalController] gesture done:', animId, `(token ${token})`)
      if (this.avatarRoot) logArmBoneQuats('post-gesture', this.avatarRoot)
      this.isInGesture  = false
      this.fadingAction = null
      // clampWhenFinished=true means the gesture is still enabled and
      // holding its final pose — we can crossfade FROM it into the idle.
      // The gesture keeps driving bones for the full 0.4s fade duration,
      // so there is never a frame with zero bone contribution (no flash).
      this._returnToIdleWithFade(nextAction)
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  /**
   * Crossfades from a clamped gesture action into the next idle.
   * Because clampWhenFinished=true, the gesture is still enabled and holding
   * its final pose when 'finished' fires — crossFadeTo FROM it works
   * correctly and keeps bones driven for the full fade duration.
   * No frame with zero contribution → no bind-pose flash.
   */
  private _returnToIdleWithFade(fromAction: THREE.AnimationAction): void {
    if (!this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = this.dictionary.get(id)
    if (!entry) {
      // Dict not ready — stop gesture and fall back to pendingIdle retry
      fromAction.stop()
      this.pendingIdle = true
      return
    }

    console.log('[SkeletalController] _returnToIdleWithFade →', id)
    this.currentIdleClipId = id
    this.idlePoolTimer     = 0

    const idleClip   = this._getRetargeted(entry.clip)
    const idleAction = this.mixer.clipAction(idleClip)
    idleAction.setLoop(THREE.LoopRepeat, Infinity)
    idleAction.clampWhenFinished = false
    idleAction.reset().play()

    // Crossfade from the still-clamped gesture into the idle.
    // This ramps gesture 1→0 and idle 0→1 over 0.4s — bones always driven.
    fromAction.crossFadeTo(idleAction, 0.4, false)
    this.currentAction = idleAction
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
      this._playGesture(cue.anim_id, cue.crossfade_duration)
    }
  }

  onEmotionChange(emotion: EmotionId): void {
    if (emotion === this.currentEmotion) return
    this.currentEmotion = emotion
    if (!this.isInGesture) this._playIdle(emotion)
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
    this.currentAction     = null
    this.fadingAction      = null
    this.gestureToken      = 0
    this.pendingIdle       = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.retargetedClipCache.clear()
    this.mixer = null
  }
}
