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
const EMOTION_IDLE_POOLS: Record<EmotionId, string[]> = {
  neutral: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_002',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_var_002',
    'rpm_neutral_idle_var_003',
  ],
  joy: [
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_expressive_001',
    'rpm_talking_001',
  ],
  anger: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_002',
  ],
  sadness: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_003',
  ],
  surprise: [
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_002',
  ],
  fear: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_002',
  ],
  disgust: [
    'rpm_neutral_idle_var_002',
    'rpm_neutral_idle_001',
  ],
  empathy: [
    'rpm_neutral_idle_var_003',
    'rpm_neutral_idle_expressive_002',
    'rpm_neutral_idle_001',
  ],
  concentration: [
    'rpm_neutral_idle_002',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_var_003',
  ],
  confusion: [
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_var_002',
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
    const uuid = nameToUUID.get(boneName.toLowerCase())
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
  if (bound > 0 || missed === 0) {
    console.log(
      `[retargetClipToUUIDs] "${clip.name}": ${bound} bound` +
      (missed > 0 ? `, ${missed} dropped (not in skeleton)` : '')
    )
  }
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

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init 0.3.72 (single-layer RPM) —', avatarRoot.name || '(unnamed)')

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
    nextAction.setEffectiveWeight(0)
    nextAction.play()

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

    console.log('[SkeletalController] gesture →', animId)
    this.isInGesture   = true
    this.idlePoolTimer = 0

    // Deep-clone + retarget for each gesture call (gesture clips play LoopOnce
    // and may be re-triggered — a fresh clone avoids mixer cache conflicts).
    const gestureClip = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(entry.clip))
    gestureClip.uuid  = THREE.MathUtils.generateUUID()
    retargetClipToUUIDs(gestureClip, this.avatarRoot!)

    const nextAction = this.mixer.clipAction(gestureClip)
    nextAction.setLoop(THREE.LoopOnce, 1)
    nextAction.clampWhenFinished = false
    nextAction.setEffectiveWeight(0)
    nextAction.play()

    const fadeDuration = crossfadeDuration > 0 ? crossfadeDuration : 0.3
    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.crossFadeTo(nextAction, fadeDuration, false)
      this.fadingAction  = this.currentAction
    } else {
      nextAction.setEffectiveWeight(1)
    }
    this.currentAction = nextAction

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== nextAction) return
      this.mixer!.removeEventListener('finished', onFinished)
      console.log('[SkeletalController] gesture done:', animId)
      if (this.avatarRoot) logArmBoneQuats('post-gesture', this.avatarRoot)
      this.isInGesture = false
      // Return to idle via crossFade
      this._playIdle(this.currentEmotion)
      // Clean up old action after fade
      setTimeout(() => {
        nextAction.stop()
        if (this.fadingAction === nextAction) this.fadingAction = null
      }, 500)
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
    this.pendingIdle       = true
    this._tryStartIdle()
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.retargetedClipCache.clear()
    this.mixer = null
  }
}
