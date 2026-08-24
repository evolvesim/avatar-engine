/**
 * measure-clip-amplitude.mjs
 *
 * Measures how BIG each clip's motion actually is, straight from the pack GLBs,
 * and prints a row per clip.
 *
 * Why measure instead of infer: the previous director classified clips as
 * "subtle" or "arm" from KEYWORDS IN THEIR NAMES and defaulted anything
 * unrecognised to "subtle". 37 clips that swing an arm 40-150 degrees were
 * therefore advertised as restrained head beats. Names do not carry this
 * information; the animation channels do.
 *
 * Two numbers per clip, both in degrees:
 *
 *   arm   max angular excursion of any shoulder/arm/forearm/hand bone
 *   body  max angular excursion of any hip/spine/head bone
 *
 * "Excursion" is the largest angle between any sampled rotation and the clip's
 * FIRST sampled rotation for that bone — i.e. how far the limb travels from where
 * the clip starts, which is what reads as gesture size on screen. Taking the max
 * over the whole clip (rather than a mean) is deliberate: one big throw of the arm
 * is what a viewer notices, even in an otherwise still clip.
 *
 * Usage:
 *   node measure-clip-amplitude.mjs [--src <dir>] [--json <file>]
 */

import fs   from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'

const argv = process.argv.slice(2)
const pick = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : dflt
}

const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const srcDir  = pick('--src', PLAYGROUND)
const jsonOut = pick('--json', null)

const DEFAULT_PACKS = [
  'animations-pack-avaturn-default.glb',
  'animations-pack-cc5-default.glb',
]

const PACKS = (pick('--packs', null)?.split(',').map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_PACKS

// Bone-name fragments per group, covering both skeletons (CC_Base_L_Upperarm /
// LeftArm, etc.). Matched case-insensitively against the node name.
const ARM_PATTERNS  = [
  'clavicle', 'shoulder', 'upperarm', 'forearm', 'hand',
  'leftarm', 'rightarm', 'leftforearm', 'rightforearm',
]
const BODY_PATTERNS = ['hip', 'spine', 'waist', 'head', 'neck']

// Finger bones are excluded: they are numerous and their rotations are large
// without reading as gesture size. "hand" above matches the wrist only because
// finger nodes carry an explicit digit segment in both rigs.
const FINGER_PATTERNS = [
  'index', 'mid', 'ring', 'pinky', 'thumb', 'finger',
]

function groupOf(name) {
  const n = name.toLowerCase()
  if (FINGER_PATTERNS.some((p) => n.includes(p))) return null
  if (ARM_PATTERNS.some((p) => n.includes(p)))  return 'arm'
  if (BODY_PATTERNS.some((p) => n.includes(p))) return 'body'
  return null
}

/** Angle in degrees between two unit quaternions [x,y,z,w]. */
function quatAngleDeg(a, b) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  dot = Math.min(1, Math.abs(dot))          // abs: q and -q are the same rotation
  return (2 * Math.acos(dot) * 180) / Math.PI
}

const io = new NodeIO()

/**
 * Measure every clip in one pack. Exported so other generators can ask this
 * question without re-deriving the bone groups or the excursion definition —
 * two answers to "how big is this motion" is one too many.
 *
 * @returns {Promise<Array<{id: string, arm: number, body: number}>>}
 */
export async function measurePack(file) {
  const rows = []
  const doc = await io.read(file)

  for (const anim of doc.getRoot().listAnimations()) {
    const maxByGroup = { arm: 0, body: 0 }

    for (const channel of anim.listChannels()) {
      if (channel.getTargetPath() !== 'rotation') continue
      const node = channel.getTargetNode()
      if (!node) continue
      const group = groupOf(node.getName())
      if (!group) continue

      const sampler = channel.getSampler()
      const out = sampler?.getOutput()
      if (!out) continue
      const arr = out.getArray()
      if (!arr || arr.length < 8) continue

      // Compare every sample against the first for this bone.
      const first = [arr[0], arr[1], arr[2], arr[3]]
      for (let i = 4; i + 3 < arr.length; i += 4) {
        const angle = quatAngleDeg(first, [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]])
        if (angle > maxByGroup[group]) maxByGroup[group] = angle
      }
    }

    rows.push({
      id:   anim.getName(),
      arm:  Math.round(maxByGroup.arm),
      body: Math.round(maxByGroup.body),
    })
  }
  return rows
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = []
  for (const file of PACKS) {
    const full = path.join(srcDir, file)
    if (!fs.existsSync(full)) {
      console.error(`missing source: ${full}`)
      continue
    }
    rows.push(...await measurePack(full))
  }

  rows.sort((a, b) => b.arm - a.arm || b.body - a.body)

  console.log('id'.padEnd(44) + 'arm°'.padStart(6) + 'body°'.padStart(7))
  for (const r of rows) {
    console.log(r.id.padEnd(44) + String(r.arm).padStart(6) + String(r.body).padStart(7))
  }

  // Distribution, to pick thresholds from the data rather than by feel.
  const arms = rows.map((r) => r.arm).sort((a, b) => a - b)
  const pct = (p) => arms[Math.min(arms.length - 1, Math.floor((p / 100) * arms.length))]
  console.log(`\nn=${rows.length}  arm° percentiles: ` +
    `p10=${pct(10)} p25=${pct(25)} p50=${pct(50)} p75=${pct(75)} p90=${pct(90)} max=${arms[arms.length - 1]}`)

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2))
    console.log(`\nwrote ${jsonOut}`)
  }
}
