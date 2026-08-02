/**
 * tickGazeEyeContact — lock/release behaviour and the elliptical eye socket.
 *
 * These cover the creepy-eye fixes: pitch is clamped and released harder than
 * yaw (vertical eye travel is what exposes sclera), and the lock releases while
 * the head is moving fast regardless of angle.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createGazeState, tickGazeEyeContact } from '../../src/core/procedural-animations'

/**
 * Minimal CC-style head with two eye bones, facing world +Z.
 * Eyes sit in front of and above the head origin, as on a real skull, so the
 * function's face-frame derivation has something sane to work with.
 */
function makeHead(pitchDeg = 0) {
  const root = new THREE.Object3D()
  const head = new THREE.Bone()
  head.name = 'CC_Base_Head'
  root.add(head)
  const left = new THREE.Bone(); left.name = 'CC_Base_L_Eye'
  const right = new THREE.Bone(); right.name = 'CC_Base_R_Eye'
  // +X is the character's left, so the LEFT eye sits at +X.
  left.position.set(0.032, 0.06, 0.09)
  right.position.set(-0.032, 0.06, 0.09)
  head.add(left, right)
  head.position.set(0, 1.5, 0)
  // Pitch the head about world X. Positive = chin up (gaze rises).
  head.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitchDeg * Math.PI / 180)
  root.updateMatrixWorld(true)
  return { root, head, left, right }
}

/** Settle the lock by ticking a static pose until lockWeight converges. */
function settle(state: ReturnType<typeof createGazeState>, rig: ReturnType<typeof makeHead>, cam: THREE.Vector3, frames = 120) {
  for (let i = 0; i < frames; i++) {
    rig.root.updateMatrixWorld(true)
    tickGazeEyeContact(state, 1 / 60, rig.head, rig.left, rig.right, cam, 0, 0, {}, true)
  }
}

/** Vertical angle (deg) between an eye's forward and the direction to the camera. */
function eyePitchToward(eye: THREE.Object3D, cam: THREE.Vector3): number {
  const eyePos = new THREE.Vector3(); eye.getWorldPosition(eyePos)
  const q = new THREE.Quaternion(); eye.getWorldQuaternion(q)
  const look = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize()
  const toCam = cam.clone().sub(eyePos).normalize()
  return Math.asin(THREE.MathUtils.clamp(look.dot(new THREE.Vector3(0, 1, 0)), -1, 1)) * 180 / Math.PI
    - Math.asin(THREE.MathUtils.clamp(toCam.dot(new THREE.Vector3(0, 1, 0)), -1, 1)) * 180 / Math.PI
}

describe('tickGazeEyeContact — lock cones', () => {
  it('locks on when the camera is straight ahead', () => {
    const rig = makeHead(0)
    const state = createGazeState()
    settle(state, rig, new THREE.Vector3(0, 1.56, 2))
    expect(state.lockWeight).toBeGreaterThan(0.9)
  })

  // NOTE ON THE REFERENCE FRAME: the cones measure deviation from the face
  // direction captured on the FIRST frame (see eyeFwdParentL), not from the true
  // world horizon — `fwd` is built as cross(worldUp, right) and so is horizontal
  // by construction, carrying no pitch information at capture time. These tests
  // therefore settle on a level head first, then pitch it, which is the real
  // sequence: the avatar mounts in a near-level idle and later pitches.
  const CAM = () => new THREE.Vector3(0, 1.56, 2)

  /** Settle level, then pitch the head by `deg` and tick. */
  function settleThenPitch(deg: number, cfg = {}) {
    const rig = makeHead(0)
    const state = createGazeState()
    settle(state, rig, CAM())
    expect(state.lockWeight).toBeGreaterThan(0.9)   // locked before the pitch
    rig.head.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -deg * Math.PI / 180)
    // Enough frames to release, but stepped so the speed term settles too.
    for (let i = 0; i < 120; i++) {
      rig.root.updateMatrixWorld(true)
      tickGazeEyeContact(state, 1 / 60, rig.head, rig.left, rig.right, CAM(), 0, 0, cfg, true)
    }
    return state
  }

  it('releases when head pitch exceeds lockConePitch but is inside lockConeYaw', () => {
    // 30° chin-up: inside the 40° yaw cone, outside the 15° pitch cone.
    expect(settleThenPitch(30).lockWeight).toBeLessThan(0.1)
  })

  it('holds when head pitch stays inside lockConePitch', () => {
    expect(settleThenPitch(8).lockWeight).toBeGreaterThan(0.9)
  })

  it('respects a caller-supplied lockConePitch', () => {
    expect(settleThenPitch(20, { lockConePitch: 10 }).lockWeight).toBeLessThan(0.1)
    expect(settleThenPitch(20, { lockConePitch: 45 }).lockWeight).toBeGreaterThan(0.9)
  })
})

describe('tickGazeEyeContact — velocity release', () => {
  it('releases while the face swings fast, then re-acquires once calm', () => {
    const rig = makeHead(0)
    const state = createGazeState()
    const cam = new THREE.Vector3(0, 1.56, 2)
    settle(state, rig, cam)
    expect(state.lockWeight).toBeGreaterThan(0.9)

    // Sweep the head ~6°/frame at 60fps ≈ 360°/s, staying inside both cones by
    // keeping the swing horizontal (yaw), so only the speed term can release it.
    for (let i = 0; i < 20; i++) {
      const yaw = (i % 2 === 0 ? 1 : -1) * 3 * Math.PI / 180
      rig.head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      rig.root.updateMatrixWorld(true)
      tickGazeEyeContact(state, 1 / 60, rig.head, rig.left, rig.right, cam, 0, 0, {}, true)
    }
    expect(state.lockWeight).toBeLessThan(0.5)

    // Hold still — the lock should come back.
    rig.head.quaternion.identity()
    settle(state, rig, cam)
    expect(state.lockWeight).toBeGreaterThan(0.9)
  })

  it('does not release for slow head motion', () => {
    const rig = makeHead(0)
    const state = createGazeState()
    const cam = new THREE.Vector3(0, 1.56, 2)
    settle(state, rig, cam)
    // ~0.3°/frame ≈ 18°/s — comfortably under the 100°/s default.
    for (let i = 0; i < 60; i++) {
      rig.head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.3 * Math.PI / 180)
      rig.root.updateMatrixWorld(true)
      tickGazeEyeContact(state, 1 / 60, rig.head, rig.left, rig.right, cam, 0, 0, {}, true)
    }
    expect(state.lockWeight).toBeGreaterThan(0.9)
  })
})

describe('tickGazeEyeContact — elliptical socket', () => {
  it('clamps vertical eye travel to eyeLimitPitch', () => {
    // Camera high above eye level with the head level: the eyes want to look far
    // up, but must stop at eyeLimitPitch. Generous lockConePitch so the lock
    // stays engaged and we are testing the socket clamp, not the release.
    const rig = makeHead(0)
    const state = createGazeState()
    const cam = new THREE.Vector3(0, 3.4, 1.2)
    for (let i = 0; i < 200; i++) {
      rig.root.updateMatrixWorld(true)
      tickGazeEyeContact(state, 1/60, rig.head, rig.left, rig.right, cam, 0, 0,
        { lockConePitch: 89, eyeLimitPitch: 10 }, true)
    }
    expect(state.lockWeight).toBeGreaterThan(0.9)
    // Residual = how far short of the camera the eye stopped. With the target
    // ~45° up and a 10° socket, the eye should fall well short rather than track.
    const residual = Math.abs(eyePitchToward(rig.left, cam))
    expect(residual).toBeGreaterThan(15)
  })

  it('allows more horizontal travel than vertical for the same offset', () => {
    const camSide = new THREE.Vector3(1.6, 1.56, 1.6)   // ~45° to the side
    const camUp   = new THREE.Vector3(0, 3.16, 1.6)     // ~45° up

    const rigA = makeHead(0), stateA = createGazeState()
    for (let i = 0; i < 200; i++) {
      rigA.root.updateMatrixWorld(true)
      tickGazeEyeContact(stateA, 1/60, rigA.head, rigA.left, rigA.right, camSide, 0, 0, { lockConeYaw: 89, lockConePitch: 89 }, true)
    }
    const rigB = makeHead(0), stateB = createGazeState()
    for (let i = 0; i < 200; i++) {
      rigB.root.updateMatrixWorld(true)
      tickGazeEyeContact(stateB, 1/60, rigB.head, rigB.left, rigB.right, camUp, 0, 0, { lockConeYaw: 89, lockConePitch: 89 }, true)
    }

    const yawTravel = Math.abs(new THREE.Euler().setFromQuaternion(rigA.left.quaternion, 'YXZ').y) * 180 / Math.PI
    const pitchTravel = Math.abs(new THREE.Euler().setFromQuaternion(rigB.left.quaternion, 'YXZ').x) * 180 / Math.PI
    // Defaults are 35° yaw vs 12° pitch, so horizontal travel must exceed vertical.
    expect(yawTravel).toBeGreaterThan(pitchTravel)
  })
})
