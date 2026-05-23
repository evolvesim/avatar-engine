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
