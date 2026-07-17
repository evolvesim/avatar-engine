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

// Constant upper-lid lowering held at rest (0 = wide open, 1 = fully closed).
// Relaxes the CC4 "staring" eye without looking sleepy.
const EYE_REST_LID = 0.14

export interface OcularState {
  blinkTimer:  number
  blinkPhase:  BlinkPhase
  blinkValue:  number
  /** Seconds to wait before the next blink — rolled ONCE per blink so the gap
   *  actually varies (rolling per-frame collapses it to a narrow band). */
  blinkInterval: number
  /** Saccade target offsets (radians) — updated every 1.5–4s */
  saccadeX:    number
  saccadeY:    number
  saccadeTimer: number
  saccadeInterval: number
}

/** A natural gap until the next blink: usually 2–7s, occasionally a quick
 *  double-blink (~0.2s) for variety. Rolled once, not per frame. */
function nextBlinkInterval(): number {
  return Math.random() < 0.12
    ? 0.18 + Math.random() * 0.22   // quick double-blink
    : 2 + Math.random() * 5         // 2–7s
}

export function createOcularState(): OcularState {
  return {
    blinkTimer:       0,
    blinkPhase:       0,
    blinkValue:       0,
    blinkInterval:    nextBlinkInterval(),
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
  delta: number,
  restLid: number = EYE_REST_LID,
): { blinkWeights: ARKitWeights; eyeRotationX: number; eyeRotationY: number } {
  // ── Blink ────────────────────────────────────────────────────────────────
  state.blinkTimer += delta

  // Open phase: wait blinkInterval seconds (rolled once) before the next blink.
  if (state.blinkPhase === 0 && state.blinkTimer > state.blinkInterval) {
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
      state.blinkInterval = nextBlinkInterval()   // roll the next gap once
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

  // Rest lid-lower: CC4 eyes sit wide open ("staring"), so `restLid` holds the
  // upper lids a little down at rest; a blink takes it the rest of the way to
  // fully closed. Callers pass 0 for rigs (Avaturn/RPM) whose neutral eye is
  // already relaxed, leaving those eyes untouched.
  const lid = restLid + (1 - restLid) * state.blinkValue

  return {
    blinkWeights: {
      eyeBlinkLeft:  lid,
      eyeBlinkRight: lid,
      eyesClosed:    lid,
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
  /** Rest LOCAL quaternions of the eye bones (captured once, since the mixer
   *  never drives the eyes). Keyed by bone uuid so an avatar swap re-captures. */
  eyeRestL?:     THREE.Quaternion
  eyeRestR?:     THREE.Quaternion
  eyeBoneLId?:   string
  eyeBoneRId?:   string
  /** The face-forward direction expressed in each eye's PARENT-local space,
   *  captured once. Re-applying the parent's live world rotation gives the eye's
   *  current rest look direction, so the aim compensates for head pitch/turn
   *  (the eye bones are children of the head and inherit its motion). */
  eyeFwdParentL?: THREE.Vector3
  eyeFwdParentR?: THREE.Vector3
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

  return weights
}

// ── 4b. Eye-contact gaze (eye-bone-derived frame) — robust for CC4 ─────────────

/**
 * Camera-locking gaze that keeps the eyes on the viewer, tuned for rigs (CC4)
 * where the head/eye bones don't follow the ARKit Z-forward convention and the
 * head is left animation-driven (no head cam-lock).
 *
 * Unlike `tickGaze`, it derives the face's right/forward/up axes from the WORLD
 * positions of the two eye bones and the head bone, so it needs no assumption
 * about bone-local axes. It aims at the real camera position, so the eye
 * direction is automatically correct for whatever camera preset is active
 * (a wide shot and a close-up sit at different angles → different eye aim).
 *
 * The eyes hold the camera while it's within the eyes' comfortable travel cone;
 * once the head turns far enough that the camera falls outside that cone (e.g. a
 * "look away" gesture), the lock releases and the eyes ride neutrally with the
 * head, then re-acquire smoothly when the head comes back.
 *
 * Two output mechanisms, selected by `driveBones`:
 *   • driveBones = true  (CC4): the eyeball follows its skeleton bone, so we
 *     rotate the LeftEye/RightEye bones directly and return {} (no morphs).
 *   • driveBones = false (RPM/Avaturn): the eyeball is morph-driven — the bones
 *     exist as skin joints but rotating them doesn't move the eye. We convert
 *     the same aim into signed yaw/pitch and return ARKit eyeLook morph weights.
 *
 * The camera-locking geometry (face frame, off-forward angle, lock cone) is
 * shared; only the final application differs, so both rigs behave identically.
 */
export function tickGazeEyeContact(
  state:      GazeState,
  delta:      number,
  headBone:   THREE.Bone | null,
  leftEye:    THREE.Bone | null,
  rightEye:   THREE.Bone | null,
  cameraPos:  THREE.Vector3,
  _saccadeX:  number,
  _saccadeY:  number,
  cfg:        GazeConfig = {},
  driveBones: boolean = true,
): Record<string, number> {
  if (!headBone || !leftEye || !rightEye) return {}

  // Max eye travel from the rest (forward) direction before we stop turning.
  const eyeLimit     = Math.abs(cfg.eyeLimitYaw ?? 35) * (Math.PI / 180)
  // How far the head can twist (camera off the face's forward) before the lock
  // releases and the eyes ride with the head. Tuned so eye contact holds through
  // normal head motion but lets go on a deliberate look-away.
  const releaseAngle = Math.abs(cfg.lockConeYaw ?? 40) * (Math.PI / 180)
  const acquireSpeed = cfg.acquireSpeed ?? 8
  const releaseSpeed = cfg.releaseSpeed ?? 5

  // ── Face frame from eye/head world positions (axis-agnostic) ───────────────
  const lW = new THREE.Vector3(); leftEye.getWorldPosition(lW)
  const rW = new THREE.Vector3(); rightEye.getWorldPosition(rW)
  const hW = new THREE.Vector3(); headBone.getWorldPosition(hW)
  const mid = lW.clone().add(rW).multiplyScalar(0.5)

  const worldUp = new THREE.Vector3(0, 1, 0)
  const right = rW.clone().sub(lW).normalize()          // toward the character's right
  const fwd = new THREE.Vector3().crossVectors(worldUp, right).normalize()  // horizontal, out the face
  if (fwd.dot(mid.clone().sub(hW)) < 0) fwd.negate()    // ensure it points forward, not back

  // ── Capture per eye, once: the rest LOCAL orientation, plus the face-forward
  //    expressed in the eye's PARENT-local space. Re-projecting that stored
  //    vector through the parent's LIVE world rotation gives the eye's current
  //    rest look direction — which follows the head's pitch/turn, so the aim
  //    compensates for it instead of riding along with it. ───────────────────
  const lParentW = new THREE.Quaternion(); if (leftEye.parent)  leftEye.parent.getWorldQuaternion(lParentW)
  const rParentW = new THREE.Quaternion(); if (rightEye.parent) rightEye.parent.getWorldQuaternion(rParentW)
  if (state.eyeBoneLId !== leftEye.uuid) {
    state.eyeRestL      = leftEye.quaternion.clone()
    state.eyeFwdParentL = fwd.clone().applyQuaternion(lParentW.clone().invert())
    state.eyeBoneLId    = leftEye.uuid
  }
  if (state.eyeBoneRId !== rightEye.uuid) {
    state.eyeRestR      = rightEye.quaternion.clone()
    state.eyeFwdParentR = fwd.clone().applyQuaternion(rParentW.clone().invert())
    state.eyeBoneRId    = rightEye.uuid
  }

  // ── Off-forward angle (for the lock/release cone), measured at the eyes ────
  // Use a PITCH/TURN-AWARE face forward, not the horizontal `fwd`: re-project the
  // stored rest forward through the head's LIVE rotation (the same basis each
  // eye's curLook uses). The horizontal `fwd` ignores head pitch, so a big up/down
  // nod never grew the angle and the eyes never released on vertical head motion —
  // only on left/right turns. This makes the release cone react to pitch too.
  const faceFwd = (state.eyeFwdParentL ?? fwd).clone().applyQuaternion(lParentW).normalize()
  const toCam = cameraPos.clone().sub(mid).normalize()
  const angle = Math.acos(THREE.MathUtils.clamp(faceFwd.dot(toCam), -1, 1))  // off-forward angle

  const targetLock = angle <= releaseAngle ? 1 : 0
  const lockSpeed  = targetLock > state.lockWeight ? acquireSpeed : releaseSpeed
  state.lockWeight = THREE.MathUtils.lerp(state.lockWeight, targetLock, 1 - Math.exp(-lockSpeed * delta))

  if (driveBones) {
    // ── CC4 & RPM: rotate the eye bones directly ────────────────────────────
    // Each eye aims at the camera from its OWN position (natural convergence),
    // starting from its live rest look direction so head pitch is compensated.
    aimEyeAtCamera(leftEye,  state.eyeRestL!, state.eyeFwdParentL!, lParentW, cameraPos, eyeLimit, state.lockWeight)
    aimEyeAtCamera(rightEye, state.eyeRestR!, state.eyeFwdParentR!, rParentW, cameraPos, eyeLimit, state.lockWeight)

    // Eyes are driven directly on the bones — no morph weights to return.
    return {}
  }

  // ── RPM/Avaturn: eyeball is morph-driven — emit ARKit eyeLook weights ──────
  // Decompose the aim into signed yaw (around worldUp) and pitch (vertical),
  // both relative to the face's forward direction.
  //   yaw > 0  → camera is to the character's right  → char looks right
  //   pitch > 0 → camera is above the eyes           → char looks up
  const yaw   = Math.atan2(toCam.dot(right),   toCam.dot(fwd))
  const pitch = Math.asin(THREE.MathUtils.clamp(toCam.dot(worldUp), -1, 1))

  // Smooth the eye direction for stability, then normalise to 0–1 morph weights
  // where the socket limit maps to 1.0. Scale by lockWeight so the eyes ease
  // back to neutral as the lock releases.
  const eyeLerp = 1 - Math.exp(-acquireSpeed * delta)
  state.eyeYaw   = THREE.MathUtils.lerp(state.eyeYaw,   yaw,   eyeLerp)
  state.eyePitch = THREE.MathUtils.lerp(state.eyePitch, pitch, eyeLerp)

  if (state.lockWeight < 0.01) return {}

  const normYaw   = THREE.MathUtils.clamp(state.eyeYaw   / eyeLimit, -1, 1) * state.lockWeight
  const normPitch = THREE.MathUtils.clamp(state.eyePitch / eyeLimit, -1, 1) * state.lockWeight

  // Anatomical convergence: looking right, the right eye rotates toward the
  // temple (OUT) and the left eye toward the nose (IN); looking left, vice versa.
  const lookRight = THREE.MathUtils.clamp( normYaw,   0, 1)
  const lookLeft  = THREE.MathUtils.clamp(-normYaw,   0, 1)
  const lookUp    = THREE.MathUtils.clamp( normPitch, 0, 1)
  const lookDown  = THREE.MathUtils.clamp(-normPitch, 0, 1)

  return {
    eyeLookInLeft:    lookRight,
    eyeLookOutLeft:   lookLeft,
    eyeLookInRight:   lookLeft,
    eyeLookOutRight:  lookRight,
    eyeLookUpLeft:    lookUp,
    eyeLookUpRight:   lookUp,
    eyeLookDownLeft:  lookDown,
    eyeLookDownRight: lookDown,
  }
}

/**
 * Point one eye bone at the camera from its own world position.
 *
 * The eye's current rest look direction is the stored parent-local forward
 * projected through the parent's LIVE world rotation, so it already tracks the
 * head's pitch/turn. We rotate FROM that live look direction TO the camera
 * direction — so a nodded-down head makes the eye rotate back UP to hold the
 * viewer, instead of riding down with the head. The turn is clamped to the
 * socket limit and scaled by the lock weight, then written to the bone local.
 */
function aimEyeAtCamera(
  eye:         THREE.Bone,
  restLocal:   THREE.Quaternion,
  fwdParent:   THREE.Vector3,
  parentWorld: THREE.Quaternion,
  cameraPos:   THREE.Vector3,
  eyeLimit:    number,
  lockWeight:  number,
): void {
  const restWorld = parentWorld.clone().multiply(restLocal)     // eye's rest orientation in world
  // Live rest look direction — follows the head because it rides the parent.
  const curLook = fwdParent.clone().applyQuaternion(parentWorld).normalize()

  const eyePos = new THREE.Vector3(); eye.getWorldPosition(eyePos)
  const toCam  = cameraPos.clone().sub(eyePos).normalize()

  // Clamp the aim to within `eyeLimit` of the current look so the eye never
  // over-rotates past its socket (e.g. a strongly pitched head it can't fully
  // catch up to — it turns as far as it can and the rest follows).
  const ang = Math.acos(THREE.MathUtils.clamp(curLook.dot(toCam), -1, 1))
  let aim = toCam
  if (ang > eyeLimit) {
    const axis = new THREE.Vector3().crossVectors(curLook, toCam)
    if (axis.lengthSq() > 1e-8) {
      axis.normalize()
      aim = curLook.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, eyeLimit))
    }
  }

  const fullDelta  = new THREE.Quaternion().setFromUnitVectors(curLook, aim)
  const worldDelta = new THREE.Quaternion().slerp(fullDelta, lockWeight)  // scale by lock
  const targetWorld = worldDelta.clone().multiply(restWorld)
  const localTarget = parentWorld.clone().invert().multiply(targetWorld)
  eye.quaternion.copy(localTarget)
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
