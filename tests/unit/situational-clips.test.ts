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
  SITUATIONAL_CLIPS, CLIP_FUNCTIONS, CLIP_MANNERS, IDLE_CLIP_IDS,
  clipInfo, isIdleClip, clipsForFunction,
} from '../../src/core/situational-clips'

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
