/**
 * AvatarCanvas.tsx — Shared avatar engine for all Evolve Simulations products
 *
 * Integrates all subsystems from the animation system design:
 *   - Viseme queue drain + ARKit morph target lerp
 *   - Additive blending (emotion baseline × α + viseme + procedural)
 *   - Emotion-persistent facial expression state machine
 *   - Skeletal animation controller (AnimationMixer + WordBoundary triggers)
 *   - Procedural micro-animations (blink, respiration, head tracking, saccades)
 *   - WebAudio FFT fallback for non-Azure providers
 *   - T-pose correction for Avaturn GLBs
 *   - Camera framing presets
 *   - Lighting presets (boardroom / consumer / education)
 *
 * ─── Architecture ─────────────────────────────────────────────────────────────
 *
 *   AvatarEngine
 *     → visemeQueueRef (Azure viseme events)
 *     → emotionStateMachine (persistent FACS→ARKit)
 *     → skeletalController (AnimationMixer + gestures)
 *     → fftFallback (WebAudio amplitude)
 *          ↓
 *   useFrame (60fps):
 *     drain viseme queue → viseme ARKit weights
 *     emotion.effectiveWeights(isSpeaking) → attenuated emotion weights
 *     fftFallback.tick() → fallback weights (if viseme queue empty)
 *     ocular tick → blink + saccade weights
 *     additiveBlend(emotion, viseme|fft, procedural)
 *     lerpWeightMap(current, target, delta)
 *     applyWeightsToMeshes(lerped, meshRefs)
 *     tickRespiration → spine/chest bones
 *     tickHeadTracking → neck/head bones (FFT amplitude)
 *     skeletalController.update(delta)
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   <AvatarCanvas
 *     engine={avatarEngine}
 *     glbUrl="/avatars/professional-male.glb"
 *     cameraPreset="head-and-shoulders"
 *     lightingPreset="boardroom"
 *   />
 */

'use client'

import React, {
  Suspense,
  useRef,
  useEffect,
  useMemo,
} from 'react'
import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'

import type { AvatarEngine }     from './avatar-engine'
import type {
  CameraPreset,
  LightingPreset,
  TTSAdapter,
  DirectorConfig,
} from './types'
import { CAMERA_PRESETS }        from './types'
import { VISEME_TO_ARKIT, AVATURN_MESH_NAMES, buildVisemeTargets } from './viseme-map'
import {
  additiveBlend,
  lerpWeightMap,
  applyWeightsToMeshes,
} from './additive-blend'
import {
  createOcularState,
  createRespirationState,
  createHeadTrackingState,
  createGazeState,
  tickOcularMechanics,
  tickRespiration,
  tickHeadTracking,
  tickGaze,
  fixTPose,
  findBone,
} from './procedural-animations'
import type { ARKitWeights } from './emotion-state'
import { hasFaceRig, mergeFaceRig } from './merge-face-rig'

/**
 * Default URL for the engine-shipped donor face rig (canonical Avaturn face meshes
 * + ARKit blendshapes + `avaturn_animation` idle). Consumers can override via the
 * `faceRigUrl` prop, but the typical case is to leave this default — the engine
 * ships face-rig.glb under /avatar-engine/.
 *
 * IMPORTANT: This is a path relative to the host site's public root. The hosting
 * product (Evolve RPG / ACTS / EvySim) must serve `face-rig.glb` at this URL —
 * either by copying it from `node_modules/@evolvesim/avatar-engine/public/avatar-engine/`
 * to its own `public/avatar-engine/` directory, or by setting up a build-time
 * symlink. See the upload-pipeline section in the 3d-avatar-lipsync skill.
 */
export const DEFAULT_FACE_RIG_URL = '/avatar-engine/face-rig.glb'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AvatarCanvasProps {
  engine:          AvatarEngine
  /**
   * TTSAdapter for this avatar. The engine already holds an adapter; this prop
   * is exposed for callers that want to wire the adapter explicitly at the
   * canvas level (e.g. for conversational-mode connect/disconnect on mount).
   * If omitted, `engine.adapter` is used.
   */
  adapter?:        TTSAdapter
  /** Optional VirtualDirector preset — defaults to trainingDirectorConfig in callers. */
  directorConfig?: DirectorConfig
  glbUrl?:         string
  /**
   * URL of the canonical face rig GLB used when `mergeFaceRig` is true (or auto-
   * detected as needed). Defaults to `DEFAULT_FACE_RIG_URL` (engine-shipped asset).
   * The donor must contain the six face meshes (Head_Mesh, Teeth_Mesh, Tongue_Mesh,
   * Eye_Mesh, Eyelash_Mesh, EyeAO_Mesh) with ARKit blendshapes and an `avaturn_animation`
   * clip. See merge-face-rig.ts for the contract.
   */
  faceRigUrl?:     string
  /**
   * Controls whether the engine merges the face rig (`faceRigUrl`) into the body
   * GLB at load time.
   *   - `'auto'` (default): merge only when the body GLB has no ARKit blendshapes
   *     (i.e. body-only Avaturn exports). Already-rigged GLBs are left untouched.
   *   - `true`: always merge.
   *   - `false`: never merge (body GLB must already have face meshes + ARKit shapes).
   *
   * The `'auto'` mode is what every product upload pipeline should use — drop
   * any Avaturn export in and the engine handles the rest.
   */
  mergeFaceRig?:   'auto' | boolean
  cameraPreset?:   CameraPreset
  lightingPreset?: LightingPreset
  bodyRotationY?:  number
  /**
   * Y offset applied to the avatar primitive in world space.
   * Default -1.52 (Avaturn standard Hips=1.52m).
   * Override if your GLB's Hips bone is at a different height.
   * Use: -(headWorldY - cameraTargetY) to frame head at the camera target.
   *
   * Issue #4 (May 2026): prior 0.3.1 publish appeared to ignore this prop
   * for some consumers. Republished as 0.3.2 from a clean build to ensure
   * the prop reaches the underlying `<primitive>` correctly. The prop chain
   * is: AvatarCanvas → AvatarScene → `<primitive position={[x, y, 0]}>`.
   */
  avatarYOffset?:  number
  /**
   * When false, skip the Avaturn-arm `fixTPose()` correction.
   * Default true (back-compatible — corrects classic Avaturn T-pose exports).
   * Set false when consuming an Avaturn A-pose export or any rig that already
   * has natural arm rotation and does NOT need the ±1.1 rad shoulder fix.
   */
  applyTPoseFix?:  boolean
  /**
   * X offset applied to the avatar primitive in world space. Default 0 (centred).
   * Use this for horizontal positioning inside the canvas — CSS translates on the
   * wrapper don't move the avatar visually because the camera re-centres around
   * world X=0. Example: `avatarXOffset={-0.1}` nudges the avatar 10cm to the left.
   */
  avatarXOffset?:  number
  /**
   * When true, automatically compute `avatarYOffset` at runtime by measuring
   * the head bone's world Y position in the loaded GLB. Overrides any
   * manually supplied `avatarYOffset` value.
   *
   * The formula targets Y ≈ 1.6 in camera space (the `head-and-shoulders`
   * camera preset target): `computedOffset = -(headWorldY - 1.6)`.
   *
   * If no head bone is found, falls back to the supplied `avatarYOffset`
   * prop (or the default `-1.52`) and logs a warning.
   *
   * Default: false (backwards-compatible).
   */
  autoCalibrate?:  boolean
  /**
   * Override the camera world-space position. When supplied, takes precedence
   * over the `cameraPreset` position. Format: [x, y, z].
   * Example: `cameraPosition={[0, -0.1, 1.4]}` lowers the camera so it looks
   * up at the avatar's face, achieving natural eye contact.
   */
  cameraPosition?: [number, number, number]
  /**
   * Override the camera look-at target. When supplied, takes precedence over
   * the `cameraPreset` target. Format: [x, y, z].
   */
  cameraTarget?:   [number, number, number]
  /**
   * URL to a custom animation pack GLB file.
   * When provided, the AnimationDictionary reloads clips from this URL.
   * Changing this prop at runtime triggers a pack reload.
   *
   * Pack options (set by admin or avatar builder):
   *   '/avatar-engine/animations.glb'        — default (RPM clips, all styles)
   *   '/avatar-engine/animations-pack1.glb'  — Pack 1: Motion Male (mx_m_)
   *   '/avatar-engine/animations-pack2.glb'  — Pack 2: Motion Female (mx_f_ + cross-pack)
   *   '/avatar-engine/animations-pack3.glb'  — Pack 3: RPM Male (rpm_, rpm2_)
   *   '/avatar-engine/animations-pack4.glb'  — Pack 4: RPM Female (rpm2f_)
   *
   * Default: undefined (keeps the engine's existing loaded dictionary)
   */
  animationPackUrl?: string
  className?:      string
}

// ── Camera setup ──────────────────────────────────────────────────────────────

function CameraSetup({
  preset,
  positionOverride,
  targetOverride,
}: {
  preset: CameraPreset
  positionOverride?: [number, number, number]
  targetOverride?: [number, number, number]
}) {
  const { camera } = useThree()
  const cfg = CAMERA_PRESETS[preset]

  useEffect(() => {
    const pos = positionOverride ?? cfg.position
    const tgt = targetOverride   ?? cfg.target
    camera.position.set(...pos)
    ;(camera as THREE.PerspectiveCamera).fov = cfg.fov
    ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    camera.lookAt(...tgt)
  }, [camera, cfg, positionOverride, targetOverride])

  return null
}

// ── Lighting ──────────────────────────────────────────────────────────────────

function Lighting({ preset }: { preset: LightingPreset }) {
  const configs = {
    boardroom: { ambient: '#d4e6f1', key: '#ffffff', keyIntensity: 1.4, fill: '#bfc9ca', fillIntensity: 0.6 },
    consumer:  { ambient: '#c7a8f5', key: '#ffffff', keyIntensity: 1.6, fill: '#8e44ad', fillIntensity: 0.4 },
    education: { ambient: '#e8f5e9', key: '#ffffff', keyIntensity: 1.5, fill: '#aed6f1', fillIntensity: 0.5 },
  }
  const c = configs[preset]
  return (
    <>
      <ambientLight color={c.ambient} intensity={0.7} />
      <directionalLight color={c.key}  intensity={c.keyIntensity}  position={[2, 4, 3]} castShadow />
      <directionalLight color={c.fill} intensity={c.fillIntensity} position={[-2, 2, -1]} />
    </>
  )
}

// ── Avatar scene ──────────────────────────────────────────────────────────────

const HEAD_BONE_NAMES = ['head', 'mixamorighead', 'bip001_head']

// Guard against re-running the merge on the same cached GLTF. useLoader returns
// the same object across re-renders; we mutate it in place once, then skip.
const mergedBodies = new WeakSet<object>()
// Camera target Y for the 'head-and-shoulders' preset (see CAMERA_PRESETS in types.ts).
// autoCalibrate shifts the avatar so the head bone sits at this Y in world space,
// putting the head at the camera's look-at point and framing it correctly.
const CAMERA_TARGET_Y = 0.1

function findHeadBoneByNames(root: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (found) return
    if (HEAD_BONE_NAMES.includes(obj.name.toLowerCase())) {
      found = obj
    }
  })
  return found
}

function AvatarScene({
  engine,
  glbUrl,
  faceRigUrl,
  mergeFaceRigMode,
  bodyRotationY,
  avatarYOffset,
  applyTPoseFix,
  avatarXOffset,
  autoCalibrate,
}: {
  engine:           AvatarEngine
  glbUrl:           string
  faceRigUrl:       string
  mergeFaceRigMode: 'auto' | boolean
  bodyRotationY:    number
  avatarYOffset:    number
  applyTPoseFix:    boolean
  avatarXOffset:    number
  autoCalibrate:    boolean
}) {
  // Decide up-front whether we need the donor face rig. When `mergeFaceRigMode`
  // is explicitly false the donor URL is omitted from the loader call so the
  // engine never fetches face-rig.glb on already-rigged GLBs.
  // Parallel load: useLoader accepts an array of URLs and returns an array of
  // GLTFs, so body + donor stream together when a merge is possible.
  const loadUrls = mergeFaceRigMode === false ? [glbUrl] : [glbUrl, faceRigUrl]
  const loaded   = useLoader(GLTFLoader, loadUrls) as unknown as (
    typeof loadUrls extends string[] ? Array<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> : never
  )
  const bodyGltf  = loaded[0] as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }
  const donorGltf = loaded[1] as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] } | undefined

  // ── Merge face rig (idempotent, runs once per body GLTF instance) ─────────
  // We mutate the cached bodyGltf so the next time useLoader returns it the merge
  // is already applied. A WeakSet guards against double-merging on re-render.
  const gltf = useMemo(() => {
    if (mergeFaceRigMode === false || !donorGltf) return bodyGltf
    if (mergedBodies.has(bodyGltf)) return bodyGltf
    const shouldMerge = mergeFaceRigMode === true ? true : !hasFaceRig(bodyGltf.scene)
    if (!shouldMerge) {
      console.info('[AvatarCanvas] face rig already present in body GLB — skipping runtime merge.')
      mergedBodies.add(bodyGltf)
      return bodyGltf
    }
    console.info('[AvatarCanvas] merging donor face rig into body GLB.')
    mergeFaceRig(bodyGltf as unknown as Parameters<typeof mergeFaceRig>[0], donorGltf as unknown as Parameters<typeof mergeFaceRig>[1])
    mergedBodies.add(bodyGltf)
    return bodyGltf
  }, [bodyGltf, donorGltf, mergeFaceRigMode])

  const scene = useMemo(() => gltf.scene.clone(true), [gltf])
  const clips = gltf.animations  // animations live on gltf, NOT on gltf.scene

  // ── R3F camera (for VOR gaze) ─────────────────────────────────────────────
  const { camera } = useThree()

  // ── Compute effective Y offset (auto-calibrate or supplied) ────────────────
  const effectiveYOffset = useMemo(() => {
    if (!autoCalibrate) return avatarYOffset
    gltf.scene.updateMatrixWorld(true)
    const head = findHeadBoneByNames(gltf.scene)
    if (!head) {
      console.warn(
        '[AvatarCanvas] autoCalibrate: no head bone found (tried head/mixamorigHead/Bip001_Head). ' +
        'Falling back to avatarYOffset=', avatarYOffset
      )
      return avatarYOffset
    }
    const headWorldY = head.getWorldPosition(new THREE.Vector3()).y
    const computedOffset = -(headWorldY - CAMERA_TARGET_Y)
    console.log(
      '[AvatarCanvas] autoCalibrate: headWorldY=', headWorldY,
      'computed avatarYOffset=', computedOffset
    )
    return computedOffset
  }, [autoCalibrate, avatarYOffset, gltf])

  // ── Mesh refs ──────────────────────────────────────────────────────────────
  const meshRefs = useRef<Record<string, THREE.SkinnedMesh | null>>(
    Object.fromEntries(AVATURN_MESH_NAMES.map(n => [n, null]))
  )

  // ── Bone refs ──────────────────────────────────────────────────────────────
  const headBone         = useRef<THREE.Bone | null>(null)
  const headBoneOriginal = useRef<THREE.Bone | null>(null)  // mixer-driven original scene bone
  const neckBone   = useRef<THREE.Bone | null>(null)
  const spineBone  = useRef<THREE.Bone | null>(null)
  const chestBone  = useRef<THREE.Bone | null>(null)


  // ── Bind-pose flash guard ──────────────────────────────────────────────────
  // The GLB is rendered in raw bind pose for the first few frames before the
  // AnimationMixer fires its first update. For acts-guide.glb, the Armature
  // root has a 28° Y rotation baked in and the Head bind pose is 0° relative,
  // so the avatar looks ~28° sideways until avaturn_animation drives the head
  // to its rest pose (~2.4° yaw). Fix: hide the scene until mixer frame 1.
  const mixerHasFired = useRef(false)

  // ── Camera-lock: head always faces forward ─────────────────────────────────
  // Root cause: the avaturn_animation base clip has a Head bone track that holds
  // the head at the GLB's baked-in off-angle rest pose (~28° sideways) every frame.
  // A gentle slerp (Phase B alpha=0.06) cannot overcome the mixer driving the bone
  // back each frame — the mixer wins.
  //
  // Fix: after the mixer runs each frame, decompose the Head bone's local quaternion
  // into Euler (YXZ order) and HARD-ZERO the Y component before recomposing.
  // This zeroes yaw while preserving the X (pitch/nod) and Z (roll/tilt) components
  // that come from the animation — head nods, tilts, and micro-movement all play
  // naturally. Only the sideways yaw is stripped.
  //
  // Phase A (frames 0–30): still used for fast initial correction (alpha=0.5 slerp
  //   toward the zero-yaw target) so the transition from bind-pose isn't jarring.
  // Phase B (frame 30+): hard-zero Y every frame — no slerp, no reference quat.
  const headCamFrame   = useRef(0)  // frame counter for phase transition

  // ── Blendshape state (useRef — never triggers re-renders) ──────────────────
  const currentWeights = useRef<ARKitWeights>({})

  // ── Viseme persistent weights (targetW/currentW pattern) ──────────────────
  // These refs persist between frames — the recentlyFired guard keeps the mouth
  // open between closely spaced viseme events instead of snapping to zero.
  const targetW    = useRef<Record<string, number>>({})
  const currentW   = useRef<Record<string, number>>({})
  const lastApplyAt = useRef<number>(0)

  // ── Procedural state ───────────────────────────────────────────────────────
  const ocular      = useRef(createOcularState())
  const respiration = useRef(createRespirationState())
  const headTrack   = useRef(createHeadTrackingState())
  const gazeState   = useRef(createGazeState())
  const cameraPosRef = useRef(new THREE.Vector3())

  // ── Viseme timing ──────────────────────────────────────────────────────────
  const lastVisemeAt = useRef<number>(0)
  // Hold class of the most recently fired viseme. Drives how long the mouth holds
  // a shape before the recentlyFired gate releases it: vowels carry over a little
  // (natural co-articulation); consonants/closures release fast so a wrong
  // consonant shape never lingers into the next phoneme.
  const lastHold = useRef<'vowel' | 'consonant' | 'closure'>('vowel')

  // ── Word boundary estimation from viseme drain ─────────────────────────────
  // Azure offline synthesis has no live wordBoundary events — the synthesizer is
  // already closed before audio plays. We estimate word boundaries by counting
  // drained visemes: every ~3 non-silence visemes ≈ 1 spoken word. This drives
  // SkeletalController.onWordBoundary() so gesture cues fire at roughly the right
  // word in the utterance without needing real Azure wordBoundary events.
  const visemeDrainCountRef   = useRef<number>(0)  // total visemes drained this utterance
  const wordBoundaryCountRef  = useRef<number>(0)  // word boundaries fired this utterance
  const VISEMES_PER_WORD      = 3                  // tunable: 3 phonemes ≈ 1 word

  // ── Initialise on scene load ───────────────────────────────────────────────
  useEffect(() => {
    if (!scene) return

    // Collect mesh refs
    scene.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh && obj.name in meshRefs.current) {
        meshRefs.current[obj.name] = obj
      }
    })

    // Collect bone refs
    headBone.current  = findBone(scene, 'Head')
    neckBone.current  = findBone(scene, 'Neck')
    spineBone.current = findBone(scene, 'Spine') ?? findBone(scene, 'Spine1')
    chestBone.current = findBone(scene, 'Spine2')


    // Fix T-pose (skip when caller's GLB is already in A-pose)
    if (applyTPoseFix) {
      fixTPose(scene)
    }

    // Initialise skeletal controller with the ORIGINAL gltf.scene — the mixer
    // drives the original bones, and the cloned SkinnedMesh.skeleton still
    // references those same bones (shared skeleton), so the clone renders with
    // correct world positions while the avatarYOffset is applied only to the
    // clone's root primitive.
    console.info('[AvatarCanvas] init — clips count:', clips.length, clips.map(c=>c.name))
    engine.skeletal.init(gltf.scene, clips)
    // Collect the head bone from the ORIGINAL scene (mixer-driven) for gaze.
    // The cloned scene's bones are not driven by the mixer so their world
    // matrices never update — tickGaze must read from gltf.scene.
    headBoneOriginal.current = findBone(gltf.scene, 'Head')
    console.info('[AvatarCanvas] headBoneOriginal:', headBoneOriginal.current?.name ?? 'NOT FOUND')
  }, [scene, gltf, clips, engine, applyTPoseFix])

  // Hide until mixer fires (prevents bind-pose sideways-look flash on first render)
  useEffect(() => {
    scene.visible = false
    mixerHasFired.current = false
  }, [scene])

  // Disable frustum culling on all SkinnedMesh nodes.
  // After rebindSkeletons() the mixer drives bones away from bind pose each frame;
  // the rest-pose bounding sphere no longer matches actual vertex positions,
  // causing the renderer to cull the mesh as soon as animation starts.
  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        (obj as THREE.SkinnedMesh).frustumCulled = false
      }
    })
  }, [scene])

  // ── useFrame: core render loop ─────────────────────────────────────────────
  useFrame((_, delta) => {
    const now        = performance.now()
    const nowMs      = Date.now()
    const queue      = engine.visemeQueueRef.current
    const startTime  = engine.visemeStartRef.current
    const isSpeaking = engine.isSpeakingRef.current

    // ── 1. Drain viseme queue (targetW/currentW pattern with recentlyFired guard)
    // applyViseme: zeros all viseme shapes, then sets only the fired one.
    // Skip id=0 (silence) — it would snap the mouth shut mid-sentence.
    // Word boundary estimation: every VISEMES_PER_WORD non-silence visemes drained
    // we call engine.skeletal.onWordBoundary() to advance gesture cue timing.
    const applyViseme = (id: number) => {
      if (id === 0) return
      const arkit = VISEME_TO_ARKIT[id]
      if (!arkit) return
      // Zero all viseme shapes first
      for (const k of Object.keys(targetW.current)) {
        targetW.current[k] = 0
      }
      // Primary Oculus mouth shape(s) at 0.6 + conservative ARKit support shapes
      // (cheeks / funnel / pucker / press / lower-lip) layered per viseme.
      // Support shapes the GLB lacks are ignored harmlessly in applyWeightsToMeshes.
      const { weights, jaw, hold } = buildVisemeTargets(id, 0.6)
      for (const [shapeName, value] of Object.entries(weights)) {
        targetW.current[shapeName] = value
      }
      // jawOpen differentiated per viseme (aa high, E/I medium, O/U low, consonants closed)
      targetW.current['jawOpen'] = jaw
      lastApplyAt.current = nowMs
      lastVisemeAt.current = now
      lastHold.current = hold

      // Word boundary estimation: count non-silence visemes; every VISEMES_PER_WORD
      // phonemes ≈ one spoken word. Call onWordBoundary() to advance gesture cue timing.
      visemeDrainCountRef.current++
      const expectedWords = Math.floor(visemeDrainCountRef.current / VISEMES_PER_WORD)
      while (wordBoundaryCountRef.current < expectedWords) {
        engine.skeletal.onWordBoundary()
        wordBoundaryCountRef.current++
      }
    }

    // Guard: startTime===0 means no audio is playing yet (reset state between sentences).
    // elapsed would be ~millions of ms → all visemes drain instantly in frame 1 → mouth
    // twitches once then closes. Skip the drain entirely until startTime is stamped.
    //
    // Also reset word boundary counters at the start of each new utterance so
    // gesture cue word_index counts restart from 0 for every sentence.
    const elapsed = startTime > 0 ? now - startTime : -1
    if (startTime > 0 && visemeDrainCountRef.current === 0 && queue.length > 0) {
      // New utterance just started (counters at 0, queue non-empty, audio running).
      // wordBoundaryCountRef already 0 — nothing to reset, but ensure skeletal counter
      // is also fresh. loadPerformance() already resets wordCounter in the controller.
    }
    // Reset counters when audio stops (startTime goes back to 0)
    if (startTime === 0 && visemeDrainCountRef.current > 0) {
      visemeDrainCountRef.current  = 0
      wordBoundaryCountRef.current = 0
    }
    while (queue.length > 0 && queue[0].audioOffset <= elapsed) {
      applyViseme(queue.shift()!.visemeId)
    }

    // recentlyFired gate: keep mouth open between closely spaced visemes.
    // Only zero targetW when there are no future events AND no recent fire.
    // The hold window is per-phoneme-class so a wrong consonant shape does not
    // linger: vowels carry over (co-articulation) while consonants/closures
    // release quickly. The vowel window stays at the proven 300ms that fixed the
    // mouth-snapping-shut regression between closely spaced visemes.
    const holdWindow    = lastHold.current === 'vowel' ? 300 : 120
    const hasFuture     = queue.length > 0
    const recentlyFired = (nowMs - lastApplyAt.current) < holdWindow
    if (!hasFuture && !recentlyFired) {
      for (const k of Object.keys(targetW.current)) {
        targetW.current[k] = 0
      }
      targetW.current['jawOpen'] = 0
    }

    // Per-frame asymmetric lerp: targetW → currentW (attack fast, release tuned).
    // Consonants/closures release faster than vowels so a transient consonant
    // shape clears before the next phoneme instead of smearing across it; vowels
    // keep the slower, natural release. Attack is always fast so onsets are crisp.
    const releaseSpeed = lastHold.current === 'vowel' ? 6 : 11
    for (const [name, target] of Object.entries(targetW.current)) {
      const cur   = currentW.current[name] ?? 0
      const alpha = target > cur
        ? 1 - Math.exp(-14 * delta)            // attack — fast
        : 1 - Math.exp(-releaseSpeed * delta)  // release — class-dependent
      currentW.current[name] = THREE.MathUtils.lerp(cur, target, alpha)
    }

    // Build visemeWeights from the lerped currentW for the additive blend below
    const visemeWeights: ARKitWeights = { ...currentW.current }

    // ── 2. FFT fallback (if viseme queue exhausted but still speaking) ─────
    const useFftFallback = isSpeaking
      && queue.length === 0
      && (now - lastVisemeAt.current) > 200
      && engine.fftFallback.connected

    const fftAmp = engine.fftFallback.tick()
    const activeVisemeWeights = useFftFallback
      ? engine.fftFallback.getBlendshapeWeights()
      : visemeWeights

    // ── 3. Emotion baseline (attenuated during speech) ─────────────────────
    const emotionWeights = engine.emotion.effectiveWeights(isSpeaking)

    // ── 4. Procedural layer (blink, saccades) ─────────────────────────────
    const { blinkWeights, eyeRotationX, eyeRotationY } = tickOcularMechanics(ocular.current, delta)

    // ── 5. Additive blend: emotion + viseme + procedural ───────────────────
    const blended = additiveBlend(emotionWeights, activeVisemeWeights, blinkWeights)

    // ── 6. Lerp toward target (organic muscle transition) ─────────────────
    // Viseme keys are already lerped in step 1 (currentW) — passing them
    // through lerpWeightMap a second time would double-smooth them, causing
    // sluggish response. Apply lerpWeightMap for emotion+blink, then overwrite
    // viseme keys directly from the pre-lerped currentW values.
    lerpWeightMap(currentWeights.current, blended, delta, 12)
    // Overwrite viseme keys with the already-lerped values from step 1
    for (const [name, val] of Object.entries(currentW.current)) {
      if (val > 0 || (currentWeights.current[name] ?? 0) > 0) {
        currentWeights.current[name] = val
      }
    }

    // ── 7. (morph targets applied after gaze — see step 10d) ────────────

    // ── 8. Procedural respiration ──────────────────────────────────────────
    tickRespiration(respiration.current, delta, spineBone.current, chestBone.current)

    // ── 9. Audio-reactive head tracking ───────────────────────────────────
    tickHeadTracking(headTrack.current, delta, fftAmp, headBone.current, neckBone.current)

    // ── 10. Skeletal animation mixer ───────────────────────────────────────
    engine.skeletal.update(delta)

    // Show avatar only after mixer has fired at least once (hides bind-pose flash)
    if (!mixerHasFired.current) {
      mixerHasFired.current = true
      scene.visible = true
    }

    // ── 10b. Head camera-lock — always face the viewer ─────────────────────
    // Every frame after the mixer runs: decompose the Head bone's local quaternion
    // into Euler (YXZ), hard-zero the Y (yaw), recompose. The mixer's Head track
    // drives the bone to the GLB's off-angle rest every frame — we strip the yaw
    // component AFTER the mixer runs so it never accumulates visually.
    // X (pitch/nod) and Z (roll/tilt) pass through unmodified — animations play
    // as designed, only the sideways rotation is removed.
    // Phase A (frames 0–30): slerp alpha=0.5 toward zero-yaw — smooth entry.
    // Phase B (frame 30+): hard-zero Y every frame — overrides mixer completely.
    if (headBone.current) {
      const bone  = headBone.current
      const frame = ++headCamFrame.current

      const e = new THREE.Euler().setFromQuaternion(bone.quaternion, 'YXZ')
      e.y = 0
      const targetQ = new THREE.Quaternion().setFromEuler(e)

      if (frame <= 30) {
        // Phase A: fast slerp toward zero-yaw — smooth initial correction
        bone.quaternion.slerp(targetQ, 0.5)
        if (frame === 30) {
          console.log('[AvatarCanvas] headCamLock: Phase B active (hard-zero yaw each frame)')
        }
      } else {
        // Phase B: hard-zero yaw every frame after mixer — mixer cannot win
        bone.quaternion.copy(targetQ)
      }
    }

    // ── 10c. VOR Gaze — camera-lock eyes with head comfort cone ─────────────
    // Update camera position from R3F camera each frame (stable vector ref —
    // no allocation per frame). Then call tickGaze which:
    //   • Measures head deviation from its reference orientation
    //   • Inside ±20° yaw / ±15° pitch cone → lockWeight lerps to 1 (eyes track camera)
    //   • Outside cone → lockWeight lerps to 0 (eyes ride with head naturally)
    //   • Saccade offsets from tickOcularMechanics are passed through so micro-
    //     movements still apply when locked (eyeRotationX/Y from step 4).
    // tickGaze is called AFTER skeletal.update() AND head cam-lock so all
    // world matrices are fully resolved for this frame.
    cameraPosRef.current.copy(camera.position)
    const gazeWeights = tickGaze(
      gazeState.current,
      delta,
      headBoneOriginal.current,   // original scene — mixer keeps world matrix current
      cameraPosRef.current,
      eyeRotationX,
      eyeRotationY,
    )

    // ── 10d. Apply gaze weights + paint morph targets ───────────────────
    // Merge gaze blendshape weights into currentWeights THEN apply to mesh,
    // so eye-look weights are included in this frame's morph target paint.
    // gazeWeights is {} when lockWeight < 0.01 — no-op when eyes ride free.
    for (const [k, v] of Object.entries(gazeWeights)) {
      currentWeights.current[k] = v
    }
    applyWeightsToMeshes(
      currentWeights.current,
      meshRefs.current as Record<string, THREE.SkinnedMesh | null>
    )

    // ── 11. Apply position offset + rotation every frame ─────────────────
    // Set scene.position every frame — R3F reconciler resets it to [0,0,0]
    // after useEffect when using <primitive> without a position prop.
    // Also apply bodyRotationY to the original gltf.scene so bone world
    // matrices include the intended facing direction.
    scene.position.set(avatarXOffset, effectiveYOffset, 0)
    gltf.scene.rotation.y = bodyRotationY
    gltf.scene.updateMatrixWorld(true)
  })

  return (
    <primitive
      object={scene}
    />
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function AvatarCanvas({
  engine,
  adapter,
  directorConfig: _directorConfig,
  glbUrl         = '/avatar.glb',
  faceRigUrl     = DEFAULT_FACE_RIG_URL,
  mergeFaceRig: mergeFaceRigMode = 'auto',
  cameraPreset   = 'head-and-shoulders',
  lightingPreset = 'consumer',
  bodyRotationY  = 0.5,
  avatarYOffset  = -1.52,
  avatarXOffset  = 0,
  applyTPoseFix  = true,
  autoCalibrate  = false,
  cameraPosition,
  cameraTarget,
  animationPackUrl,
  className      = 'w-full h-full',
}: AvatarCanvasProps) {
  // For conversational-mode adapters, open the WS on mount and tear it down on unmount.
  const activeAdapter = adapter ?? engine.adapter
  useEffect(() => {
    if (activeAdapter.mode !== 'conversational') return
    engine.connect().catch((err) => console.error('[AvatarCanvas] connect failed:', err))
    return () => { engine.disconnect() }
  }, [engine, activeAdapter])

  // Reload animation dictionary when the pack URL changes
  useEffect(() => {
    if (!animationPackUrl) return
    engine.dictionary.loadPack(animationPackUrl).then(() => {
      engine.refreshAnimIds()
      console.info(`[AvatarCanvas] Animation pack loaded: ${animationPackUrl}`)
    }).catch((err) => {
      console.error('[AvatarCanvas] Failed to load animation pack:', err)
    })
  }, [engine, animationPackUrl])

  return (
    <div className={className}>
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ position: cameraPosition ?? CAMERA_PRESETS[cameraPreset].position, fov: CAMERA_PRESETS[cameraPreset].fov }}
        shadows
      >
        <CameraSetup preset={cameraPreset} positionOverride={cameraPosition} targetOverride={cameraTarget} />
        <Lighting preset={lightingPreset} />
        <Suspense fallback={null}>
          <AvatarScene
            engine={engine}
            glbUrl={glbUrl}
            faceRigUrl={faceRigUrl}
            mergeFaceRigMode={mergeFaceRigMode}
            bodyRotationY={bodyRotationY}
            avatarYOffset={avatarYOffset}
            avatarXOffset={avatarXOffset}
            applyTPoseFix={applyTPoseFix}
            autoCalibrate={autoCalibrate}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
