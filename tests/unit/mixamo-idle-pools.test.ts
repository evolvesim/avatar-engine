/**
 * Guards the Mixamo idle pools against drifting from scripts/mixamo-mapping.json.
 *
 * The mapping file is the record of the hand-done mapping pass, and the pools in
 * skeletal-controller.ts are what the runtime actually uses. If the two disagree,
 * the Virtual Director rests on off-tone idles — the exact bug this mapping was
 * done to fix — and nothing else would catch it.
 *
 * The pools are module-private, so these tests read the source text. That is
 * deliberately blunt but it fails loudly on the thing that matters: an id present
 * in one place and absent from the other.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const mapping = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/mixamo-mapping.json'), 'utf8'),
) as {
  clips: Array<{
    cc5: string; mx: string; type: 'Idle' | 'Gesture'
    emotion: string | null; loop: string; keep: boolean; targetPitch?: number
  }>
}
const source = fs.readFileSync(path.join(ROOT, 'src/core/skeletal-controller.ts'), 'utf8')

/** The MIXAMO_IDLES table, parsed back out of the source. */
function parsePools(): Record<string, string[]> {
  const start = source.indexOf('const MIXAMO_IDLES')
  expect(start, 'MIXAMO_IDLES table not found in skeletal-controller.ts').toBeGreaterThan(-1)
  const body = source.slice(start, source.indexOf('\n}', start))
  const pools: Record<string, string[]> = {}
  for (const line of body.split('\n')) {
    const key = /^\s{2}([a-z]+):\s*\[/.exec(line)
    if (key) pools[key[1]] = []
    const current = Object.keys(pools).at(-1)
    if (!current) continue
    for (const [, id] of line.matchAll(/'((?:cc5|mx)_[a-z0-9_]+)'/g)) pools[current].push(id)
  }
  return pools
}

const keptIdles = mapping.clips.filter(c => c.keep && c.type === 'Idle')
const keptGestures = mapping.clips.filter(c => c.keep && c.type === 'Gesture')
const dropped = mapping.clips.filter(c => !c.keep)

describe('mixamo-mapping.json is internally consistent', () => {
  it('covers all 45 clips with a keep decision', () => {
    expect(mapping.clips).toHaveLength(45)
    expect(keptIdles.length + keptGestures.length + dropped.length).toBe(45)
  })

  it('gives every kept clip exactly one emotion, and dropped clips none', () => {
    for (const c of [...keptIdles, ...keptGestures]) {
      expect(c.emotion, `${c.cc5} is kept but has no emotion`).toBeTruthy()
    }
    for (const c of dropped) expect(c.emotion).toBeNull()
  })

  it('pairs every clip across both rigs with matching ids', () => {
    for (const c of mapping.clips) {
      expect(c.mx).toBe(c.cc5.replace(/^cc5_/, 'mx_'))
    }
  })

  it('keeps loop in step with type', () => {
    for (const c of mapping.clips) {
      expect(c.loop).toBe(c.type === 'Idle' ? 'loop' : 'once')
    }
  })

  it('gives every emotion in use at least one idle to rest on', () => {
    const emotions = new Set([...keptIdles, ...keptGestures].map(c => c.emotion))
    for (const e of emotions) {
      const idles = keptIdles.filter(c => c.emotion === e)
      expect(idles.length, `emotion "${e}" has gestures but no idle`).toBeGreaterThan(0)
    }
  })
})

describe('MIXAMO_IDLES matches the mapping', () => {
  const pools = parsePools()

  it('lists every kept idle, for both rigs, under its mapped emotion', () => {
    for (const c of keptIdles) {
      const pool = pools[c.emotion!]
      expect(pool, `no pool for emotion "${c.emotion}"`).toBeDefined()
      expect(pool, `${c.cc5} missing from the ${c.emotion} pool`).toContain(c.cc5)
      expect(pool, `${c.mx} missing from the ${c.emotion} pool`).toContain(c.mx)
    }
  })

  it('puts each idle in exactly one emotion pool', () => {
    const seen = new Map<string, string>()
    for (const [emotion, ids] of Object.entries(pools)) {
      for (const id of ids) {
        const prev = seen.get(id)
        expect(prev, `${id} is in both "${prev}" and "${emotion}" — an emotion would draw an off-tone idle`).toBeUndefined()
        seen.set(id, emotion)
      }
    }
  })

  it('contains no gesture and no dropped clip', () => {
    const all = Object.values(pools).flat()
    for (const c of keptGestures) {
      expect(all, `gesture ${c.cc5} is in an idle pool — it would loop instead of playing once`).not.toContain(c.cc5)
      expect(all, `gesture ${c.mx} is in an idle pool`).not.toContain(c.mx)
    }
    for (const c of dropped) {
      expect(all, `${c.cc5} was dropped but is still pooled`).not.toContain(c.cc5)
      expect(all, `${c.mx} was dropped but is still pooled`).not.toContain(c.mx)
    }
  })

  it('is the only place these ids appear in the controller', () => {
    // Any cc5_/mx_ id outside the MIXAMO_IDLES table means a stale hard-coded
    // reference survived — that is how the pools contradicted each other before.
    const table = source.slice(source.indexOf('const MIXAMO_IDLES'))
    const outside = source.replace(table, '')
    const strays = [...outside.matchAll(/'((?:cc5|mx)_[a-z0-9_]+)'/g)].map(m => m[1])
    expect(strays, `stray ids outside MIXAMO_IDLES: ${strays.join(', ')}`).toHaveLength(0)
  })
})
