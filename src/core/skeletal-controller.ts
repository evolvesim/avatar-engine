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
import {
  isIdleClip as isRegisteredIdleClip,
  clipsForFunction,
  idlesForManner,
  isOffGenderClip,
} from './situational-clips'
import type { ClipFunction, ClipManner, ClipGender } from './situational-clips'

// ── Situational idle selection ───────────────────────────────────────────────
//
// Emotion no longer chooses the body's resting pose. It persists on the FACE (see
// EmotionStateMachine / _applyPerformanceData), so a character who turns sad stays
// visibly sad across exchanges while still resting and gesturing appropriately for
// what is being said.
//
// The previous design keyed idle pools off the emotion — EMOTION_IDLE_POOLS, one
// list per emotion. Two problems killed it:
//
//   1. With one idle per emotion, a conversation that settled on an emotion sat on
//      a single loop, and the whole scene read as that one mood.
//   2. Whenever an emotion had no idle in the loaded pack it fell back to neutral,
//      so the "emotional" body language was mostly absent anyway.
//
// Now resting poses are just clips whose function is `rest`, and the director asks
// for a specific clip when it wants something particular. Membership in the
// generated registry (situational-clips.ts) is what marks a clip as an idle and
// gets it played LoopRepeat; unregistered clips from a legacy pack fall back to a
// name heuristic so they still loop rather than flashing a T-pose.
const REST_FUNCTION: ClipFunction = 'rest'

// ── Which resting poses the current feeling permits ──────────────────────────
//
// Decoupling emotion from the body was right, but the first cut went too far: it
// drew UNIFORMLY from every `rest` clip. The CC pack has 18 of them and 9 carry a
// manner — cc_slouched "when tired", cc_side_eye "when wary or scared",
// cc_crossed_arms_looking_down "when detached", cc_masculine_look_around "when
// uncomfortable", cc_angry_breathing_fast "when agitated", and four more. So every
// re-roll was a coin flip on whether the character stood there characterised by
// accident: a salesperson dropping into a slouch, or a wary side-eye, in a
// conversation that called for neither.
//
// The fix is not to re-couple emotion to the body. It is to say that a
// CHARACTERISED pose has to be earned: a manner is only in rotation when the
// sustained feeling actually supports it. Everything else rests on the
// uncharacterised poses, which is what "standard and subtle" means.
//
// `neutral` maps to no manners at all — deliberately the strictest case, because it
// is also the most common.
const EMOTION_IDLE_MANNERS: Readonly<Record<EmotionId, readonly ClipManner[]>> = {
  neutral:     [],
  happy:       ['relaxed', 'elated'],
  thoughtful:  ['guarded'],
  sadness:     ['downcast'],
  displeasure: ['guarded', 'agitated'],
  shy:         ['shy', 'guarded'],
  empathy:     ['relaxed'],
}

// 'formal' is absent from every list above on purpose: a formal stance is never
// WRONG, so it is folded into the always-available set below rather than gated.
const ALWAYS_ALLOWED_IDLE_MANNERS: readonly ClipManner[] = ['formal']

// Resting poses are re-rolled every ~22s. Avoiding only the CURRENT clip lets a
// pool of n cycle back around after n/2 picks on average, which is what "he keeps
// doing the same idle" feels like. Remembering the last few makes a visible
// difference at no cost. Kept below the smallest realistic pool so there is always
// something left to choose.
const IDLE_HISTORY = 3

// ── Diagnostic helpers ────────────────────────────────────────────────────────

function logArmBoneQuats(label: string, root: THREE.Object3D): void {
  // Full-body diagnostic: arms + spine + hips + legs + head.
  // Extended (July 2026) so we can diagnose whole-body orientation bugs from
  // console output (e.g. Pack 8 UE5 root-axis convention leaving character
  // folded/upside-down with correct arm values).
  const BONES = [
    'Hips',
    'Spine', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot',
    'RightUpLeg', 'RightLeg', 'RightFoot',
  ]
  const lines: string[] = []
  const found = new Map<string, THREE.Object3D>()
  root.traverse((obj) => {
    if (BONES.includes(obj.name) && !found.has(obj.name)) found.set(obj.name, obj)
  })
  const deg = (r: number) => (r * 180 / Math.PI).toFixed(1)
  for (const name of BONES) {
    const obj = found.get(name)
    if (!obj) { lines.push(`  ${name.padEnd(14)} (not found)`); continue }
    const q = obj.quaternion
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
    let extra = ''
    if (name === 'Hips') {
      const wp = new THREE.Vector3()
      obj.getWorldPosition(wp)
      extra = ` world[${wp.x.toFixed(2)},${wp.y.toFixed(2)},${wp.z.toFixed(2)}]`
    }
    lines.push(`  ${name.padEnd(14)} q[${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)}] euler[${deg(e.x)}°,${deg(e.y)}°,${deg(e.z)}°]${extra}`)
  }
  if (lines.length === 0) {
    console.warn(`[BoneDiag] ${label}: no bones found`)
  } else {
    console.log(`[BoneDiag] ${label}:\n${lines.join('\n')}`)
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
/**
 * Fix SkinnedMesh.skeleton.bones[] to point at the cloned bones after
 * `gltf.scene.clone(true)`.
 *
 * Three.js's built-in Object3D.clone() creates fresh clones of the bone Object3Ds,
 * but every SkinnedMesh's `skeleton.bones[]` still contains references to the
 * ORIGINAL scene's bones. The AnimationMixer drives whatever tree it was given
 * (the clone), so cloned bones rotate correctly, but SkinnedMesh reads pose
 * from the un-moved original bones → T-pose forever.
 *
 * Fix: walk the cloned tree, build a name→Object3D map, and rewrite
 * each SkinnedMesh's `skeleton.bones[]` to point at the cloned bones.
 *
 * This is the 0.3.11 fix, reintroduced in 0.5.1 for CC4 support.
 * (See the 3d-avatar-lipsync skill for the full history.)
 *
 * NOTE: We do NOT call `skeleton.computeBoneTexture()` here because that
 * requires an active WebGL context. AvatarCanvas.tsx handles that in a
 * useEffect after mount when the WebGL renderer is guaranteed ready.
 */
function rebindSkeletons(root: THREE.Object3D): void {
  const boneMap = new Map<string, THREE.Object3D>()
  root.traverse((obj) => {
    if (obj.name) boneMap.set(obj.name, obj)
  })

  // Ensure world matrices are up to date before we snapshot bindMatrix.
  root.updateMatrixWorld(true)

  let meshesFixed = 0
  let bonesRemapped = 0
  let bindMatrixResets = 0
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return
    mesh.skeleton.bones = mesh.skeleton.bones.map((originalBone) => {
      const cloned = boneMap.get(originalBone.name) as THREE.Bone | undefined
      if (cloned && cloned !== originalBone) {
        bonesRemapped++
        return cloned
      }
      return originalBone
    })

    // ── CC4 bindMatrix fix (0.5.2) ───────────────────────────────────────
    // Some CC4 GLBs (FBX2glTF exported) have bindMatrix=identity while the
    // mesh sits under a scaled Armature (scale 0.01). bindMatrixInverse was
    // captured in the parent-scaled space, so bindMatrix and bindMatrixInverse
    // are NOT inverses of each other. WebGL skinning then produces wildly
    // out-of-scale vertex positions ("explosion") when bones move.
    //
    // Detect the mismatch (|det(bindMatrix * bindMatrixInverse) - 1| > eps)
    // and reset bindMatrix = mesh.matrixWorld, bindMatrixInverse = inverse.
    // This makes the pair consistent with three.js's SkinnedMesh.bind() default.
    const product = new THREE.Matrix4().multiplyMatrices(
      mesh.bindMatrix,
      mesh.bindMatrixInverse
    )
    // Check if product is (close to) identity
    const e = product.elements
    const identityDiff =
      Math.abs(e[0] - 1) + Math.abs(e[5] - 1) + Math.abs(e[10] - 1) +
      Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) +
      Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9])
    if (identityDiff > 0.01) {
      mesh.bindMatrix.copy(mesh.matrixWorld)
      mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert()
      bindMatrixResets++
    }
    // ────────────────────────────────────────────────────────────────────

    meshesFixed++
  })

  console.log(
    `[rebindSkeletons] fixed ${meshesFixed} SkinnedMesh(es), ` +
    `remapped ${bonesRemapped} bone refs` +
    (bindMatrixResets > 0 ? `, reset bindMatrix on ${bindMatrixResets} mesh(es)` : '')
  )
}

function retargetClipToUUIDs(
  clip: THREE.AnimationClip,
  avatarRoot: THREE.Object3D
): { clip: THREE.AnimationClip; bound: number; missed: number } {
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
  return { clip, bound, missed }
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
  /** Most-recently-played idles, newest first. See IDLE_HISTORY. */
  private recentIdleIds:     string[]     = []
  /**
   * The character's gender presentation, when the product knows it. Used only to
   * keep an explicitly-marked opposite-gender clip out of rotation — a male avatar
   * playing `cc_feminine_head_up`. null/undefined means no bias at all.
   */
  private genderBias:        ClipGender | null = null
  private idlePoolTimer:     number       = 0
  private idlePoolInterval:  number       = 22
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
    // ── Fix skeleton.bones[] after gltf.scene.clone(true) ────────────────────
    // Three.js's built-in clone creates new bone objects but SkinnedMesh.skeleton.bones[]
    // still points to the ORIGINAL scene's bones. The AnimationMixer drives the cloned
    // bones (correct), but the SkinnedMesh reads pose from skeleton.bones[] (originals)
    // that never move → T-pose forever. Remap by name before creating the mixer.
    // This is the 0.3.11 fix, reintroduced for CC4 support (0.5.1).
    rebindSkeletons(avatarRoot)

    this.mixer      = new THREE.AnimationMixer(avatarRoot)
    this.avatarRoot = avatarRoot
    console.log('[SkeletalController] init 0.5.2 (rebindSkeletons + bindMatrix fix + CC4 native) —', avatarRoot.name || '(unnamed)')

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
        console.warn('[SkeletalController] pendingIdle after 120 frames — no rest clip in the loaded pack')
      }
    } else {
      this.pendingIdleFrames = 0
    }

    // ── Idle pool cycling (only when fully idle, no gesture active) ───────────
    if (!this.isInGesture && !this.pendingIdle) {
      this.idlePoolTimer += delta
      if (this.idlePoolTimer >= this.idlePoolInterval) {
        this.idlePoolTimer    = 0
        // v0.5.35 — slower idle cycling (was 8–15s, which read as restless
        // "jumping"). A resting avatar holds a pose ~18–34s before drifting to
        // another in the SAME emotion pool.
        this.idlePoolInterval = 18 + Math.random() * 16
        const next = this._pickNextIdle()
        if (next !== this.currentIdleClipId) this._playIdle(next)
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
    return isRegisteredIdleClip(animId)
  }

  /**
   * Returns a UUID-retargeted deep-clone of a clip, cached by the original clip's UUID.
   * The dictionary entry's clip is never mutated — retargeting mutates the clone only.
   * Returns null if the clip binds 0 tracks to the current avatar skeleton
   * (e.g. Mixamo clip on CC4 avatar) — caller must fall back.
   */
  private _getRetargeted(clip: THREE.AnimationClip): THREE.AnimationClip | null {
    const cached = this.retargetedClipCache.get(clip.uuid)
    if (cached) return cached
    const cloned = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(clip))
    cloned.uuid = THREE.MathUtils.generateUUID()
    const { bound } = retargetClipToUUIDs(cloned, this.avatarRoot!)
    if (bound === 0) {
      console.warn(
        `[SkeletalController] Clip "${clip.name}" bound 0 tracks to avatar — ` +
        `probable cross-skeleton mismatch (e.g. Mixamo idle on CC4 avatar). ` +
        `Skipping and returning null.`
      )
      return null
    }
    this.retargetedClipCache.set(clip.uuid, cloned)
    return cloned
  }

  /**
   * Find any clip in the dictionary whose bone names match the current avatar
   * skeleton. Used as a cross-skeleton fallback when the emotion idle pool
   * (hardcoded Mixamo IDs) can't bind on a CC4 avatar.
   */
  private _findCompatibleClipInDict(): { id: string; entry: { clip: THREE.AnimationClip } } | null {
    if (!this.avatarRoot) return null
    // Build a set of lowercase bone names in this avatar for a quick prefix check.
    const boneNames = new Set<string>()
    this.avatarRoot.traverse((o) => { if (o.name) boneNames.add(o.name.toLowerCase()) })

    for (const [id, entry] of (this.dictionary as unknown as { clips: Map<string, { clip: THREE.AnimationClip }> }).clips) {
      const clip = entry.clip
      // Sample up to first 5 track bone names; if any match, this clip is compatible.
      let hits = 0
      for (let i = 0; i < Math.min(clip.tracks.length, 8); i++) {
        const t = clip.tracks[i]
        const dot = t.name.lastIndexOf('.')
        const name = t.name.slice(0, dot).replace(/_\d+$/, '').toLowerCase()
        if (boneNames.has(name)) hits++
      }
      if (hits > 0) return { id, entry }
    }
    return null
  }

  private _tryStartIdle(): void {
    if (!this.pendingIdle || !this.mixer) return
    let id    = this._pickNextIdle()
    let entry = this.dictionary.get(id)
    if (!entry) return  // dict not ready yet — retry next frame

    let idleClip = this._getRetargeted(entry.clip)
    if (!idleClip) {
      // Emotion pool clip is incompatible with this skeleton — fall back to
      // any compatible clip in the dictionary (CC4 pack, etc.).
      const fb = this._findCompatibleClipInDict()
      if (!fb) {
        console.warn('[SkeletalController] No compatible idle in dict — retrying next frame')
        return
      }
      id = fb.id
      entry = fb.entry as typeof entry
      idleClip = this._getRetargeted(entry.clip)
      if (!idleClip) return  // shouldn't happen but bail safely
      console.log(`[SkeletalController] Cross-skeleton fallback idle → "${id}"`)
    }

    this.pendingIdle       = false
    this.currentIdleClipId = id
    this._noteIdlePlayed(id)
    this.isInGesture       = false

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
   * Pick the next resting pose.
   *
   * Emotion still does not choose a SPECIFIC clip — it only decides which
   * emotional colourings are eligible at all (EMOTION_IDLE_MANNERS). At neutral,
   * which is most of any conversation, that means only the uncharacterised poses,
   * so the character stands and listens rather than slouching or throwing a wary
   * side-eye for no reason.
   *
   * Widening is stepwise so a thin pack still rests:
   *   1. Poses whose manner the current feeling permits.
   *   2. Uncharacterised poses only (the "standard" set).
   *   3. Every `rest` clip in the pack.
   *   4. Anything the pack itself presents as an idle (unmapped legacy packs).
   */
  private _pickNextIdle(): string {
    // In the pack, and not explicitly marked for the other gender. Applied at every
    // widening step so the bias survives a fallback — a male avatar should not end up
    // in `cc_feminine_head_up` just because the manner-permitted pool was thin.
    // Never applied to the LAST resort: resting in an off-gender pose beats freezing.
    const inPack = (ids: string[]) =>
      ids.filter(id => !!this.dictionary.get(id) && !isOffGenderClip(id, this.genderBias))

    const allowed = [
      ...(EMOTION_IDLE_MANNERS[this.currentEmotion] ?? []),
      ...ALWAYS_ALLOWED_IDLE_MANNERS,
    ]
    let available = inPack(idlesForManner(allowed).map(c => c.id))

    if (available.length === 0) {
      available = inPack(idlesForManner(ALWAYS_ALLOWED_IDLE_MANNERS).map(c => c.id))
    }
    if (available.length === 0) {
      available = inPack(clipsForFunction(REST_FUNCTION, 'idle').map(c => c.id))
    }
    // Drop the gender bias before the legacy-pack fallback: a pack with only
    // off-gender idles must still rest rather than stand frozen.
    if (available.length === 0) {
      available = clipsForFunction(REST_FUNCTION, 'idle')
        .map(c => c.id)
        .filter(id => !!this.dictionary.get(id))
    }
    // A legacy or unmapped pack contributes no registry `rest` clips. Fall back to
    // anything the pack itself presents as an idle, so such packs still rest
    // instead of freezing.
    if (available.length === 0) {
      available = this.dictionary.animationIds.filter(id => this._isIdleClip(id))
    }
    if (available.length === 0) return ''
    if (available.length === 1) return available[0]

    // Avoid the last few, not just the current one — see IDLE_HISTORY.
    let candidates = available.filter(id => !this.recentIdleIds.includes(id))
    if (candidates.length === 0) {
      candidates = available.filter(id => id !== this.currentIdleClipId)
    }
    const pick = candidates.length > 0 ? candidates : available
    return pick[Math.floor(Math.random() * pick.length)]
  }

  /** Record a played idle in the anti-repeat history. */
  private _noteIdlePlayed(id: string): void {
    if (!id) return
    this.recentIdleIds = [id, ...this.recentIdleIds.filter(x => x !== id)].slice(0, IDLE_HISTORY)
  }

  private _playIdle(idleId?: string): void {
    if (!this.mixer) return
    let id    = idleId ?? this._pickNextIdle()
    let entry = this.dictionary.get(id)
    if (!entry) return

    let idleClip = this._getRetargeted(entry.clip)
    if (!idleClip) {
      const fb = this._findCompatibleClipInDict()
      if (!fb) {
        console.warn(`[SkeletalController] _playIdle: no compatible clip in dict — skip`)
        return
      }
      id = fb.id
      entry = fb.entry as typeof entry
      idleClip = this._getRetargeted(entry.clip)
      if (!idleClip) return
      console.log(`[SkeletalController] Cross-skeleton fallback idle → "${id}"`)
    }

    // Clear stale pending cues — switching to idle means no active speech.
    // Prevents cues from a previous loadPerformance call firing on the next
    // onWordBoundary tick (e.g. from viseme drain in AvatarCanvas).
    this.pendingCues = []
    this.wordCounter = 0

    this.currentIdleClipId = id
    this._noteIdlePlayed(id)
    this.isInGesture       = false
    this.idlePoolTimer     = 0

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
      this._playIdle(animId)
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
    const { bound: gestureBound } = retargetClipToUUIDs(gestureClip, this.avatarRoot!)
    if (gestureBound === 0) {
      console.warn(
        `[SkeletalController] Gesture "${animId}" bound 0 tracks — cross-skeleton mismatch. Aborting play.`
      )
      this.isInGesture = false
      return
    }

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
    let id    = this._pickNextIdle()
    let entry = this.dictionary.get(id)
    if (!entry) {
      // Dict not ready — crossfade via pendingIdle retry.
      // Don’t hard-stop the clamped gesture: let it keep holding the pose.
      // _tryStartIdle will crossfade from it when the dict resolves.
      this.pendingIdle   = true
      this.currentAction = fromAction  // keep reference so _tryStartIdle can fade FROM it
      return
    }

    let idleClip = this._getRetargeted(entry.clip)
    if (!idleClip) {
      const fb = this._findCompatibleClipInDict()
      if (!fb) {
        console.warn('[SkeletalController] return-to-idle: no compatible clip — clamping current')
        this.pendingIdle   = true
        this.currentAction = fromAction
        return
      }
      id = fb.id
      entry = fb.entry as typeof entry
      idleClip = this._getRetargeted(entry.clip)
      if (!idleClip) {
        this.pendingIdle   = true
        this.currentAction = fromAction
        return
      }
      console.log(`[SkeletalController] Cross-skeleton fallback return-to-idle → "${id}"`)
    }

    this.currentIdleClipId = id
    this._noteIdlePlayed(id)
    this.idlePoolTimer     = 0

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

  /**
   * Record the current emotion for diagnostics only.
   *
   * This used to re-pick the body idle whenever the emotion changed, which is the
   * coupling that made an emotional conversation sit on one loop. Emotion is now
   * expressed on the FACE and persists there across exchanges; the body rests and
   * gestures according to what is being said. Kept as a no-op for the body so the
   * public API and its callers are unchanged.
   */
  /**
   * Bias clip selection toward a gender presentation.
   *
   * Only clips the author explicitly marked (`*_feminine_*` / `*_masculine_*` — 19 of
   * 130) are affected; the other 111 suit anyone. Pass null for a non-binary
   * character or when the product does not know, and nothing is filtered.
   *
   * Safe to call before or after init: it only changes which clips the NEXT idle roll
   * considers.
   */
  setGenderBias(gender: ClipGender | null): void {
    this.genderBias = gender
  }

  onEmotionChange(emotion: EmotionId): void {
    this.currentEmotion = emotion
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
