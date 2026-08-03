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
 * 'manner' exists to break ties and to let a director ask for an on-tone variant.
 * It must never be used to restrict the candidate pool.
 */

/** What a clip does in dialogue. */
export type ClipFunction =
${mapping.functions.map((f) => `  | '${f}'`).join('\n')}

/** Optional emotional colouring. Breaks ties; never gates selection. */
export type ClipManner =
${mapping.manners.map((m) => `  | '${m}'`).join('\n')}

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
  duration:  number
}

export const CLIP_FUNCTIONS: readonly ClipFunction[] = ${lit(mapping.functions)}
export const CLIP_MANNERS:   readonly ClipManner[]   = ${lit(mapping.manners)}

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
 * Registry clips serving a given function, optionally narrowed to idle or gesture.
 * Order is stable (registry order) so callers can apply their own preference.
 */
export function clipsForFunction(
  fn: ClipFunction,
  kind?: 'idle' | 'gesture',
): SituationalClip[] {
  return Object.values(SITUATIONAL_CLIPS).filter(
    c => c.functions.includes(fn) && (kind === undefined || c.kind === kind),
  )
}
`
fs.writeFileSync(outFile, out)
console.log(`wrote ${path.relative(process.cwd(), outFile)} — ${seen.size} clips, ` +
            `${mapping.functions.length} functions, ${mapping.manners.length} manners`)
