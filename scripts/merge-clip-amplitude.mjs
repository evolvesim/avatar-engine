/**
 * merge-clip-amplitude.mjs
 *
 * Writes the MEASURED motion size of every clip into situational-mapping.json,
 * then situational-clips.ts is regenerated from it.
 *
 *   node measure-clip-amplitude.mjs --json /tmp/amplitude.json
 *   node merge-clip-amplitude.mjs   --json /tmp/amplitude.json
 *   node gen-situational-clips.mjs
 *
 * Adds three fields per clip: `armDeg`, `bodyDeg` (measured, see
 * measure-clip-amplitude.mjs) and `scale`, the band derived from armDeg.
 *
 * ── Where the band thresholds come from ─────────────────────────────────────
 *
 * Measured across all 130 clips the arm-excursion distribution is CONTINUOUS —
 * the largest interior gap is 7 degrees, so there is no natural cliff to snap to.
 * The cuts are therefore chosen at 20 and 70 degrees, which sit close to the
 * terciles (43 / 34 / 53 clips) and line up with a meaning you can state:
 *
 *   subtle    <= 20   head, eyes, a small weight shift. Nothing leaves the torso
 *                     silhouette. cc_head_nod 9, cc_idle_standard 7.
 *   moderate  21-70   a contained hand movement — snapped in front, hands
 *                     together. cc_hand_snapped_in_front 42.
 *   broad     >  70   a full arm throw, clearly visible across the frame.
 *                     cc_fist_pump 114, cc_hand_on_hip_then_outwards 150.
 *
 * They are a presentation aid for choosing restraint, not physics — `armDeg` is
 * kept alongside so a caller can threshold differently without re-measuring.
 */

import fs   from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const pick = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : dflt
}

const here    = import.meta.dirname
const ampFile = pick('--json', null)
if (!ampFile) {
  console.error('usage: node merge-clip-amplitude.mjs --json <amplitude.json>')
  process.exit(1)
}

const SUBTLE_MAX   = 20
const MODERATE_MAX = 70

function bandOf(armDeg) {
  if (armDeg <= SUBTLE_MAX)   return 'subtle'
  if (armDeg <= MODERATE_MAX) return 'moderate'
  return 'broad'
}

const mapFile = path.join(here, 'situational-mapping.json')
const mapping = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
const measured = new Map(
  JSON.parse(fs.readFileSync(ampFile, 'utf8')).map((r) => [r.id, r]),
)

mapping.scales = ['subtle', 'moderate', 'broad']
mapping.scaleThresholds = { subtleMax: SUBTLE_MAX, moderateMax: MODERATE_MAX }

const missing = []
const counts = { subtle: 0, moderate: 0, broad: 0 }

for (const pack of Object.values(mapping.packs)) {
  for (const clip of pack.clips) {
    const m = measured.get(clip.id)
    if (!m) {
      missing.push(clip.id)
      continue
    }
    clip.armDeg  = m.arm
    clip.bodyDeg = m.body
    clip.scale   = bandOf(m.arm)
    counts[clip.scale]++
  }
}

if (missing.length > 0) {
  // Refuse to write a partially-annotated mapping: a clip with no scale would
  // silently read as whatever the generator defaults to, and the whole point is
  // that the director stops guessing motion size.
  console.error(`no measurement for ${missing.length} clip(s): ${missing.join(', ')}`)
  console.error('re-run measure-clip-amplitude.mjs against the current packs first')
  process.exit(1)
}

fs.writeFileSync(mapFile, JSON.stringify(mapping, null, 2) + '\n')
console.log(`merged amplitude into ${path.relative(process.cwd(), mapFile)} — ` +
  `${counts.subtle} subtle, ${counts.moderate} moderate, ${counts.broad} broad`)
