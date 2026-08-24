/**
 * gen-clip-provenance.mjs
 *
 * Emits ../avatar-playground/components/clip-provenance.ts — the map between the
 * ORIGINAL full-length ActorCore clips and the slices cut from them.
 *
 * Most of the CC pack's clips are pieces. `cc4_c_stand_talk_378997` is one
 * continuous 28s performance in the source; the pack carries it as six separate
 * gestures (`_p1`…`_p6`, with `_p7` dropped along the way). Once a slice is
 * renamed to its descriptive id — cc_high_hands_together_step_forward — nothing
 * downstream records that it was ever part of a longer take, which makes it
 * impossible to ask the obvious question: does the slice still read like the
 * moment it was cut from?
 *
 * This map exists so the playground's animation tester can answer that. It pairs
 * each original with its surviving slices and reports what the slicing dropped.
 *
 * The originals themselves live at public/avatar-engine/animations-source-cc4-*.glb,
 * restored from avatar-playground commit 3d5842b (they were removed from the
 * working tree in be8834e once the sliced packs superseded them).
 *
 * Re-run after editing situational-mapping.json:
 *   node gen-clip-provenance.mjs [--src <dir of the source GLBs>]
 */

import fs   from 'node:fs'
import path from 'node:path'

const here   = import.meta.dirname
const argv   = process.argv.slice(2)
const pick   = (flag, dflt) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : dflt }

const PLAYGROUND = path.resolve(here, '../../avatar-playground')
const srcDir  = pick('--src', path.join(PLAYGROUND, 'public/avatar-engine'))
const outFile = path.join(PLAYGROUND, 'components/clip-provenance.ts')

const mapping = JSON.parse(fs.readFileSync(path.join(here, 'situational-mapping.json'), 'utf8'))

/** The restored originals, in the order the tester should offer them. */
const SOURCE_FILES = [
  { file: 'animations-source-cc4-common.glb', key: 'common' },
  { file: 'animations-source-cc4-male.glb',   key: 'male'   },
  { file: 'animations-source-cc4-female.glb', key: 'female' },
]

/**
 * Read clip names + durations straight out of a GLB's JSON chunk.
 *
 * Deliberately dependency-free: this runs against files restored from git
 * history, and needing a working node_modules to inspect them would defeat the
 * point of being able to recover them at all.
 */
function readClips(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error(`not a GLB: ${file}`)
  let off = 12, json = null
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4)
    if (type === 0x4E4F534A) { json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8')); break }
    off += 8 + len
  }
  if (!json) throw new Error(`no JSON chunk: ${file}`)
  const acc = json.accessors ?? []
  return (json.animations ?? []).map((a) => {
    let dur = 0
    for (const s of a.samplers ?? []) {
      const max = acc[s.input]?.max?.[0]
      if (max != null) dur = Math.max(dur, max)
    }
    return { name: a.name ?? 'unnamed', duration: dur }
  })
}

// ── Index the originals ───────────────────────────────────────────────────────

const originals = new Map()   // source clip name -> { file, duration }
for (const { file } of SOURCE_FILES) {
  const full = path.join(srcDir, file)
  if (!fs.existsSync(full)) {
    console.error(`✗ ${file} not found in ${srcDir} — restore it from avatar-playground 3d5842b first`)
    process.exit(1)
  }
  for (const c of readClips(full)) {
    if (!originals.has(c.name)) originals.set(c.name, { file, duration: c.duration })
  }
}

// ── Attach each pack clip to the original it came from ────────────────────────
//
// A pack clip's `source` is either "<original>_p<n>" for a slice or the original
// name itself when the whole take was kept as one clip. Both are recorded: a
// whole-take clip is still worth showing as "1 of 1, nothing dropped", because
// that is the answer to "was this one sliced?".

const bySource = new Map()
for (const [packKey, pack] of Object.entries(mapping.packs)) {
  for (const clip of pack.clips) {
    const m = /^(.*)_p(\d+)$/.exec(clip.source ?? '')
    const origin = m ? m[1] : clip.source
    const piece  = m ? Number(m[2]) : 1
    if (!originals.has(origin)) continue          // Mixamo/CC5 clips, never sliced
    if (!bySource.has(origin)) bySource.set(origin, [])
    bySource.get(origin).push({ id: clip.id, label: clip.label, piece, len: clip.len ?? 0, pack: packKey })
  }
}

const q   = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const num = (n) => Number(n).toFixed(2)

const rows = [...bySource.keys()].sort().map((origin) => {
  const { file, duration } = originals.get(origin)
  const slices = bySource.get(origin).sort((a, b) => a.piece - b.piece)
  const kept   = slices.reduce((a, s) => a + s.len, 0)
  const body   = slices
    .map((s) => `      { id: ${q(s.id)}, label: ${q(s.label)}, piece: ${s.piece}, duration: ${num(s.len)} },`)
    .join('\n')
  return `  ${q(origin)}: {
    origin: ${q(origin)},
    file: ${q(file)},
    duration: ${num(duration)},
    keptDuration: ${num(kept)},
    slices: [
${body}
    ],
  },`
}).join('\n')

// Originals that reached no pack at all — cut entirely, and the reason the
// restored GLBs hold more than the pack does.
const unused = [...originals.keys()].filter((k) => !bySource.has(k)).sort()

const out = `/**
 * clip-provenance.ts — GENERATED. Do not edit by hand.
 *
 * Source: avatar-engine/scripts/situational-mapping.json + the restored
 *         public/avatar-engine/animations-source-cc4-*.glb
 * Regenerate: node scripts/gen-clip-provenance.mjs   (from the engine repo)
 *
 * Which shipped clips were cut from which original take.
 *
 * The CC pack is largely made of slices. One 28s ActorCore performance becomes
 * six one-shot gestures, each renamed to describe its own motion, and after the
 * rename nothing records the relationship. That is fine for the director — it
 * only ever wants a gesture that fits the moment — but it makes the slicing
 * itself unreviewable: you cannot see what a slice was cut out of, where the
 * cuts fell, or what was dropped on the floor.
 *
 * The animation tester uses this to put the two side by side.
 */

export interface ClipSlice {
  /** The shipped clip id, e.g. 'cc_high_hands_together_step_forward'. */
  id:       string
  label:    string
  /** 1-based position within the original take. Gaps mean a piece was dropped. */
  piece:    number
  duration: number
}

export interface ClipOrigin {
  /** The original clip name as authored, e.g. 'cc4_c_stand_talk_378997'. */
  origin:        string
  /** Which restored source GLB holds it. */
  file:          string
  /** Length of the original, uncut. */
  duration:      number
  /** Total length of the slices that survived into a pack. */
  keptDuration:  number
  slices:        ClipSlice[]
}

/** Keyed by original clip name. */
export const CLIP_ORIGINS: Record<string, ClipOrigin> = {
${rows}
}

/**
 * Originals that reached no pack — cut entirely during the mapping pass.
 * They are still in the restored source GLBs, which is the point of keeping them.
 */
export const UNUSED_ORIGINALS: readonly string[] = [
${unused.map((u) => `  ${q(u)},`).join('\n')}
]

/** Reverse lookup: shipped clip id -> the original it was cut from. */
export const ORIGIN_BY_CLIP_ID: Record<string, string> = Object.fromEntries(
  Object.values(CLIP_ORIGINS).flatMap((o) => o.slices.map((s) => [s.id, o.origin])),
)

/** True when the original was cut into more than one shipped clip. */
export function wasSliced(origin: string): boolean {
  return (CLIP_ORIGINS[origin]?.slices.length ?? 0) > 1
}

/** Seconds of the original that no shipped clip covers. Never negative. */
export function droppedDuration(origin: string): number {
  const o = CLIP_ORIGINS[origin]
  if (!o) return 0
  return Math.max(0, Math.round((o.duration - o.keptDuration) * 100) / 100)
}
`

fs.writeFileSync(outFile, out)
const sliced = [...bySource.values()].filter((s) => s.length > 1).length
console.log(`✓ ${path.relative(process.cwd(), outFile)}`)
console.log(`  ${bySource.size} originals mapped (${sliced} of them sliced), ${unused.length} never used`)
