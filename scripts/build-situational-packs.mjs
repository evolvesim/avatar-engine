/**
 * build-situational-packs.mjs
 *
 * Builds the two situational animation packs — one per rig — from
 * scripts/situational-mapping.json.
 *
 *   animations-pack-avaturn-default.glb   Avaturn/RPM rig, av_* clip ids
 *   animations-pack-cc5-default.glb       CC rig,          cc_* clip ids
 *
 * Each pack is assembled by copying clips out of the existing packs and RENAMING
 * them to the mapping's ids. The CC pack merges the old CC5 Default plus all four
 * CC4 packs into one, so "which pack is a clip in" stops being a question.
 *
 * Why the rename matters: the previous ids encoded attitude (mx_m_angry_point,
 * cc4_c_nod_start_speech_p2), which pushed the director toward picking by mood.
 * The new ids are descriptive of the motion, and what the director actually reads
 * is the mapping's `functions` + `when` text.
 *
 * Clips marked "Delete" in the source inventory are simply absent from the
 * mapping, so they never reach a pack.
 *
 * Conventions are preserved per rig by copying the source clip's channels
 * verbatim — no resampling, no re-retargeting. Only the clip NAME changes, so
 * anything that bound before still binds.
 *
 * ── Re-running this after the fact ──────────────────────────────────────────
 *
 * This is a ONE-SHOT build, not a repeatable step, and two things stop a bare
 * re-run from working:
 *
 *  1. Its CC sources include the four animations-pack-cc4-*.glb files, which were
 *     deleted from the playground once their clips landed in CC5 Default. They are
 *     still in the playground's git history, so restore them into a scratch dir
 *     first and point --src at it:
 *
 *       git -C ../avatar-playground show <pre-deletion-sha>:public/avatar-engine/animations-pack-cc4-male-natural.glb > /tmp/src/animations-pack-cc4-male-natural.glb
 *
 *     (341ca96 "Playground: two situational packs" is the commit that removed
 *     them, so its parent has all four.)
 *
 *  2. animations-pack-cc5-default.glb is BOTH a CC source and the CC output. With
 *     --src and --out defaulting to the same directory, a second run reads the
 *     pack it wrote on the first — clips already renamed to cc_* ids, so the
 *     mapping's source names no longer match. Always pass a --src that holds the
 *     ORIGINAL packs and an --out that differs from it.
 *
 * Usage:
 *   node build-situational-packs.mjs [--src <dir>] [--out <dir>]
 */

import fs   from 'node:fs'
import path from 'node:path'
import { Document, NodeIO, Accessor } from '@gltf-transform/core'

const argv = process.argv.slice(2)
const pick = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : dflt
}
const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const srcDir = pick('--src', PLAYGROUND)
const outDir = pick('--out', PLAYGROUND)

const mapping = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'situational-mapping.json'), 'utf8'))

/** Where each rig's clips are copied from. First file to define a clip wins. */
const SOURCES = {
  rpm: ['animations-pack-avaturn-default.glb'],
  cc:  [
    'animations-pack-cc5-default.glb',
    'animations-pack-cc4-male-natural.glb',
    'animations-pack-cc4-female-natural.glb',
    'animations-pack-cc4-male-expressive.glb',
    'animations-pack-cc4-female-expressive.glb',
  ],
}

const io = new NodeIO()

for (const [packKey, pack] of Object.entries(mapping.packs)) {
  const rig = pack.rig
  console.log(`\n── ${pack.label}  (${packKey}, rig=${rig}, ${pack.clips.length} clips)`)

  // Index every source clip and the node it targets, plus a canonical node tree.
  // The node tree comes from the FIRST source file: within a rig all the packs
  // were built to the same skeleton, which is asserted below.
  const clipIndex = new Map()      // clip name -> { anim, doc }
  let baseNodes = null, baseFile = null
  for (const file of SOURCES[rig]) {
    const full = path.join(srcDir, file)
    if (!fs.existsSync(full)) { console.log(`   – ${file} missing, skipped`); continue }
    const doc = await io.read(full)
    const names = doc.getRoot().listNodes().map((n) => n.getName()).sort()
    if (baseNodes === null) { baseNodes = names; baseFile = file }
    else if (names.length !== baseNodes.length || names.some((n, i) => n !== baseNodes[i])) {
      // Not fatal — a pack may carry extra bones — but the union must stay sane.
      const extra = names.filter((n) => !baseNodes.includes(n))
      if (extra.length) {
        console.log(`   ! ${file} adds ${extra.length} bone(s) not in ${baseFile}: ${extra.slice(0, 5).join(', ')}`)
        baseNodes = [...new Set([...baseNodes, ...extra])].sort()
      }
    }
    for (const anim of doc.getRoot().listAnimations()) {
      if (!clipIndex.has(anim.getName())) clipIndex.set(anim.getName(), { anim, doc })
    }
  }
  if (!baseNodes) { console.error(`   no source packs found for rig ${rig}`); process.exit(1) }

  // Rest pose per bone name, taken from whichever source defines it.
  const rest = new Map()
  for (const file of SOURCES[rig]) {
    const full = path.join(srcDir, file)
    if (!fs.existsSync(full)) continue
    const doc = await io.read(full)
    for (const n of doc.getRoot().listNodes()) {
      if (!rest.has(n.getName())) {
        rest.set(n.getName(), { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() })
      }
    }
  }

  const out    = new Document()
  const buffer = out.createBuffer()
  const scene  = out.createScene('Root Scene')

  // Rebuild the node tree flat, preserving each bone's rest transform. The
  // runtime retargets by NAME onto the avatar's own hierarchy, so a flat table is
  // sufficient and keeps the two rigs' packs structurally identical.
  const nodeByName = new Map()
  for (const name of baseNodes) {
    const r = rest.get(name) ?? { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
    const node = out.createNode(name).setTranslation(r.t).setRotation(r.r).setScale(r.s)
    scene.addChild(node)
    nodeByName.set(name, node)
  }

  let copied = 0, channels = 0, skippedNode = 0
  const missing = []
  for (const clip of pack.clips) {
    const found = clipIndex.get(clip.source)
    if (!found) { missing.push(clip.source); continue }
    const anim = out.createAnimation(clip.id)
    for (const ch of found.anim.listChannels()) {
      const targetName = ch.getTargetNode()?.getName()
      const node = targetName && nodeByName.get(targetName)
      if (!node) { skippedNode++; continue }
      const s = ch.getSampler()
      const input = out.createAccessor()
        .setArray(s.getInput().getArray().slice())
        .setType(Accessor.Type.SCALAR).setBuffer(buffer)
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
    copied++
  }

  if (missing.length) {
    console.error(`   ✗ ${missing.length} source clip(s) not found: ${missing.slice(0, 6).join(', ')}`)
    process.exit(1)
  }

  const file = path.join(outDir, `animations-pack-${packKey}.glb`)
  fs.mkdirSync(outDir, { recursive: true })
  await io.write(file, out)
  const mb = (fs.statSync(file).size / 1048576).toFixed(1)
  console.log(`   ✓ ${path.basename(file)} — ${copied} clips, ${nodeByName.size} nodes, ${channels} channels, ${mb} MB`)
  if (skippedNode) console.log(`     (${skippedNode} channels dropped: target bone absent from the pack skeleton)`)

  const byKind = pack.clips.reduce((a, c) => (a[c.kind] = (a[c.kind] || 0) + 1, a), {})
  console.log(`     ${byKind.idle ?? 0} idles, ${byKind.gesture ?? 0} gestures`)
}

console.log('\nDone.')
