/**
 * AvatarCanvas.tsx — Shared avatar engine for all Evolve Simulations products
 *
 * Single source of truth for:
 *   - Avaturn GLB loading + mesh refs
 *   - Azure viseme queue drain + ARKit morph target lerp
 *   - Procedural blink + head micro-movement
 *   - Camera framing presets
 *   - Lighting presets (boardroom / consumer / education)
 *   - Error boundary + Suspense fallback
 *
 * Used by:
 *   Evolve B2B  — enterprise L&D simulation dashboard
 *   EvySim      — consumer communication coaching app
 *   ACTS        — K-12 / tertiary education portal
 *
 * ─── Architecture ─────────────────────────────────────────────────────────────
 *
 *   Azure Speech SDK → visemeReceived → VisemeEvent[] in visemeQueueRef
 *                                              ↓
 *                         useFrame drains queue (performance.now + audioOffset)
 *                                              ↓
 *                         applyViseme → targetW → lerp → morphTargetInfluences
 *                                              ↓
 *                         ARKit blendshapes on Head_Mesh, Teeth_Mesh, etc.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   // Evolve B2B
 *   <AvatarCanvas
 *     glbUrl="/avatars/professional-male.glb"
 *     cameraPreset="head-and-shoulders"
 *     lightingPreset="boardroom"
 *     visemeQueueRef={visemeQueueRef}
 *     isAvatarSpeaking={state.status === 'speaking'}
 *     visemeStartRef={visemeStartRef}
 *   />
 *
 *   // EvySim
 *   <AvatarCanvas
 *     glbUrl="/avatars/evysim-coach.glb"
 *     cameraPreset="close-face"
 *     lightingPreset="consumer"
 *     visemeQueueRef={visemeQueueRef}
 *     isAvatarSpeaking={state.status === 'speaking'}
 *     visemeStartRef={visemeStartRef}
 *   />
 *
 *   // ACTS Education
 *   <AvatarCanvas
 *     glbUrl="/avatars/acts-guide.glb"
 *     cameraPreset="head-and-shoulders"
 *     lightingPreset="education"
 *     visemeQueueRef={visemeQueueRef}
 *     isAvatarSpeaking={state.status === 'speaking'}
 *     visemeStartRef={visemeStartRef}
 *   />
 */

'use client'

import React, {
  useRef,
  useEffect,
  useCallback,
  Component,
  Suspense,
  type RefObject,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'

import {
  VISEME_TO_ARKIT,
  ALL_VISEME_NAMES,
  JAW_OPEN_SHAPES,
  AVATURN_MESH_NAMES,
} from './viseme-map'
import {
  CAMERA_PRESETS,
  type AvatarCanvasProps,
  type CameraPreset,
  type LightingPreset,
  type VisemeEvent,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Error boundary
// ─────────────────────────────────────────────────────────────────────────────

interface EBProps { fallback: React.ReactNode; children: React.ReactNode }
interface EBState { hasError: boolean; message: string }

class AvatarErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AvatarEngine] render error:', error, info)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera setup — must live inside Canvas so useThree is valid.
// Never call camera.lookAt() in onCreated — R3F resets the camera after that
// callback and the lookAt is silently wiped. Use this component instead.
// ─────────────────────────────────────────────────────────────────────────────

function CameraSetup({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree()
  const cfg = CAMERA_PRESETS[preset]
  useEffect(() => {
    camera.lookAt(...cfg.target)
  }, [camera, cfg.target])
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Lighting — three presets, one per product type
// ─────────────────────────────────────────────────────────────────────────────

function SceneLighting({ preset }: { preset: LightingPreset }) {
  switch (preset) {
    case 'boardroom':
      // Cool, professional. Crisp key + soft fill + faint blue-grey rim.
      return (
        <>
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 4, 3]}   intensity={1.3} color="#f0f4ff" />
          <directionalLight position={[-2, 1, -1]} intensity={0.25} color="#c8d8e8" />
          <pointLight       position={[0, 2, 1.5]} intensity={0.3}  color="#a0b8d0" />
        </>
      )
    case 'consumer':
      // Warm purple accent — matches EvySim dopamine palette.
      return (
        <>
          <ambientLight intensity={0.7} />
          <directionalLight position={[2, 4, 3]}   intensity={1.2} />
          <directionalLight position={[-2, 1, -1]} intensity={0.3} color="#a78bfa" />
          <pointLight       position={[0, 2, 1.5]} intensity={0.5} color="#c4b5fd" />
        </>
      )
    case 'education':
      // Bright, neutral, non-threatening. Good for K-12 screen time.
      return (
        <>
          <ambientLight intensity={0.9} />
          <directionalLight position={[1, 3, 2]}   intensity={1.1} color="#fff8f0" />
          <directionalLight position={[-1, 1, 1]}  intensity={0.4} color="#f0f8ff" />
        </>
      )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AvatarModel — the actual GLB scene with full viseme + animation logic
// ─────────────────────────────────────────────────────────────────────────────

interface AvatarModelProps {
  glbUrl: string
  visemeQueueRef: RefObject<VisemeEvent[]>
  isAvatarSpeaking: boolean
  visemeStartRef: RefObject<number>
  blink: boolean
  headBob: boolean
  bodyRotationY: number
}

function AvatarModel({
  glbUrl,
  visemeQueueRef,
  isAvatarSpeaking,
  visemeStartRef,
  blink,
  headBob,
  bodyRotationY,
}: AvatarModelProps) {
  const { scene, animations } = useGLTF(glbUrl)
  const { actions }           = useAnimations(animations, scene)

  // Refs holding SkinnedMesh instances keyed by mesh name
  const meshRefs = useRef<Record<string, THREE.SkinnedMesh>>({})

  // Current and target morph target weights — never stored in React state
  // to avoid re-render overhead during useFrame
  const targetW  = useRef<Record<string, number>>({})
  const currentW = useRef<Record<string, number>>({})

  // Tracks when we last applied a non-sil viseme — used for the idle gate
  const lastApplyAt = useRef<number>(0)

  // Ref to the Head bone for head bob
  const headBoneRef = useRef<THREE.Object3D | null>(null)

  // Blink state machine
  const blinkTimer = useRef<number>(0)
  const blinkPhase = useRef<0 | 1 | 2>(0)  // 0=open, 1=closing, 2=opening
  const blinkVal   = useRef<number>(0)

  // Head bob time accumulator
  const headBobTime = useRef<number>(0)

  // ── Start idle animation (Avaturn idle clip) ──────────────────────────────
  useEffect(() => {
    const action = actions['avaturn_animation']
    if (action) {
      action.reset()
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.fadeIn(0.3)
      action.play()
    }
    return () => { action?.fadeOut(0.3) }
  }, [actions])

  // ── Populate mesh refs + fix T-pose arm bones ──────────────────────────────
  useEffect(() => {
    const targetMeshNames = new Set<string>(AVATURN_MESH_NAMES)

    scene.traverse((obj) => {
      // Mesh refs for morph target writes
      if (obj instanceof THREE.SkinnedMesh && targetMeshNames.has(obj.name)) {
        meshRefs.current[obj.name] = obj
      }

      // Head bone for procedural bob
      if (obj.name === 'Head' && headBoneRef.current === null) {
        headBoneRef.current = obj
      }

      // T-pose fix: rotate arm bones so arms rest at sides instead of 90° out.
      // Only applied if the GLB has no embedded idle animation.
      if (!animations.length) {
        if (obj.name === 'LeftArm')      (obj as THREE.Bone).rotation.z =  1.1
        if (obj.name === 'RightArm')     (obj as THREE.Bone).rotation.z = -1.1
        if (obj.name === 'LeftForeArm')  (obj as THREE.Bone).rotation.z =  0.15
        if (obj.name === 'RightForeArm') (obj as THREE.Bone).rotation.z = -0.15
      }
    })
  }, [scene, animations])

  // ── applyViseme ────────────────────────────────────────────────────────────
  const applyViseme = useCallback((id: number) => {
    // Skip viseme_sil (id=0) — applying it zeroes all shapes mid-sentence,
    // creating an unnatural mouth snap between phonemes.
    if (id === 0) return

    // Zero all shapes, then set the target shape(s) for this viseme
    ALL_VISEME_NAMES.forEach(v => { targetW.current[v] = 0 })

    const shapes = VISEME_TO_ARKIT[id] ?? ['viseme_sil']
    const weight = 1 / shapes.length  // split evenly for compound visemes
    shapes.forEach(s => { targetW.current[s] = weight })

    // Open jaw for vowel shapes — 0.25 is the sweet spot (0.5 looks unnatural)
    targetW.current['jawOpen'] = shapes.some(s => JAW_OPEN_SHAPES.has(s)) ? 0.25 : 0

    lastApplyAt.current = Date.now()
  }, [])

  // ── useFrame — the hot path ───────────────────────────────────────────────
  useFrame((_, delta) => {
    const now  = Date.now()
    const perf = performance.now()
    const queue      = visemeQueueRef.current ?? []
    const audioStart = visemeStartRef.current  // performance.now() stamp

    // ── 1. Drain viseme queue ───────────────────────────────────────────────
    // audioOffset is ms from audio start. Fire when:
    //   audioStart + audioOffset <= performance.now()
    if (audioStart > 0) {
      while (queue.length > 0 && (audioStart + queue[0].audioOffset) <= perf) {
        applyViseme(queue.shift()!.visemeId)
      }
    }

    // ── 2. Idle gate — zero mouth only when truly silent ───────────────────
    // hasFuture:     more visemes are queued for later
    // recentlyFired: just fired within 300ms — keeps mouth from snapping shut
    //                between closely spaced visemes
    const hasFuture     = audioStart > 0 && queue.length > 0
    const recentlyFired = (now - lastApplyAt.current) < 300
    if (!hasFuture && !recentlyFired && !isAvatarSpeaking) {
      ALL_VISEME_NAMES.forEach(k => { targetW.current[k] = 0 })
      targetW.current['jawOpen'] = 0
    }

    // ── 3. Lerp all morph targets (smooth interpolation) ───────────────────
    // Exponential lerp: faster approach when far from target, smooth arrival.
    // Factor 12 = snappy but not jarring. Reduce to 6–8 for softer mouth.
    for (const [name, target] of Object.entries(targetW.current)) {
      const cur  = currentW.current[name] ?? 0
      const next = THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-12 * delta))
      currentW.current[name] = next

      for (const mesh of Object.values(meshRefs.current)) {
        const dict = mesh.morphTargetDictionary
        const inf  = mesh.morphTargetInfluences
        if (dict && inf && name in dict) {
          inf[dict[name]] = next
        }
      }
    }

    // ── 4. Procedural blink ─────────────────────────────────────────────────
    if (blink) {
      blinkTimer.current += delta

      // Phase 0 (eyes open): wait 3–7s then start closing
      if (blinkPhase.current === 0 && blinkTimer.current > 3 + Math.random() * 4) {
        blinkPhase.current = 1
        blinkTimer.current = 0
      }

      // Phase 1 (closing): ramp up to 1 at 14 units/sec
      if (blinkPhase.current === 1) {
        blinkVal.current = Math.min(blinkVal.current + delta * 14, 1)
        if (blinkVal.current >= 1) blinkPhase.current = 2
      }

      // Phase 2 (opening): ramp down to 0 at 10 units/sec
      if (blinkPhase.current === 2) {
        blinkVal.current = Math.max(blinkVal.current - delta * 10, 0)
        if (blinkVal.current <= 0) {
          blinkPhase.current = 0
          blinkTimer.current = 0
        }
      }

      // Apply blink to all meshes that have these targets
      for (const name of ['eyeBlinkLeft', 'eyeBlinkRight', 'eyesClosed']) {
        for (const mesh of Object.values(meshRefs.current)) {
          const dict = mesh.morphTargetDictionary
          const inf  = mesh.morphTargetInfluences
          if (dict && inf && name in dict) {
            inf[dict[name]] = blinkVal.current
          }
        }
      }
    }

    // ── 5. Procedural head micro-movement ──────────────────────────────────
    if (headBob && headBoneRef.current) {
      headBobTime.current += delta
      const t = headBobTime.current
      headBoneRef.current.rotation.x = Math.sin(t * 0.4) * 0.008 + Math.sin(t * 1.1) * 0.004
      headBoneRef.current.rotation.y = Math.sin(t * 0.3) * 0.010 + Math.sin(t * 0.7) * 0.005
      headBoneRef.current.rotation.z = Math.sin(t * 0.5) * 0.004
    }
  })

  return (
    <primitive
      object={scene}
      scale={[1, 1, 1]}
      position={[0, -1.52, 0]}  // Avaturn standard: hips at world origin → head at ~Y=0.2
      rotation={[0, bodyRotationY, 0]}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AvatarCanvas — public API, default export
// ─────────────────────────────────────────────────────────────────────────────

export function AvatarCanvas({
  glbUrl         = '/avatar.glb',
  cameraPreset   = 'head-and-shoulders',
  lightingPreset = 'consumer',
  visemeQueueRef,
  isAvatarSpeaking,
  visemeStartRef,
  blink          = true,
  headBob        = true,
  bodyRotationY  = 0.5,
  className      = 'w-full h-full',
}: AvatarCanvasProps) {
  const cfg = CAMERA_PRESETS[cameraPreset]

  // Preload is called at module level below — useGLTF.preload is idempotent
  // and safe to call with multiple different URLs.

  return (
    <div className={className} style={{ position: 'relative' }}>
      <Canvas
        camera={{ position: cfg.position, fov: cfg.fov }}
        gl={{ antialias: true, alpha: true }}
        frameloop="always"
        style={{ width: '100%', height: '100%' }}
      >
        <CameraSetup preset={cameraPreset} />
        <SceneLighting preset={lightingPreset} />

        <AvatarErrorBoundary
          fallback={
            <mesh>
              <sphereGeometry args={[0.08, 8, 8]} />
              <meshBasicMaterial color="#a78bfa" wireframe />
            </mesh>
          }
        >
          <Suspense fallback={null}>
            <AvatarModel
              glbUrl={glbUrl}
              visemeQueueRef={visemeQueueRef}
              isAvatarSpeaking={isAvatarSpeaking}
              visemeStartRef={visemeStartRef}
              blink={blink}
              headBob={headBob}
              bodyRotationY={bodyRotationY}
            />
          </Suspense>
        </AvatarErrorBoundary>
      </Canvas>
    </div>
  )
}

// Preload the default avatar at import time so it's in the Three.js cache
// before the first render. Products that use a different glbUrl should call
// useGLTF.preload('/their-avatar.glb') in their own page/layout files.
useGLTF.preload('/avatar.glb')
