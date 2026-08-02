/**
 * build-avaturn-pack.mjs
 *
 * Merges the three legacy Mixamo-rig packs into one Avaturn Default pack.
 *
 * The 45 Mixamo clips were split across packs 1/2/5 purely by gender and posture
 * (Motion Male / Motion Female / Sitting Female). The mapping pass in
 * mixamo-mapping.json reviewed every clip as suitable for either gender, so the
 * split no longer earns its keep — one pack now serves both, matching the single
 * CC5 Default pack on the CC rig side.
 *
 * Input:  animations-pack1.glb, animations-pack2.glb, animations-pack5.glb
 * Output: animations-pack-avaturn-default.glb  (the mx_* clips marked keep:true)
 *
 * These source packs are FLAT — 52 nodes with no parent/child links — so the
 * merge is a straight channel copy against a shared node table. Node names and
 * rest transforms are asserted identical across all three inputs before merging;
 * a mismatch would silently retarget clips onto the wrong rest pose.
 *
 * Head-pitch corrections are NOT applied here — run bake-head-pitch.mjs after,
 * which measures the flat pack's clips by composing them onto the RPM avatar
 * skeleton (the only way to see the pitch a viewer would).
 *
 * Usage:
 *   node build-avaturn-pack.mjs [--pack-dir <dir>] [--out <dir>]
 */

import fs   from 'node:fs'
import path from 'node:path'
import { Document, NodeIO, Accessor } from '@gltf-transform/core'

const SOURCES = ['animations-pack1.glb', 'animations-pack2.glb', 'animations-pack5.glb']
const REST_EPSILON = 1e-5

const argv = process.argv.slice(2)
const dirIdx = argv.indexOf('--pack-dir')
const outIdx = argv.indexOf('--out')
const packDir = dirIdx !== -1 ? argv[dirIdx + 1]
              : path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const outDir = outIdx !== -1 ? argv[outIdx + 1] : packDir

const mapping = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, 'mixamo-mapping.json'), 'utf8'),
)
const KEEP = new Map(mapping.clips.filter(c => c.keep).map(c => [c.mx, c]))
const DROP = new Set(mapping.clips.filter(c => !c.keep).map(c => c.mx))

console.log(`Pack dir: ${packDir}`)
console.log(`Mapping keeps ${KEEP.size}, drops ${DROP.size}\n`)

const io = new NodeIO()

// ── Read sources, assert one shared skeleton ─────────────────────────────────

let template = null      // [{name, translation, rotation, scale}] from the first pack
const collected = []     // {id, channels:[{bone,path,times,values,interp}]}
const skippedIds = []

for (const src of SOURCES) {
  const file = path.join(packDir, src)
  if (!fs.existsSync(file)) throw new Error(`missing source pack: ${file}`)
  const doc = await io.read(file)
  const nodes = doc.getRoot().listNodes()

  const shape = nodes.map(n => ({
    name: n.getName(),
    translation: n.getTranslation(),
    rotation: n.getRotation(),
    scale: n.getScale(),
  }))

  if (template === null) {
    template = shape
  } else {
    if (shape.length !== template.length) {
      throw new Error(`${src}: ${shape.length} nodes, first pack had ${template.length}`)
    }
    for (let i = 0; i < shape.length; i++) {
      if (shape[i].name !== template[i].name) {
        throw new Error(`${src}: node ${i} is "${shape[i].name}", first pack had "${template[i].name}"`)
      }
      for (const key of ['translation', 'rotation', 'scale']) {
        const a = shape[i][key], b = template[i][key]
        for (let k = 0; k < a.length; k++) {
          if (Math.abs(a[k] - b[k]) > REST_EPSILON) {
            throw new Error(
              `${src}: rest ${key} of "${shape[i].name}" differs from the first pack ` +
              `(${a.join(',')} vs ${b.join(',')}) — merging would retarget onto the wrong rest pose`)
          }
        }
      }
    }
  }

  let took = 0
  for (const anim of doc.getRoot().listAnimations()) {
    const id = anim.getName()
    if (!KEEP.has(id)) {
      if (!DROP.has(id)) throw new Error(`${src}: clip "${id}" is in neither the keep nor drop list`)
      skippedIds.push(id)
      continue
    }
    const channels = []
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode()
      if (!node) continue
      const s = ch.getSampler()
      channels.push({
        bone:   node.getName(),
        path:   ch.getTargetPath(),
        times:  Float32Array.from(s.getInput().getArray()),
        values: Float32Array.from(s.getOutput().getArray()),
        interp: s.getInterpolation(),
      })
    }
    collected.push({ id, channels, meta: KEEP.get(id) })
    took++
  }
  console.log(`  ${src.padEnd(24)} ${took} kept, ${doc.getRoot().listAnimations().length - took} dropped`)
}

const missing = [...KEEP.keys()].filter(id => !collected.some(c => c.id === id))
if (missing.length) throw new Error(`mapping expects clips not present in any source pack: ${missing.join(', ')}`)
if (collected.length !== KEEP.size) {
  throw new Error(`collected ${collected.length} clips but the mapping keeps ${KEEP.size}`)
}
const dupes = collected.map(c => c.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupes.length) throw new Error(`clip appears in more than one source pack: ${dupes.join(', ')}`)

// ── Write the merged pack ────────────────────────────────────────────────────

const doc = new Document()
const buffer = doc.createBuffer()
const scene = doc.createScene('Root Scene')
const nodeByName = new Map()
for (const n of template) {
  const node = doc.createNode(n.name)
    .setTranslation(n.translation).setRotation(n.rotation).setScale(n.scale)
  // Sources are flat, so every node hangs off the scene directly.
  scene.addChild(node)
  nodeByName.set(n.name, node)
}

for (const { id, channels } of collected) {
  const anim = doc.createAnimation(id)
  for (const ch of channels) {
    const node = nodeByName.get(ch.bone)
    if (!node) throw new Error(`clip "${id}" targets unknown bone "${ch.bone}"`)
    const input = doc.createAccessor().setArray(ch.times).setType(Accessor.Type.SCALAR).setBuffer(buffer)
    const output = doc.createAccessor().setArray(ch.values)
      .setType(ch.path === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
      .setBuffer(buffer)
    const sampler = doc.createAnimationSampler()
      .setInput(input).setOutput(output).setInterpolation(ch.interp)
    anim.addSampler(sampler)
    anim.addChannel(doc.createAnimationChannel()
      .setSampler(sampler).setTargetNode(node).setTargetPath(ch.path))
  }
}

fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, mapping.packs.avaturn)
await io.write(out, doc)

console.log(`\nDropped ${skippedIds.length} clip(s) per the mapping`)
console.log(`Skeleton: ${template.length} nodes (flat, as the sources are)`)
console.log(`\n✓ ${path.basename(out)} — ${collected.length} clips, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)

const byEmotion = {}
for (const c of collected) {
  byEmotion[c.meta.emotion] ??= { Idle: 0, Gesture: 0 }
  byEmotion[c.meta.emotion][c.meta.type]++
}
console.log('\nper-emotion coverage:')
for (const [e, c] of Object.entries(byEmotion)) {
  console.log(`  ${e.padEnd(12)} idles=${c.Idle}  gestures=${c.Gesture}` + (c.Idle ? '' : '   ← NO IDLE'))
}
const noIdle = Object.entries(byEmotion).filter(([, c]) => !c.Idle).map(([e]) => e)
if (noIdle.length) throw new Error(`emotion(s) with no idle to rest on: ${noIdle.join(', ')}`)

console.log('\nDone.')
