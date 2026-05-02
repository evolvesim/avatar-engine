/**
 * compile-animations.js
 *
 * Procedurally generates all 25 animation clips defined in the
 * ANIMATION_MANIFEST and packs them into a single binary animations.glb.
 *
 * No Blender, no FBX imports, no runtime downloads — pure Node.js.
 *
 * Output: public/avatar-engine/animations.glb
 *
 * Architecture:
 *   Each clip is defined as a list of BoneTrack entries:
 *     { bone, property: 'rotation'|'position'|'scale', times[], values[] }
 *   Values are quaternions (xyzw) for rotation, vec3 for position/scale.
 *   Clips are built to the Mixamo/Avaturn skeleton hierarchy.
 *
 * Bone naming: Mixamo convention (Avaturn exports match this)
 *   Hips, Spine, Spine1, Spine2, Neck, Head
 *   LeftShoulder, LeftArm, LeftForeArm, LeftHand
 *   RightShoulder, RightArm, RightForeArm, RightHand
 *   LeftUpLeg, LeftLeg, RightUpLeg, RightLeg
 */

'use strict'

const { Document, NodeIO, Accessor, Animation } = require('@gltf-transform/core')
const fs   = require('fs')
const path = require('path')

// ── Quaternion helpers ────────────────────────────────────────────────────────

/** Euler XYZ → quaternion [x,y,z,w] */
function euler(ex, ey, ez) {
  // Intrinsic XYZ rotation
  const cx = Math.cos(ex/2), sx = Math.sin(ex/2)
  const cy = Math.cos(ey/2), sy = Math.sin(ey/2)
  const cz = Math.cos(ez/2), sz = Math.sin(ez/2)
  return [
    sx*cy*cz + cx*sy*sz,
    cx*sy*cz - sx*cy*sz,
    cx*cy*sz + sx*sy*cz,
    cx*cy*cz - sx*sy*sz,
  ]
}

/** Identity quaternion */
const ID = [0, 0, 0, 1]

/** Lerp two quaternions at t (not normalised — fine for small angles) */
function qlerp(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t)
}

/** Sine eased value at t in [0..1], peak at 0.5 */
function bell(t) { return Math.sin(Math.PI * t) }

/** Build a set of evenly-spaced time samples from 0..duration */
function times(n, duration) {
  return Array.from({length: n}, (_, i) => (i / (n-1)) * duration)
}

// ── Keyframe track builder ────────────────────────────────────────────────────

/**
 * Build a flat Float32Array interleaved as required by gltf-transform:
 *   rotation → 4 components per frame [x,y,z,w]
 *   translation → 3 components per frame [x,y,z]
 */
function flatValues(frames) {
  return new Float32Array(frames.flat())
}

function flatTimes(arr) {
  return new Float32Array(arr)
}

// ── Skeleton node builder ─────────────────────────────────────────────────────

const BONE_NAMES = [
  'Hips','Spine','Spine1','Spine2','Neck','Head',
  'LeftShoulder','LeftArm','LeftForeArm','LeftHand',
  'RightShoulder','RightArm','RightForeArm','RightHand',
  'LeftUpLeg','LeftLeg','RightUpLeg','RightLeg',
]

/**
 * Create a minimal skeleton in the Document — one Node per bone.
 * All nodes are children of root scene node.
 * Returns a Map<boneName, gltf-transform Node>
 */
function buildSkeleton(doc) {
  const scene = doc.createScene('Armature')
  const boneMap = new Map()
  for (const name of BONE_NAMES) {
    const node = doc.createNode(name)
    node.setTranslation([0, 0, 0])
    node.setRotation([0, 0, 0, 1])
    scene.addChild(node)
    boneMap.set(name, node)
  }
  return boneMap
}

// ── Animation clip factory ────────────────────────────────────────────────────

/**
 * Add a named animation clip to the Document.
 *
 * @param doc       gltf-transform Document
 * @param boneMap   Map<boneName, Node>
 * @param name      Clip name (must match ANIMATION_MANIFEST key)
 * @param tracks    Array of { bone, property, times, values }
 *                  values: array of frame-values, each frame is [x,y,z,w] or [x,y,z]
 */
function addClip(doc, boneMap, name, tracks) {
  const anim = doc.createAnimation(name)

  for (const track of tracks) {
    const node = boneMap.get(track.bone)
    if (!node) { console.warn(`  ⚠  bone "${track.bone}" not in skeleton — skipping track`); continue }

    const nComp = track.property === 'rotation' ? 4 : 3

    const inputAcc = doc.createAccessor()
      .setArray(flatTimes(track.times))
      .setType(Accessor.Type.SCALAR)

    const outputAcc = doc.createAccessor()
      .setArray(flatValues(track.values))
      .setType(nComp === 4 ? Accessor.Type.VEC4 : Accessor.Type.VEC3)

    const sampler = doc.createAnimationSampler()
      .setInput(inputAcc)
      .setOutput(outputAcc)
      .setInterpolation('LINEAR')

    const channel = doc.createAnimationChannel()
      .setSampler(sampler)
      .setTargetNode(node)
      .setTargetPath(track.property === 'rotation' ? 'rotation'
                   : track.property === 'position' ? 'translation'
                   : 'scale')

    anim.addSampler(sampler)
    anim.addChannel(channel)
  }
}

// ── Clip definitions ─────────────────────────────────────────────────────────
//
// All clips target the Mixamo/Avaturn skeleton.
// Rotations expressed as quaternions derived from anatomically plausible
// Euler angles in radians. Animations are relative to T-pose.
//
// Convention:
//   Spine: pitch forward = positive X rotation
//   Head:  nod = +X, shake = +Y, tilt = +Z
//   Arms:  abduction (out from body) = +Z on LeftArm, -Z on RightArm
//          flexion (up) = -X for arm raise
// ─────────────────────────────────────────────────────────────────────────────

function defineClips(doc, boneMap) {

  // ── 1. quaternius_neutral_idle ─────────────────────────────────────────────
  // Gentle breathing sway — 4s loop
  {
    const dur = 4.0, n = 9
    const ts = times(n, dur)
    addClip(doc, boneMap, 'quaternius_neutral_idle', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(Math.sin(t * Math.PI * 0.5) * 0.015, 0, Math.sin(t * Math.PI * 0.25) * 0.008))
      },
      {
        bone: 'Spine1', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(Math.sin(t * Math.PI * 0.5 + 0.3) * 0.01, 0, 0))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(Math.sin(t * Math.PI * 0.25) * 0.008, Math.sin(t * Math.PI * 0.15) * 0.012, 0))
      },
    ])
  }

  // ── 2. quaternius_joy_breathing_idle ──────────────────────────────────────
  // Upright, slightly bouncy chest lift — 3s loop
  {
    const dur = 3.0, n = 9
    const ts = times(n, dur)
    addClip(doc, boneMap, 'quaternius_joy_breathing_idle', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(-0.04 + Math.sin(t * Math.PI * 0.67) * 0.02, 0, 0))
      },
      {
        bone: 'Spine2', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(-0.03 + Math.sin(t * Math.PI * 0.67 + 0.2) * 0.015, 0, 0))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(Math.sin(t * Math.PI * 0.33) * 0.01, Math.sin(t * Math.PI * 0.2) * 0.015, 0))
      },
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0, 0, 1.0 + Math.sin(t * Math.PI * 0.67) * 0.03))  // relaxed down, subtle sway
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0, 0, -1.0 - Math.sin(t * Math.PI * 0.67) * 0.03))
      },
    ])
  }

  // ── 3. quaternius_anger_tense_idle ────────────────────────────────────────
  // Stiff, slightly forward — subtle chest heave, arms tenser at sides — 3s loop
  {
    const dur = 3.0, n = 7
    const ts = times(n, dur)
    addClip(doc, boneMap, 'quaternius_anger_tense_idle', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.06 + Math.sin(t * Math.PI * 0.67) * 0.025, 0, 0))
      },
      {
        bone: 'Spine1', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.04 + Math.sin(t * Math.PI * 0.67) * 0.018, 0, 0))
      },
      {
        bone: 'Neck', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.05, 0, Math.sin(t * Math.PI * 0.5) * 0.005))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.04, 0, 0))
      },
      // Arms pulled in tighter
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(-0.05, 0, 0.85))
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(-0.05, 0, -0.85))
      },
    ])
  }

  // ── 4. quaternius_sadness_slumped ─────────────────────────────────────────
  // Slumped forward, head down, slow breath — 5s loop
  {
    const dur = 5.0, n = 9
    const ts = times(n, dur)
    addClip(doc, boneMap, 'quaternius_sadness_slumped', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.14 + Math.sin(t * Math.PI * 0.4) * 0.01, 0, 0))
      },
      {
        bone: 'Spine1', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.10 + Math.sin(t * Math.PI * 0.4) * 0.008, 0, 0))
      },
      {
        bone: 'Spine2', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.06, 0, Math.sin(t * Math.PI * 0.2) * 0.004))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.18 + Math.sin(t * Math.PI * 0.4) * 0.008, 0, 0))
      },
      {
        bone: 'LeftShoulder', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(0, 0, 0.06))   // shoulders drooped
      },
      {
        bone: 'RightShoulder', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(0, 0, -0.06))
      },
    ])
  }

  // ── 5. quaternius_concentration_idle ─────────────────────────────────────
  // Slight forward lean, head tilted, still — 4s loop
  {
    const dur = 4.0, n = 7
    const ts = times(n, dur)
    addClip(doc, boneMap, 'quaternius_concentration_idle', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.05 + Math.sin(t * Math.PI * 0.5) * 0.008, 0, 0))
      },
      {
        bone: 'Spine2', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.03, 0, 0))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.06 + Math.sin(t * Math.PI * 0.4) * 0.006, 0, 0.04))  // slight tilt
      },
    ])
  }

  // ── 6. mixamo_neutral_talking_default ─────────────────────────────────────
  // Generic talking gesture — arms move with speech — 2s once
  {
    const dur = 2.0
    const ts = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    addClip(doc, boneMap, 'mixamo_neutral_talking_default', [
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(-s * 0.35, 0, -1.0 + s * 0.2)
        })
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(0, 0, s * 0.4)
        })
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(Math.sin(t * Math.PI) * 0.025, 0, 0))
      },
    ])
  }

  // ── 7. mixamo_neutral_thoughtful_nod ─────────────────────────────────────
  // Two deliberate nods — 1.5s once
  {
    const ts = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5]
    const nodAmplitude = 0.12
    addClip(doc, boneMap, 'mixamo_neutral_thoughtful_nod', [
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(nodAmplitude, 0, 0),
          euler(0, 0, 0),
          euler(nodAmplitude * 0.8, 0, 0),
          euler(0, 0, 0),
          euler(nodAmplitude * 0.4, 0, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Spine2', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0.03, 0, 0),
          euler(0, 0, 0),
          euler(0.02, 0, 0),
          euler(0, 0, 0),
          euler(0.01, 0, 0),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 8. mixamo_neutral_head_shake ──────────────────────────────────────────
  // Disagreement head shake — 1.2s once
  {
    const ts = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]
    const a = 0.14
    addClip(doc, boneMap, 'mixamo_neutral_head_shake', [
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, -a, 0),
          euler(0, a, 0),
          euler(0, -a*0.85, 0),
          euler(0, a*0.6, 0),
          euler(0, -a*0.3, 0),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 9. mixamo_joy_talking_hands ───────────────────────────────────────────
  // Animated bilateral hand gestures while talking — 2.5s once
  {
    const dur = 2.5
    const n = 11
    const ts = times(n, dur)
    addClip(doc, boneMap, 'mixamo_joy_talking_hands', [
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const p = t / dur
          const s = Math.sin(p * Math.PI * 2)
          return euler(-0.2 - s * 0.2, 0, 0.9 - s * 0.15)
        })
      },
      {
        bone: 'LeftForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const p = t / dur
          return euler(0, 0, Math.sin(p * Math.PI * 2 + 0.5) * 0.35)
        })
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const p = t / dur
          const s = Math.sin(p * Math.PI * 2 + Math.PI)
          return euler(-0.2 - s * 0.2, 0, -0.9 + s * 0.15)
        })
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const p = t / dur
          return euler(0, 0, -Math.sin(p * Math.PI * 2 + 0.5) * 0.35)
        })
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(Math.sin(t * Math.PI * 0.8) * 0.02, Math.sin(t * Math.PI * 0.5) * 0.025, 0))
      },
    ])
  }

  // ── 10. mixamo_joy_thumbs_up ─────────────────────────────────────────────
  // Right arm raises with thumbs up gesture + small nod — 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'mixamo_joy_thumbs_up', [
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, -1.0),
          euler(-0.5, 0.1, -0.7),
          euler(-0.8, 0.15, -0.5),   // arm fully raised
          euler(-0.8, 0.15, -0.5),   // hold
          euler(-0.8, 0.15, -0.5),   // hold
          euler(-0.4, 0.05, -0.75),
          euler(0, 0, -1.0),
        ]
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, -0.2, 0.1),
          euler(0, -0.4, 0.2),
          euler(0, -0.4, 0.2),
          euler(0, -0.4, 0.2),
          euler(0, -0.2, 0.1),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0.05, 0, 0),
          euler(-0.06, 0, 0),   // small nod on raise
          euler(-0.04, 0, 0),
          euler(-0.02, 0, 0),
          euler(0.02, 0, 0),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 11. mixamo_anger_dismissive_wave ─────────────────────────────────────
  // Sharp right hand dismissive wave — 1.5s once
  {
    const ts = [0, 0.15, 0.4, 0.65, 0.9, 1.2, 1.5]
    addClip(doc, boneMap, 'mixamo_anger_dismissive_wave', [
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, -1.0),
          euler(-0.1, 0, -0.8),
          euler(-0.3, 0.2, -0.6),  // arm partially raised
          euler(-0.3, 0.2, -0.6),
          euler(-0.25, 0.35, -0.55), // wave peak
          euler(-0.1, 0.1, -0.75),
          euler(0, 0, -1.0),
        ]
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, -0.1, 0),
          euler(0, -0.5, 0.15),
          euler(0, -0.7, 0.2),  // wrist flick
          euler(0, -0.4, 0.1),
          euler(0, -0.15, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0.04, 0, 0),
          euler(0.06, 0, 0),
          euler(0.04, 0, 0),
          euler(0.04, 0, 0),
          euler(0.04, 0, 0),
          euler(0.04, 0, 0),
          euler(0.04, 0, 0),
        ]
      },
    ])
  }

  // ── 12. mixamo_anger_pointing ─────────────────────────────────────────────
  // Assertive forward point with right hand — 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'mixamo_anger_pointing', [
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, -1.0),
          euler(-0.3, -0.1, -0.7),
          euler(-0.6, -0.2, -0.5),  // arm pointing forward
          euler(-0.65, -0.2, -0.5),
          euler(-0.65, -0.2, -0.5),
          euler(-0.35, -0.1, -0.75),
          euler(0, 0, -1.0),
        ]
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, -0.3, 0),
          euler(0, -0.6, 0),
          euler(0, -0.65, 0),
          euler(0, -0.6, 0),
          euler(0, -0.3, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0.04, 0, 0),
          euler(0.06, 0.05, 0),
          euler(0.04, 0.08, 0),
          euler(0.04, 0.08, 0),
          euler(0.04, 0.06, 0),
          euler(0.04, 0.02, 0),
          euler(0.04, 0, 0),
        ]
      },
    ])
  }

  // ── 13. mixamo_anger_arms_crossed ─────────────────────────────────────────
  // Arms crossed defensive posture — 2s loop
  {
    const ts = [0, 0.5, 1.0, 1.5, 2.0]
    addClip(doc, boneMap, 'mixamo_anger_arms_crossed', [
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(-0.35 + Math.sin(t * Math.PI) * 0.01, 0.3, 0.5))
      },
      {
        bone: 'LeftForeArm', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(0, 0.8, 0))
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(-0.35 + Math.sin(t * Math.PI + 0.2) * 0.01, -0.3, -0.5))
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(0, -0.8, 0))
      },
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(() => euler(0.05, 0, 0))
      },
    ])
  }

  // ── 14. mixamo_sadness_apologetic_hands ───────────────────────────────────
  // Both palms up — apologetic/resigned — 2s once
  {
    const dur = 2.0
    const ts = times(9, dur)
    addClip(doc, boneMap, 'mixamo_sadness_apologetic_hands', [
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(-s * 0.25, 0, 0.9 - s * 0.2)
        })
      },
      {
        bone: 'LeftForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(0, 0, s * 0.5)  // forearm rotates to show palm up
        })
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(-s * 0.25, 0, -(0.9 - s * 0.2))
        })
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(0, 0, -s * 0.5)
        })
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.1 + bell(t / dur) * 0.04, 0, 0))
      },
    ])
  }

  // ── 15. mixamo_sadness_head_down ──────────────────────────────────────────
  // Slow head drop with sigh, then back up — 3s once
  {
    const ts = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
    addClip(doc, boneMap, 'mixamo_sadness_head_down', [
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0.08, 0, 0),
          euler(0.22, 0, 0),
          euler(0.25, 0, 0),  // lowest point
          euler(0.25, 0, 0),
          euler(0.15, 0, 0),
          euler(0.05, 0, 0),
        ]
      },
      {
        bone: 'Spine1', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0.03, 0, 0),
          euler(0.07, 0, 0),
          euler(0.08, 0, 0),
          euler(0.07, 0, 0),
          euler(0.04, 0, 0),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 16. mixamo_surprise_step_back ─────────────────────────────────────────
  // Startle — small backward lean, hands come up — 1.5s once
  {
    const ts = [0, 0.15, 0.4, 0.7, 1.0, 1.25, 1.5]
    addClip(doc, boneMap, 'mixamo_surprise_step_back', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(-0.15, 0, 0),   // jerk back
          euler(-0.12, 0, 0),
          euler(-0.06, 0, 0),
          euler(-0.02, 0, 0),
          euler(0, 0, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(-0.1, 0, 0),    // head snaps back
          euler(-0.05, 0, 0),
          euler(0, 0, 0),
          euler(0, 0, 0),
          euler(0, 0, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 1.0),
          euler(-0.4, 0, 0.6),  // arms fly up in surprise
          euler(-0.35, 0, 0.65),
          euler(-0.2, 0, 0.8),
          euler(-0.1, 0, 0.9),
          euler(0, 0, 1.0),
          euler(0, 0, 1.0),
        ]
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, -1.0),
          euler(-0.4, 0, -0.6),
          euler(-0.35, 0, -0.65),
          euler(-0.2, 0, -0.8),
          euler(-0.1, 0, -0.9),
          euler(0, 0, -1.0),
          euler(0, 0, -1.0),
        ]
      },
    ])
  }

  // ── 17. mixamo_empathy_open_hands ─────────────────────────────────────────
  // Open palms presented forward — warm, receptive — 2s once
  {
    const dur = 2.0
    const ts = times(9, dur)
    addClip(doc, boneMap, 'mixamo_empathy_open_hands', [
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur) * 0.9
          return euler(-s * 0.3, -s * 0.1, 1.0 - s * 0.35)
        })
      },
      {
        bone: 'LeftForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(0, s * 0.35, s * 0.4)
        })
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur) * 0.9
          return euler(-s * 0.3, s * 0.1, -(1.0 - s * 0.35))
        })
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: ts.map(t => {
          const s = bell(t / dur)
          return euler(0, -s * 0.35, -s * 0.4)
        })
      },
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(-0.03 * bell(t / dur), 0, 0))  // slight open lean
      },
    ])
  }

  // ── 18. mixamo_empathy_leaning_forward ────────────────────────────────────
  // Slow forward lean — engaged listening — 3s loop
  {
    const dur = 3.0, n = 7
    const ts = times(n, dur)
    addClip(doc, boneMap, 'mixamo_empathy_leaning_forward', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.08 + Math.sin(t * Math.PI / dur * 0.5) * 0.015, 0, 0))
      },
      {
        bone: 'Spine1', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.05 + Math.sin(t * Math.PI / dur * 0.5) * 0.01, 0, 0))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(-0.02, 0, Math.sin(t * Math.PI / dur) * 0.03))  // slight head tilt
      },
    ])
  }

  // ── 19. mixamo_concentration_chin_stroke ─────────────────────────────────
  // Right hand raises to chin thoughtfully — 2.5s once
  {
    const ts = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.5]
    addClip(doc, boneMap, 'mixamo_concentration_chin_stroke', [
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, -1.0),
          euler(-0.3, -0.1, -0.65),
          euler(-0.6, -0.15, -0.5),  // arm raised to face
          euler(-0.6, -0.15, -0.5),
          euler(-0.62, -0.12, -0.5),  // subtle stroke
          euler(-0.4, -0.1, -0.7),
          euler(0, 0, -1.0),
        ]
      },
      {
        bone: 'RightForeArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, -0.3, 0),
          euler(0, -0.7, 0),  // forearm near face
          euler(0, -0.7, 0),
          euler(0, -0.72, 0),
          euler(0, -0.4, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0.05, 0, 0),
          euler(0.06, 0, 0.02),
          euler(0.06, 0, 0.04),
          euler(0.06, 0, 0.05),
          euler(0.06, 0, 0.04),
          euler(0.05, 0, 0.02),
          euler(0.05, 0, 0),
        ]
      },
    ])
  }

  // ── 20. mixamo_confusion_head_tilt ───────────────────────────────────────
  // Quizzical head tilt right + slight shrug — 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'mixamo_confusion_head_tilt', [
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0.02, 0, 0.08),
          euler(0.03, 0, 0.15),   // tilt peak
          euler(0.03, 0, 0.15),
          euler(0.03, 0, 0.12),
          euler(0.01, 0, 0.05),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'RightShoulder', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, 0, -0.04),
          euler(0, 0, -0.08),   // subtle shrug
          euler(0, 0, -0.08),
          euler(0, 0, -0.06),
          euler(0, 0, -0.02),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 21. mesh2motion_neutral_weight_shift ─────────────────────────────────
  // Casual weight shift hip sway — 4s loop
  {
    const dur = 4.0, n = 9
    const ts = times(n, dur)
    addClip(doc, boneMap, 'mesh2motion_neutral_weight_shift', [
      {
        bone: 'Hips', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0, 0, Math.sin(t * Math.PI * 0.5) * 0.04))
      },
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.01, 0, -Math.sin(t * Math.PI * 0.5) * 0.025)) // counter-rotation
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0, Math.sin(t * Math.PI * 0.25) * 0.01, 0))
      },
    ])
  }

  // ── 22. mesh2motion_joy_celebratory_clap ─────────────────────────────────
  // Two claps with chest bounce — 1.5s once
  {
    const ts = [0, 0.2, 0.35, 0.5, 0.65, 0.9, 1.1, 1.3, 1.5]
    addClip(doc, boneMap, 'mesh2motion_joy_celebratory_clap', [
      {
        bone: 'LeftArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 1.0),
          euler(-0.45, 0.25, 0.55),
          euler(-0.5, 0.3, 0.5),   // clap 1 meet
          euler(-0.4, 0.2, 0.6),
          euler(-0.48, 0.28, 0.52), // clap 2 meet
          euler(-0.3, 0.1, 0.7),
          euler(-0.15, 0, 0.85),
          euler(0, 0, 1.0),
          euler(0, 0, 1.0),
        ]
      },
      {
        bone: 'RightArm', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, -1.0),
          euler(-0.45, -0.25, -0.55),
          euler(-0.5, -0.3, -0.5),
          euler(-0.4, -0.2, -0.6),
          euler(-0.48, -0.28, -0.52),
          euler(-0.3, -0.1, -0.7),
          euler(-0.15, 0, -0.85),
          euler(0, 0, -1.0),
          euler(0, 0, -1.0),
        ]
      },
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(-0.04, 0, 0),
          euler(-0.05, 0, 0),
          euler(-0.03, 0, 0),
          euler(-0.04, 0, 0),
          euler(-0.02, 0, 0),
          euler(-0.01, 0, 0),
          euler(0, 0, 0),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 23. mesh2motion_sadness_shoulder_slump ───────────────────────────────
  // Progressive shoulder drop, slow recovery — 5s loop
  {
    const dur = 5.0, n = 9
    const ts = times(n, dur)
    addClip(doc, boneMap, 'mesh2motion_sadness_shoulder_slump', [
      {
        bone: 'LeftShoulder', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0, 0, 0.05 + Math.sin(t * Math.PI / dur) * 0.04))
      },
      {
        bone: 'RightShoulder', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0, 0, -(0.05 + Math.sin(t * Math.PI / dur) * 0.04)))
      },
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.1 + Math.sin(t * Math.PI / dur) * 0.02, 0, 0))
      },
      {
        bone: 'Spine1', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.07 + Math.sin(t * Math.PI / dur) * 0.015, 0, 0))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(0.12 + Math.sin(t * Math.PI / dur) * 0.01, 0, 0))
      },
    ])
  }

  // ── 24. (bonus) mixamo_neutral_looking_around ─────────────────────────────
  // Ambient gaze shift — head turns left/right naturally — 6s loop
  // Not in original manifest but useful; will be indexed as unknown (neutral defaults)
  {
    const ts = [0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    addClip(doc, boneMap, 'mixamo_neutral_looking_around', [
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0.01, 0.12, 0),
          euler(0.01, 0.12, 0),
          euler(0, 0, 0),
          euler(0, -0.1, 0),
          euler(0, -0.1, 0),
          euler(0, 0, 0),
        ]
      },
      {
        bone: 'Spine2', property: 'rotation',
        times: ts,
        values: [
          euler(0, 0, 0),
          euler(0, 0.03, 0),
          euler(0, 0.03, 0),
          euler(0, 0, 0),
          euler(0, -0.025, 0),
          euler(0, -0.025, 0),
          euler(0, 0, 0),
        ]
      },
    ])
  }

  // ── 25. (bonus) mixamo_neutral_listening_sway ─────────────────────────────
  // Minimal active-listening micro-movement — 8s loop
  {
    const dur = 8.0, n = 17
    const ts = times(n, dur)
    addClip(doc, boneMap, 'mixamo_neutral_listening_sway', [
      {
        bone: 'Spine', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(
          0.01 + Math.sin(t * 0.4) * 0.008,
          Math.sin(t * 0.3) * 0.006,
          Math.sin(t * 0.5) * 0.005
        ))
      },
      {
        bone: 'Head', property: 'rotation',
        times: ts,
        values: ts.map(t => euler(
          Math.sin(t * 0.35) * 0.012,
          Math.sin(t * 0.28) * 0.015,
          Math.sin(t * 0.45) * 0.008
        ))
      },
    ])
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎬  Evolve Avatar Engine — Animation Dictionary Compiler')
  console.log('   Building 25 procedural animation clips...\n')

  const doc = new Document()
  doc.createBuffer()              // required by gltf-transform for binary resources
  const boneMap = buildSkeleton(doc)

  defineClips(doc, boneMap)

  const io = new NodeIO()
  const outDir  = path.resolve(__dirname, 'dist')
  const outFile = path.join(outDir, 'animations.glb')
  fs.mkdirSync(outDir, { recursive: true })

  await io.write(outFile, doc)

  const stats = fs.statSync(outFile)
  const kb = (stats.size / 1024).toFixed(1)

  // Report what we compiled
  const animations = doc.getRoot().listAnimations()
  console.log(`✅  Compiled ${animations.length} animation clips:`)
  for (const anim of animations) {
    const channels = anim.listChannels().length
    console.log(`   • ${anim.getName().padEnd(45)} (${channels} channel${channels !== 1 ? 's' : ''})`)
  }

  console.log(`\n📦  Output: ${outFile}`)
  console.log(`   Size: ${kb} KB\n`)

  if (stats.size > 512 * 1024) {
    console.warn(`⚠   File exceeds 500KB target (${kb}KB). Consider reducing keyframe density.`)
  } else {
    console.log(`✅  Under 500KB target ✓`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
