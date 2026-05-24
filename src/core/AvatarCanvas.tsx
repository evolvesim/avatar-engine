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
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'

import type { AvatarEngine }     from './avatar-engine'
import type {
  CameraPreset,
  LightingPreset,
  TTSAdapter,
  DirectorConfig,
} from './types'
import { CAMERA_PRESETS }        from './types'
import { VISEME_TO_ARKIT, AVATURN_MESH_NAMES } from './viseme-map'
import {
  additiveBlend,
  lerpWeightMap,
  applyWeightsToMeshes,
} from './additive-blend'
import {
  createOcularState,
  createRespirationState,
  createHeadTrackingState,
  tickOcularMechanics,
  tickRespiration,
  tickHeadTracking,
  fixTPose,
  findBone,
} from './procedural-animations'
import type { ARKitWeights } from './emotion-state'

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
  className?:      string
}

// ── Camera setup ──────────────────────────────────────────────────────────────

function CameraSetup({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree()
  const cfg = CAMERA_PRESETS[preset]

  useEffect(() => {
    camera.position.set(...cfg.position)
    ;(camera as THREE.PerspectiveCamera).fov = cfg.fov
    ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    camera.lookAt(...cfg.target)
  }, [camera, cfg])

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

function AvatarScene({
  engine,
  glbUrl,
  bodyRotationY,
  avatarYOffset,
  applyTPoseFix,
  avatarXOffset,
}: {
  engine:         AvatarEngine
  glbUrl:         string
  bodyRotationY:  number
  avatarYOffset:  number
  applyTPoseFix:  boolean
  avatarXOffset:  number
}) {
  const gltf  = useLoader(GLTFLoader, glbUrl)
  // SkeletonUtils.clone preserves the source's constructor (Group → Group) and
  // rebinds SkinnedMesh.skeleton.bones[] to the cloned bones. Keep the Group
  // type so R3F's <primitive> reconciles transform props correctly.
  const scene = useMemo(() => skeletonClone(gltf.scene) as THREE.Group, [gltf])

  // Disable frustum culling after mount — doing this inside useMemo on a
  // partially-initialised gltf (during Suspense resolution) can throw and
  // crash the AvatarCanvas tree.
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh) {
        obj.frustumCulled = false
      }
    })
  }, [scene])
  const clips = gltf.animations  // animations live on gltf, NOT on gltf.scene

  // ── Mesh refs ──────────────────────────────────────────────────────────────
  const meshRefs = useRef<Record<string, THREE.SkinnedMesh | null>>(
    Object.fromEntries(AVATURN_MESH_NAMES.map(n => [n, null]))
  )

  // ── Bone refs ──────────────────────────────────────────────────────────────
  const headBone   = useRef<THREE.Bone | null>(null)
  const neckBone   = useRef<THREE.Bone | null>(null)
  const spineBone  = useRef<THREE.Bone | null>(null)
  const chestBone  = useRef<THREE.Bone | null>(null)

  // ── Blendshape state (useRef — never triggers re-renders) ──────────────────
  const currentWeights = useRef<ARKitWeights>({})
  const targetWeights  = useRef<ARKitWeights>({})

  // ── Procedural state ───────────────────────────────────────────────────────
  const ocular      = useRef(createOcularState())
  const respiration = useRef(createRespirationState())
  const headTrack   = useRef(createHeadTrackingState())

  // ── Viseme timing ──────────────────────────────────────────────────────────
  const lastVisemeAt = useRef<number>(0)

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

    // Initialise skeletal controller with avatar root
    engine.skeletal.init(scene, clips)
  }, [scene, clips, engine, applyTPoseFix])

  // ── useFrame: core render loop ─────────────────────────────────────────────
  useFrame((_, delta) => {
    const now        = performance.now()
    const queue      = engine.visemeQueueRef.current
    const startTime  = engine.visemeStartRef.current
    const isSpeaking = engine.isSpeakingRef.current

    // ── 1. Drain viseme queue ──────────────────────────────────────────────
    const visemeWeights: ARKitWeights = {}
    const elapsed = now - startTime

    while (queue.length > 0 && queue[0].audioOffset <= elapsed) {
      const event   = queue.shift()!
      const arkit   = VISEME_TO_ARKIT[event.visemeId]
      if (arkit) {
        // arkit is string[] — each element is an ARKit blendshape name
        // split weight evenly across co-articulated shapes (e.g. viseme 20/21)
        const w = 1 / arkit.length
        for (const shapeName of arkit) {
          visemeWeights[shapeName] = Math.max(visemeWeights[shapeName] ?? 0, w)
        }
      }
      lastVisemeAt.current = now
    }

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
    const { blinkWeights } = tickOcularMechanics(ocular.current, delta)

    // ── 5. Additive blend: emotion + viseme + procedural ───────────────────
    const blended = additiveBlend(emotionWeights, activeVisemeWeights, blinkWeights)

    // ── 6. Lerp toward target (organic muscle transition) ─────────────────
    lerpWeightMap(currentWeights.current, blended, delta, 12)

    // ── 7. Apply to mesh morph targets ────────────────────────────────────
    applyWeightsToMeshes(
      currentWeights.current,
      meshRefs.current as Record<string, THREE.SkinnedMesh | null>
    )

    // ── 8. Procedural respiration ──────────────────────────────────────────
    tickRespiration(respiration.current, delta, spineBone.current, chestBone.current)

    // ── 9. Audio-reactive head tracking ───────────────────────────────────
    tickHeadTracking(headTrack.current, delta, fftAmp, headBone.current, neckBone.current)

    // ── 10. Skeletal animation mixer ───────────────────────────────────────
    engine.skeletal.update(delta)
  })

  return (
    <primitive
      object={scene}
      position={[avatarXOffset, avatarYOffset, 0]}
      rotation={[0, bodyRotationY, 0]}
    />
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function AvatarCanvas({
  engine,
  adapter,
  directorConfig: _directorConfig,
  glbUrl         = '/avatar.glb',
  cameraPreset   = 'head-and-shoulders',
  lightingPreset = 'consumer',
  bodyRotationY  = 0.5,
  avatarYOffset  = -1.52,
  avatarXOffset  = 0,
  applyTPoseFix  = true,
  className      = 'w-full h-full',
}: AvatarCanvasProps) {
  // For conversational-mode adapters, open the WS on mount and tear it down on unmount.
  const activeAdapter = adapter ?? engine.adapter
  useEffect(() => {
    if (activeAdapter.mode !== 'conversational') return
    engine.connect().catch((err) => console.error('[AvatarCanvas] connect failed:', err))
    return () => { engine.disconnect() }
  }, [engine, activeAdapter])

  return (
    <div className={className}>
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ position: CAMERA_PRESETS[cameraPreset].position, fov: CAMERA_PRESETS[cameraPreset].fov }}
        shadows
      >
        <CameraSetup preset={cameraPreset} />
        <Lighting preset={lightingPreset} />
        <Suspense fallback={null}>
          <AvatarScene
            engine={engine}
            glbUrl={glbUrl}
            bodyRotationY={bodyRotationY}
            avatarYOffset={avatarYOffset}
            avatarXOffset={avatarXOffset}
            applyTPoseFix={applyTPoseFix}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
