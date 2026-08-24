/**
 * propose-cuts.mjs
 *
 * Proposes where to cut a long take into gesture-sized pieces.
 *
 * The original slicing was done by hand in the portal, and nothing in this repo
 * records how. The judgement it encodes is simple enough to state: a cut must
 * land where the body is nearly still. A piece that starts or ends mid-swing
 * cannot be crossfaded into or out of without the arm visibly teleporting, which
 * is the one thing a one-shot gesture must never do.
 *
 * So: measure angular velocity per sample across the arm and body bones, smooth
 * it, and choose cut frames that minimise the velocity at the WORST cut, subject
 * to every piece landing inside the house range. Existing pieces run 2.03-6.60s
 * with a median near 4s, so that is the range enforced here.
 *
 * Worst cut, not total: summing costs quietly rewards cutting less, since fewer
 * cuts means fewer terms to add up. One piece that ends mid-swing ruins that
 * piece no matter how clean its neighbours are, so the objective is the maximum.
 * Ties on the maximum are broken by the total, which picks the calmer tiling
 * among equally-good worst cases.
 *
 * The choice is a bottleneck shortest path over cut frames rather than a greedy
 * walk: a greedy pass takes the calmest early cut and can be forced into a bad
 * one later, which is exactly the case where a piece ends mid-gesture.
 *
 * This only PROPOSES. The chosen ranges are written into situational-mapping.json
 * as `cut: { from, to }` and reviewed there like every other mapping decision.
 *
 * Usage:
 *   node propose-cuts.mjs <clip-name> [--min 2.5] [--max 6.5] [--src <dir>]
 */

import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'

const argv = process.argv.slice(2)
const pick = (flag, dflt) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : dflt }
const clipName = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true)

const PLAYGROUND = path.resolve(import.meta.dirname, '../../avatar-playground/public/avatar-engine')
const srcDir = pick('--src', PLAYGROUND)
const MIN = Number(pick('--min', 2.5))
const MAX = Number(pick('--max', 6.5))

const ARM  = ['clavicle', 'shoulder', 'upperarm', 'forearm', 'hand', 'leftarm', 'rightarm']
const BODY = ['hip', 'spine', 'waist', 'head', 'neck']
const FINGER = ['index', 'mid', 'ring', 'pinky', 'thumb', 'finger']
const tracked = (name) => {
  const n = name.toLowerCase()
  if (FINGER.some((p) => n.includes(p))) return false
  return ARM.some((p) => n.includes(p)) || BODY.some((p) => n.includes(p))
}

function quatAngleDeg(a, b) {
  let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
  dot = Math.min(1, Math.abs(dot))
  return (2 * Math.acos(dot) * 180) / Math.PI
}

const io = new NodeIO()
const doc = await io.read(path.join(srcDir, 'animations-pack-cc4-originals.glb'))
const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName)
if (!anim) { console.error(`clip not found: ${clipName}`); process.exit(1) }

// ── Build a common timeline and a velocity signal on it ──────────────────────

let times = null
const perBone = []
for (const ch of anim.listChannels()) {
  if (ch.getTargetPath() !== 'rotation') continue
  const name = ch.getTargetNode()?.getName() ?? ''
  if (!tracked(name)) continue
  const s = ch.getSampler()
  const t = Array.from(s.getInput().getArray())
  const q = s.getOutput().getArray()
  if (!times || t.length > times.length) times = t
  perBone.push({ t, q })
}
if (!perBone.length) { console.error('no tracked rotation channels'); process.exit(1) }

const n = times.length
const vel = new Float64Array(n)
for (const { t, q } of perBone) {
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i-1] || 1/30
    const a = [q[(i-1)*4], q[(i-1)*4+1], q[(i-1)*4+2], q[(i-1)*4+3]]
    const b = [q[i*4], q[i*4+1], q[i*4+2], q[i*4+3]]
    // Channels can be sampled on their own timeline; land the value on the
    // nearest frame of the common one.
    const idx = Math.min(n - 1, Math.round((t[i] / times[n-1]) * (n - 1)))
    vel[idx] += quatAngleDeg(a, b) / dt
  }
}
// Smooth: a single noisy frame is not a calm moment.
const SM = 5
const smooth = new Float64Array(n)
for (let i = 0; i < n; i++) {
  let sum = 0, c = 0
  for (let j = Math.max(0, i-SM); j <= Math.min(n-1, i+SM); j++) { sum += vel[j]; c++ }
  smooth[i] = sum / c
}

// ── Shortest path over cut frames ────────────────────────────────────────────

const T = times[n-1]
const frameAt = (sec) => Math.min(n-1, Math.max(0, Math.round((sec / T) * (n-1))))
const INF = Infinity
// bottleneck[i] = smallest possible worst-cut to reach frame i; total[i] breaks ties.
const bottleneck = new Float64Array(n).fill(INF)
const total      = new Float64Array(n).fill(INF)
const prev       = new Int32Array(n).fill(-1)
bottleneck[0] = 0
total[0] = 0
const better = (b, t, i) => b < bottleneck[i] - 1e-9 || (Math.abs(b - bottleneck[i]) <= 1e-9 && t < total[i])
for (let i = 0; i < n; i++) {
  if (bottleneck[i] === INF) continue
  const ti = times[i]
  for (let j = i + 1; j < n; j++) {
    const len = times[j] - ti
    if (len < MIN) continue
    if (len > MAX) break
    // Cost of cutting at j is how fast the body is moving there. The final frame
    // is free — the take has to end where it ends.
    const cost = j === n - 1 ? 0 : smooth[j]
    const b = Math.max(bottleneck[i], cost)
    const t = total[i] + cost
    if (better(b, t, j)) { bottleneck[j] = b; total[j] = t; prev[j] = i }
  }
}
if (bottleneck[n-1] === INF) { console.error(`cannot tile ${T.toFixed(2)}s into ${MIN}-${MAX}s pieces`); process.exit(1) }

const cuts = []
for (let i = n-1; i !== -1 && i !== 0; i = prev[i]) cuts.push(i)
cuts.push(0)
cuts.reverse()

const velRange = [...smooth].sort((a,b)=>a-b)
const pct = (p) => velRange[Math.floor((p/100) * (velRange.length-1))]

console.log(`${clipName} — ${T.toFixed(2)}s, ${n} frames`)
console.log(`velocity °/s: p10=${pct(10).toFixed(0)} median=${pct(50).toFixed(0)} p90=${pct(90).toFixed(0)}`)
console.log(`\n  piece   from     to      len    vel at cut`)
for (let k = 0; k < cuts.length - 1; k++) {
  const a = times[cuts[k]], b = times[cuts[k+1]]
  const v = k === cuts.length - 2 ? 0 : smooth[cuts[k+1]]
  const pctile = Math.round(100 * velRange.filter((x) => x < v).length / velRange.length)
  console.log(`  p${k+1}   ${a.toFixed(2).padStart(6)} ${b.toFixed(2).padStart(7)} ${(b-a).toFixed(2).padStart(7)}    ${v.toFixed(0).padStart(5)}°/s ${k === cuts.length-2 ? '(end of take)' : `(p${pctile})`}`)
}
console.log(`\n  worst cut: ${bottleneck[n-1].toFixed(0)}°/s`)
console.log(`  JSON: ${JSON.stringify(cuts.slice(0,-1).map((c,k) => ({ from: +times[c].toFixed(2), to: +times[cuts[k+1]].toFixed(2) })))}`)
