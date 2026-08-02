/**
 * build-rpm-legacy-pack.mjs
 *
 * Recovers the legacy RPM animation set into a single clean pack.
 *
 * The 89 RPM clips (rpm_ gestures, rpm2_ idles, rpm2f_ female idles) still live
 * in public/avatar-engine/animations.glb, but nothing loads that file and two of
 * the three families do not bind to the avatar. This rebuilds them as one pack
 * on a single clean skeleton, matching the conventions of the pack this rig
 * already uses (animations-pack-avaturn-default.glb).
 *
 * ── Why they stopped working ─────────────────────────────────────────────────
 *
 * animations.glb was produced by merging many source GLBs and holds 40+ COPIES
 * of the same Mixamo skeleton — 4306 nodes, every one un-suffixed in the file.
 * three.js's GLTFLoader has to disambiguate duplicate object names, so it renames
 * the copies at load time: Hips, Hips_1, … Hips_34. Animation tracks then target
 * those renamed objects.
 *
 * Whichever family owns the FIRST skeleton copy keeps clean names (rpm_, binds
 * 52/52). Every other family ends up pointing at Hips_34 / Hips_72, and since the
 * engine retargets by BONE NAME, all of those tracks miss and the avatar freezes
 * — the documented "no bone named LeftArm_17 → arms frozen" failure in
 * skeletal-controller.ts.
 *
 * The fix is a rename, not a re-retarget: strip the trailing _NN and every track
 * resolves. Verified across all rpm2_ tracks — 2067/2067 resolve to a real bone.
 *
 * ── Output ───────────────────────────────────────────────────────────────────
 *
 *   public/avatar-engine/animations-pack-rpm-legacy.glb
 *
 * Conventions taken from animations-pack-avaturn-default.glb so it is a drop-in
 * sibling: flat node list (the runtime retargets by name onto the avatar's own
 * hierarchy, so the pack's tree is only a name table), translation on Hips only,
 * no scale channels, LINEAR interpolation.
 *
 * Usage:
 *   node build-rpm-legacy-pack.mjs [--source <animations.glb>] [--out <dir>]
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
import { Document, NodeIO, Accessor } from '@gltf-transform/core'
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

const CLIP_PREFIXES = ['rpm_', 'rpm2_', 'rpm2f_']
/** Only this bone carries a translation channel; matches the avaturn pack. */
const TRANSLATED_BONES = new Set(['Hips'])
/** A rotation track that never leaves the bone's rest pose contributes nothing. */
const REST_EPSILON = 1e-4

/** three.js appends _NN to duplicate object names; undo that to get the real bone. */
function canonicalBone(name) {
  return name.replace(/_\d+$/, '')
}

function varies(values, stride) {
  for (let i = stride; i < values.length; i++) {
    if (Math.abs(values[i] - values[i % stride]) > REST_EPSILON) return true
  }
  return false
}

// ── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const srcIdx = argv.indexOf('--source')
const outIdx = argv.indexOf('--out')
const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const source = srcIdx !== -1 ? argv[srcIdx + 1] : path.join(PLAYGROUND, 'animations.glb')
const outDir = outIdx !== -1 ? argv[outIdx + 1] : PLAYGROUND

if (!fs.existsSync(source)) {
  console.error(`source not found: ${source}\nPass --source <animations.glb>.`)
  process.exit(1)
}

// ── Load ─────────────────────────────────────────────────────────────────────

const buf = fs.readFileSync(source)
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej,
))

const clips = gltf.animations.filter(c => CLIP_PREFIXES.some(p => c.name.startsWith(p)))
console.log(`Source: ${path.basename(source)}`)
console.log(`  ${gltf.animations.length} clips total, ${clips.length} match ${CLIP_PREFIXES.join(' / ')}\n`)
if (!clips.length) { console.error('No RPM clips found.'); process.exit(1) }

// Rest pose per canonical bone.
//
// animations.glb has NO scene graph at all — the merge that produced it kept the
// nodes and animations but dropped every scene — so there is nothing to traverse
// via three.js. Rest poses come from gltf-transform instead, which reads nodes
// directly.
//
// Preferred source is the pack this rig already uses: its 52-node Mixamo rest
// pose is known-good and keeps the new pack consistent with it. Anything the RPM
// clips animate that it lacks (eyes, HeadTop_End, extra toe bones) falls back to
// animations.glb's own nodes — first occurrence of each name, which is the
// canonical copy.
const rest = new Map()
async function harvestRest(file, label) {
  if (!fs.existsSync(file)) { console.log(`  – ${label}: not found, skipped`); return 0 }
  const doc = await new NodeIO().read(file)
  let added = 0
  for (const node of doc.getRoot().listNodes()) {
    const name = canonicalBone(node.getName())
    if (!name || rest.has(name)) continue
    rest.set(name, { translation: node.getTranslation(), rotation: node.getRotation() })
    added++
  }
  console.log(`  ${label}: +${added} bone rest poses`)
  return added
}
console.log('Rest poses:')
await harvestRest(path.join(path.dirname(source), 'animations-pack-avaturn-default.glb'), 'avaturn-default (preferred)')
await harvestRest(source, 'animations.glb (fallback)')
console.log('')

// ── Extract ──────────────────────────────────────────────────────────────────

const entries = []
const stats = { rotation: 0, translation: 0, droppedScale: 0, droppedRest: 0, droppedNonHipT: 0, unknown: 0 }
const usedBones = new Set()
const bySuffix = { clean: 0, desuffixed: 0 }

for (const clip of clips) {
  const channels = []
  for (const track of clip.tracks) {
    const dot  = track.name.lastIndexOf('.')
    const raw  = track.name.slice(0, dot)
    const prop = track.name.slice(dot + 1)
    const bone = canonicalBone(raw)
    if (bone !== raw) bySuffix.desuffixed++; else bySuffix.clean++

    if (!rest.has(bone)) { stats.unknown++; continue }
    if (prop === 'scale') { stats.droppedScale++; continue }

    if (prop === 'position') {
      if (!TRANSLATED_BONES.has(bone)) { stats.droppedNonHipT++; continue }
      channels.push({ bone, path: 'translation',
        times: Float32Array.from(track.times), values: Float32Array.from(track.values) })
      stats.translation++
      usedBones.add(bone)
      continue
    }

    if (prop === 'quaternion') {
      if (!varies(track.values, 4)) {
        const held = Array.from(track.values.slice(0, 4))
        const r = rest.get(bone).rotation
        if (held.every((v, i) => Math.abs(v - r[i]) <= REST_EPSILON)) { stats.droppedRest++; continue }
      }
      channels.push({ bone, path: 'rotation',
        times: Float32Array.from(track.times), values: Float32Array.from(track.values) })
      stats.rotation++
      usedBones.add(bone)
    }
  }
  entries.push({ name: clip.name, duration: clip.duration, channels })
}

console.log(`Track targets: ${bySuffix.clean} already clean, ${bySuffix.desuffixed} de-suffixed`)
console.log(`Channels kept: ${stats.rotation} rotation, ${stats.translation} translation (Hips)`)
console.log(`Pruned: ${stats.droppedScale} scale, ${stats.droppedNonHipT} non-hip translation, ` +
            `${stats.droppedRest} rest-pose rotation` + (stats.unknown ? `, ${stats.unknown} unknown-bone` : ''))
console.log(`Distinct bones animated: ${usedBones.size}\n`)

// ── Build ────────────────────────────────────────────────────────────────────

const doc    = new Document()
const buffer = doc.createBuffer()
const scene  = doc.createScene('Root Scene')

// Flat node list, like the avaturn pack: the runtime rewrites track targets onto
// the avatar's own skeleton by name, so this tree is a name table, not a rig.
const nodeByName = new Map()
for (const bone of [...usedBones].sort()) {
  const r = rest.get(bone)
  const node = doc.createNode(bone)
    .setTranslation(r.translation)
    .setRotation(r.rotation)
    .setScale([1, 1, 1])
  scene.addChild(node)
  nodeByName.set(bone, node)
}

for (const { name, channels } of entries) {
  const anim = doc.createAnimation(name)
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
    anim.addSampler(sampler)
    anim.addChannel(doc.createAnimationChannel()
      .setSampler(sampler).setTargetNode(node).setTargetPath(ch.path))
  }
}

const outFile = path.join(outDir, 'animations-pack-rpm-legacy.glb')
fs.mkdirSync(outDir, { recursive: true })
await new NodeIO().write(outFile, doc)

const kb = (fs.statSync(outFile).size / 1024).toFixed(0)
console.log(`✓ ${path.basename(outFile)} — ${entries.length} clips, ${nodeByName.size} nodes, ${kb} KB`)
for (const p of CLIP_PREFIXES) {
  const n = entries.filter(e => e.name.startsWith(p) &&
    // rpm_ must not swallow rpm2_/rpm2f_
    !CLIP_PREFIXES.some(q => q !== p && q.length > p.length && e.name.startsWith(q))).length
  console.log(`    ${p.padEnd(8)} ${n} clips`)
}
