/**
 * build-originals-pack.mjs
 *
 * Merges the three restored source GLBs into ONE loadable pack:
 *
 *   animations-pack-cc4-originals.glb    the full-length takes, uncut
 *
 * The playground loads a single pack at a time, so the originals split across
 * common/male/female cannot be browsed as a group. This merges them, keeping
 * each clip's ORIGINAL name — the whole point of the pack is that it is the
 * source material, so renaming it to something descriptive would defeat it.
 *
 * Clips are written longest-first. The long takes are what anyone opening this
 * pack came to watch; the short idles are the tail.
 *
 * Same assembly convention as build-situational-packs.mjs: the bone table is the
 * UNION of the three skeletons, rebuilt flat with each bone's rest transform, and
 * channels are copied verbatim — no resampling, no re-retargeting. The runtime
 * retargets by name, so a flat table binds exactly as the sliced packs do.
 *
 * Usage:
 *   node build-originals-pack.mjs [--src <dir>] [--out <dir>]
 */

import fs   from 'node:fs'
import path from 'node:path'
import { Document, NodeIO, Accessor } from '@gltf-transform/core'

const argv = process.argv.slice(2)
const pick = (flag, dflt) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : dflt }

const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const srcDir = pick('--src', PLAYGROUND)
const outDir = pick('--out', PLAYGROUND)

const SOURCES = [
  'animations-source-cc4-common.glb',
  'animations-source-cc4-male.glb',
  'animations-source-cc4-female.glb',
]

const io = new NodeIO()

// ── Read every source, union the skeletons, index the clips ──────────────────

const clips = []            // { name, anim, file }
const rest  = new Map()     // bone name -> rest transform, first definition wins
const seen  = new Set()

for (const file of SOURCES) {
  const full = path.join(srcDir, file)
  if (!fs.existsSync(full)) {
    console.error(`✗ ${file} not found in ${srcDir} — restore it from avatar-playground 3d5842b first`)
    process.exit(1)
  }
  const doc = await io.read(full)
  for (const n of doc.getRoot().listNodes()) {
    if (!rest.has(n.getName())) {
      rest.set(n.getName(), { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() })
    }
  }
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName()
    if (seen.has(name)) { console.log(`   – ${name} already taken from an earlier source, skipped`); continue }
    seen.add(name)
    let dur = 0
    for (const ch of anim.listChannels()) {
      const input = ch.getSampler()?.getInput()
      const max = input?.getMax([])
      if (max?.[0] != null) dur = Math.max(dur, max[0])
    }
    clips.push({ name, anim, duration: dur, file })
  }
  console.log(`   ✓ ${file} — ${doc.getRoot().listAnimations().length} clips, ${doc.getRoot().listNodes().length} bones`)
}

clips.sort((a, b) => b.duration - a.duration)

// ── Rebuild flat ─────────────────────────────────────────────────────────────

const out    = new Document()
const buffer = out.createBuffer()
const scene  = out.createScene('Root Scene')

const nodeByName = new Map()
for (const name of [...rest.keys()].sort()) {
  const r = rest.get(name)
  const node = out.createNode(name).setTranslation(r.t).setRotation(r.r).setScale(r.s)
  scene.addChild(node)
  nodeByName.set(name, node)
}

let channels = 0, skippedNode = 0
for (const clip of clips) {
  const anim = out.createAnimation(clip.name)
  // Every channel in a take shares one time array. Copying it per channel is
  // what makes a merged pack several times the size of its sources — 70-odd
  // identical float arrays per clip — so reuse the accessor instead.
  const inputs = new Map()
  for (const ch of clip.anim.listChannels()) {
    const targetName = ch.getTargetNode()?.getName()
    const node = targetName && nodeByName.get(targetName)
    if (!node) { skippedNode++; continue }
    const s = ch.getSampler()
    const srcInput = s.getInput()
    let input = inputs.get(srcInput)
    if (!input) {
      input = out.createAccessor()
        .setArray(srcInput.getArray().slice())
        .setType(Accessor.Type.SCALAR).setBuffer(buffer)
      inputs.set(srcInput, input)
    }
    const outAcc = out.createAccessor()
      .setArray(s.getOutput().getArray().slice())
      .setType(ch.getTargetPath() === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
      .setBuffer(buffer)
    const sampler = out.createAnimationSampler()
      .setInput(input).setOutput(outAcc).setInterpolation(s.getInterpolation())
    anim.addSampler(sampler)
    anim.addChannel(out.createAnimationChannel()
      .setSampler(sampler).setTargetNode(node).setTargetPath(ch.getTargetPath()))
    channels++
  }
}

const file = path.join(outDir, 'animations-pack-cc4-originals.glb')
fs.mkdirSync(outDir, { recursive: true })
await io.write(file, out)

const mb = (fs.statSync(file).size / 1048576).toFixed(1)
console.log(`\n✓ ${path.basename(file)} — ${clips.length} clips, ${nodeByName.size} bones, ${channels} channels, ${mb} MB`)
if (skippedNode) console.log(`  (${skippedNode} channels dropped: target bone absent from the union skeleton)`)
const total = clips.reduce((a, c) => a + c.duration, 0)
console.log(`  ${(total / 60).toFixed(1)} minutes of motion; longest ${clips[0].name} at ${clips[0].duration.toFixed(2)}s`)
