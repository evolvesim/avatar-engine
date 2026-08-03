/**
 * merge-clip-gender.mjs
 *
 * Records each clip's intended gender presentation in situational-mapping.json,
 * then situational-clips.ts is regenerated from it.
 *
 *   node merge-clip-gender.mjs
 *   node gen-situational-clips.mjs
 *
 * ── Why deriving this from the id is legitimate here ─────────────────────────
 *
 * Elsewhere in this pipeline, inferring a property from a clip's NAME was exactly
 * the bug: the old director guessed motion size from keywords and mislabelled 37
 * arm-throwing clips as head beats. Size is a physical fact the name does not carry,
 * so it had to be measured.
 *
 * Gender presentation is different in kind. It is not a hidden physical property —
 * it is an explicit authorial marker. Whoever built the packs deliberately named
 * these clips `*_feminine_*` / `*_masculine_*`, and the "when to use" text confirms
 * it independently ("When female and attentive"). Reading that token is reading the
 * author's own declaration, not guessing.
 *
 * Two safeguards so it stays a declaration rather than a heuristic:
 *   - the token is matched on `_` boundaries, never as a substring
 *   - a clip matching BOTH markers is an error, not a silent coin-flip
 *
 * Everything unmarked stays null, i.e. suitable for any character. That is 111 of
 * 130 clips — gender BIASES selection, it does not partition the pack.
 */

import fs   from 'node:fs'
import path from 'node:path'

const here    = import.meta.dirname
const mapFile = path.join(here, 'situational-mapping.json')
const mapping = JSON.parse(fs.readFileSync(mapFile, 'utf8'))

const FEMININE = /(^|_)feminine(_|$)/
const MASCULINE = /(^|_)masculine(_|$)/

mapping.genders = ['feminine', 'masculine']

const counts = { feminine: 0, masculine: 0, none: 0 }
const conflicts = []

for (const pack of Object.values(mapping.packs)) {
  for (const clip of pack.clips) {
    const fem = FEMININE.test(clip.id)
    const masc = MASCULINE.test(clip.id)
    if (fem && masc) { conflicts.push(clip.id); continue }
    clip.gender = fem ? 'feminine' : masc ? 'masculine' : null
    counts[clip.gender ?? 'none']++
  }
}

if (conflicts.length > 0) {
  console.error(`clip marked both feminine AND masculine: ${conflicts.join(', ')}`)
  process.exit(1)
}

fs.writeFileSync(mapFile, JSON.stringify(mapping, null, 2) + '\n')
console.log(`merged gender into ${path.relative(process.cwd(), mapFile)} — ` +
  `${counts.feminine} feminine, ${counts.masculine} masculine, ${counts.none} unmarked`)
