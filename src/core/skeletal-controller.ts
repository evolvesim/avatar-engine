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
    // mx_m — Pack 1 Motion Male idles (checked first so pack1 works out of the box)
    'mx_m_standard_idle',
    'mx_m_idle_still',
    'mx_m_neutral_idle_foot_forward',
    'mx_m_breathing_idle_fast_breathing',
    // mx_f — Pack 2 Motion Female idles
    'mx_f_idle_standard',
    'mx_f_idle_shifting',
    'mx_f_idle_foot_forward_slouch',
    'mx_f_standing_idle_footfoward',
    // rpm (original — confirmed working)
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
  // happy (formerly joy)
  happy: [
    'mx_m_happy_idle_swaying',
    'mx_f_standing_greeting_waving',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_expressive_001',
    'quaternius_joy_breathing_idle',
    'evolve_rapport_mirroring_lean',
    'rpm2_idle_001',
    'rpm2_idle_var_003',
    'rpm2f_idle_001',
    'rpm2f_idle_var_002',
  ],
  sadness: [
    'mx_m_idle_still',
    'mx_f_idle_foot_forward_slouch',
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_003',
    'quaternius_sadness_slumped',
    'mesh2motion_sadness_shoulder_slump',
    'rpm2_idle_001',
    'rpm2_idle_var_005',
  ],
  surprise: [
    'mx_m_standard_idle',
    'mx_f_idle_standard',
    'rpm_neutral_idle_var_001',
    'rpm_neutral_idle_002',
    'quaternius_neutral_idle',
    'rpm2_idle_var_001',
    'rpm2_idle_var_004',
  ],
  empathy: [
    'mx_m_neutral_idle_foot_forward',
    'mx_f_idle_shifting',
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
  // thoughtful (replaces concentration + confusion)
  thoughtful: [
    'mx_m_idle_still',
    'mx_m_neutral_idle_foot_forward',
    'mx_f_sitting_hands_crossed',
    'rpm_neutral_idle_002',
    'rpm_neutral_idle_var_001',
    'quaternius_concentration_idle',
    'evolve_concentration_arms_folded_think',
    'evolve_professional_steeple_fingers',
    'evolve_listening_interested_lean',
    'rpm2_idle_var_010',
    'rpm2_idle_var_006',
    'rpm2f_idle_var_006',
    'rpm2f_idle_var_007',
  ],
  // displeasure (replaces anger + disgust)
  displeasure: [
    'mx_m_breathing_idle_fast_breathing',
    'mx_f_idle_foot_forward_slouch',
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_002',
    'quaternius_anger_tense_idle',
    'mixamo_anger_arms_crossed',
    'quaternius_disgust_recoil_idle',
    'rpm2_idle_002',
    'rpm2_idle_var_007',
    'rpm2_idle_var_008',
  ],
  // tension (replaces fear)
  tension: [
    'mx_m_idle_still',
    'mx_f_idle_standard',
    'rpm_neutral_idle_001',
    'rpm_neutral_idle_var_002',
    'quaternius_fear_frozen_idle',
    'evolve_stress_suppressed_still',
    'rpm2_idle_002',
    'rpm2_idle_var_006',
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
  /**
   * All clips present in EMOTION_IDLE_POOLS — used by _isIdleClip() to
   * detect when a VD selects an idle as a gesture and re-route it.
   */
  private static readonly ALL_IDLE_CLIP_IDS: ReadonlySet<string> = new Set(
    Object.values(EMOTION_IDLE_POOLS).flat()
  )

  constructor(dictionary: AnimationDictionary) {
    this.dictionary = dictionary
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  init(avatarRoot: THREE.Object3D, clips?: THREE.AnimationClip[]): void {
    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init 0.3.90 (134 clips: 34 RPM + 39 RPM2 + 16 RPM2f + 45 Mixamo, no ACTS) —', avatarRoot.name || '(unnamed)')

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
      // Warn ONCE at 120 frames, and only if the dictionary genuinely has no
      // resolvable idle for this emotion — not because the (possibly stale)
      // hardcoded pool head is missing from the active pack. Avoids the
      // misleading "dict missing: mx_m_standard_idle" spam when Pack 5 is loaded
      // but its own idles (mc_m_idle_*) are available.
      if (++this.pendingIdleFrames === 120 && this._pickNextIdle(this.currentEmotion) === null) {
        console.warn(
          `[SkeletalController] pendingIdle after 120 frames — no loadable idle for emotion "${this.currentEmotion}" in active pack`
        )
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
        if (next && next !== this.currentIdleClipId) this._playIdle(this.currentEmotion, next)
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
   * Stop and remove all mixer actions EXCEPT the ones passed in.
   * Prevents stale low-weight actions from accumulating across
   * gesture→idle→gesture cycles and bleeding bind-pose into blends.
   */
  private _stopStaleActions(...keep: (THREE.AnimationAction | null)[]): void {
    if (!this.mixer) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allActions: THREE.AnimationAction[] = (this.mixer as any)?._actions ?? []
    const keepSet = new Set(keep.filter(Boolean))
    for (const action of allActions) {
      if (!keepSet.has(action)) {
        action.stop()
      }
    }
  }

  /**
   * Returns true if the given clip ID is an idle pool clip.
   * Used to detect when VD accidentally selects an idle as a gesture.
   */
  private _isIdleClip(animId: string): boolean {
    return SkeletalController.ALL_IDLE_CLIP_IDS.has(animId)
  }

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
    const id = this._pickNextIdle(this.currentEmotion)
    if (!id) return  // no valid idle loaded yet — retry next frame
    const entry = this.dictionary.get(id)
    if (!entry) return  // dict not ready yet — retry next frame

    this.pendingIdle       = false
    this.currentIdleClipId = id
    this.isInGesture       = false

    const idleClip   = this._getRetargeted(entry.clip)
    const idleAction = this.mixer.clipAction(idleClip)
    idleAction.setLoop(THREE.LoopRepeat, Infinity)
    idleAction.clampWhenFinished = false

    if (this.currentAction && this.currentAction !== idleAction) {
      // There is an active action (e.g. a clamped gesture that couldn’t find
      // its idle target when onFinished fired). Crossfade instead of hard-play
      // so bones always have a driver — no bind-pose flash.
      const outgoing = this.currentAction
      const fadeDuration = 0.5
      console.log(
        `[SkeletalController] pendingIdle → crossfade: "${outgoing.getClip().name}" → "${id}" (${fadeDuration}s)`
      )
      idleAction.reset().play()
      outgoing.crossFadeTo(idleAction, fadeDuration, false)
      // Stop all other stale actions — keep only outgoing + incoming
      this._stopStaleActions(outgoing, idleAction)
      this.fadingAction  = outgoing
    } else {
      // Clean start — no prior action. Hard-play at full weight.
      console.log('[SkeletalController] first idle (clean):', id)
      idleAction.setEffectiveWeight(1)
      idleAction.play()
    }
    this.currentAction = idleAction
  }

  /**
   * Pick the next idle clip id for an emotion, constrained to clips actually
   * present in the loaded dictionary. The hardcoded EMOTION_IDLE_POOLS are
   * treated as *preferences*, not guarantees — the dictionary filters them to
   * what is loaded and supplies pack-local / name-based fallbacks. Returns null
   * when no valid idle exists (caller retains the current base action).
   *
   * This is the fix for the pack-fallback bug: pools list mx_m_/rpm_ ids, but
   * when Pack 5 (mc_m_) is loaded none of those exist, so the old code returned
   * a missing id and left the avatar stuck on a clamped gesture pose while
   * spamming "dict missing: mx_m_standard_idle".
   */
  private _pickNextIdle(emotion: EmotionId): string | null {
    const pool = EMOTION_IDLE_POOLS[emotion] ?? EMOTION_IDLE_POOLS.neutral
    return this.dictionary.resolveIdleId(emotion, pool, this.currentIdleClipId)
  }

  private _playIdle(emotion: EmotionId, idleId?: string): void {
    if (!this.mixer) return
    const id = idleId ?? this._pickNextIdle(emotion)
    if (!id) {
      // No valid idle loaded — keep the current base action driving the bones
      // and arm pendingIdle so we retry once a dictionary is available.
      this.pendingIdle = true
      return
    }
    const entry = this.dictionary.get(id)
    if (!entry) return

    this.currentIdleClipId = id
    this.isInGesture       = false
    this.idlePoolTimer     = 0

    const idleClip   = this._getRetargeted(entry.clip)
    const nextAction = this.mixer.clipAction(idleClip)
    nextAction.setLoop(THREE.LoopRepeat, Infinity)
    nextAction.clampWhenFinished = false

    if (this.currentAction && this.currentAction !== nextAction) {
      const outgoing     = this.currentAction
      const fadeDuration = 0.5
      console.log(
        `[SkeletalController] idle: "${outgoing.getClip().name}" → "${id}" (${fadeDuration}s | ` +
        `outClamped=${outgoing.clampWhenFinished} outW=${outgoing.getEffectiveWeight().toFixed(2)})`
      )
      // Stop all stale actions before starting the crossfade.
      // Stale actions at low weight prevent the normalised sum from reaching 1
      // — bones partially driven by bind pose for the entire fade duration.
      this._stopStaleActions(outgoing, nextAction)
      nextAction.reset().play()
      outgoing.crossFadeTo(nextAction, fadeDuration, false)
      this.fadingAction = outgoing
    } else {
      console.log(`[SkeletalController] idle (clean start): "${id}"`)
      nextAction.setEffectiveWeight(1)
      nextAction.play()
    }
    this.currentAction = nextAction
  }

  private _playGesture(animId: string, crossfadeDuration: number): void {
    if (!this.mixer) return

    // Guard: if the VD selected an idle clip as a gesture, re-route to _playIdle.
    // Idle clips played as LoopOnce end immediately and cause the return-to-idle
    // crossfade to fire in a tight loop, producing a rapid snap sequence.
    if (this._isIdleClip(animId)) {
      console.warn(
        `[SkeletalController] "${animId}" is an idle clip — re-routing to _playIdle (not playing as gesture)`
      )
      this._playIdle(this.currentEmotion, animId)
      return
    }

    const entry = this.dictionary.get(animId)
    if (!entry) {
      console.warn(`[SkeletalController] "${animId}" not found in dictionary`)
      return
    }

    // Mint a new token. Any onFinished handler holding an old token will
    // see a mismatch and no-op — prevents stale listeners from firing
    // _returnToIdleWithFade multiple times when gestures are interrupted.
    const token = ++this.gestureToken

    // In-fade: how long to blend FROM the current idle INTO this gesture.
    // Use 0.35s minimum so even short clips don’t snap in.
    const inFadeDuration  = Math.max(crossfadeDuration > 0 ? crossfadeDuration : 0.3, 0.35)
    // Out-fade: how long to blend FROM the clamped gesture INTO the next idle.
    // 0.6s gives enough time for arm bones to interpolate from gesture pose.
    const outFadeDuration = 0.6

    const outgoing = this.currentAction
    console.log(
      `[SkeletalController] gesture: "${outgoing?.getClip().name ?? 'none'}" → "${animId}" ` +
      `(token ${token} | in=${inFadeDuration.toFixed(2)}s | out=${outFadeDuration}s)`
    )

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
    // driving bones while the crossfade to idle ramps up (outFadeDuration).
    // Without clamp, Three.js disables the action on 'finished' → zero bone
    // driver for one frame → bind-pose flash before idle takes over.
    nextAction.clampWhenFinished = true
    // Do NOT pre-set weight to 0. crossFadeTo owns the weight ramp (0→1
    // over inFadeDuration). Pre-setting weight=0 overrides the interpolant
    // and keeps the gesture at weight 0 for its entire duration → bind pose.
    nextAction.reset().play()

    if (outgoing && outgoing !== nextAction) {
      // Stop all other stale actions first so they don’t contribute
      // low-weight bind-pose bleed during the fade window.
      this._stopStaleActions(outgoing, nextAction)
      outgoing.crossFadeTo(nextAction, inFadeDuration, false)
      this.fadingAction = outgoing
    } else {
      // No prior action — just start at full weight.
      nextAction.setEffectiveWeight(1)
      this.fadingAction = null
    }
    this.currentAction = nextAction

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allActionsAtStart: number = ((this.mixer as any)?._actions ?? []).length
    console.log(
      `[SkeletalController]   mixer action count after gesture start: ${allActionsAtStart}` +
      ` | outClamped=${outgoing?.clampWhenFinished ?? 'n/a'} | baseDriven=true (single-layer)`
    )

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      // Guard 1: wrong action (Three.js fires 'finished' for any action that ends)
      if (e.action !== nextAction) return
      // Guard 2: stale token — this gesture was interrupted by a newer one
      if (this.gestureToken !== token) {
        this.mixer!.removeEventListener('finished', onFinished)
        return
      }
      this.mixer!.removeEventListener('finished', onFinished)
      console.log(
        `[SkeletalController] gesture done: "${animId}" (token ${token})` +
        ` | returning to idle with ${outFadeDuration}s fade`
      )
      if (this.avatarRoot) logArmBoneQuats('post-gesture', this.avatarRoot)
      this.isInGesture  = false
      this.fadingAction = null
      // clampWhenFinished=true means the gesture is still enabled and
      // holding its final pose — we crossfade FROM it into the idle.
      // The gesture keeps driving bones for the full outFadeDuration,
      // so there is never a frame with zero bone contribution (no flash).
      this._returnToIdleWithFade(nextAction, outFadeDuration)
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
  private _returnToIdleWithFade(fromAction: THREE.AnimationAction, fadeDuration = 0.6): void {
    if (!this.mixer) return
    const id    = this._pickNextIdle(this.currentEmotion)
    const entry = id ? this.dictionary.get(id) : null
    if (!id || !entry) {
      // No valid idle loaded (e.g. dict not ready, or pools list ids absent
      // from the active pack). Crossfade via pendingIdle retry — don’t hard-stop
      // the clamped gesture: let it keep holding the pose so bones stay driven.
      // _tryStartIdle will crossfade FROM it once a valid idle resolves.
      this.pendingIdle   = true
      this.currentAction = fromAction  // keep reference so _tryStartIdle can fade FROM it
      return
    }

    this.currentIdleClipId = id
    this.idlePoolTimer     = 0

    const idleClip   = this._getRetargeted(entry.clip)
    const idleAction = this.mixer.clipAction(idleClip)
    idleAction.setLoop(THREE.LoopRepeat, Infinity)
    idleAction.clampWhenFinished = false

    // Stop all stale actions (previous idles, prior crossfade remnants)
    // before starting the new crossfade. Only fromAction + idleAction should
    // be active — no other action should be contributing bind-pose bleed.
    this._stopStaleActions(fromAction, idleAction)

    idleAction.reset().play()

    console.log(
      `[SkeletalController] return-to-idle: "${fromAction.getClip().name}" → "${id}" ` +
      `(${fadeDuration}s | fromClamped=true | fromW=${fromAction.getEffectiveWeight().toFixed(2)})`
    )

    // Crossfade from the still-clamped gesture into the idle.
    // This ramps gesture 1→0 and idle 0→1 over fadeDuration — bones always driven.
    fromAction.crossFadeTo(idleAction, fadeDuration, false)
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

  /**
   * Notify the controller that the active animation pack/dictionary changed.
   * Clears the retargeted-clip cache (clips from the previous pack are now
   * stale) and re-derives the active idle from the newly-loaded dictionary.
   *
   * Must be called after `dictionary.loadPack(url)` resolves. Without this the
   * controller keeps trying to play idle ids from the old pack (e.g. mx_m_*
   * after switching to the mc_m_ coach pack) — the source of the
   * "dict missing: mx_m_standard_idle" fallback bug.
   */
  notifyPackChanged(): void {
    this.retargetedClipCache.clear()
    // Drop the stale idle id so resolution does not try to exclude / reuse a
    // clip that no longer exists in the new pack.
    this.currentIdleClipId = ''
    this.idlePoolTimer     = 0
    // Re-derive an idle from the new dictionary. If a gesture is mid-flight we
    // leave it; its onFinished handler will resolve to a valid pack idle.
    if (!this.isInGesture) {
      this.pendingIdle = true
      this._tryStartIdle()
    }
  }

  reset(): void {
    this.mixer?.stopAllAction()  // stops all actions and clears the internal _actions array
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
