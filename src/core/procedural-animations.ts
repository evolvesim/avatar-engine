/**
 * procedural-animations.ts — Procedural micro-animation layer
 *
 * Implements the "Combating the Uncanny Valley with Procedural Noise" section
 * from the research spec. All animations here are fully programmatic — no
 * clips, no keyframes, no baked data.
 *
 * Systems:
 *   1. Autonomous Ocular Mechanics — randomised blink + saccades
 *   2. Procedural Respiration     — Perlin-like sine noise on spine/chest
 *   3. Audio-Reactive Head Tracking — FFT amplitude → neck/head quaternion
 *
 * All state is held in useRef objects — zero React re-renders.
 * Called from the useFrame loop every 16.6ms.
 */

import * as THREE from 'three'
import type { ARKitWeights } from './emotion-state'

// ── 1. Ocular mechanics ───────────────────────────────────────────────────────

export type BlinkPhase = 0 | 1 | 2  // 0=open, 1=closing, 2=opening

export interface OcularState {
  blinkTimer:  number
  blinkPhase:  BlinkPhase
  blinkValue:  number
  /** Saccade target offsets (radians) — updated every 1.5–4s */
  saccadeX:    number
  saccadeY:    number
  saccadeTimer: number
  saccadeInterval: number
}

export function createOcularState(): OcularState {
  return {
    blinkTimer:       0,
    blinkPhase:       0,
    blinkValue:       0,
    saccadeX:         0,
    saccadeY:         0,
    saccadeTimer:     0,
    saccadeInterval:  2 + Math.random() * 2,
  }
}

/**
 * Advance the ocular state by one frame.
 *
 * @param state   Mutable ocular state (useRef.current)
 * @param delta   Seconds since last frame
 * @returns  ARKit blink weights + eye bone rotation offsets
 */
export function tickOcularMechanics(
  state: OcularState,
  delta: number
): { blinkWeights: ARKitWeights; eyeRotationX: number; eyeRotationY: number } {
  // ── Blink ────────────────────────────────────────────────────────────────
  state.blinkTimer += delta

  // Open phase: wait 2–6 seconds before next blink
  if (state.blinkPhase === 0 && state.blinkTimer > 2 + Math.random() * 4) {
    state.blinkPhase = 1
    state.blinkTimer = 0
  }
  // Closing: 80ms
  if (state.blinkPhase === 1) {
    state.blinkValue = Math.min(state.blinkValue + delta * 12.5, 1)
    if (state.blinkValue >= 1) state.blinkPhase = 2
  }
  // Opening: 100ms
  if (state.blinkPhase === 2) {
    state.blinkValue = Math.max(state.blinkValue - delta * 10, 0)
    if (state.blinkValue <= 0) {
      state.blinkPhase = 0
      state.blinkTimer = 0
    }
  }

  // ── Saccades ─────────────────────────────────────────────────────────────
  state.saccadeTimer += delta
  if (state.saccadeTimer >= state.saccadeInterval) {
    // Small involuntary micro-movement of gaze (max ±0.025 rad ≈ 1.4°)
    state.saccadeX        = (Math.random() - 0.5) * 0.025
    state.saccadeY        = (Math.random() - 0.5) * 0.025
    state.saccadeTimer    = 0
    state.saccadeInterval = 1.5 + Math.random() * 2.5
  }

  return {
    blinkWeights: {
      eyeBlinkLeft:  state.blinkValue,
      eyeBlinkRight: state.blinkValue,
      eyesClosed:    state.blinkValue,
    },
    eyeRotationX: state.saccadeX,
    eyeRotationY: state.saccadeY,
  }
}

// ── 2. Procedural respiration ─────────────────────────────────────────────────

export interface RespirationState {
  time: number
}

export function createRespirationState(): RespirationState {
  return { time: 0 }
}

/**
 * Advance the respiration simulation by one frame.
 * Applies subtle sine-wave translation to spine/chest bones via bone references.
 *
 * @param state      Mutable respiration state
 * @param delta      Seconds since last frame
 * @param spineBone  Reference to the Spine or Spine1 bone
 * @param chestBone  Reference to the Spine2 (chest) bone — optional
 */
export function tickRespiration(
  state:      RespirationState,
  delta:      number,
  spineBone:  THREE.Bone | null,
  chestBone:  THREE.Bone | null
): void {
  state.time += delta

  const t = state.time
  // Primary breath cycle: ~0.25 Hz (one full breath every ~4s)
  // Secondary micro-variation: ~0.55 Hz (slight irregularity)
  const amplitude = 0.003  // subtle — barely perceptible
  const breathY   = Math.sin(t * 1.57) * amplitude + Math.sin(t * 3.45) * (amplitude * 0.4)

  if (spineBone) {
    spineBone.rotation.x = breathY * 0.6   // forward lean variation
    spineBone.position.y = breathY * 0.4   // vertical chest rise
  }
  if (chestBone) {
    chestBone.rotation.x = breathY * 0.4
  }
}

// ── 3. Audio-reactive head tracking ──────────────────────────────────────────

export interface HeadTrackingState {
  time:         number
  smoothedAmp:  number  // exponential moving average of FFT amplitude
}

export function createHeadTrackingState(): HeadTrackingState {
  return { time: 0, smoothedAmp: 0 }
}

/**
 * Advance head tracking by one frame.
 *
 * Combines:
 *   a) Ambient micro-movement (Perlin-like noise via summed sines) — always active
 *   b) Audio-reactive overlay — adds extra sway proportional to speech amplitude
 *
 * @param state      Mutable head tracking state
 * @param delta      Seconds since last frame
 * @param fftAmplitude  Normalised FFT amplitude 0–1 from the WebAudio analyser
 *                   Pass 0 if FFT fallback is not active
 * @param headBone   Reference to the Head bone
 * @param neckBone   Reference to the Neck bone — optional
 */
export function tickHeadTracking(
  state:        HeadTrackingState,
  delta:        number,
  fftAmplitude: number,
  headBone:     THREE.Bone | null,
  neckBone:     THREE.Bone | null
): void {
  state.time       += delta
  // Smooth the FFT amplitude to prevent jitter
  state.smoothedAmp = state.smoothedAmp * 0.85 + fftAmplitude * 0.15

  const t   = state.time
  const amp = state.smoothedAmp

  // ── Ambient noise micro-movement (summed sines — low freq) ───────────────
  const ambientX = Math.sin(t * 0.4) * 0.008 + Math.sin(t * 1.1) * 0.004
  const ambientY = Math.sin(t * 0.3) * 0.010 + Math.sin(t * 0.7) * 0.005
  const ambientZ = Math.sin(t * 0.5) * 0.004

  // ── Audio-reactive overlay (speech rhythm) ────────────────────────────────
  const speechX = Math.sin(t * 4.2) * amp * 0.012   // nods with speech rhythm
  const speechY = Math.sin(t * 3.1) * amp * 0.008   // slight lateral sway

  if (headBone) {
    headBone.rotation.x = ambientX + speechX
    headBone.rotation.y = ambientY + speechY
    headBone.rotation.z = ambientZ
  }
  if (neckBone) {
    // Neck carries ~40% of the head movement for natural weight distribution
    neckBone.rotation.x = (ambientX + speechX) * 0.4
    neckBone.rotation.y = (ambientY + speechY) * 0.4
  }
}

// ── 4. VOR Gaze — camera-lock with vestibulo-ocular reflex ─────────────────────

/**
 * Vestibulo-ocular reflex (VOR) gaze system.
 *
 * Eyes lock onto the camera target while the head is within a comfort cone.
 * When the head rotates beyond the threshold (e.g. during a "looking away"
 * gesture), the eye lock releases and eyes ride naturally with the head.
 * When the head returns inside the cone, eyes smoothly re-acquire.
 *
 * Parameters:
 *   lockConeYaw   — max head yaw (°) before eye lock releases  (default 20°)
 *   lockConePitch — max head pitch (°) before eye lock releases (default 15°)
 *   releaseSpeed  — lerp alpha/s when releasing lock (default 4 = ~0.25s)
 *   acquireSpeed  — lerp alpha/s when re-acquiring  (default 8 = ~0.12s)
 *   eyeLimitYaw   — max eye socket yaw rotation (°) from neutral (default 28°)
 *   eyeLimitPitch — max eye socket pitch rotation (°) from neutral (default 20°)
 */
export interface GazeState {
  /** Current eye weight: 1 = fully locked on camera, 0 = riding with head. */
  lockWeight:    number
  /** Smoothed eye target rotation (LOCAL to head bone), radians. */
  eyeYaw:        number
  eyePitch:      number
  /** Reference head rotation at last acquire — used to compute head deviation. */
  refHeadYaw:    number
  refHeadPitch:  number
}

export interface GazeConfig {
  lockConeYaw?:   number   // degrees, default 20
  lockConePitch?: number   // degrees, default 15
  releaseSpeed?:  number   // lerp/s, default 4
  acquireSpeed?:  number   // lerp/s, default 8
  eyeLimitYaw?:   number   // degrees, default 28
  eyeLimitPitch?: number   // degrees, default 20
}

export function createGazeState(): GazeState {
  return {
    lockWeight:   0,   // start unlocked — acquire on first frame
    eyeYaw:       0,
    eyePitch:     0,
    refHeadYaw:   0,
    refHeadPitch: 0,
  }
}

/**
 * Compute the angle (radians) from head bone to camera in HEAD-LOCAL space.
 * Returns {yaw, pitch} that the eyes would need to rotate to look at the camera.
 *
 * @param headBone   The Head bone (world matrix must be up to date)
 * @param cameraPos  Camera world position (THREE.Vector3)
 */
function computeEyeTargetLocal(
  headBone: THREE.Bone,
  cameraPos: THREE.Vector3,
): { yaw: number; pitch: number } {
  // Head world position
  const headWorld = new THREE.Vector3()
  headBone.getWorldPosition(headWorld)

  // Direction from head to camera in world space.
  // Zero the Y component so the camera height doesn't drive eye pitch —
  // the avatar always treats the viewer as eye-level regardless of where
  // the camera is positioned in the scene (above, below, etc.).
  const toCamera = cameraPos.clone().sub(headWorld)
  toCamera.y = 0
  toCamera.normalize()

  // Transform into head bone LOCAL space (inverse of world rotation)
  const headWorldQuat = new THREE.Quaternion()
  headBone.getWorldQuaternion(headWorldQuat)
  const invHead = headWorldQuat.clone().invert()
  const localDir = toCamera.clone().applyQuaternion(invHead)

  // yaw only — pitch is always 0 (eye-level assumption)
  const yaw   =  Math.atan2(localDir.x, localDir.z)
  const pitch = 0

  // One-shot debug — remove after confirming gaze direction
  if (!(computeEyeTargetLocal as any)._logged) {
    (computeEyeTargetLocal as any)._logged = true
    console.info('[tickGaze] headWorld:', headWorld.toArray().map(v => v.toFixed(3)))
    console.info('[tickGaze] cameraPos:', cameraPos.toArray().map(v => v.toFixed(3)))
    console.info('[tickGaze] localDir:', localDir.toArray().map(v => v.toFixed(3)))
    console.info('[tickGaze] yaw (deg):', (yaw * 180 / Math.PI).toFixed(1))
  }

  return { yaw, pitch }
}

/**
 * Advance the VOR gaze system by one frame.
 *
 * Avaturn GLBs use ARKit 52 morph targets for eye direction — there are no
 * separate LeftEye/RightEye bones. This function returns ARKit blendshape
 * weights (eyeLookIn/Out/Up/Down Left/Right) that the caller should merge
 * into the additive blend map before applying to mesh morph targets.
 *
 * Call AFTER tickHeadTracking and AFTER the skeletal mixer update so all
 * world matrices are resolved.
 *
 * @param state     Mutable gaze state (useRef.current)
 * @param delta     Seconds since last frame
 * @param headBone  Head bone reference (world matrix must be current)
 * @param cameraPos Camera world position
 * @param saccadeX  Saccade pitch offset from tickOcularMechanics (radians)
 * @param saccadeY  Saccade yaw offset from tickOcularMechanics (radians)
 * @param cfg       Tuning parameters
 * @returns         ARKit eye-look blendshape weights (0–1 each)
 */
export function tickGaze(
  state:     GazeState,
  delta:     number,
  headBone:  THREE.Bone | null,
  cameraPos: THREE.Vector3,
  saccadeX:  number,
  saccadeY:  number,
  cfg:       GazeConfig = {},
): Record<string, number> {
  if (!headBone) return {}

  const lockConeYaw   = Math.abs(cfg.lockConeYaw   ?? 20)
  const lockConePitch = Math.abs(cfg.lockConePitch ?? 15)
  const releaseSpeed  = cfg.releaseSpeed ?? 4
  const acquireSpeed  = cfg.acquireSpeed ?? 8
  // ARKit eye-look weights max out at 1.0, which maps to ~30° of eye travel.
  // We scale our radian target into 0–1 using this reference angle.
  const eyeLimitYaw   = Math.abs(cfg.eyeLimitYaw   ?? 28) * (Math.PI / 180)
  const eyeLimitPitch = Math.abs(cfg.eyeLimitPitch ?? 20) * (Math.PI / 180)

  // ── Measure current head deviation in world space ─────────────────────────
  const headWorldQuat = new THREE.Quaternion()
  headBone.getWorldQuaternion(headWorldQuat)
  const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ')

  // On first frame set reference = current head orientation
  if (state.lockWeight === 0 && state.refHeadYaw === 0 && state.refHeadPitch === 0) {
    state.refHeadYaw   = headEuler.y
    state.refHeadPitch = headEuler.x
  }

  const deviationYaw   = Math.abs(headEuler.y - state.refHeadYaw)   * (180 / Math.PI)
  const deviationPitch = Math.abs(headEuler.x - state.refHeadPitch) * (180 / Math.PI)

  // ── Determine target lock weight ──────────────────────────────────────────
  const insideCone = deviationYaw <= lockConeYaw && deviationPitch <= lockConePitch
  const targetLock = insideCone ? 1 : 0

  // On re-acquire, update reference so lock resets at current head position
  if (insideCone && state.lockWeight < 0.5) {
    state.refHeadYaw   = headEuler.y
    state.refHeadPitch = headEuler.x
  }

  const speed = targetLock > state.lockWeight ? acquireSpeed : releaseSpeed
  state.lockWeight = THREE.MathUtils.lerp(state.lockWeight, targetLock, 1 - Math.exp(-speed * delta))

  // ── Compute target eye rotation (head-local, toward camera) ──────────────
  const { yaw: targetYaw, pitch: targetPitch } = computeEyeTargetLocal(headBone, cameraPos)

  const clampedYaw   = THREE.MathUtils.clamp(targetYaw,   -eyeLimitYaw,   eyeLimitYaw)
  const clampedPitch = THREE.MathUtils.clamp(targetPitch, -eyeLimitPitch, eyeLimitPitch)

  const eyeLerp = 1 - Math.exp(-acquireSpeed * delta)
  state.eyeYaw   = THREE.MathUtils.lerp(state.eyeYaw,   clampedYaw,   eyeLerp)
  state.eyePitch = THREE.MathUtils.lerp(state.eyePitch, clampedPitch, eyeLerp)

  // Apply saccade on top (only when locked)
  const finalYaw   = (state.eyeYaw   + saccadeY) * state.lockWeight
  const finalPitch = (state.eyePitch + saccadeX) * state.lockWeight

  // When lockWeight = 0, return empty weights — eyes rest neutral with the head
  if (state.lockWeight < 0.01) return {}

  // ── Convert radians → ARKit 0–1 weights ──────────────────────────────────
  // Normalise by the socket limit angle so limit angle → weight 1.0
  // Positive yaw   = eyes right: left eye looks OUT, right eye looks IN
  // Negative yaw   = eyes left:  left eye looks IN,  right eye looks OUT
  // Positive pitch = eyes up
  // Negative pitch = eyes down
  const normYaw   = finalYaw   / eyeLimitYaw
  const normPitch = finalPitch / eyeLimitPitch

  const lookRight = THREE.MathUtils.clamp( normYaw,   0, 1)
  const lookLeft  = THREE.MathUtils.clamp(-normYaw,   0, 1)
  const lookUp    = THREE.MathUtils.clamp( normPitch, 0, 1)
  const lookDown  = THREE.MathUtils.clamp(-normPitch, 0, 1)

  const weights = {
    eyeLookOutLeft:   lookRight,
    eyeLookInLeft:    lookLeft,
    eyeLookUpLeft:    lookUp,
    eyeLookDownLeft:  lookDown,
    eyeLookInRight:   lookRight,
    eyeLookOutRight:  lookLeft,
    eyeLookUpRight:   lookUp,
    eyeLookDownRight: lookDown,
  }

  // One-shot debug — remove after confirming gaze weights
  if (!(tickGaze as any)._logged) {
    (tickGaze as any)._logged = true
    console.info('[tickGaze] lockWeight:', state.lockWeight.toFixed(3))
    console.info('[tickGaze] finalYaw (deg):', (finalYaw * 180 / Math.PI).toFixed(1))
    console.info('[tickGaze] weights:', JSON.stringify(Object.fromEntries(Object.entries(weights).filter(([,v]) => v > 0.001))))
  }

  return weights
}

// ── 4. Arm T-pose correction ──────────────────────────────────────────────────

/**
 * Fix Avaturn GLB bind-pose (arms extended at ~90°) by rotating arm bones.
 * Call once after the scene loads, inside useEffect([scene]).
 *
 * Values per the 3d-avatar-lipsync skill:
 *   LeftArm  +1.1 rad (~63° down),  RightArm -1.1 rad
 *   Forearms: ±0.15 rad (slight natural angle)
 */
export function fixTPose(scene: THREE.Object3D): void {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Bone)) return
    switch (obj.name) {
      case 'LeftArm':       obj.rotation.z =  1.1;  break
      case 'RightArm':      obj.rotation.z = -1.1;  break
      case 'LeftForeArm':   obj.rotation.z =  0.15; break
      case 'RightForeArm':  obj.rotation.z = -0.15; break
    }
  })
}

// ── Bone finder helper ────────────────────────────────────────────────────────

/**
 * Find a named bone in the scene graph.
 * Returns null if not found — all callers handle null gracefully.
 */
export function findBone(scene: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null
  scene.traverse((obj) => {
    if (!found && obj instanceof THREE.Bone && obj.name === name) {
      found = obj
    }
  })
  return found
}
