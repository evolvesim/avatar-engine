/**
 * measure-sheet-columns.mjs
 *
 * Emits the "Animation renames" spreadsheet's own columns for a set of clips,
 * as CSV, so new clips can be added to that sheet in the schema it already uses.
 *
 * The sheet's Legend defines every column, and this follows it exactly:
 *
 *   Head/Torso/L arm/R arm/Fingers/Legs °   max LOCAL rotation each joint group
 *                                           reaches from its own frame-0 pose, so
 *                                           inherited spine motion does not read
 *                                           as arm movement
 *   Head speed °/s                          mean angular speed of the head
 *
 * Two of the sheet's columns are deliberately left EMPTY rather than filled:
 *
 *   Hands rise (m)   needs the hand's world position, which means running forward
 *                    kinematics over the skeleton — the pack clips carry rotation
 *                    channels only, so it cannot be read off them directly.
 *   Head pitch °     the sheet's values come from the portal's own taxonomy code
 *                    against a rest reference this script does not have. Measuring
 *                    it here lands on a different zero (every clip reads about
 *                    -20°), so the numbers would not be comparable with the rows
 *                    already in the sheet.
 *
 * Both are better filled by re-running the sheet's own measurement pass against
 * the updated pack. A number on the wrong scale in a column people sort by is
 * worse than a blank one.
 *   Shape (measured)                        plain-English summary of the same numbers
 *
 * The rig is Z-up, so "above the hip" is a Z difference, not Y. Getting that
 * backwards is what hid a 9cm stance difference between two idles.
 *
 * Usage:
 *   node measure-sheet-columns.mjs <clip> [clip ...] [--pack <file>]
 */

import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'

const argv = process.argv.slice(2)
const pick = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d }
const clips = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))

const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const packFile = path.join(PLAYGROUND, pick('--pack', 'animations-pack-cc5-default.glb'))

const GROUPS = {
  head:    (n) => /head|neck/i.test(n),
  torso:   (n) => /spine|waist|pelvis/i.test(n) && !/hip$/i.test(n),
  larm:    (n) => /^cc_base_l_(clavicle|upperarm|forearm|hand)$/i.test(n),
  rarm:    (n) => /^cc_base_r_(clavicle|upperarm|forearm|hand)$/i.test(n),
  fingers: (n) => /index|mid|ring|pinky|thumb/i.test(n),
  legs:    (n) => /thigh|calf|foot|toe/i.test(n),
}

const deg = (a, b) => {
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
  d = Math.min(1, Math.abs(d))
  return (2 * Math.acos(d) * 180) / Math.PI
}

/**
 * The editorial columns, which are decisions rather than measurements. Both
 * source takes were marked "Delete" in this sheet as IDLES, because they swing
 * their arms 105-115° and read as nothing like a resting pose. Cut into gesture
 * pieces they are usable, which is what these rows record.
 */
const SHEET_META = {
  cc_chat_relax_1:  { newName: 'Chat relax 1 of 5',  pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_relax_2:  { newName: 'Chat relax 2 of 5',  pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_relax_3:  { newName: 'Chat relax 3 of 5',  pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_relax_4:  { newName: 'Chat relax 4 of 5',  pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_relax_5:  { newName: 'Chat relax 5 of 5',  pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_listen_1: { newName: 'Chat listen 1 of 4', pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_listen_2: { newName: 'Chat listen 2 of 4', pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_listen_3: { newName: 'Chat listen 3 of 4', pack: 'CC5 Default', type: 'Gesture' },
  cc_chat_listen_4: { newName: 'Chat listen 4 of 4', pack: 'CC5 Default', type: 'Gesture' },
  cc_idle_378963:   { newName: 'Idle 378963',        pack: 'CC5 Default', type: 'Idle' },
}
for (const [id, m] of Object.entries(SHEET_META)) {
  const cut = id.startsWith('cc_idle') ? '' : ' — piece of a take marked Delete as an idle; usable as a gesture'
  m.fn = id.startsWith('cc_chat_listen') ? 'When listening (UNREVIEWED — watch and rename)'
       : id.startsWith('cc_chat_relax')  ? 'When explaining (UNREVIEWED — watch and rename)'
       : 'When at rest'
  m.flags = id.startsWith('cc_idle') ? 'height normalised +7.2cm to the shipped band'
          : `NEEDS NAMING: placeholder name and function${cut}`
  m.bucket = 'not offered yet'
}

const io = new NodeIO()
const doc = await io.read(packFile)

const rows = []
for (const name of clips) {
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === name)
  if (!anim) { console.error(`# clip not found: ${name}`); continue }

  const max = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, 0]))
  let headSpeedSum = 0, headSpeedN = 0, duration = 0

  for (const ch of anim.listChannels()) {
    const bone = ch.getTargetNode()?.getName() ?? ''
    const s = ch.getSampler()
    const t = s.getInput().getArray()
    const v = s.getOutput().getArray()
    duration = Math.max(duration, t[t.length - 1])

    if (ch.getTargetPath() !== 'rotation') continue

    const first = [v[0], v[1], v[2], v[3]]
    let peak = 0
    for (let i = 4; i + 3 < v.length; i += 4) peak = Math.max(peak, deg(first, [v[i], v[i+1], v[i+2], v[i+3]]))
    for (const [g, test] of Object.entries(GROUPS)) if (test(bone)) max[g] = Math.max(max[g], peak)

    if (/^CC_Base_Head$/i.test(bone)) {
      for (let i = 4; i + 3 < v.length; i += 4) {
        const dt = (t[i / 4] - t[i / 4 - 1]) || 1 / 30
        headSpeedSum += deg([v[i-4],v[i-3],v[i-2],v[i-1]], [v[i],v[i+1],v[i+2],v[i+3]]) / dt
        headSpeedN++
      }
    }
  }

  const r = (n) => Math.round(n)

  // Plain-English summary, same vocabulary the sheet already uses.
  const parts = []
  const bothArms = max.larm > 40 && max.rarm > 40
  if (bothArms) parts.push('both arms')
  else if (max.larm > 40) parts.push('left arm')
  else if (max.rarm > 40) parts.push('right arm')
  else if (max.larm > 15 || max.rarm > 15) parts.push('slight arm')
  if (max.head > 15) parts.push('head')
  if (max.torso > 15) parts.push('torso')
  if (max.legs > 20) parts.push('legs/weight shift')
  if (max.fingers > 25) parts.push('fingers')
  const shape = parts.length ? parts.join(' + ') : 'near-still'

  const meta = SHEET_META[name] ?? {}
  rows.push([
    name, meta.newName ?? '', meta.fn ?? '', meta.pack ?? '', meta.type ?? '', duration.toFixed(1),
    r(max.head), r(max.torso), r(max.larm), r(max.rarm), r(max.fingers), r(max.legs),
    '', '',                                    // Hands rise, Head pitch — see header
    r(headSpeedN ? headSpeedSum / headSpeedN : 0),
    shape, '', meta.bucket ?? '', meta.flags ?? '',
  ])
}

const HEAD = ['Current clip ID','New name','Function / when to use','Pack(s)','Type','Len (s)','Head °','Torso °','L arm °','R arm °','Fingers °','Legs °','Hands rise (m)','Head pitch °','Head speed °/s','Shape (measured)','Emotion tag (retiring)','VD bucket today','Flags']
const csv = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)
console.log(HEAD.map(csv).join(','))
for (const row of rows) console.log(row.map(csv).join(','))
