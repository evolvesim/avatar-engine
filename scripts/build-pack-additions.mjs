/**
 * build-pack-additions.mjs
 *
 * Adds clips to an existing pack, taken from the restored originals.
 *
 * This APPENDS rather than rebuilding. build-situational-packs.mjs assembles CC5
 * Default from the four animations-pack-cc4-*.glb files, which were deleted once
 * their clips landed in that pack — so a full rebuild means restoring four files
 * from history and regenerating all 98 existing clips to add one. Appending
 * leaves every shipped clip untouched, which is the whole point when the change
 * is additive.
 *
 * Driven by situational-mapping.json. A clip is built here when it carries:
 *
 *   "add": "originals"          take it from animations-pack-cc4-originals.glb
 *   "cut": { from, to }         optional — a time range, in seconds, of that take
 *
 * ── Height normalisation ────────────────────────────────────────────────────
 *
 * The CC rig is Z-up, so CC_Base_Hip's Z translation IS the character's standing
 * height. The source takes were authored at two distinct stances about 9cm apart
 * — cc4_c_idle_251105 stands at 0.993, cc4_c_idle_378963 at 0.901 — while the
 * shipped pack sits in a 0.923-0.979 band, because the portal's remap normalised
 * them on the way in. Dropping a raw take in next to the shipped clips makes the
 * character visibly sink or rise when the director switches idles.
 *
 * So each added clip is shifted by a CONSTANT so its mean hip height matches the
 * shipped pack's median. Constant, not scaled: the clip's own vertical motion —
 * the weight shifts and the breathing — is the performance, and only the stance
 * it is performed at is being corrected.
 *
 * Usage:
 *   node build-pack-additions.mjs [--src <dir>] [--out <dir>] [--dry]
 */

import fs   from 'node:fs'
import path from 'node:path'
import { NodeIO, Accessor } from '@gltf-transform/core'

const argv = process.argv.slice(2)
const pick = (flag, dflt) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : dflt }
const DRY  = argv.includes('--dry')

const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const srcDir = pick('--src', PLAYGROUND)
const outDir = pick('--out', PLAYGROUND)

const mapping = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'situational-mapping.json'), 'utf8'))

const HIP = 'CC_Base_Hip'
const io = new NodeIO()

/** Mean hip height (Z) over a clip's hip translation channel, or null. */
function meanHipZ(anim) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'translation') continue
    if (ch.getTargetNode()?.getName() !== HIP) continue
    const arr = ch.getSampler().getOutput().getArray()
    let sum = 0, n = 0
    for (let i = 2; i < arr.length; i += 3) { sum += arr[i]; n++ }
    return n ? sum / n : null
  }
  return null
}

for (const [packKey, pack] of Object.entries(mapping.packs)) {
  const additions = pack.clips.filter((c) => c.add === 'originals')
  if (!additions.length) continue

  const packFile = path.join(srcDir, `animations-pack-${packKey}.glb`)
  const srcFile  = path.join(srcDir, 'animations-pack-cc4-originals.glb')
  for (const f of [packFile, srcFile]) {
    if (!fs.existsSync(f)) { console.error(`✗ missing ${f}`); process.exit(1) }
  }

  const doc = await io.read(packFile)
  const src = await io.read(srcFile)
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()

  console.log(`\n── ${pack.label} (${packKey})`)
  console.log(`   pack has ${doc.getRoot().listAnimations().length} clips, adding ${additions.length}`)

  // The height every added clip is brought to: the median of what already ships.
  const existingZ = doc.getRoot().listAnimations().map(meanHipZ).filter((z) => z != null).sort((a, b) => a - b)
  if (!existingZ.length) { console.error('   ✗ no hip channel in the existing pack — cannot derive a target height'); process.exit(1) }
  const targetZ = existingZ[Math.floor(existingZ.length / 2)]
  console.log(`   target hip height ${targetZ.toFixed(3)} (median of ${existingZ.length} shipped clips, ${existingZ[0].toFixed(3)}..${existingZ[existingZ.length-1].toFixed(3)})`)

  const nodeByName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
  const existingNames = new Set(doc.getRoot().listAnimations().map((a) => a.getName()))

  for (const clip of additions) {
    if (existingNames.has(clip.id)) { console.log(`   – ${clip.id} already in the pack, skipped`); continue }

    const srcAnim = src.getRoot().listAnimations().find((a) => a.getName() === clip.source)
    if (!srcAnim) { console.error(`   ✗ source take not found: ${clip.source}`); process.exit(1) }

    const from = clip.cut?.from ?? 0
    const to   = clip.cut?.to   ?? Infinity

    // What to shift this clip's height by, measured on the RANGE being taken —
    // a take can drift, so the piece's own mean is the honest reference.
    let sum = 0, count = 0
    for (const ch of srcAnim.listChannels()) {
      if (ch.getTargetPath() !== 'translation') continue
      if (ch.getTargetNode()?.getName() !== HIP) continue
      const t = ch.getSampler().getInput().getArray()
      const v = ch.getSampler().getOutput().getArray()
      for (let i = 0; i < t.length; i++) {
        if (t[i] < from || t[i] > to) continue
        sum += v[i * 3 + 2]; count++
      }
    }
    const clipZ = count ? sum / count : null
    const dz = clipZ == null ? 0 : targetZ - clipZ

    const anim = doc.createAnimation(clip.id)
    let channels = 0, samples = 0, missingBone = 0
    for (const ch of srcAnim.listChannels()) {
      const boneName = ch.getTargetNode()?.getName()
      const node = boneName && nodeByName.get(boneName)
      if (!node) { missingBone++; continue }

      const s = ch.getSampler()
      const t = s.getInput().getArray()
      const v = s.getOutput().getArray()
      const stride = ch.getTargetPath() === 'rotation' ? 4 : 3

      const keep = []
      for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to) keep.push(i)
      if (keep.length < 2) continue

      const t0 = t[keep[0]]
      const inArr  = new Float32Array(keep.length)
      const outArr = new Float32Array(keep.length * stride)
      const isHipTranslation = stride === 3 && boneName === HIP
      keep.forEach((srcIdx, k) => {
        inArr[k] = t[srcIdx] - t0
        for (let c = 0; c < stride; c++) outArr[k * stride + c] = v[srcIdx * stride + c]
        if (isHipTranslation) outArr[k * stride + 2] += dz
      })

      const input = doc.createAccessor()
        .setArray(inArr).setType(Accessor.Type.SCALAR).setBuffer(buffer)
      const output = doc.createAccessor()
        .setArray(outArr)
        .setType(stride === 4 ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
        .setBuffer(buffer)
      const sampler = doc.createAnimationSampler()
        .setInput(input).setOutput(output).setInterpolation(s.getInterpolation())
      anim.addSampler(sampler)
      anim.addChannel(doc.createAnimationChannel()
        .setSampler(sampler).setTargetNode(node).setTargetPath(ch.getTargetPath()))
      channels++
      samples += keep.length
    }

    const len = clip.cut ? (clip.cut.to - clip.cut.from) : null
    console.log(`   ✓ ${clip.id.padEnd(26)} ${clip.source}` +
      (clip.cut ? ` [${from.toFixed(2)}-${to.toFixed(2)}s]` : ' [whole]') +
      `  ${channels} channels` +
      (clipZ != null ? `, hip ${clipZ.toFixed(3)} → ${targetZ.toFixed(3)} (${dz >= 0 ? '+' : ''}${(dz * 100).toFixed(1)}cm)` : ', no hip channel'))
    if (missingBone) console.log(`     (${missingBone} channels dropped: bone absent from the pack skeleton)`)
    if (len && Math.abs(len - (clip.len ?? len)) > 0.05) {
      console.log(`     ! mapping len ${clip.len} disagrees with the cut range ${len.toFixed(2)}`)
    }
  }

  if (DRY) { console.log('   (dry run — not written)'); continue }
  fs.mkdirSync(outDir, { recursive: true })
  await io.write(packFile.replace(srcDir, outDir), doc)
  const mb = (fs.statSync(path.join(outDir, `animations-pack-${packKey}.glb`)).size / 1048576).toFixed(1)
  console.log(`   → ${doc.getRoot().listAnimations().length} clips, ${mb} MB`)
}
