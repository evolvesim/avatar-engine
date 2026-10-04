/**
 * findGazeHead — which node eye-contact gaze reads the head frame from.
 *
 * Some CC exports leave the head out of every skin's joint list. GLTFLoader then
 * loads it as a plain Object3D, not a Bone, although the animation mixer still
 * drives it by name. A Bone-only lookup missed it and eye contact went dark.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createGazeState, findGazeHead, tickGazeEyeContact } from '../../src/core/procedural-animations'

function makeCCRig(headIsBone: boolean) {
  const root = new THREE.Object3D()
  const neck = new THREE.Bone(); neck.name = 'CC_Base_NeckTwist02'
  const head = headIsBone ? new THREE.Bone() : new THREE.Object3D()
  head.name = 'CC_Base_Head'
  const left = new THREE.Bone(); left.name = 'CC_Base_L_Eye'
  const right = new THREE.Bone(); right.name = 'CC_Base_R_Eye'
  left.position.set(0.032, 0.06, 0.09)
  right.position.set(-0.032, 0.06, 0.09)
  root.add(neck)
  neck.add(head)
  head.add(left, right)
  neck.position.set(0, 1.5, 0)
  root.updateMatrixWorld(true)
  return { root, head, left, right }
}

describe('findGazeHead', () => {
  it('finds a CC head that is a skin joint (Bone)', () => {
    const rig = makeCCRig(true)
    expect(findGazeHead(rig.root)).toBe(rig.head)
  })

  it('finds a CC head that loaded as a plain Object3D', () => {
    const rig = makeCCRig(false)
    expect(findGazeHead(rig.root)).toBe(rig.head)
  })

  it('prefers the RPM/Avaturn Head bone when present', () => {
    const root = new THREE.Object3D()
    const head = new THREE.Bone(); head.name = 'Head'
    root.add(head)
    expect(findGazeHead(root)).toBe(head)
  })

  it('returns null when the rig has no head', () => {
    expect(findGazeHead(new THREE.Object3D())).toBeNull()
  })

  it('drives eye contact on a rig whose head is a plain Object3D', () => {
    const rig = makeCCRig(false)
    const state = createGazeState()
    const cam = new THREE.Vector3(0.3, 1.56, 2)
    for (let i = 0; i < 120; i++) {
      rig.root.updateMatrixWorld(true)
      tickGazeEyeContact(state, 1 / 60, findGazeHead(rig.root), rig.left, rig.right, cam, 0, 0, {}, true)
    }
    expect(state.lockWeight).toBeGreaterThan(0.9)
    expect(rig.left.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.05)
  })
})
