/**
 * compile-animations.js
 *
 * Procedurally generates ALL animation clips for the Evolve avatar engine
 * and packs them into a single binary animations.glb.
 *
 * No Blender, no FBX imports, no runtime downloads — pure Node.js.
 *
 * Output: ../avatar-engine/public/avatar-engine/animations.glb
 *
 * ── Taxonomy (72 clips total) ────────────────────────────────────────────────
 *
 * NEUTRAL        (9)  — idle loop, weight shifts, subtle gestures, listening
 * JOY            (7)  — idle, talking hands, thumbs up, clap, laugh, affirmation, open
 * ANGER          (7)  — tense idle, dismissive wave, pointing, arms-crossed,
 *                       table slam, finger wag, controlled release
 * SADNESS        (6)  — slumped idle, head-down, apologetic, shoulder-slump,
 *                       head shake regret, resigned sigh
 * SURPRISE       (5)  — step back, hands up, double-take, wide lean, recover
 * FEAR           (5)  — frozen idle, shrink back, protective arms, furtive glance, tremble
 * DISGUST        (4)  — recoil, look away, lean back cross, upper-lip lift
 * EMPATHY        (6)  — open hands, forward lean, gentle nod, reach out,
 *                       hand over heart, soft head tilt
 * CONCENTRATION  (6)  — chin stroke, arms-folded think, step forward, finger
 *                       tap temple, lean in assess, deliberate point
 * CONFUSION      (5)  — head tilt, shrug, look around, double head tilt, quizzical raise
 * PROFESSIONAL   (7)  — authority stance, present data, handshake prep,
 *                       steeple fingers, open pitch, formal nod, confident cross
 * LISTENING      (5)  — active listen sway, affirm micro-nod, interested lean,
 *                       reflective pause, attentive still
 *
 * Naming convention: <source>_<emotion>_<action>
 * Source prefixes: quaternius_ | mixamo_ | mesh2motion_ | evolve_
 * (evolve_ = clips designed specifically for L&D/soft-skills scenarios)
 */

'use strict'

const { Document, NodeIO, Accessor } = require('@gltf-transform/core')
const fs   = require('fs')
const path = require('path')

// ── Math helpers ─────────────────────────────────────────────────────────────

/** Intrinsic XYZ Euler → quaternion [x,y,z,w] */
function euler(ex, ey, ez) {
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

/** Sine-bell easing: 0→peak at t=0.5→0 over [0,1] */
function bell(t) { return Math.sin(Math.PI * Math.max(0, Math.min(1, t))) }

/** Quick ease-in bell: rises fast, falls slow */
function snapBell(t) {
  const c = Math.max(0, Math.min(1, t))
  return c < 0.25 ? Math.sin(Math.PI * c * 2) : Math.cos(Math.PI * (c - 0.25) / 1.5) * 0.5 + 0.5
}

/** Evenly-spaced time array 0..duration, n samples */
function times(n, duration) {
  return Array.from({length: n}, (_, i) => (i / (n - 1)) * duration)
}

/** Flatten array-of-arrays → Float32Array */
function flat(frames) { return new Float32Array(frames.flat()) }
function ftimes(arr)  { return new Float32Array(arr) }

// ── Skeleton ──────────────────────────────────────────────────────────────────

const BONE_NAMES = [
  'Hips','Spine','Spine1','Spine2','Neck','Head',
  'LeftShoulder','LeftArm','LeftForeArm','LeftHand',
  'RightShoulder','RightArm','RightForeArm','RightHand',
  'LeftUpLeg','LeftLeg','RightUpLeg','RightLeg',
]

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

// ── Clip factory ──────────────────────────────────────────────────────────────

function addClip(doc, boneMap, name, tracks) {
  const anim = doc.createAnimation(name)
  for (const track of tracks) {
    const node = boneMap.get(track.bone)
    if (!node) { console.warn(`  ⚠  bone "${track.bone}" not found — skipping`); continue }
    const nComp = track.property === 'rotation' ? 4 : 3
    const inputAcc = doc.createAccessor()
      .setArray(ftimes(track.times))
      .setType(Accessor.Type.SCALAR)
    const outputAcc = doc.createAccessor()
      .setArray(flat(track.values))
      .setType(nComp === 4 ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
    const sampler = doc.createAnimationSampler()
      .setInput(inputAcc).setOutput(outputAcc).setInterpolation('LINEAR')
    const channel = doc.createAnimationChannel()
      .setSampler(sampler).setTargetNode(node)
      .setTargetPath(
        track.property === 'rotation'  ? 'rotation'    :
        track.property === 'position'  ? 'translation' : 'scale'
      )
    anim.addSampler(sampler)
    anim.addChannel(channel)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIP DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════

function defineClips(doc, boneMap) {

  // ────────────────────────────────────────────────────────────────────────────
  // NEUTRAL (9 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 1. quaternius_neutral_idle — gentle breathing sway, 4s loop
  {
    const ts = times(9, 4.0)
    addClip(doc, boneMap, 'quaternius_neutral_idle', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI*0.5)*0.015, 0, Math.sin(t*Math.PI*0.25)*0.008)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI*0.5+0.3)*0.01, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI*0.25)*0.008, Math.sin(t*Math.PI*0.15)*0.012, 0)) },
    ])
  }

  // 2. mesh2motion_neutral_weight_shift — hip sway, 4s loop
  {
    const ts = times(9, 4.0)
    addClip(doc, boneMap, 'mesh2motion_neutral_weight_shift', [
      { bone:'Hips',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, Math.sin(t*Math.PI*0.5)*0.04)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.01, 0, -Math.sin(t*Math.PI*0.5)*0.025)) },
      { bone:'Head',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, Math.sin(t*Math.PI*0.25)*0.01, 0)) },
    ])
  }

  // 3. mixamo_neutral_talking_default — right-hand conversational gesture, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'mixamo_neutral_talking_default', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.06)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-bell(t/2)*0.35, 0, -1.0+bell(t/2)*0.2)) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, bell(t/2)*0.4)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI)*0.025, 0, 0)) },
    ])
  }

  // 4. mixamo_neutral_thoughtful_nod — two deliberate nods, 1.5s once
  {
    const ts = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5]
    addClip(doc, boneMap, 'mixamo_neutral_thoughtful_nod', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.12,0,0),euler(0,0,0),euler(0.1,0,0),euler(0,0,0),euler(0.05,0,0),euler(0,0,0)] },
      { bone:'Spine2', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.03,0,0),euler(0,0,0),euler(0.02,0,0),euler(0,0,0),euler(0.01,0,0),euler(0,0,0)] },
    ])
  }

  // 5. mixamo_neutral_head_shake — disagreement shake, 1.2s once
  {
    const ts = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]
    const a  = 0.14
    addClip(doc, boneMap, 'mixamo_neutral_head_shake', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-a,0),euler(0,a,0),euler(0,-a*.85,0),euler(0,a*.6,0),euler(0,-a*.3,0),euler(0,0,0)] },
    ])
  }

  // 6. mixamo_neutral_looking_around — ambient gaze shift, 6s loop
  {
    const ts = [0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    addClip(doc, boneMap, 'mixamo_neutral_looking_around', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.01,0.12,0),euler(0.01,0.12,0),euler(0,0,0),euler(0,-0.1,0),euler(0,-0.1,0),euler(0,0,0)] },
      { bone:'Spine2', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.03,0),euler(0,0.03,0),euler(0,0,0),euler(0,-0.025,0),euler(0,-0.025,0),euler(0,0,0)] },
    ])
  }

  // 7. mixamo_neutral_listening_sway — micro-motion while user is speaking, 8s loop
  {
    const ts = times(17, 8.0)
    addClip(doc, boneMap, 'mixamo_neutral_listening_sway', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.01+Math.sin(t*0.4)*0.008, Math.sin(t*0.3)*0.006, Math.sin(t*0.5)*0.005)) },
      { bone:'Head',  property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*0.35)*0.012, Math.sin(t*0.28)*0.015, Math.sin(t*0.45)*0.008)) },
    ])
  }

  // 8. evolve_neutral_explain_both_hands — bilateral open-palm explanation, 2.5s once
  {
    const ts = times(11, 2.5)
    addClip(doc, boneMap, 'evolve_neutral_explain_both_hands', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+bell(t/2.5)*0.06)) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-bell(t/2.5)*0.28, 0, 0.9-bell(t/2.5)*0.25)) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, bell(t/2.5)*0.3)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2.5)*0.06)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-bell(t/2.5)*0.28, 0, -(0.9-bell(t/2.5)*0.25))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -bell(t/2.5)*0.3)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*1.2)*0.018, 0, 0)) },
    ])
  }

  // 9. evolve_neutral_self_reference — hand to chest "I" gesture, 1.5s once
  {
    const ts = [0, 0.2, 0.5, 0.8, 1.1, 1.3, 1.5]
    addClip(doc, boneMap, 'evolve_neutral_self_reference', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,-0.15),euler(0,0,-0.17),euler(0,0,-0.22),euler(0,0,-0.22),euler(0,0,-0.22),euler(0,0,-0.18),euler(0,0,-0.15)] },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.15,0,-0.8),euler(-0.5,-0.3,-0.55),euler(-0.5,-0.3,-0.55),euler(-0.5,-0.3,-0.55),euler(-0.2,0,-0.85),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.15,0),euler(0,-0.55,0.3),euler(0,-0.55,0.3),euler(0,-0.55,0.3),euler(0,-0.2,0.1),euler(0,0,0)] },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // JOY (7 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 10. quaternius_joy_breathing_idle — upright bouncy chest, 3s loop
  {
    const ts = times(9, 3.0)
    addClip(doc, boneMap, 'quaternius_joy_breathing_idle', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.04+Math.sin(t*Math.PI*0.67)*0.02, 0, 0)) },
      { bone:'Spine2', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.03+Math.sin(t*Math.PI*0.67+0.2)*0.015, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI*0.33)*0.01, Math.sin(t*Math.PI*0.2)*0.015, 0)) },
      { bone:'LeftArm',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 1.0+Math.sin(t*Math.PI*0.67)*0.03)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -1.0-Math.sin(t*Math.PI*0.67)*0.03)) },
    ])
  }

  // 11. mixamo_joy_talking_hands — animated bilateral talk, 2.5s once
  {
    const ts = times(11, 2.5)
    addClip(doc, boneMap, 'mixamo_joy_talking_hands', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+Math.sin(t*Math.PI*2/2.5)*0.04)) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.2-Math.sin(t*Math.PI*2/2.5)*0.2, 0, 0.9-Math.sin(t*Math.PI*2/2.5)*0.15)) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, Math.sin(t*Math.PI*2/2.5+0.5)*0.35)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-Math.sin(t*Math.PI*2/2.5+Math.PI)*0.04)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.2-Math.sin(t*Math.PI*2/2.5+Math.PI)*0.2, 0, -0.9+Math.sin(t*Math.PI*2/2.5+Math.PI)*0.15)) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -Math.sin(t*Math.PI*2/2.5+0.5)*0.35)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI*0.8)*0.02, Math.sin(t*Math.PI*0.5)*0.025, 0)) },
    ])
  }

  // 12. mixamo_joy_thumbs_up — right arm raises thumbs-up, 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'mixamo_joy_thumbs_up', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,-0.15),euler(0,0,-0.19),euler(0,0,-0.24),euler(0,0,-0.24),euler(0,0,-0.24),euler(0,0,-0.20),euler(0,0,-0.15)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.5,0.1,-0.7),euler(-0.8,0.15,-0.5),euler(-0.8,0.15,-0.5),euler(-0.8,0.15,-0.5),euler(-0.4,0.05,-0.75),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.2,0.1),euler(0,-0.4,0.2),euler(0,-0.4,0.2),euler(0,-0.4,0.2),euler(0,-0.2,0.1),euler(0,0,0)] },
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.05,0,0),euler(-0.06,0,0),euler(-0.04,0,0),euler(-0.02,0,0),euler(0.02,0,0),euler(0,0,0)] },
    ])
  }

  // 13. mesh2motion_joy_celebratory_clap — two claps, 1.5s once
  {
    const ts = [0, 0.2, 0.35, 0.5, 0.65, 0.9, 1.1, 1.3, 1.5]
    addClip(doc, boneMap, 'mesh2motion_joy_celebratory_clap', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:[euler(0,0,1.0),euler(-0.45,0.25,0.55),euler(-0.5,0.3,0.5),euler(-0.4,0.2,0.6),euler(-0.48,0.28,0.52),euler(-0.3,0.1,0.7),euler(-0.15,0,0.85),euler(0,0,1.0),euler(0,0,1.0)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.45,-0.25,-0.55),euler(-0.5,-0.3,-0.5),euler(-0.4,-0.2,-0.6),euler(-0.48,-0.28,-0.52),euler(-0.3,-0.1,-0.7),euler(-0.15,0,-0.85),euler(0,0,-1.0),euler(0,0,-1.0)] },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.04*bell(t/1.5), 0, 0)) },
    ])
  }

  // 14. evolve_joy_enthusiastic_agree — forward step + open arms "yes!", 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_joy_enthusiastic_agree', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.06*bell(t/2), 0, 0)) },
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.4*bell(t/2), 0, 0.75-0.3*bell(t/2))) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.4*bell(t/2), 0, -0.75+0.3*bell(t/2))) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05*bell(t/2), 0, 0)) },
    ])
  }

  // 15. evolve_joy_warm_smile_nod — warm nod with slight open-arm rest, 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'evolve_joy_warm_smile_nod', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.1,0,0),euler(0.02,0,0),euler(0.08,0,0),euler(0.01,0,0),euler(0.04,0,0),euler(0,0,0)] },
      { bone:'Spine', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.02,0,0),euler(0,0,0),euler(-0.015,0,0),euler(0,0,0),euler(-0.01,0,0),euler(0,0,0)] },
    ])
  }

  // 16. evolve_joy_present_good_news — arms spread wide for reveal, 2.2s once
  {
    const ts = times(9, 2.2)
    addClip(doc, boneMap, 'evolve_joy_present_good_news', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+bell(t/2.2)*0.08)) },
      { bone:'LeftArm',      property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.35*bell(t/2.2), -0.1*bell(t/2.2), 0.8-0.5*bell(t/2.2))) },
      { bone:'LeftForeArm',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.2*bell(t/2.2), 0.3*bell(t/2.2))) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2.2)*0.08)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.35*bell(t/2.2), 0.1*bell(t/2.2), -(0.8-0.5*bell(t/2.2)))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.2*bell(t/2.2), -0.3*bell(t/2.2))) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.04*bell(t/2.2), 0, 0)) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ANGER (7 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 17. quaternius_anger_tense_idle — stiff heave, arms tight, 3s loop
  {
    const ts = times(7, 3.0)
    addClip(doc, boneMap, 'quaternius_anger_tense_idle', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.06+Math.sin(t*Math.PI*0.67)*0.025, 0, 0)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+Math.sin(t*Math.PI*0.67)*0.018, 0, 0)) },
      { bone:'Neck',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05, 0, Math.sin(t*Math.PI*0.5)*0.005)) },
      { bone:'Head',   property:'rotation', times:ts, values:ts.map(()=>euler(0.04,0,0)) },
      { bone:'LeftArm',  property:'rotation', times:ts, values:ts.map(()=>euler(-0.05,0,0.85)) },
      { bone:'RightArm', property:'rotation', times:ts, values:ts.map(()=>euler(-0.05,0,-0.85)) },
    ])
  }

  // 18. mixamo_anger_dismissive_wave — sharp right-hand dismissal, 1.5s once
  {
    const ts = [0, 0.15, 0.4, 0.65, 0.9, 1.2, 1.5]
    addClip(doc, boneMap, 'mixamo_anger_dismissive_wave', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,-0.15),euler(0,0,-0.17),euler(0,0,-0.21),euler(0,0,-0.21),euler(0,0,-0.22),euler(0,0,-0.18),euler(0,0,-0.15)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.1,0,-0.8),euler(-0.3,0.2,-0.6),euler(-0.3,0.2,-0.6),euler(-0.25,0.35,-0.55),euler(-0.1,0.1,-0.75),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.1,0),euler(0,-0.5,0.15),euler(0,-0.7,0.2),euler(0,-0.4,0.1),euler(0,-0.15,0),euler(0,0,0)] },
      { bone:'Head', property:'rotation', times:ts, values:ts.map(()=>euler(0.04,0,0)) },
    ])
  }

  // 19. mixamo_anger_pointing — assertive forward point, 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'mixamo_anger_pointing', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,-0.15),euler(0,0,-0.19),euler(0,0,-0.23),euler(0,0,-0.23),euler(0,0,-0.23),euler(0,0,-0.20),euler(0,0,-0.15)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.3,-0.1,-0.7),euler(-0.6,-0.2,-0.5),euler(-0.65,-0.2,-0.5),euler(-0.65,-0.2,-0.5),euler(-0.35,-0.1,-0.75),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.3,0),euler(0,-0.6,0),euler(0,-0.65,0),euler(0,-0.6,0),euler(0,-0.3,0),euler(0,0,0)] },
      { bone:'RightHand', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.1,0),euler(0,-0.18,0),euler(0,-0.18,0),euler(0,-0.18,0),euler(0,-0.1,0),euler(0,0,0)] },
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0.04,0,0),euler(0.06,0.05,0),euler(0.04,0.08,0),euler(0.04,0.08,0),euler(0.04,0.06,0),euler(0.04,0.02,0),euler(0.04,0,0)] },
    ])
  }

  // 20. mixamo_anger_arms_crossed — defensive crossed posture, 2s loop
  {
    const ts = times(5, 2.0)
    addClip(doc, boneMap, 'mixamo_anger_arms_crossed', [
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0, 0, 0.18)) },
      { bone:'LeftArm',     property:'rotation', times:ts, values:ts.map(t=>euler(-0.35+Math.sin(t*Math.PI)*0.01, 0.3, 0.5)) },
      { bone:'LeftForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0, 0.8, 0)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0, 0, -0.18)) },
      { bone:'RightArm',     property:'rotation', times:ts, values:ts.map(t=>euler(-0.35+Math.sin(t*Math.PI+0.2)*0.01, -0.3, -0.5)) },
      { bone:'RightForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0, -0.8, 0)) },
      { bone:'Spine', property:'rotation', times:ts, values:ts.map(()=>euler(0.05, 0, 0)) },
    ])
  }

  // 21. evolve_anger_finger_wag — authoritative "no" finger wag, 1.5s once
  {
    const ts = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5]
    addClip(doc, boneMap, 'evolve_anger_finger_wag', [
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.25,-0.1,-0.75),euler(-0.35,-0.15,-0.65),euler(-0.35,-0.15,-0.65),euler(-0.35,-0.15,-0.65),euler(-0.35,-0.15,-0.65),euler(-0.2,-0.05,-0.8),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.4,0.1),euler(0,-0.5,0.15),euler(0,-0.55,0.15),euler(0,-0.5,0.15),euler(0,-0.55,0.15),euler(0,-0.3,0.05),euler(0,0,0)] },
      // wag via hand rotation
      { bone:'RightHand', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0,0.08),euler(0,0,-0.08),euler(0,0,0.08),euler(0,0,-0.08),euler(0,0,0.06),euler(0,0,0),euler(0,0,0)] },
    ])
  }

  // 22. evolve_anger_controlled_release — deep breath, composed posture, 2.5s once
  // Used for de-escalation moment: anger beginning to subside
  {
    const ts = times(9, 2.5)
    addClip(doc, boneMap, 'evolve_anger_controlled_release', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2.5); return euler(0.06-s*0.06, 0, 0) }) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2.5); return euler(0.04-s*0.04, 0, 0) }) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2.5); return euler(0.04-s*0.04, 0, 0) }) },
      { bone:'LeftArm',  property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2.5); return euler(-0.05+s*0.05, 0, 0.85+s*0.15) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2.5); return euler(-0.05+s*0.05, 0, -0.85-s*0.15) }) },
    ])
  }

  // 23. evolve_anger_emphatic_table — hands-down emphatic gesture (authority), 1.2s once
  {
    const ts = [0, 0.15, 0.35, 0.55, 0.75, 0.95, 1.2]
    addClip(doc, boneMap, 'evolve_anger_emphatic_table', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:[euler(0,0,0.15),euler(0,0,0.17),euler(0,0,0.20),euler(0,0,0.21),euler(0,0,0.20),euler(0,0,0.18),euler(0,0,0.15)] },
      { bone:'LeftArm',      property:'rotation', times:ts,
        values:[euler(0,0,1.0),euler(-0.1,0,0.7),euler(-0.2,0.15,0.55),euler(-0.25,0.2,0.5),euler(-0.2,0.15,0.55),euler(-0.1,0.05,0.7),euler(0,0,1.0)] },
      { bone:'LeftForeArm',  property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.1,0),euler(0,0.35,0.1),euler(0,0.45,0.15),euler(0,0.35,0.1),euler(0,0.15,0.05),euler(0,0,0)] },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,-0.15),euler(0,0,-0.17),euler(0,0,-0.20),euler(0,0,-0.21),euler(0,0,-0.20),euler(0,0,-0.18),euler(0,0,-0.15)] },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.1,0,-0.7),euler(-0.2,-0.15,-0.55),euler(-0.25,-0.2,-0.5),euler(-0.2,-0.15,-0.55),euler(-0.1,-0.05,-0.7),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.1,0),euler(0,-0.35,-0.1),euler(0,-0.45,-0.15),euler(0,-0.35,-0.1),euler(0,-0.15,-0.05),euler(0,0,0)] },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SADNESS (6 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 24. quaternius_sadness_slumped — slumped forward, head down, 5s loop
  {
    const ts = times(9, 5.0)
    addClip(doc, boneMap, 'quaternius_sadness_slumped', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.14+Math.sin(t*Math.PI*0.4)*0.01, 0, 0)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.10+Math.sin(t*Math.PI*0.4)*0.008, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.18+Math.sin(t*Math.PI*0.4)*0.008, 0, 0)) },
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.06)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.06)) },
    ])
  }

  // 25. mixamo_sadness_apologetic_hands — palms-up resigned, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'mixamo_sadness_apologetic_hands', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+bell(t/2)*0.05)) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-bell(t/2)*0.25, 0, 0.9-bell(t/2)*0.2)) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, bell(t/2)*0.5)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.05)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-bell(t/2)*0.25, 0, -(0.9-bell(t/2)*0.2))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -bell(t/2)*0.5)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.1+bell(t/2)*0.04, 0, 0)) },
    ])
  }

  // 26. mixamo_sadness_head_down — slow head drop with sigh, 3s once
  {
    const ts = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
    addClip(doc, boneMap, 'mixamo_sadness_head_down', [
      { bone:'Head',   property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.08,0,0),euler(0.22,0,0),euler(0.25,0,0),euler(0.25,0,0),euler(0.15,0,0),euler(0.05,0,0)] },
      { bone:'Spine1', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.03,0,0),euler(0.07,0,0),euler(0.08,0,0),euler(0.07,0,0),euler(0.04,0,0),euler(0,0,0)] },
    ])
  }

  // 27. mesh2motion_sadness_shoulder_slump — drooped shoulders loop, 5s loop
  {
    const ts = times(9, 5.0)
    addClip(doc, boneMap, 'mesh2motion_sadness_shoulder_slump', [
      { bone:'LeftShoulder',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.05+Math.sin(t*Math.PI/5)*0.04)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -(0.05+Math.sin(t*Math.PI/5)*0.04))) },
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.1+Math.sin(t*Math.PI/5)*0.02, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.12+Math.sin(t*Math.PI/5)*0.01, 0, 0)) },
    ])
  }

  // 28. evolve_sadness_slow_head_shake — regretful slow shake, 2s once
  {
    const ts = [0, 0.4, 0.8, 1.2, 1.6, 2.0]
    const a = 0.10
    addClip(doc, boneMap, 'evolve_sadness_slow_head_shake', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0.1,0,0),euler(0.1,-a,0),euler(0.1,a,0),euler(0.1,-a*0.7,0),euler(0.1,a*0.4,0),euler(0.1,0,0)] },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(()=>euler(0.08,0,0)) },
    ])
  }

  // 29. evolve_sadness_resigned_sigh — deep inhale + exhale slump, 2.5s once
  {
    const ts = times(9, 2.5)
    addClip(doc, boneMap, 'evolve_sadness_resigned_sigh', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{
          const p = t/2.5
          // rise on inhale, drop on exhale
          const v = p < 0.4 ? p/0.4 : 1-(p-0.4)/0.6
          return euler(0.05-v*0.03, 0, 0)
        }) },
      { bone:'Spine2', property:'rotation', times:ts,
        values:ts.map(t=>{
          const p = t/2.5
          const v = p < 0.4 ? p/0.4 : 1-(p-0.4)/0.6
          return euler(0.03-v*0.02, 0, 0)
        }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/2.5; return euler(0.08+p*0.08, 0, 0) }) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SURPRISE (5 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 30. mixamo_surprise_step_back — startle, arms fly up, 1.5s once
  {
    const ts = [0, 0.15, 0.4, 0.7, 1.0, 1.25, 1.5]
    addClip(doc, boneMap, 'mixamo_surprise_step_back', [
      { bone:'Spine', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.15,0,0),euler(-0.12,0,0),euler(-0.06,0,0),euler(-0.02,0,0),euler(0,0,0),euler(0,0,0)] },
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.1,0,0),euler(-0.05,0,0),euler(0,0,0),euler(0,0,0),euler(0,0,0),euler(0,0,0)] },
      { bone:'LeftArm', property:'rotation', times:ts,
        values:[euler(0,0,1.0),euler(-0.4,0,0.6),euler(-0.35,0,0.65),euler(-0.2,0,0.8),euler(-0.1,0,0.9),euler(0,0,1.0),euler(0,0,1.0)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.4,0,-0.6),euler(-0.35,0,-0.65),euler(-0.2,0,-0.8),euler(-0.1,0,-0.9),euler(0,0,-1.0),euler(0,0,-1.0)] },
    ])
  }

  // 31. evolve_surprise_double_take — head snaps to one side twice, 1.5s once
  {
    const ts = [0, 0.15, 0.3, 0.5, 0.65, 0.8, 1.0, 1.2, 1.5]
    addClip(doc, boneMap, 'evolve_surprise_double_take', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.12,0),euler(0,0,0),euler(0,0.18,0),euler(0,0.18,0),euler(0,0.18,0),euler(0,0.08,0),euler(0,0.02,0),euler(0,0,0)] },
    ])
  }

  // 32. evolve_surprise_lean_in — wide-eyed lean forward, 1.8s once
  {
    const ts = times(7, 1.8)
    addClip(doc, boneMap, 'evolve_surprise_lean_in', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.08*bell(t/1.8), 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.06*bell(t/1.8), 0, 0)) },
      { bone:'LeftArm',  property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05*bell(t/1.8), 0, 1.0)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05*bell(t/1.8), 0, -1.0)) },
    ])
  }

  // 33. evolve_surprise_hands_on_face — both hands rise toward face, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_surprise_hands_on_face', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+bell(t/2)*0.10)) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.65*bell(t/2), 0.2*bell(t/2), 0.6-0.4*bell(t/2))) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.5*bell(t/2), 0.3*bell(t/2))) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.10)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.65*bell(t/2), -0.2*bell(t/2), -(0.6-0.4*bell(t/2)))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.5*bell(t/2), -0.3*bell(t/2))) },
    ])
  }

  // 34. evolve_surprise_recover — recovery from shock, settle back, 2s once
  {
    const ts = times(7, 2.0)
    addClip(doc, boneMap, 'evolve_surprise_recover', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/2.0; return euler(-0.1*(1-p), 0, 0) }) },
      { bone:'Head',  property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/2.0; return euler(-0.06*(1-p), 0, 0) }) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FEAR (5 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 35. quaternius_fear_frozen_idle — rigid, breath held, minimal movement, 3s loop
  {
    const ts = times(7, 3.0)
    addClip(doc, boneMap, 'quaternius_fear_frozen_idle', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+Math.sin(t*Math.PI*0.33)*0.005, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.02+Math.sin(t*Math.PI*0.5)*0.006, 0, Math.sin(t*Math.PI*0.4)*0.004)) },
      { bone:'LeftArm',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.75)) },
      { bone:'RightArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.75)) },
    ])
  }

  // 36. evolve_fear_shrink_back — shoulders up, body shrinks, 1.5s once
  {
    const ts = times(7, 1.5)
    addClip(doc, boneMap, 'evolve_fear_shrink_back', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05*bell(t/1.5), 0, 0)) },
      { bone:'Neck',   property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.04*bell(t/1.5), 0, 0)) },
      { bone:'LeftShoulder',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.12*bell(t/1.5))) },  // shoulders up
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.12*bell(t/1.5))) },
      { bone:'LeftArm',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.1*bell(t/1.5), 0, 0.7)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.1*bell(t/1.5), 0, -0.7)) },
    ])
  }

  // 37. evolve_fear_protective_arms — arms cross over chest protectively, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_fear_protective_arms', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+bell(t/2)*0.07)) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2); return euler(-0.4*s, 0.25*s, 0.65-0.2*s) }) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.7*bell(t/2), 0)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.07)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2); return euler(-0.4*s, -0.25*s, -(0.65-0.2*s)) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.7*bell(t/2), 0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05*bell(t/2), 0, 0)) },
    ])
  }

  // 38. evolve_fear_furtive_glance — rapid head turn to side then back, 1.2s once
  {
    const ts = [0, 0.2, 0.4, 0.6, 0.75, 0.9, 1.05, 1.2]
    addClip(doc, boneMap, 'evolve_fear_furtive_glance', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.2,0),euler(0,0.28,0),euler(0,0.28,0),euler(0,0.1,0),euler(0,-0.15,0),euler(0,-0.05,0),euler(0,0,0)] },
      { bone:'Spine2', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.05,0),euler(0,0.07,0),euler(0,0.07,0),euler(0,0.03,0),euler(0,-0.04,0),euler(0,-0.01,0),euler(0,0,0)] },
    ])
  }

  // 39. evolve_fear_tension_tremble — subtle high-frequency tremor in hands, 2s loop
  {
    const n = 25; const dur = 2.0
    const ts = times(n, dur)
    addClip(doc, boneMap, 'evolve_fear_tension_tremble', [
      { bone:'RightHand', property:'rotation', times:ts,
        values:ts.map((_,i)=>euler(0, 0, ((i%2===0)?0.018:-0.018))) },
      { bone:'LeftHand',  property:'rotation', times:ts,
        values:ts.map((_,i)=>euler(0, 0, ((i%2===0)?-0.015:0.015))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map((_,i)=>euler(0, 0, ((i%2===0)?0.008:-0.008))) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DISGUST (4 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 40. quaternius_disgust_recoil_idle — lean back + slight head turn away, 3s loop
  {
    const ts = times(7, 3.0)
    addClip(doc, boneMap, 'quaternius_disgust_recoil_idle', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.06+Math.sin(t*Math.PI*0.33)*0.008, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.03, -0.08+Math.sin(t*Math.PI*0.2)*0.005, 0.03)) },
      { bone:'LeftArm',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,1.0)) },
      { bone:'RightArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-1.0)) },
    ])
  }

  // 41. evolve_disgust_look_away — head turns firmly away and back, 2s once
  {
    const ts = [0, 0.3, 0.6, 1.0, 1.4, 1.7, 2.0]
    addClip(doc, boneMap, 'evolve_disgust_look_away', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.02,-0.2,0.04),euler(-0.04,-0.32,0.06),euler(-0.04,-0.32,0.06),euler(-0.02,-0.2,0.04),euler(-0.01,-0.05,0.01),euler(0,0,0)] },
      { bone:'Spine2', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.05,0),euler(0,-0.08,0),euler(0,-0.08,0),euler(0,-0.05,0),euler(0,-0.01,0),euler(0,0,0)] },
    ])
  }

  // 42. evolve_disgust_lean_back_cross — leaning back with crossed arms, 3s loop
  {
    const ts = times(5, 3.0)
    addClip(doc, boneMap, 'evolve_disgust_lean_back_cross', [
      { bone:'Spine',  property:'rotation', times:ts, values:ts.map(()=>euler(-0.08,0,0)) },
      { bone:'Head',   property:'rotation', times:ts, values:ts.map(()=>euler(-0.04,-0.05,0)) },
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.18)) },
      { bone:'LeftArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.3,0.25,0.55)) },
      { bone:'LeftForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0.7,0)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.18)) },
      { bone:'RightArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.3,-0.25,-0.55)) },
      { bone:'RightForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,-0.7,0)) },
    ])
  }

  // 43. evolve_disgust_sharp_recoil — brief sharp backward jerk, 1.2s once
  {
    const ts = [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1.2]
    addClip(doc, boneMap, 'evolve_disgust_sharp_recoil', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.18,0,0),euler(-0.22,0,0),euler(-0.18,0,0),euler(-0.12,0,0),euler(-0.05,0,0),euler(0,0,0)] },
      { bone:'Head',   property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.12,0,0),euler(-0.15,0,0),euler(-0.12,0,0),euler(-0.07,0,0),euler(-0.02,0,0),euler(0,0,0)] },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // EMPATHY (6 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 44. mixamo_empathy_open_hands — warm palms-forward presentation, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'mixamo_empathy_open_hands', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2)*0.9; return euler(0,0,0.15+s*0.06) }) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2)*0.9; return euler(-s*0.3,-s*0.1,1.0-s*0.35) }) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2); return euler(0,s*0.35,s*0.4) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2)*0.9; return euler(0,0,-0.15-s*0.06) }) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2)*0.9; return euler(-s*0.3,s*0.1,-(1.0-s*0.35)) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2); return euler(0,-s*0.35,-s*0.4) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.03*bell(t/2), 0, 0)) },
    ])
  }

  // 45. mixamo_empathy_leaning_forward — slow engaged lean, 3s loop
  {
    const ts = times(7, 3.0)
    addClip(doc, boneMap, 'mixamo_empathy_leaning_forward', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.08+Math.sin(t*Math.PI/3*0.5)*0.015, 0, 0)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05+Math.sin(t*Math.PI/3*0.5)*0.01, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.02, 0, Math.sin(t*Math.PI/3)*0.03)) },
    ])
  }

  // 46. evolve_empathy_gentle_nod — slow reassuring nod sequence, 3s once
  {
    const ts = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.7, 3.0]
    addClip(doc, boneMap, 'evolve_empathy_gentle_nod', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.09,0,0.02),euler(0.01,0,0),euler(0.07,0,0.02),euler(0.01,0,0),euler(0.06,0,0.01),euler(0.01,0,0),euler(0.03,0,0),euler(0,0,0)] },
      { bone:'Spine', property:'rotation', times:ts,
        values:[euler(0.04,0,0),euler(0.06,0,0),euler(0.04,0,0),euler(0.06,0,0),euler(0.04,0,0),euler(0.05,0,0),euler(0.04,0,0),euler(0.04,0,0),euler(0.04,0,0)] },
    ])
  }

  // 47. evolve_empathy_reach_out — one hand extends toward other person, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_empathy_reach_out', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.06)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.5*bell(t/2), -0.15*bell(t/2), -0.85+0.3*bell(t/2))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.4*bell(t/2), 0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.03, 0.06*bell(t/2), 0)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.03*bell(t/2), 0.04*bell(t/2), 0)) },
    ])
  }

  // 48. evolve_empathy_hand_over_heart — right hand rests on chest, 2.5s once
  {
    const ts = times(9, 2.5)
    addClip(doc, boneMap, 'evolve_empathy_hand_over_heart', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2.5)*0.07)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.55*bell(t/2.5), -0.2*bell(t/2.5), -0.7+0.15*bell(t/2.5))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.6*bell(t/2.5), 0.2*bell(t/2.5))) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.03+0.02*bell(t/2.5), 0, 0)) },
    ])
  }

  // 49. evolve_empathy_soft_head_tilt — compassionate head tilt with forward lean, 2s loop
  {
    const ts = times(7, 2.0)
    addClip(doc, boneMap, 'evolve_empathy_soft_head_tilt', [
      { bone:'Head',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+Math.sin(t*Math.PI/2)*0.006, 0, 0.08+Math.sin(t*Math.PI/4)*0.005)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.06+Math.sin(t*Math.PI/2)*0.008, 0, 0)) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CONCENTRATION (6 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 50. quaternius_concentration_idle — forward lean, still, 4s loop
  {
    const ts = times(7, 4.0)
    addClip(doc, boneMap, 'quaternius_concentration_idle', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05+Math.sin(t*Math.PI*0.5)*0.008, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.06+Math.sin(t*Math.PI*0.4)*0.006, 0, 0.04)) },
    ])
  }

  // 51. mixamo_concentration_chin_stroke — right hand to chin, 2.5s once
  {
    const ts = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.5]
    addClip(doc, boneMap, 'mixamo_concentration_chin_stroke', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,-0.15),euler(0,0,-0.19),euler(0,0,-0.23),euler(0,0,-0.23),euler(0,0,-0.23),euler(0,0,-0.20),euler(0,0,-0.15)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.3,-0.1,-0.65),euler(-0.6,-0.15,-0.5),euler(-0.6,-0.15,-0.5),euler(-0.62,-0.12,-0.5),euler(-0.4,-0.1,-0.7),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.3,0),euler(0,-0.7,0),euler(0,-0.7,0),euler(0,-0.72,0),euler(0,-0.4,0),euler(0,0,0)] },
      { bone:'RightHand', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.05,0.02),euler(0,-0.08,0.04),euler(0,-0.1,0.06),euler(0,-0.08,0.04),euler(0,-0.05,0.02),euler(0,0,0)] },
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0.05,0,0),euler(0.06,0,0.02),euler(0.06,0,0.04),euler(0.06,0,0.05),euler(0.06,0,0.04),euler(0.05,0,0.02),euler(0.05,0,0)] },
    ])
  }

  // 52. evolve_concentration_arms_folded_think — folded-arms contemplative stance, 4s loop
  {
    const ts = times(7, 4.0)
    addClip(doc, boneMap, 'evolve_concentration_arms_folded_think', [
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.18)) },
      { bone:'LeftArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.3,0.2,0.5)) },
      { bone:'LeftForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0.75,0)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.18)) },
      { bone:'RightArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.3,-0.2,-0.5)) },
      { bone:'RightForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,-0.75,0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.06+Math.sin(t*0.5)*0.01, Math.sin(t*0.3)*0.015, 0.03)) },
    ])
  }

  // 53. evolve_concentration_step_forward — deliberate step toward / lean in, 2s once
  {
    const ts = times(7, 2.0)
    addClip(doc, boneMap, 'evolve_concentration_step_forward', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+bell(t/2)*0.06, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+bell(t/2)*0.04, 0, 0)) },
    ])
  }

  // 54. evolve_concentration_finger_tap_temple — finger taps temple in thought, 2s once
  {
    const ts = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    addClip(doc, boneMap, 'evolve_concentration_finger_tap_temple', [
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.4,-0.1,-0.65),euler(-0.65,-0.15,-0.5),euler(-0.65,-0.15,-0.5),euler(-0.65,-0.15,-0.5),euler(-0.65,-0.15,-0.5),euler(-0.65,-0.15,-0.5),euler(-0.35,-0.1,-0.7),euler(0,0,-1.0)] },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,-0.4,0.1),euler(0,-0.7,0.15),euler(0,-0.7,0.15),euler(0,-0.7,0.15),euler(0,-0.7,0.15),euler(0,-0.7,0.15),euler(0,-0.35,0.05),euler(0,0,0)] },
      // subtle tap via hand
      { bone:'RightHand', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0,0),euler(0,0,0),euler(0,0.05,-0.03),euler(0,0,0),euler(0,0.05,-0.03),euler(0,0,0),euler(0,0,0),euler(0,0,0)] },
    ])
  }

  // 55. evolve_concentration_deliberate_point — slow precise pointing at key idea, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_concentration_deliberate_point', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.07)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2); return euler(-0.5*s, -0.1*s, -1.0+0.45*s) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.6*bell(t/2), 0)) },
      { bone:'RightHand', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.12*bell(t/2), 0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+0.02*bell(t/2), 0.06*bell(t/2), 0)) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CONFUSION (5 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 56. mixamo_confusion_head_tilt — quizzical head tilt + slight shrug, 1.8s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]
    addClip(doc, boneMap, 'mixamo_confusion_head_tilt', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.02,0,0.08),euler(0.03,0,0.15),euler(0.03,0,0.15),euler(0.03,0,0.12),euler(0.01,0,0.05),euler(0,0,0)] },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0,-0.04),euler(0,0,-0.08),euler(0,0,-0.08),euler(0,0,-0.06),euler(0,0,-0.02),euler(0,0,0)] },
    ])
  }

  // 57. evolve_confusion_shrug — bilateral shoulder shrug, 1.5s once
  {
    const ts = [0, 0.2, 0.45, 0.7, 1.0, 1.25, 1.5]
    addClip(doc, boneMap, 'evolve_confusion_shrug', [
      { bone:'LeftShoulder',  property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0,0.1),euler(0,0,0.18),euler(0,0,0.18),euler(0,0,0.12),euler(0,0,0.05),euler(0,0,0)] },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0,-0.1),euler(0,0,-0.18),euler(0,0,-0.18),euler(0,0,-0.12),euler(0,0,-0.05),euler(0,0,0)] },
      { bone:'LeftArm',  property:'rotation', times:ts,
        values:[euler(0,0,1.0),euler(-0.1,0,0.8),euler(-0.2,0.1,0.65),euler(-0.2,0.1,0.65),euler(-0.15,0.05,0.78),euler(-0.05,0,0.92),euler(0,0,1.0)] },
      { bone:'RightArm', property:'rotation', times:ts,
        values:[euler(0,0,-1.0),euler(-0.1,0,-0.8),euler(-0.2,-0.1,-0.65),euler(-0.2,-0.1,-0.65),euler(-0.15,-0.05,-0.78),euler(-0.05,0,-0.92),euler(0,0,-1.0)] },
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.01,0,0.04),euler(0.02,0,0.08),euler(0.02,0,0.08),euler(0.01,0,0.05),euler(0,0,0.02),euler(0,0,0)] },
    ])
  }

  // 58. evolve_confusion_look_around — scanning environment with head, 4s once
  {
    const ts = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
    addClip(doc, boneMap, 'evolve_confusion_look_around', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.15,0),euler(0,0.08,0),euler(0,-0.12,0),euler(0,-0.18,0),euler(0,-0.08,0),euler(0,0.05,0),euler(0,0.02,0),euler(0,0,0)] },
      { bone:'Spine2', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0,0.04,0),euler(0,0.02,0),euler(0,-0.03,0),euler(0,-0.05,0),euler(0,-0.02,0),euler(0,0.01,0),euler(0,0,0),euler(0,0,0)] },
    ])
  }

  // 59. evolve_confusion_double_head_tilt — tilt one way, pause, tilt other, 2.5s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.5]
    addClip(doc, boneMap, 'evolve_confusion_double_head_tilt', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.02,0,0.12),euler(0.03,0,0.16),euler(0.03,0,0.16),euler(0.01,0,0.05),euler(0,0,-0.1),euler(0.02,0,-0.14),euler(0.01,0,-0.06),euler(0,0,0)] },
    ])
  }

  // 60. evolve_confusion_quizzical_raise — one brow up implied + side glance, 1.5s once
  {
    const ts = [0, 0.3, 0.6, 0.9, 1.2, 1.5]
    addClip(doc, boneMap, 'evolve_confusion_quizzical_raise', [
      { bone:'Head', property:'rotation', times:ts,
        values:[euler(0,0,0),euler(-0.02,0.08,0.06),euler(-0.03,0.12,0.1),euler(-0.03,0.12,0.1),euler(-0.01,0.05,0.04),euler(0,0,0)] },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PROFESSIONAL / ENTERPRISE — Evolve B2B specific (7 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 61. evolve_professional_authority_stance — upright, composed, arms at sides, 4s loop
  {
    const ts = times(7, 4.0)
    addClip(doc, boneMap, 'evolve_professional_authority_stance', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.02+Math.sin(t*0.4)*0.006, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0+Math.sin(t*0.35)*0.008, Math.sin(t*0.25)*0.01, 0)) },
      { bone:'LeftArm',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,1.05)) },
      { bone:'RightArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-1.05)) },
    ])
  }

  // 62. evolve_professional_present_data — arm sweeps to imaginary screen, 2.5s once
  {
    const ts = times(11, 2.5)
    addClip(doc, boneMap, 'evolve_professional_present_data', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2.5)*0.07)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const s=bell(t/2.5); return euler(-0.45*s, -0.15*s, -1.0+0.55*s) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.5*bell(t/2.5), 0.1*bell(t/2.5))) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.08*bell(t/2.5), 0)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.04*bell(t/2.5), 0)) },
    ])
  }

  // 63. evolve_professional_steeple_fingers — fingers steepled power pose, 4s loop
  {
    const ts = times(5, 4.0)
    addClip(doc, boneMap, 'evolve_professional_steeple_fingers', [
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.17)) },
      { bone:'LeftArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.3,0.2,0.45)) },
      { bone:'LeftForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0.6,0.2)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.17)) },
      { bone:'RightArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.3,-0.2,-0.45)) },
      { bone:'RightForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,-0.6,-0.2)) },
      { bone:'Spine',  property:'rotation', times:ts, values:ts.map(()=>euler(-0.02,0,0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+Math.sin(t*0.5)*0.01, Math.sin(t*0.3)*0.015, 0)) },
    ])
  }

  // 64. evolve_professional_formal_nod — precise single authoritative nod, 1.2s once
  {
    const ts = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]
    addClip(doc, boneMap, 'evolve_professional_formal_nod', [
      { bone:'Head',  property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.06,0,0),euler(0.12,0,0),euler(0.12,0,0),euler(0.06,0,0),euler(0.02,0,0),euler(0,0,0)] },
      { bone:'Spine2',property:'rotation', times:ts,
        values:[euler(0,0,0),euler(0.02,0,0),euler(0.04,0,0),euler(0.04,0,0),euler(0.02,0,0),euler(0.01,0,0),euler(0,0,0)] },
    ])
  }

  // 65. evolve_professional_open_pitch — arms open for collaborative pitch, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_professional_open_pitch', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.15+bell(t/2)*0.06)) },
      { bone:'LeftArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.25*bell(t/2), -0.08*bell(t/2), 0.85-0.35*bell(t/2))) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.25*bell(t/2), 0.2*bell(t/2))) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.06)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.25*bell(t/2), 0.08*bell(t/2), -(0.85-0.35*bell(t/2)))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.25*bell(t/2), -0.2*bell(t/2))) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.02*bell(t/2), 0, 0)) },
    ])
  }

  // 66. evolve_professional_confident_cross — confident arm cross (not defensive), 4s loop
  {
    const ts = times(5, 4.0)
    addClip(doc, boneMap, 'evolve_professional_confident_cross', [
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.18)) },
      { bone:'LeftArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.2,0.15,0.55)) },
      { bone:'LeftForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0.65,0)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.18)) },
      { bone:'RightArm',     property:'rotation', times:ts, values:ts.map(()=>euler(-0.2,-0.15,-0.55)) },
      { bone:'RightForeArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,-0.65,0)) },
      { bone:'Spine', property:'rotation', times:ts, values:ts.map(()=>euler(-0.01,0,0)) },
      { bone:'Head',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0, Math.sin(t*0.4)*0.012, 0)) },
    ])
  }

  // 67. evolve_professional_handshake_prep — extends right hand forward, 2s once
  {
    const ts = times(9, 2.0)
    addClip(doc, boneMap, 'evolve_professional_handshake_prep', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -0.15-bell(t/2)*0.07)) },
      { bone:'RightArm',     property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.4*bell(t/2), -0.1*bell(t/2), -0.9+0.4*bell(t/2))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, -0.3*bell(t/2), 0.1*bell(t/2))) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.04*bell(t/2), 0)) },
    ])
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ACTIVE LISTENING (5 clips)
  // ────────────────────────────────────────────────────────────────────────────

  // 68. evolve_listening_active_sway — engaged body sway while other person speaks, 6s loop
  {
    const ts = times(13, 6.0)
    addClip(doc, boneMap, 'evolve_listening_active_sway', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.03+Math.sin(t*0.55)*0.01, Math.sin(t*0.38)*0.008, Math.sin(t*0.7)*0.006)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+Math.sin(t*0.45)*0.012, Math.sin(t*0.32)*0.018, Math.sin(t*0.6)*0.01)) },
    ])
  }

  // 69. evolve_listening_affirm_micro_nod — tiny sub-conscious agreement nods, 4s loop
  {
    const n = 13; const dur = 4.0
    const ts = times(n, dur)
    addClip(doc, boneMap, 'evolve_listening_affirm_micro_nod', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{
          const p = t/dur
          // Three small nods placed at ~0.25, 0.55, 0.85 of the loop
          const nod = Math.max(0,Math.sin(p*Math.PI*3)*0.045)
          return euler(nod, Math.sin(t*0.4)*0.008, 0)
        }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+Math.sin(t*0.5)*0.006, 0, 0)) },
    ])
  }

  // 70. evolve_listening_interested_lean — gradual forward lean of interest, 3s loop
  {
    const ts = times(7, 3.0)
    addClip(doc, boneMap, 'evolve_listening_interested_lean', [
      { bone:'Spine',  property:'rotation', times:ts,
        values:ts.map(t=>euler(0.06+Math.sin(t*Math.PI/3)*0.01, 0, 0)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+Math.sin(t*Math.PI/3)*0.007, 0, 0)) },
      { bone:'Head',   property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.01, 0, Math.sin(t*Math.PI/3)*0.025)) },
    ])
  }

  // 71. evolve_listening_reflective_pause — still with slight chin-down, 3s once
  {
    const ts = times(7, 3.0)
    addClip(doc, boneMap, 'evolve_listening_reflective_pause', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05+Math.sin(t*0.5)*0.005, 0, Math.sin(t*0.35)*0.008)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+Math.sin(t*0.4)*0.004, 0, 0)) },
    ])
  }

  // 72. evolve_listening_attentive_still — upright and focused, minimal movement, 5s loop
  {
    const ts = times(9, 5.0)
    addClip(doc, boneMap, 'evolve_listening_attentive_still', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.01+Math.sin(t*0.3)*0.005, 0, Math.sin(t*0.5)*0.004)) },
      { bone:'Head',  property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*0.4)*0.007, Math.sin(t*0.28)*0.009, 0)) },
      { bone:'LeftArm',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,1.05)) },
      { bone:'RightArm', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-1.05)) },
    ])
  }

  // ── v3: 38 NEW CLIPS ─────────────────────────────────────────────────────────

  // ── LISTENING & AGREEMENT (6) ────────────────────────────────────────────────

  // evolve_listening_micro_nod_continuous — 3s loop, slow shallow 5° nod
  {
    const dur=3, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_listening_micro_nod_continuous', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*2.1)*0.045, 0, 0)) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*2.1)*0.02, 0, 0)) },
    ])
  }

  // evolve_listening_lean_and_settle — 4s loop, torso forward 4-6°, head tilt 3°
  {
    const dur=4, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_listening_lean_and_settle', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05+Math.sin(t*1.57)*0.03, 0, 0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, Math.sin(t*1.57)*0.04)) },
    ])
  }

  // evolve_listening_chin_raise_affirm — 1.5s once, chin lift then return
  {
    const dur=1.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_listening_chin_raise_affirm', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const v=p<0.4?-0.12*(p/0.4):p<0.7?-0.12:0; return euler(v,0,0) }) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const v=p<0.4?-0.06*(p/0.4):p<0.7?-0.06:0; return euler(v,0,0) }) },
    ])
  }

  // evolve_listening_mmm_body — 1.8s once, head bob + chest rise
  {
    const dur=1.8, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_listening_mmm_body', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI/dur)*0.07, 0, 0)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*Math.PI/dur)*0.03, 0, 0)) },
    ])
  }

  // evolve_listening_hold_space — 6s loop, near-motionless deliberate calm
  {
    const dur=6, fps=10, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_listening_hold_space', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*0.5)*0.005, Math.sin(t*0.37)*0.005, 0)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+Math.sin(t*0.3)*0.008, 0, 0)) },
    ])
  }

  // evolve_listening_reflective_tilt — 2s once, head tilt 8-10°, hand toward chin
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_listening_reflective_tilt', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(-0.04*p, 0, 0.14*Math.min(p/0.5,1)*(1-Math.max(0,(p-0.8)/0.2))) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0, 0, -0.15-0.05*Math.min(p/0.5,1)) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(-0.25*Math.min(p/0.5,1), -0.1, -0.55) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.6*Math.min(p/0.5,1), 0, 0) }) },
    ])
  }

  // ── AGREEMENT SPECTRUM (5) ───────────────────────────────────────────────────

  // evolve_agreement_strong_nod — 1.5s once, two firm ~20° nods
  {
    const dur=1.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_agreement_strong_nod', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.32*Math.sin(t*4.19), 0, 0)) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.12*Math.sin(t*4.19), 0, 0)) },
    ])
  }

  // evolve_agreement_warm_verbal_affirm — 2s once, nod + open palm extends
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_agreement_warm_verbal_affirm', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.22*Math.sin(t*3.14), 0, 0)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const ext=p<0.5?p*2:1-(p-0.5)*2; return euler(0, 0, -0.15-0.05*ext) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const ext=p<0.5?p*2:1-(p-0.5)*2; return euler(-0.2*ext, -0.15*ext, -0.5) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const ext=p<0.5?p*2:1-(p-0.5)*2; return euler(0.4*ext, 0, 0) }) },
    ])
  }

  // evolve_agreement_considered_nod — 2s once, one slow deliberate nod + lean
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_agreement_considered_nod', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.18*Math.sin(t*Math.PI/dur), 0, 0)) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.03+0.04*Math.sin(t*Math.PI/dur), 0, 0)) },
    ])
  }

  // evolve_agreement_yes_but_pause — 2.5s once, nod → still → index rise + head tilt
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_agreement_yes_but_pause', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; if(p<0.35) return euler(0.18*Math.sin(p/0.35*Math.PI),0,0); if(p<0.6) return euler(0,0,0); return euler(0,0,0.1*(p-0.6)/0.4) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const rise=p>0.6?(p-0.6)/0.4:0; return euler(-0.15*rise, -0.1*rise, -0.5) }) },
    ])
  }

  // evolve_agreement_gentle_disagree — 1.8s once, 5-8° side-to-side head shake
  {
    const dur=1.8, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_agreement_gentle_disagree', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.1*Math.sin(t*3.49), 0)) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0.04*Math.sin(t*3.49), 0)) },
    ])
  }

  // ── COACHING & FEEDBACK (5) ──────────────────────────────────────────────────

  // evolve_coaching_praise_delivery — 2s once, open palms extend at waist then retract
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_coaching_praise_delivery', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.5?p*2:1-(p-0.5)*2; return euler(-0.15*e, 0.2*e, 0.9-0.25*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.5?p*2:1-(p-0.5)*2; return euler(-0.15*e, -0.2*e, -(0.9-0.25*e)) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05*Math.sin(t*Math.PI/dur), 0, 0)) },
    ])
  }

  // evolve_coaching_constructive_frame — 2.5s once, hands form loose frame at chest
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_coaching_constructive_frame', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.4?p/0.4:p<0.8?1:(1-p)/0.2; return euler(0, 0, 0.15+0.05*e) }) },
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.4?p/0.4:p<0.8?1:(1-p)/0.2; return euler(-0.3*e, 0.3*e, 0.7-0.2*e) }) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.4?p/0.4:p<0.8?1:(1-p)/0.2; return euler(0.7*e, 0, 0) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.4?p/0.4:p<0.8?1:(1-p)/0.2; return euler(0, 0, -0.15-0.05*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.4?p/0.4:p<0.8?1:(1-p)/0.2; return euler(-0.3*e, -0.3*e, -(0.7-0.2*e)) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.4?p/0.4:p<0.8?1:(1-p)/0.2; return euler(0.7*e, 0, 0) }) },
    ])
  }

  // evolve_coaching_check_understanding — 2s once, head tilt + palm-up query hand
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_coaching_check_understanding', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(-0.04, 0, 0.1*Math.sin(p*Math.PI)) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(0, 0, -0.15-0.04*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.2*e, -0.2*e, -0.5) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.5*Math.sin(p*Math.PI), 0, 0) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+0.03*Math.sin(t*Math.PI/dur), 0, 0)) },
    ])
  }

  // evolve_coaching_summarise_gesture — 2.5s once, slow circular gather at waist + nod
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_coaching_summarise_gesture', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.12*Math.max(0,Math.sin((p-0.75)*Math.PI/0.25)), 0, 0) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0, 0, -0.15-0.04*Math.sin(p*Math.PI)) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(-0.1, Math.sin(p*Math.PI*2)*-0.2, -0.7+Math.sin(p*Math.PI)*0.2) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.4+Math.sin(p*Math.PI)*0.3, 0, 0) }) },
    ])
  }

  // evolve_coaching_invite_reflection — 2.5s once, both palms open outward, body back
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_coaching_invite_reflection', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.1*e, 0.35*e, 0.85) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.1*e, -0.35*e, -0.85) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(-0.04*Math.sin(p*Math.PI), 0, 0) }) },
    ])
  }

  // ── PROFESSIONAL CONVERSATION (3) ────────────────────────────────────────────

  // evolve_professional_invite_to_speak — 2s once, open palm toward listener, head bow
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_professional_invite_to_speak', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(0, 0, -0.15-0.05*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.1*e, -0.3*e, -0.75+0.1*e) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.35*Math.sin(p*Math.PI), 0, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.1*Math.sin(p*Math.PI), 0, 0) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(-0.03*Math.sin(p*Math.PI), 0, 0) }) },
    ])
  }

  // evolve_professional_topic_transition — 2s once, hands open-close at waist, reset
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_professional_topic_transition', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.5?p*2*0.15:(1-(p-0.5)*2)*0.15; return euler(-e, e, 0.85) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.5?p*2*0.15:(1-(p-0.5)*2)*0.15; return euler(-e, -e, -0.85) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05, 0, 0)) },
    ])
  }

  // evolve_professional_wrap_up_signal — 2.5s once, hands clasp, lean forward, slow nod
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_professional_wrap_up_signal', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.4,1); return euler(-0.15*e, 0.15*e, 0.9-0.1*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.4,1); return euler(-0.15*e, -0.15*e, -(0.9-0.1*e)) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.05+0.05*Math.min(p/0.5,1), 0, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0.14*Math.max(0,Math.sin((p-0.7)/0.3*Math.PI)), 0, 0) }) },
    ])
  }

  // ── SUBTLE IDLE VARIETY (3) ──────────────────────────────────────────────────

  // evolve_idle_seated_upright — 5s loop, near-zero motion seated base idle
  {
    const dur=5, fps=10, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_idle_seated_upright', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.05+Math.sin(t*0.6)*0.008, Math.sin(t*0.4)*0.005, 0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*0.5)*0.006, Math.sin(t*0.35)*0.007, 0)) },
    ])
  }

  // evolve_idle_look_down_notes — 2.5s once, head drops to desk, scans L-R, returns
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_idle_look_down_notes', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const drop=p<0.25?p/0.25:p<0.75?1:1-(p-0.75)/0.25; const scan=p>0.25&&p<0.75?Math.sin((p-0.25)/0.5*Math.PI)*0.12:0; return euler(0.3*drop, scan, 0) }) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const drop=p<0.25?p/0.25:p<0.75?1:1-(p-0.75)/0.25; return euler(0.12*drop, 0, 0) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const drop=p<0.25?p/0.25:p<0.75?1:1-(p-0.75)/0.25; return euler(0.06*drop, 0, 0) }) },
    ])
  }

  // evolve_idle_micro_posture_reset — 2s once, spine extends, shoulders roll back
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_idle_micro_posture_reset', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(0.05-0.05*e, 0, 0) }) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(0.05-0.06*e, 0, 0) }) },
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0, 0, -0.08*Math.sin(p*Math.PI)) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; return euler(0, 0, 0.08*Math.sin(p*Math.PI)) }) },
    ])
  }

  // ── THINKING & PROCESSING (4) ────────────────────────────────────────────────

  // evolve_thinking_recall_look_up — 2s once, eyes/head shift up-and-aside
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_thinking_recall_look_up', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.35?p/0.35:p<0.75?1:1-(p-0.75)/0.25; return euler(-0.18*e, 0.12*e, 0) }) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.35?p/0.35:p<0.75?1:1-(p-0.75)/0.25; return euler(-0.07*e, 0, 0) }) },
    ])
  }

  // evolve_thinking_weigh_options — 2.5s once, both hands rock alternately like scales
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_thinking_weigh_options', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0, 0, 0.15+0.05*e+0.03*Math.sin(t*3.77)*e) }) },
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.3,1); return euler(-0.2*e, 0.2*e, 0.7-0.15*Math.sin(t*3.77)) }) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0.55*e, 0, 0) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0, 0, -0.15-0.05*e+0.03*Math.sin(t*3.77)*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.3,1); return euler(-0.2*e, -0.2*e, -(0.7+0.15*Math.sin(t*3.77))) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0.55*e, 0, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.05*Math.sin(t*3.77)*Math.min(t/dur/0.3,1))) },
    ])
  }

  // evolve_thinking_calculate_still — 2.5s once, near-still, hand drifts toward mouth
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_thinking_calculate_still', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const lift=p<0.4?p/0.4:1; return euler(0, 0, -0.15-0.06*lift) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const lift=p<0.4?p/0.4:1; return euler(-0.3*lift, -0.15, -0.55) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const lift=p<0.4?p/0.4:1; return euler(0.7*lift, 0, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(Math.sin(t*0.8)*0.008, Math.sin(t*1.1)*0.01, 0)) },
    ])
  }

  // evolve_thinking_decide_forward — 2s once, pause then torso forward + hand outward
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_thinking_decide_forward', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p>0.5?(p-0.5)/0.5:0; return euler(0.06*e, 0, 0) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p>0.5?(p-0.5)/0.5:0; return euler(0, 0, -0.15-0.05*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p>0.5?(p-0.5)/0.5:0; return euler(-0.2*e, -0.3*e, -0.7) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p>0.5?(p-0.5)/0.5:0; return euler(0.35*e, 0, 0) }) },
    ])
  }

  // ── EDUCATION-SPECIFIC (5) ───────────────────────────────────────────────────

  // evolve_education_step_by_step — 3s once, finger counts on hand, nod per beat
  {
    const dur=3, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_education_step_by_step', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0, 0, 0.15+0.05*e) }) },
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.3,1); return euler(-0.25*e, 0.3*e, 0.75-0.1*e) }) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0.65*e, 0, 0) }) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0, 0, -0.15-0.04*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.3,1); return euler(-0.1*e, -0.15*e, -0.7) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.3,1); return euler(0.5*e, 0, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const beat=Math.floor(t/1)*1; const phase=(t%1); return euler(0.1*Math.max(0,Math.sin(phase*Math.PI)), 0, 0) }) },
    ])
  }

  // evolve_education_point_to_content — 3s once, arm extends to side at 45°, holds, retracts
  {
    const dur=3, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_education_point_to_content', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const extend=p<0.3?p/0.3:p<0.8?1:(1-p)/0.2; return euler(0, 0, -0.15-0.08*extend) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const extend=p<0.3?p/0.3:p<0.8?1:(1-p)/0.2; return euler(-0.5*extend, -0.45*extend, -1.0*extend) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const extend=p<0.3?p/0.3:p<0.8?1:(1-p)/0.2; return euler(0.3*extend, 0, 0) }) },
      { bone:'RightHand', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const extend=p<0.3?p/0.3:p<0.8?1:(1-p)/0.2; return euler(0, -0.15*extend, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const look=p<0.3?p/0.3:p<0.8?1:(1-p)/0.2; return euler(0, -0.2*look, 0) }) },
    ])
  }

  // evolve_education_writing_gesture — 2.5s once, hand mimes writing at desk angle
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_education_writing_gesture', [
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.25,1); return euler(0, 0, -0.15-0.04*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.25,1); return euler(0.1*e, 0, -0.6) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.25,1); return euler(0.9*e, 0, 0) }) },
      { bone:'RightHand', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, Math.sin(t*4)*0.05, 0)) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.min(p/0.25,1); return euler(0.25*e, Math.sin(t*4)*0.05, 0) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.min(t/dur/0.25,1); return euler(0.08*e, 0, 0) }) },
    ])
  }

  // evolve_education_check_understand_question — 2s once, both hands open and rise
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_education_check_understand_question', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.2*e, 0.3*e, 0.8-0.2*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.2*e, -0.3*e, -(0.8-0.2*e)) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+0.04*Math.sin(t*Math.PI/dur), 0, 0)) },
    ])
  }

  // evolve_education_encourage_student — 2s once, slow affirm nod + open warm hand toward student
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_education_encourage_student', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.18*Math.sin(t*Math.PI/dur), 0, 0)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.sin(t/dur*Math.PI); return euler(0, 0, -0.15-0.04*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.1*e, -0.25*e, -0.7) }) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const e=Math.sin(t/dur*Math.PI); return euler(0.3*e, 0, 0) }) },
    ])
  }

  // ── SOCIAL & RAPPORT (4) ─────────────────────────────────────────────────────

  // evolve_rapport_calm_reassurance — 2s once, slow palm-down gesture + small nod
  {
    const dur=2, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_rapport_calm_reassurance', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.05*e, 0.2*e, 0.8-0.1*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.05*e, -0.2*e, -(0.8-0.1*e)) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.1*Math.sin(t*Math.PI/dur), 0, 0)) },
    ])
  }

  // evolve_rapport_mirroring_lean — 4s loop, torso angles, shoulder drop on near side
  {
    const dur=4, fps=15, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_rapport_mirroring_lean', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04, Math.sin(t*1.57)*0.04, Math.sin(t*1.57)*0.03)) },
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, Math.sin(t*1.57)*-0.06)) },
    ])
  }

  // evolve_rapport_professional_smile_hold — 3s once, lips rise, posture opens, holds then fades
  {
    const dur=3, fps=20, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_rapport_professional_smile_hold', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const rise=p<0.2?p/0.2:p<0.7?1:1-(p-0.7)/0.3; return euler(-0.05*rise, 0, 0) }) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const rise=p<0.2?p/0.2:p<0.7?1:1-(p-0.7)/0.3; return euler(0.04-0.04*rise, 0, 0) }) },
    ])
  }

  // evolve_rapport_inclusive_gesture — 2.5s once, arms spread gently outward, palms up
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_rapport_inclusive_gesture', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.08*e, 0.4*e, 0.7-0.2*e) }) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=Math.sin(p*Math.PI); return euler(-0.08*e, -0.4*e, -(0.7-0.2*e)) }) },
    ])
  }

  // ── STRESS & PRESSURE (5) ────────────────────────────────────────────────────

  // evolve_stress_suppressed_still — 4s loop, elevated shoulders, shallow breath
  {
    const dur=4, fps=15, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_stress_suppressed_still', [
      { bone:'LeftShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.12+Math.sin(t*1.57)*0.015, 0, 0)) },
      { bone:'RightShoulder', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.12+Math.sin(t*1.57)*0.015, 0, 0)) },
      { bone:'Spine1', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.02+Math.sin(t*1.57)*0.008, 0, 0)) },
    ])
  }

  // evolve_stress_contained_retreat — 1.5s once, small backward weight shift, chin drops
  {
    const dur=1.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_stress_contained_retreat', [
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.5?p*2:1-(p-0.5)*2; return euler(-0.05*e, 0, 0) }) },
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.5?p*2:1-(p-0.5)*2; return euler(0.1*e, 0, 0) }) },
    ])
  }

  // evolve_stress_self_anchor — 4s loop, arms cross loosely at waist (light self-soothe)
  {
    const dur=4, fps=15, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_stress_self_anchor', [
      { bone:'LeftShoulder',  property:'rotation', times:ts, values:ts.map(()=>euler(0,0,0.17)) },
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05, 0.15, 0.55+Math.sin(t*0.8)*0.02)) },
      { bone:'LeftForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.8+Math.sin(t*0.6)*0.02, 0, 0)) },
      { bone:'RightShoulder', property:'rotation', times:ts, values:ts.map(()=>euler(0,0,-0.17)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(-0.05, -0.15, -(0.55+Math.sin(t*0.8)*0.02))) },
      { bone:'RightForeArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.8+Math.sin(t*0.6)*0.02, 0, 0)) },
    ])
  }

  // evolve_stress_brief_look_away — 2.5s once, eyes break contact, shift down-away, conscious return
  {
    const dur=2.5, fps=30, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_stress_brief_look_away', [
      { bone:'Head', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.25?p/0.25:p<0.75?1:1-(p-0.75)/0.25; return euler(0.15*e, -0.2*e, 0) }) },
      { bone:'Neck', property:'rotation', times:ts,
        values:ts.map(t=>{ const p=t/dur; const e=p<0.25?p/0.25:p<0.75?1:1-(p-0.75)/0.25; return euler(0.06*e, -0.08*e, 0) }) },
    ])
  }

  // evolve_stress_micro_tension — 3s loop, subtle hand tension, body slightly rigid
  {
    const dur=3, fps=15, n=dur*fps+1
    const ts=Array.from({length:n},(_,i)=>i/(n-1)*dur)
    addClip(doc, boneMap, 'evolve_stress_micro_tension', [
      { bone:'LeftArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, 0.9+Math.sin(t*2.1)*0.015)) },
      { bone:'RightArm', property:'rotation', times:ts,
        values:ts.map(t=>euler(0, 0, -(0.9+Math.sin(t*2.1)*0.015))) },
      { bone:'Spine', property:'rotation', times:ts,
        values:ts.map(t=>euler(0.04+Math.sin(t*1.4)*0.01, 0, 0)) },
    ])
  }

}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎬  Evolve Avatar Engine — Animation Dictionary Compiler v3')
  console.log('   Building 110 procedural animation clips (72 existing + 38 new)...\n')

  const doc = new Document()
  doc.createBuffer()
  const boneMap = buildSkeleton(doc)
  defineClips(doc, boneMap)

  const io = new NodeIO()
  const outDir  = path.resolve(__dirname, 'dist')
  const outFile = path.join(outDir, 'animations.glb')
  const publicFile = path.resolve(__dirname, '..', 'public', 'avatar-engine', 'animations.glb')
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(path.dirname(publicFile), { recursive: true })
  await io.write(outFile, doc)
  fs.copyFileSync(outFile, publicFile)
  console.log(`📋  Copied to: ${publicFile}`)

  const stats = fs.statSync(outFile)
  const kb    = (stats.size / 1024).toFixed(1)

  const animations = doc.getRoot().listAnimations()

  // Group by emotion prefix
  const groups = {}
  for (const anim of animations) {
    const name = anim.getName()
    const parts = name.split('_')
    // emotion is 2nd segment (after source prefix)
    const src = parts[0]
    const emotion = parts[1] ?? 'other'
    const key = emotion
    if (!groups[key]) groups[key] = []
    groups[key].push({ name, channels: anim.listChannels().length })
  }

  console.log(`✅  Compiled ${animations.length} animation clips:\n`)
  for (const [emotion, clips] of Object.entries(groups).sort()) {
    console.log(`  [${emotion.toUpperCase()}]`)
    for (const c of clips) {
      console.log(`    • ${c.name.padEnd(55)} (${c.channels} ch)`)
    }
  }

  console.log(`\n📦  Output: ${outFile}`)
  console.log(`   Size: ${kb} KB`)

  if (stats.size > 512 * 1024) {
    console.warn(`\n⚠   File exceeds 500KB target (${kb}KB)`)
  } else {
    console.log(`   ✅  Under 500KB target\n`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
