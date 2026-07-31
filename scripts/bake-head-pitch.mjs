/**
 * bake-head-pitch.mjs
 *
 * Re-levels the head pitch of specific animation clips in-place.
 *
 * Some clips are authored with a sustained chin-up. On an idle that's on screen
 * continuously it reads as looking down your nose at the viewer, and it fights
 * the engine's camera-locking gaze (the eyes rotate down to hold eye contact,
 * exposing sclera). Because the offset is a static pose error rather than a
 * motion problem, it can be corrected by rotating the neck chain without
 * touching timing, yaw, or motion amplitude.
 *
 * NOT a general fix for creepy eyes. Clips whose heads swing fast and wide are a
 * different failure mode — the eye lock holding fixation through a large arc —
 * and belong in the gaze system, not here. Use this only for clips with a
 * sustained pitch offset and little head travel.
 *
 * The correction is expressed as an ABSOLUTE target mean pitch, so the script is
 * idempotent: it measures the current value, solves for the delta, and applies
 * it. Re-running on already-corrected output is a no-op.
 *
 * Usage:
 *   node bake-head-pitch.mjs [--pack-dir <dir>] [--dry-run]
 *
 * Default pack dir is the playground's public/avatar-engine (where the product
 * serves packs from).
 */

globalThis.self = globalThis
globalThis.window = globalThis
globalThis.document ??= {
  createElementNS: () => ({ style: {}, setAttribute() {}, getContext: () => ({ fillRect() {}, drawImage() {} }) }),
  createElement:   () => ({ style: {}, setAttribute() {}, getContext: () => ({ fillRect() {}, drawImage() {} }) }),
}

import fs   from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { NodeIO, Accessor } from '@gltf-transform/core'
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

// ── What to correct ──────────────────────────────────────────────────────────

/** targetMeanPitchDeg: desired mean gaze elevation. Negative = slightly chin-down. */
const CORRECTIONS = [
  {
    pack: 'animations-pack-cc4-male-natural.glb',
    clip: 'cc4_m_basic_move_idle',
    // Authored at a constant +4.4° chin-up with only 4° of total head travel —
    // a pose offset, not a performance. It's in the engine's CC4_IDLES_NEUTRAL
    // pool, so it's a default idle with heavy screen time. -2° matches the
    // slight chin-down of this pack's conversational clips (-4° to -17°).
    targetMeanPitchDeg: -2.0,
  },
  // The rest come from mixamo-mapping.json, where the target pitches were set by
  // hand during the mapping pass. Appended below so both rigs get the same
  // correction from one source.
  ...mixamoCorrections(),
]

/**
 * Expand each mapping entry carrying a targetPitch into a correction for BOTH
 * rigs — the CC clip in the CC5 pack and its Mixamo-rig twin in the Avaturn pack.
 * RIGS below supplies the right bone names and measurement skeleton per rig.
 */
function mixamoCorrections() {
  const mapping = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, 'mixamo-mapping.json'), 'utf8'),
  )
  const out = []
  for (const c of mapping.clips) {
    if (!c.keep || c.targetPitch == null) continue
    out.push({ pack: mapping.packs.cc5,     clip: c.cc5, targetMeanPitchDeg: c.targetPitch, rig: 'cc' })
    out.push({ pack: mapping.packs.avaturn, clip: c.mx,  targetMeanPitchDeg: c.targetPitch, rig: 'mixamo' })
  }
  return out
}

/**
 * Per-rig knowledge. Two things differ between the CC and Mixamo/Avaturn packs:
 *
 *  - WHERE the correction goes. The CC packs are hierarchical, so the bend can be
 *    spread down the neck (dumping it all on the head bone reads as a detached
 *    skull). The Mixamo packs are FLAT — 52 nodes, zero parent/child links — so
 *    rotating Spine2 or Neck there has no effect on the head at all. Only the
 *    Head channel composes predictably onto the avatar, so it takes the whole
 *    correction. The mixamo deltas are small (<5deg), well inside what reads as
 *    posture on a single bone.
 *
 *  - WHERE pitch is measured. A hierarchical pack can be measured in place. In a
 *    flat pack the head's stored rotation is NOT what the viewer sees (Head local
 *    reads ~20deg on a clip whose on-avatar pitch is ~0deg), because the spine and
 *    neck tracks only accumulate once retargeted. So mixamo clips are measured by
 *    binding them onto a real hierarchical skeleton — the same composition the
 *    runtime performs. All 52 clip bones bind to the RPM avatar by name.
 *
 * Chain weights must sum to 1 within each rig.
 */
const RIGS = {
  cc: {
    headBone: 'CC_Base_Head',
    chain: [
      ['CC_Base_NeckTwist01', 0.4],
      ['CC_Base_NeckTwist02', 0.3],
      ['CC_Base_Head',        0.3],
    ],
    measureOn: null,
  },
  mixamo: {
    headBone: 'Head',
    chain: [['Head', 1.0]],
    measureOn: '../../avatar-playground/public/avatars/rpm-avatar-tpose.glb',
  },
}
/** Default rig when a correction does not name one (the original CC4 entry). */
const DEFAULT_RIG = 'cc'

/** Head-local gaze axis (+Z forward, +Y up through the skull) — verified against
 *  eye-socket geometry on alex-cc4.glb. A positive local-X rotation lowers gaze. */
const GAZE_LOCAL = new THREE.Vector3(0, 0, 1)
const WORLD_UP   = new THREE.Vector3(0, 1, 0)
const SAMPLES    = 90
const TOLERANCE_DEG = 0.05
const MAX_PASSES = 6

// ── Measurement ──────────────────────────────────────────────────────────────

function loadScene(file) {
  const b = fs.readFileSync(file)
  return new Promise((res, rej) => new GLTFLoader().parse(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej,
  ))
}

/**
 * Mean/min/max gaze elevation, azimuth drift and total angular travel.
 *
 * `skeleton` is the scene the clip is evaluated against. For a flat pack that
 * must be a hierarchical stand-in (RIGS[rig].measureOn), or the numbers describe
 * stored rotations rather than anything the viewer would see.
 */
function measure(gltf, clipName, rig = DEFAULT_RIG, skeleton = null) {
  const scene = skeleton ?? gltf.scene
  const head  = scene.getObjectByName(RIGS[rig].headBone)
  const clip  = gltf.animations.find(c => c.name === clipName)
  if (!head) throw new Error(`${RIGS[rig].headBone} not found in the measurement skeleton`)
  if (!clip) throw new Error(`clip "${clipName}" not found`)

  const mixer = new THREE.AnimationMixer(scene)
  mixer.clipAction(clip).play()

  let sum = 0, min = Infinity, max = -Infinity, travel = 0
  let prevDir = null
  const azimuths = []
  for (let i = 0; i <= SAMPLES; i++) {
    mixer.setTime(clip.duration * i / SAMPLES)
    scene.updateMatrixWorld(true)
    const q = new THREE.Quaternion().setFromRotationMatrix(head.matrixWorld)
    const d = GAZE_LOCAL.clone().applyQuaternion(q).normalize()
    const pitch = Math.asin(THREE.MathUtils.clamp(d.dot(WORLD_UP), -1, 1)) * 180 / Math.PI
    sum += pitch; min = Math.min(min, pitch); max = Math.max(max, pitch)
    azimuths.push(Math.atan2(d.x, d.z) * 180 / Math.PI)
    if (prevDir) travel += Math.acos(THREE.MathUtils.clamp(prevDir.dot(d), -1, 1)) * 180 / Math.PI
    prevDir = d
  }
  mixer.stopAllAction()
  mixer.uncacheClip(clip)

  return { mean: sum / (SAMPLES + 1), min, max, travel, azimuths, duration: clip.duration }
}

// ── Edit ─────────────────────────────────────────────────────────────────────

/**
 * Rotate the neck chain's rotation tracks by `totalDeg` about each bone's local
 * X axis, weighted by RIGS[rig].chain. Positive lowers the gaze.
 *
 * Reads from `srcFile` every call so repeated passes never compound.
 */
async function applyCorrection(srcFile, outFile, clipName, totalDeg, rig = DEFAULT_RIG) {
  const io  = new NodeIO()
  const doc = await io.read(srcFile)
  const anim = doc.getRoot().listAnimations().find(a => a.getName() === clipName)
  if (!anim) throw new Error(`clip "${clipName}" not in ${path.basename(srcFile)}`)

  const buffer = doc.getRoot().listBuffers()[0]
  const touched = []

  for (const [boneName, weight] of RIGS[rig].chain) {
    const theta = totalDeg * weight * Math.PI / 180
    const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), theta)

    const channel = anim.listChannels().find(c =>
      c.getTargetPath() === 'rotation' && c.getTargetNode()?.getName() === boneName)
    if (!channel) {
      console.warn(`   ⚠  no rotation channel for ${boneName} in "${clipName}" — skipped`)
      continue
    }

    const src = channel.getSampler().getOutput().getArray()
    const out = new Float32Array(src.length)
    const q = new THREE.Quaternion()
    for (let i = 0; i < src.length; i += 4) {
      q.set(src[i], src[i + 1], src[i + 2], src[i + 3]).multiply(delta).normalize()
      out[i] = q.x; out[i + 1] = q.y; out[i + 2] = q.z; out[i + 3] = q.w
    }

    // Fresh accessor rather than mutating in place — never risk aliasing another
    // channel that happens to share the buffer view.
    channel.getSampler().setOutput(
      doc.createAccessor().setArray(out).setType(Accessor.Type.VEC4).setBuffer(buffer),
    )
    touched.push(`${boneName} ${(totalDeg * weight).toFixed(2)}° (${src.length / 4} keys)`)
  }

  await io.write(outFile, doc)
  return touched
}

// ── Main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const dirIdx = argv.indexOf('--pack-dir')
const packDir = dirIdx !== -1 ? argv[dirIdx + 1]
              : path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const dryRun = argv.includes('--dry-run')

if (!fs.existsSync(packDir)) {
  console.error(`pack dir not found: ${packDir}\nPass --pack-dir <dir>.`)
  process.exit(1)
}
console.log(`Pack dir: ${packDir}${dryRun ? '  (dry run)' : ''}\n`)

for (const { pack, clip, targetMeanPitchDeg, rig = DEFAULT_RIG } of CORRECTIONS) {
  const file = path.join(packDir, pack)
  // Must keep the .glb extension — gltf-transform picks GLB vs glTF+.bin from it.
  const tmp  = file.replace(/\.glb$/, '.bake-tmp.glb')
  console.log(`── ${clip}  in ${pack}   [${rig} rig` +
              (RIGS[rig].measureOn ? ', measured on the RPM avatar skeleton]' : ']'))

  const skelPath = RIGS[rig].measureOn
    ? path.resolve(import.meta.dirname, RIGS[rig].measureOn)
    : null
  if (skelPath && !fs.existsSync(skelPath)) {
    throw new Error(`measurement skeleton not found for the ${rig} rig: ${skelPath}`)
  }
  const loadSkel = async () => (skelPath ? (await loadScene(skelPath)).scene : null)

  const before = measure(await loadScene(file), clip, rig, await loadSkel())
  console.log(`   before: mean ${before.mean.toFixed(2)}°  range ${before.min.toFixed(1)}°..${before.max.toFixed(1)}°  travel ${before.travel.toFixed(1)}°`)
  console.log(`   target: mean ${targetMeanPitchDeg.toFixed(2)}°`)

  let total = before.mean - targetMeanPitchDeg
  let after = null, touched = null

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    touched = await applyCorrection(file, tmp, clip, total, rig)
    after = measure(await loadScene(tmp), clip, rig, await loadSkel())
    const err = after.mean - targetMeanPitchDeg
    console.log(`   pass ${pass}: applied ${total.toFixed(3)}° → mean ${after.mean.toFixed(3)}°  (error ${err >= 0 ? '+' : ''}${err.toFixed(3)}°)`)
    if (Math.abs(err) <= TOLERANCE_DEG) break
    total += err
    if (pass === MAX_PASSES) {
      fs.rmSync(tmp, { force: true })
      throw new Error(`did not converge within ${TOLERANCE_DEG}° after ${MAX_PASSES} passes`)
    }
  }

  // Motion amplitude and left/right must be untouched.
  const travelDrift = Math.abs(after.travel - before.travel)
  const azDrift = Math.max(...after.azimuths.map((a, i) => Math.abs(a - before.azimuths[i])))
  console.log(`   applied: ${touched.join(', ')}`)
  console.log(`   after : mean ${after.mean.toFixed(2)}°  range ${after.min.toFixed(1)}°..${after.max.toFixed(1)}°  travel ${after.travel.toFixed(1)}°`)
  console.log(`   checks: gaze travel drift ${travelDrift.toFixed(2)}°  |  max azimuth (left/right) drift ${azDrift.toFixed(3)}°`)

  if (travelDrift > 1.0) throw new Error(`motion amplitude changed by ${travelDrift.toFixed(2)}° — aborting`)
  if (azDrift > 1.0)     throw new Error(`left/right motion changed by ${azDrift.toFixed(3)}° — aborting`)

  if (dryRun) {
    fs.rmSync(tmp, { force: true })
    console.log('   dry run — no file written\n')
  } else {
    fs.renameSync(tmp, file)
    console.log(`   ✓ written to ${pack}\n`)
  }
}

console.log('Done.')
