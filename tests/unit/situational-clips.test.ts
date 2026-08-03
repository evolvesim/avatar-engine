/**
 * The situational clip registry, and the invariant that emotion no longer picks
 * body clips.
 *
 * Replaces mixamo-idle-pools.test.ts, which pinned the old per-emotion idle
 * tables. Those tables are gone: emotion is a facial state now, and body clips
 * are chosen by what they do in dialogue.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  SITUATIONAL_CLIPS, CLIP_FUNCTIONS, CLIP_MANNERS, CLIP_SCALES, SCALE_ORDER, IDLE_CLIP_IDS,
  clipInfo, isIdleClip, clipsForFunction, idlesForManner, isUncharacterisedClip,
  isOffGenderClip, CLIP_GENDERS,
} from '../../src/core/situational-clips'
import type { ClipManner } from '../../src/core/situational-clips'

const ROOT = path.resolve(__dirname, '../..')
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/situational-mapping.json'), 'utf8'))
const mapped = Object.values(mapping.packs).flatMap((p: any) => p.clips) as any[]

describe('generated registry matches its source mapping', () => {
  // Guards against committing a stale situational-clips.ts after editing the JSON.
  it('has exactly the mapped clips', () => {
    expect(Object.keys(SITUATIONAL_CLIPS).sort()).toEqual(mapped.map(c => c.id).sort())
  })

  it('preserves kind, functions and manner for every clip', () => {
    for (const c of mapped) {
      const got = SITUATIONAL_CLIPS[c.id]
      expect(got, c.id).toBeDefined()
      expect(got.kind, c.id).toBe(c.kind)
      expect(got.functions, c.id).toEqual(c.functions)
      expect(got.manner, c.id).toEqual(c.manner)
      expect(got.when, c.id).toBe(c.when)
    }
  })

  it('declares the same vocabularies', () => {
    expect([...CLIP_FUNCTIONS]).toEqual(mapping.functions)
    expect([...CLIP_MANNERS]).toEqual(mapping.manners)
  })

  it('uses only declared functions and manners', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      for (const f of c.functions) expect(CLIP_FUNCTIONS, c.id).toContain(f)
      for (const m of c.manner)    expect(CLIP_MANNERS, c.id).toContain(m)
    }
  })
})

describe('coverage', () => {
  it('every declared function has at least one clip', () => {
    for (const fn of CLIP_FUNCTIONS) {
      expect(clipsForFunction(fn).length, `no clip serves "${fn}"`).toBeGreaterThan(0)
    }
  })

  // Without a rest clip the avatar has nothing to return to after a gesture.
  it('every pack can rest — at least one rest idle per pack', () => {
    for (const [key, pack] of Object.entries(mapping.packs) as [string, any][]) {
      const rests = pack.clips.filter((c: any) => c.kind === 'idle' && c.functions.includes('rest'))
      expect(rests.length, `${key} has no rest idle`).toBeGreaterThan(0)
    }
  })

  it('every clip serves at least one function', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      expect(c.functions.length, c.id).toBeGreaterThan(0)
    }
  })
})

describe('isIdleClip', () => {
  it('is true for every registry idle and false for every registry gesture', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      expect(isIdleClip(c.id), c.id).toBe(c.kind === 'idle')
    }
  })

  it('IDLE_CLIP_IDS holds exactly the idles', () => {
    const idles = Object.values(SITUATIONAL_CLIPS).filter(c => c.kind === 'idle').map(c => c.id)
    expect([...IDLE_CLIP_IDS].sort()).toEqual(idles.sort())
  })

  // A legacy pack's idles must still loop, or they crossfade through the bind
  // pose and flash a T-pose.
  it('falls back to a name heuristic for unregistered clips', () => {
    expect(isIdleClip('mx_m_standard_idle')).toBe(true)
    expect(isIdleClip('mcu_neutral_stand_idle_01')).toBe(true)
    expect(isIdleClip('rpm2_idle_var_004')).toBe(true)
    expect(isIdleClip('cc4_c_breathing_loop')).toBe(true)
    expect(isIdleClip('some_unknown_gesture')).toBe(false)
  })

  it('does not let the heuristic override a registered gesture', () => {
    // A registered gesture whose name happens to contain "idle" must stay a gesture.
    const trap = Object.values(SITUATIONAL_CLIPS)
      .find(c => c.kind === 'gesture' && /idle/i.test(c.id))
    if (trap) expect(isIdleClip(trap.id), trap.id).toBe(false)
  })
})

describe('clipInfo', () => {
  it('returns undefined for an unmapped clip rather than throwing', () => {
    expect(clipInfo('not_a_clip')).toBeUndefined()
  })
})

describe('emotion no longer selects body clips', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'src/core/skeletal-controller.ts'), 'utf8')

  it('has no live per-emotion idle pool tables', () => {
    // Only the explanatory comment should mention the old symbol.
    const live = controller.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(live).not.toContain('EMOTION_IDLE_POOLS')
    expect(live).not.toContain('MIXAMO_IDLES')
    expect(live).not.toContain('CC4_IDLES')
  })

  it('picks idles without an emotion argument', () => {
    expect(controller).toContain('private _pickNextIdle(): string')
    expect(controller).not.toMatch(/_pickNextIdle\(this\.currentEmotion\)/)
  })

  it('onEmotionChange does not restart the body idle', () => {
    const fn = controller.slice(controller.indexOf('onEmotionChange(emotion: EmotionId)'))
      .slice(0, 400)
    expect(fn).not.toContain('_playIdle')
  })
})

// ── Measured motion size ─────────────────────────────────────────────────────

describe('clip scale is measured, not guessed', () => {
  it('bands every clip and keeps the raw measurement alongside', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      expect(CLIP_SCALES, c.id).toContain(c.scale)
      expect(typeof c.armDeg, c.id).toBe('number')
      expect(typeof c.bodyDeg, c.id).toBe('number')
    }
  })

  it('agrees with the mapping the registry was generated from', () => {
    for (const pack of Object.values(mapping.packs) as { clips: Record<string, unknown>[] }[]) {
      for (const clip of pack.clips) {
        const reg = SITUATIONAL_CLIPS[clip['id'] as string]
        expect(reg.scale, reg.id).toBe(clip['scale'])
        expect(reg.armDeg, reg.id).toBe(clip['armDeg'])
      }
    }
  })

  it('bands consistently with the recorded thresholds', () => {
    const { subtleMax, moderateMax } = mapping.scaleThresholds
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      const expected = c.armDeg <= subtleMax ? 'subtle' : c.armDeg <= moderateMax ? 'moderate' : 'broad'
      expect(c.scale, `${c.id} @ ${c.armDeg}°`).toBe(expected)
    }
  })

  it('contradicts what a name-keyword classifier would have concluded', () => {
    // The whole reason for measuring: names carry no reliable signal. Neither of
    // these ids mentions an arm or a hand, and both are full arm throws.
    expect(SITUATIONAL_CLIPS['cc_bashful_look_at_ground'].scale).toBe('broad')
    expect(SITUATIONAL_CLIPS['cc_look_at_hand_and_nails'].scale).toBe('broad')
    // And these do read as small, correctly.
    expect(SITUATIONAL_CLIPS['cc_head_nod'].scale).toBe('subtle')
    expect(SITUATIONAL_CLIPS['cc_neutral_idle'].scale).toBe('subtle')
  })

  it('narrows candidates by maxScale and can order smallest-first', () => {
    const all = clipsForFunction('explaining', 'gesture')
    const small = clipsForFunction('explaining', 'gesture', { maxScale: 'moderate' })
    expect(small.length).toBeLessThan(all.length)
    for (const c of small) expect(SCALE_ORDER[c.scale]).toBeLessThanOrEqual(SCALE_ORDER['moderate'])

    const ordered = clipsForFunction('explaining', 'gesture', { smallestFirst: true }).map(c => c.armDeg)
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b))
  })
})

// ── Characterised resting poses have to be earned ────────────────────────────
//
// The reported symptom: a car-sales avatar repeatedly dropping into the "tired"
// idle in a conversation that never called for it. The CC pack has 18 resting poses
// and 9 carry a manner, and the picker drew uniformly from all of them — so every
// re-roll was a coin flip on standing there characterised for no reason.
describe('idlesForManner', () => {
  it('returns only uncharacterised poses when nothing is allowed', () => {
    const idles = idlesForManner([])
    expect(idles.length).toBeGreaterThan(0)
    for (const c of idles) {
      expect(c.manner, c.id).toEqual([])
      expect(c.kind).toBe('idle')
    }
  })

  it('excludes the tired / wary / detached poses at neutral', () => {
    const ids = new Set(idlesForManner([]).map(c => c.id))
    // These are exactly the poses that were showing up unbidden.
    expect(ids.has('cc_slouched')).toBe(false)              // "When tired"
    expect(ids.has('cc_side_eye')).toBe(false)              // "When wary or scared"
    expect(ids.has('cc_crossed_arms_looking_down')).toBe(false) // "When detached"
    expect(ids.has('cc_masculine_look_around')).toBe(false) // "When uncomfortable"
  })

  it('keeps the standard attentive poses available at neutral', () => {
    const ids = new Set(idlesForManner([]).map(c => c.id))
    expect(ids.has('cc_idle_standard')).toBe(true)
    expect(ids.has('cc_neutral_idle')).toBe(true)
    expect(ids.has('cc_masculine_idle')).toBe(true)
    expect(ids.has('cc_feminine_idle')).toBe(true)
  })

  it('admits a pose once its manner is allowed', () => {
    const downcast = idlesForManner(['downcast']).map(c => c.id)
    expect(downcast).toContain('cc_slouched')
    // Allowing one manner must not admit the others.
    expect(downcast).not.toContain('cc_side_eye')
  })

  it('leaves a workable pool for every emotion the controller maps', () => {
    // Each list in EMOTION_IDLE_MANNERS must yield at least the uncharacterised
    // set, so no feeling can strand the avatar without a resting pose.
    const lists: readonly ClipManner[][] = [
      [], ['relaxed', 'elated'], ['guarded'], ['downcast'],
      ['guarded', 'agitated'], ['shy', 'guarded'], ['relaxed'],
    ]
    for (const allowed of lists) {
      expect(idlesForManner([...allowed, 'formal']).length, allowed.join('+')).toBeGreaterThanOrEqual(4)
    }
  })

  it('never filters gestures — manner gates rest only', () => {
    for (const c of idlesForManner(CLIP_MANNERS)) expect(c.kind).toBe('idle')
  })
})

describe('isUncharacterisedClip', () => {
  it('is true only for clips with no manner', () => {
    expect(isUncharacterisedClip('cc_idle_standard')).toBe(true)
    expect(isUncharacterisedClip('cc_slouched')).toBe(false)
    expect(isUncharacterisedClip('not_a_clip')).toBe(false)
  })
})

describe('the idle picker is context-aware and anti-repeat', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'src/core/skeletal-controller.ts'), 'utf8')

  it('gates resting poses on the sustained feeling', () => {
    expect(controller).toContain('EMOTION_IDLE_MANNERS')
    expect(controller).toContain('idlesForManner')
  })

  it('maps every emotion in the palette', () => {
    const block = controller.slice(
      controller.indexOf('EMOTION_IDLE_MANNERS'),
      controller.indexOf('ALWAYS_ALLOWED_IDLE_MANNERS'),
    )
    for (const e of ['neutral', 'happy', 'thoughtful', 'sadness', 'displeasure', 'shy', 'empathy']) {
      expect(block, e).toContain(`${e}:`)
    }
  })

  it('remembers more than just the current idle', () => {
    // Avoiding only the current clip is what let a pool cycle back around every
    // few picks and read as "the same idle again".
    expect(controller).toContain('IDLE_HISTORY')
    expect(controller).toContain('recentIdleIds')
    expect(controller).toContain('_noteIdlePlayed')
  })

  it('still does not take an emotion argument', () => {
    // Emotion decides which MANNERS are eligible, never a specific clip.
    expect(controller).toContain('private _pickNextIdle(): string')
  })
})

// ── Gender bias ──────────────────────────────────────────────────────────────
//
// A male CC character was seen playing cc_feminine_head_up and then
// cc_masculine_idle in the same sequence. The packs are ungendered by design, but a
// minority of clips carry an explicit authorial marker and those should follow the
// character.
describe('clip gender', () => {
  it('marks exactly the clips the author named, and nothing else', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      if (/(^|_)feminine(_|$)/.test(c.id)) expect(c.gender, c.id).toBe('feminine')
      else if (/(^|_)masculine(_|$)/.test(c.id)) expect(c.gender, c.id).toBe('masculine')
      else expect(c.gender, c.id).toBeNull()
    }
  })

  it('leaves the large majority unmarked, so this biases rather than partitions', () => {
    const total = Object.keys(SITUATIONAL_CLIPS).length
    const marked = Object.values(SITUATIONAL_CLIPS).filter(c => c.gender != null).length
    expect(marked).toBe(19)
    // Well under a fifth. If this ever crossed half, "bias" would be the wrong word
    // and the never-strand guards below would start doing real work every turn.
    expect(marked / total).toBeLessThan(0.2)
  })

  it('agrees with the mapping it was generated from', () => {
    for (const pack of Object.values(mapping.packs) as { clips: Record<string, unknown>[] }[]) {
      for (const clip of pack.clips) {
        const reg = SITUATIONAL_CLIPS[clip['id'] as string]
        expect(reg.gender, reg.id).toBe(clip['gender'] ?? null)
      }
    }
  })

  it('uses only the declared gender vocabulary', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      if (c.gender != null) expect(CLIP_GENDERS).toContain(c.gender)
    }
  })
})

describe('isOffGenderClip', () => {
  it('rejects only an explicitly opposite-marked clip', () => {
    expect(isOffGenderClip('cc_feminine_head_up', 'masculine')).toBe(true)
    expect(isOffGenderClip('cc_masculine_idle', 'feminine')).toBe(true)
    expect(isOffGenderClip('cc_feminine_head_up', 'feminine')).toBe(false)
    expect(isOffGenderClip('cc_masculine_idle', 'masculine')).toBe(false)
  })

  it('never rejects an unmarked clip', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      if (c.gender != null) continue
      expect(isOffGenderClip(c.id, 'masculine'), c.id).toBe(false)
      expect(isOffGenderClip(c.id, 'feminine'), c.id).toBe(false)
    }
  })

  it('applies no bias at all without a gender — the non-binary case', () => {
    for (const c of Object.values(SITUATIONAL_CLIPS)) {
      expect(isOffGenderClip(c.id, null), c.id).toBe(false)
      expect(isOffGenderClip(c.id), c.id).toBe(false)
    }
  })

  it('is false for an unknown id rather than throwing', () => {
    expect(isOffGenderClip('not_a_clip', 'feminine')).toBe(false)
  })

  it('leaves a workable idle pool for either gender at neutral', () => {
    // The bias must not strand the avatar. Neutral is the strictest manner case, so
    // if it survives there it survives everywhere.
    for (const gender of CLIP_GENDERS) {
      for (const prefix of ['cc_', 'av_']) {
        const pool = idlesForManner(['formal'])
          .filter(c => c.id.startsWith(prefix) && !isOffGenderClip(c.id, gender))
        expect(pool.length, `${prefix}${gender}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('the controller applies the gender bias', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'src/core/skeletal-controller.ts'), 'utf8')

  it('filters idle candidates by gender', () => {
    expect(controller).toContain('isOffGenderClip')
    expect(controller).toContain('setGenderBias')
  })

  it('drops the bias before the last-resort fallback', () => {
    // Resting in an off-gender pose beats standing frozen.
    const fn = controller.slice(controller.indexOf('private _pickNextIdle()'))
      .slice(0, 2000)
    expect(fn).toMatch(/Drop the gender bias/)
  })
})
