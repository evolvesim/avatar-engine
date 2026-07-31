/**
 * build-cc5-packs.mjs
 *
 * Builds the two CC5 animation packs from the iClone-exported FBX motions.
 *
 * Source: the 45 Mixamo clips retargeted to the CC5 standard rig in iClone and
 * exported one-motion-per-FBX (plus a throwaway `0_T-Pose` stack in each file).
 * These are the same 45 clips already shipped as packs 1/2/5 on the Mixamo rig
 * (`mx_m_` / `mx_f_`); this script produces the CC-rig equivalents (`cc5_m_` /
 * `cc5_f_`) so they can drive the CC4/CC5 portal avatars.
 *
 * Output: a SINGLE pack, public/avatar-engine/animations-pack-cc5-default.glb.
 * Which clips go in, and under which emotion, comes from mixamo-mapping.json —
 * the hand-done mapping pass. Clips marked keep:false are left out entirely.
 * One pack serves both genders: every kept clip was reviewed as suitable for
 * either, so there is no male/female split.
 *
 * Conventions are taken from the existing CC4 portal packs so these are
 * drop-in equivalents:
 *   - node chain `RootNode` → `root` → `CC_Base_Hip` → … (FBX `RL_BoneRoot`
 *     is renamed to `root`; the FBX's unnamed group root becomes `RootNode`)
 *   - metres, Z-up  (FBX exports centimetres → all translations ÷ 100)
 *   - translation channel on `CC_Base_Hip` only; every other bone is rotation-only
 *   - no scale channels
 *   - LINEAR interpolation
 *
 * Head-pitch corrections are NOT applied here — run bake-head-pitch.mjs after,
 * which reads the same mapping file and has its own motion-preservation guards.
 *
 * Usage:
 *   node build-cc5-packs.mjs <fbx-dir> [--out <dir>]
 */

// three's FBXLoader is browser-oriented; these shims are enough for the
// geometry/animation path (no textures are read — motion-only FBX).
globalThis.self = globalThis
globalThis.window = globalThis
globalThis.document ??= {
  createElementNS: () => ({ style: {}, setAttribute() {}, getContext: () => ({ fillRect() {}, drawImage() {} }) }),
  createElement:   () => ({ style: {}, setAttribute() {}, getContext: () => ({ fillRect() {}, drawImage() {} }) }),
}

import fs   from 'node:fs'
import path from 'node:path'
import { Document, NodeIO, Accessor } from '@gltf-transform/core'
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')

// ── Conventions ──────────────────────────────────────────────────────────────

/** FBX exports centimetres; the engine's packs are in metres. */
const CM_TO_M = 0.01
/** FBX skeleton root bone → the node name the portal packs use. */
const FBX_ROOT_BONE = 'RL_BoneRoot'
const PACK_ROOT_BONE = 'root'
/** Placeholder animation stack iClone writes into every motion FBX. */
const TPOSE_CLIP = '0_T-Pose'
/** Bones allowed a translation channel. Everything else is rotation-only. */
const TRANSLATED_BONES = new Set(['CC_Base_Hip'])
/** A rotation track that never leaves the bone's rest pose is dropped. */
const REST_EPSILON = 1e-4

// ── Clip naming ──────────────────────────────────────────────────────────────

/**
 * `M_Ch02_nonPBR_Standard_Idle` → `cc5_m_standard_idle`
 *
 * Mirrors the `mx_m_` / `mx_f_` names packs 1/2/5 already use for these exact
 * clips, so the CC5 packs stay diffable against the Mixamo-rig originals.
 */
function clipIdFor(fbxClipName) {
  const m = /^([FM])_Ch02_nonPBR_(.+)$/.exec(fbxClipName)
  if (!m) throw new Error(`Unrecognised clip name: "${fbxClipName}"`)
  const [, gender, rest] = m
  const slug = rest
    .replace(/__(\d)_$/, '_$1')   // `Agreeing__2_` → `Agreeing_2`
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return { id: `cc5_${gender.toLowerCase()}_${slug}`, gender: gender.toLowerCase() }
}

// ── FBX loading ──────────────────────────────────────────────────────────────

function loadMotionFbx(file) {
  const buf = fs.readFileSync(file)
  const group = new FBXLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '',
  )

  const clips = group.animations.filter(c => c.name !== TPOSE_CLIP && c.duration > 0)
  if (clips.length !== 1) {
    throw new Error(
      `${path.basename(file)}: expected exactly 1 motion clip besides "${TPOSE_CLIP}", ` +
      `found ${clips.length} (${group.animations.map(c => c.name).join(', ')})`,
    )
  }

  // Bone hierarchy, in traversal order, with FBX_ROOT_BONE renamed.
  const bones = []
  ;(function walk(obj, parentName) {
    for (const child of obj.children) {
      if (child.isBone) {
        const name = child.name === FBX_ROOT_BONE ? PACK_ROOT_BONE : child.name
        bones.push({
          name,
          parent:      parentName,
          translation: child.position.toArray().map(v => v * CM_TO_M),
          rotation:    child.quaternion.toArray(),
        })
        walk(child, name)
      } else {
        walk(child, parentName)   // skip non-bone groups (e.g. CC_Game_Tongue)
      }
    }
  })(group, null)

  return { clip: clips[0], bones }
}

// ── Track extraction ─────────────────────────────────────────────────────────

/** Does a sampled track ever deviate from its first keyframe? */
function varies(values, stride) {
  for (let i = stride; i < values.length; i++) {
    if (Math.abs(values[i] - values[i % stride]) > REST_EPSILON) return true
  }
  return false
}

/**
 * Reduce a three.js AnimationClip to the channel set the portal packs use:
 * rotation on every bone that actually moves, translation on the hip only,
 * scale never.
 */
function extractChannels(clip, boneByName) {
  const channels = []
  let droppedRest = 0, droppedScale = 0, droppedTranslation = 0, unknownBone = 0

  for (const track of clip.tracks) {
    const dot  = track.name.lastIndexOf('.')
    const raw  = track.name.slice(0, dot)
    const prop = track.name.slice(dot + 1)
    const name = raw === FBX_ROOT_BONE ? PACK_ROOT_BONE : raw

    const bone = boneByName.get(name)
    if (!bone) { unknownBone++; continue }

    if (prop === 'scale') { droppedScale++; continue }

    if (prop === 'position') {
      if (!TRANSLATED_BONES.has(name)) { droppedTranslation++; continue }
      channels.push({
        bone: name, path: 'translation',
        times:  Float32Array.from(track.times),
        values: Float32Array.from(track.values, v => v * CM_TO_M),
      })
      continue
    }

    if (prop === 'quaternion') {
      // A bone pinned to its rest rotation for the whole clip contributes
      // nothing — the node's own rotation already supplies it.
      if (!varies(track.values, 4)) {
        const rest = bone.rotation
        const held = Array.from(track.values.slice(0, 4))
        if (held.every((v, i) => Math.abs(v - rest[i]) <= REST_EPSILON)) {
          droppedRest++
          continue
        }
      }
      channels.push({
        bone: name, path: 'rotation',
        times:  Float32Array.from(track.times),
        values: Float32Array.from(track.values),
      })
    }
  }

  return { channels, stats: { droppedRest, droppedScale, droppedTranslation, unknownBone } }
}

// ── GLB assembly ─────────────────────────────────────────────────────────────

function buildPack(entries, bones, outFile) {
  const doc   = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('Root Scene')

  // `RootNode` mirrors the existing CC4 packs' outermost node.
  const rootNode = doc.createNode('RootNode')
  scene.addChild(rootNode)

  const nodeByName = new Map()
  for (const bone of bones) {
    const node = doc.createNode(bone.name)
      .setTranslation(bone.translation)
      .setRotation(bone.rotation)
      .setScale([1, 1, 1])
    nodeByName.set(bone.name, node)
    if (bone.parent === null) rootNode.addChild(node)
    else nodeByName.get(bone.parent).addChild(node)
  }

  for (const { id, channels } of entries) {
    const anim = doc.createAnimation(id)
    for (const ch of channels) {
      const node = nodeByName.get(ch.bone)
      if (!node) continue
      const input = doc.createAccessor()
        .setArray(ch.times).setType(Accessor.Type.SCALAR).setBuffer(buffer)
      const output = doc.createAccessor()
        .setArray(ch.values)
        .setType(ch.path === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
        .setBuffer(buffer)
      const sampler = doc.createAnimationSampler()
        .setInput(input).setOutput(output).setInterpolation('LINEAR')
      const channel = doc.createAnimationChannel()
        .setSampler(sampler).setTargetNode(node).setTargetPath(ch.path)
      anim.addSampler(sampler)
      anim.addChannel(channel)
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  return new NodeIO().write(outFile, doc).then(() => outFile)
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2)
const fbxDir = args[0]
const outIdx = args.indexOf('--out')
const outDir = outIdx !== -1 ? args[outIdx + 1]
             : path.resolve(import.meta.dirname, '../public/avatar-engine')

if (!fbxDir) {
  console.error('usage: node build-cc5-packs.mjs <fbx-dir> [--out <dir>]')
  process.exit(1)
}

const mapping = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, 'mixamo-mapping.json'), 'utf8'),
)
const KEEP = new Map(mapping.clips.filter(c => c.keep).map(c => [c.cc5, c]))
const DROP = new Set(mapping.clips.filter(c => !c.keep).map(c => c.cc5))

const files = fs.readdirSync(fbxDir)
  .filter(f => /_Motion\.fbx$/i.test(f))
  .sort()

console.log(`Reading ${files.length} motion FBX from ${fbxDir}`)
console.log(`Mapping keeps ${KEEP.size}, drops ${DROP.size}\n`)

const kept = []
const skipped = []
let bones = null
const totals = { droppedRest: 0, droppedScale: 0, droppedTranslation: 0, unknownBone: 0 }

for (const file of files) {
  const { clip, bones: fileBones } = loadMotionFbx(path.join(fbxDir, file))

  // Every export must share one skeleton, or the packs can't share a node tree.
  if (bones === null) {
    bones = fileBones
  } else if (fileBones.length !== bones.length ||
             fileBones.some((b, i) => b.name !== bones[i].name)) {
    throw new Error(`${file}: skeleton differs from the first FBX — cannot share a node tree`)
  }

  const boneByName = new Map(bones.map(b => [b.name, b]))
  const { id } = clipIdFor(clip.name)

  if (!KEEP.has(id)) {
    if (!DROP.has(id)) {
      throw new Error(`${file}: clip "${id}" is in neither the keep nor the drop list of mixamo-mapping.json`)
    }
    skipped.push(id)
    continue
  }

  const { channels, stats } = extractChannels(clip, boneByName)
  for (const k of Object.keys(totals)) totals[k] += stats[k]

  kept.push({ id, channels, duration: clip.duration, source: clip.name, emotion: KEEP.get(id).emotion, type: KEEP.get(id).type })
  console.log(
    `  ${id.padEnd(46)} ${clip.duration.toFixed(2).padStart(6)}s  ` +
    `${String(channels.length).padStart(3)} channels  ${KEEP.get(id).type.padEnd(7)} ${KEEP.get(id).emotion}`,
  )
}

if (kept.length !== KEEP.size) {
  const missing = [...KEEP.keys()].filter(id => !kept.some(k => k.id === id))
  throw new Error(`mapping expects ${KEEP.size} clips but only ${kept.length} were found; missing: ${missing.join(', ')}`)
}

console.log(`\nDropped ${skipped.length} clip(s) per the mapping: ${skipped.join(', ')}`)
console.log(`Skeleton: ${bones.length} nodes (+ RootNode)`)
console.log(
  `Pruned per-clip: ${totals.droppedScale} scale, ${totals.droppedTranslation} non-hip translation, ` +
  `${totals.droppedRest} rest-pose rotation` +
  (totals.unknownBone ? `, ${totals.unknownBone} unknown-bone` : ''),
)

const out = path.join(outDir, mapping.packs.cc5)
await buildPack(kept, bones, out)
const kb = (fs.statSync(out).size / 1024).toFixed(0)
console.log(`\n✓ ${path.basename(out)} — ${kept.length} clips, ${kb} KB`)

const byEmotion = {}
for (const k of kept) {
  byEmotion[k.emotion] ??= { Idle: 0, Gesture: 0 }
  byEmotion[k.emotion][k.type]++
}
console.log('\nper-emotion coverage:')
for (const [e, c] of Object.entries(byEmotion)) {
  console.log(`  ${e.padEnd(12)} idles=${c.Idle}  gestures=${c.Gesture}` + (c.Idle ? '' : '   ← NO IDLE'))
}
const noIdle = Object.entries(byEmotion).filter(([, c]) => !c.Idle).map(([e]) => e)
if (noIdle.length) throw new Error(`emotion(s) with no idle to rest on: ${noIdle.join(', ')}`)

console.log('\nDone.')
