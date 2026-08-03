/**
 * gen-situational-clips.mjs
 *
 * Emits src/core/situational-clips.ts from scripts/situational-mapping.json.
 *
 * The engine needs the mapping at runtime to pick clips by situation, and the
 * mapping is authored as data (generated in turn from the inventory spreadsheet).
 * Generating a typed TS module rather than fetching JSON keeps the engine a
 * dependency-free library: no network, no bundler asset handling, and the clip
 * ids are checkable at compile time.
 *
 * Re-run after editing situational-mapping.json:
 *   node gen-situational-clips.mjs
 */

import fs   from 'node:fs'
import path from 'node:path'

const here    = import.meta.dirname
const mapping = JSON.parse(fs.readFileSync(path.join(here, 'situational-mapping.json'), 'utf8'))
const outFile = path.join(here, '../src/core/situational-clips.ts')

const clips = Object.values(mapping.packs).flatMap((p) => p.clips)
const seen  = new Map()
for (const c of clips) {
  if (seen.has(c.id)) throw new Error(`duplicate clip id across packs: ${c.id}`)
  seen.set(c.id, c)
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const lit = (arr) => `[${arr.map(q).join(', ')}]`

const rows = [...seen.values()]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((c) =>
    `  ${q(c.id)}: { id: ${q(c.id)}, label: ${q(c.label)}, when: ${q(c.when)}, ` +
    `kind: ${q(c.kind)}, functions: ${lit(c.functions)}, manner: ${lit(c.manner)}, ` +
    `scale: ${q(c.scale)}, armDeg: ${Number(c.armDeg ?? 0)}, bodyDeg: ${Number(c.bodyDeg ?? 0)}, ` +
    `duration: ${Number(c.len ?? 0).toFixed(2)} },`)
  .join('\n')

const out = `/**
 * situational-clips.ts — GENERATED. Do not edit by hand.
 *
 * Source: scripts/situational-mapping.json
 * Regenerate: node scripts/gen-situational-clips.mjs
 *
 * The situational clip registry. Every clip records WHAT IT DOES IN DIALOGUE
 * ('functions') and HOW IT IS COLOURED ('manner') — deliberately NOT an emotion.
 *
 * Emotion no longer decides which body clip may play. It persists on the FACE via
 * the emotion state machine, so a character who turns sad stays visibly sad across
 * exchanges while still gesturing appropriately for what they are saying. Coupling
 * the two is what previously pinned an avatar to one emotion's clips and made every
 * conversation read as the same mood.
 *
 * 'manner' exists to break ties, to let a director ask for an on-tone variant, and
 * to keep a CHARACTERISED resting pose out of rotation when nothing in the
 * conversation calls for it. It must never restrict the pool of GESTURES.
 *
 * 'scale' is the MEASURED size of the motion (see scripts/measure-clip-amplitude
 * and merge-clip-amplitude), not a guess from the clip's name. Guessing from names
 * is exactly how 37 arm-throwing clips came to be advertised as restrained head
 * beats. A director should default to 'subtle' and escalate only when the moment
 * earns it.
 */

/** What a clip does in dialogue. */
export type ClipFunction =
${mapping.functions.map((f) => `  | '${f}'`).join('\n')}

/** Optional emotional colouring. Breaks ties; never gates gesture selection. */
export type ClipManner =
${mapping.manners.map((m) => `  | '${m}'`).join('\n')}

/**
 * Measured size of the motion, banded from armDeg.
 *
 *   subtle    <= ${mapping.scaleThresholds.subtleMax}°  head, eyes, a small weight shift
 *   moderate  <= ${mapping.scaleThresholds.moderateMax}°  a contained hand movement
 *   broad      >  ${mapping.scaleThresholds.moderateMax}°  a full arm throw, visible across the frame
 */
export type ClipScale =
${mapping.scales.map((s) => `  | '${s}'`).join('\n')}

export interface SituationalClip {
  id:        string
  /** Human label for admin UIs. */
  label:     string
  /** Author's description of the moment it fits. This is what a director is shown. */
  when:      string
  /** 'idle' loops as a resting pose; 'gesture' plays once. */
  kind:      'idle' | 'gesture'
  functions: ClipFunction[]
  manner:    ClipManner[]
  /** Banded motion size. Prefer the smallest that fits the moment. */
  scale:     ClipScale
  /** Max angular excursion of any shoulder/arm/forearm/hand bone, in degrees. */
  armDeg:    number
  /** Max angular excursion of any hip/spine/head/neck bone, in degrees. */
  bodyDeg:   number
  duration:  number
}

export const CLIP_FUNCTIONS: readonly ClipFunction[] = ${lit(mapping.functions)}
export const CLIP_MANNERS:   readonly ClipManner[]   = ${lit(mapping.manners)}
export const CLIP_SCALES:    readonly ClipScale[]    = ${lit(mapping.scales)}

/** Ascending motion size, for "prefer the smallest that fits" ordering. */
export const SCALE_ORDER: Readonly<Record<ClipScale, number>> = { subtle: 0, moderate: 1, broad: 2 }

export const SITUATIONAL_CLIPS: Record<string, SituationalClip> = {
${rows}
}

/** Clip ids that loop as resting poses. */
export const IDLE_CLIP_IDS: ReadonlySet<string> = new Set(
  Object.values(SITUATIONAL_CLIPS).filter(c => c.kind === 'idle').map(c => c.id),
)

/** Registry lookup. Returns undefined for clips from an unmapped legacy pack. */
export function clipInfo(id: string): SituationalClip | undefined {
  return SITUATIONAL_CLIPS[id]
}

/**
 * Is this clip a resting loop?
 *
 * Falls back to a name heuristic for clips outside the registry, so loading a
 * legacy pack degrades gracefully instead of treating its idles as one-shot
 * gestures (which crossfades through the bind pose and flashes a T-pose).
 */
export function isIdleClip(id: string): boolean {
  if (IDLE_CLIP_IDS.has(id)) return true
  if (SITUATIONAL_CLIPS[id]) return false
  return /(^|_)idle(_|$)|(^|_)still(_|$)|breathing/.test(id.toLowerCase())
}

/**
 * Registry clips serving a given function, optionally narrowed to idle or gesture
 * and to a maximum motion size.
 *
 * Order is stable (registry order) so callers can apply their own preference;
 * pass \`smallestFirst\` to get them ordered by measured size instead, which is what
 * a caller wanting restraint should use.
 */
export function clipsForFunction(
  fn: ClipFunction,
  kind?: 'idle' | 'gesture',
  opts?: { maxScale?: ClipScale; smallestFirst?: boolean },
): SituationalClip[] {
  const ceiling = opts?.maxScale ? SCALE_ORDER[opts.maxScale] : Infinity
  const out = Object.values(SITUATIONAL_CLIPS).filter(
    c => c.functions.includes(fn) &&
         (kind === undefined || c.kind === kind) &&
         SCALE_ORDER[c.scale] <= ceiling,
  )
  return opts?.smallestFirst ? out.sort((a, b) => a.armDeg - b.armDeg) : out
}

/**
 * Resting poses whose emotional colouring the current moment permits.
 *
 * A clip qualifies when EVERY one of its manner tags is in \`allowed\` — so
 * \`allowed = []\` yields only the uncharacterised idles. This is the fix for an
 * avatar dropping into a visibly tired or wary stance in a conversation that never
 * called for one: most resting poses in the CC pack carry a manner, and drawing
 * uniformly from all of them means the character spends most of its time
 * characterised by accident.
 *
 * Gestures are deliberately NOT filtered this way — manner must never restrict
 * what a character can do with their hands, only how they stand at rest.
 */
export function idlesForManner(allowed: readonly ClipManner[]): SituationalClip[] {
  const ok = new Set(allowed)
  return Object.values(SITUATIONAL_CLIPS).filter(
    c => c.kind === 'idle' && c.manner.every(m => ok.has(m)),
  )
}

/** True when the clip carries no emotional colouring at all. */
export function isUncharacterisedClip(id: string): boolean {
  const c = SITUATIONAL_CLIPS[id]
  return !!c && c.manner.length === 0
}
`
fs.writeFileSync(outFile, out)
console.log(`wrote ${path.relative(process.cwd(), outFile)} — ${seen.size} clips, ` +
            `${mapping.functions.length} functions, ${mapping.manners.length} manners`)
