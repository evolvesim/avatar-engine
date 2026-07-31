import { describe, it, expect } from 'vitest'
import { LIGHTING_RIGS } from '../../src/core/AvatarCanvas'

/**
 * Per-product lighting isolation.
 *
 * Each product owns its own rig, and taking an engine update must never move
 * another product's lights. ACTS in particular has positioned its own lighting,
 * so these values and positions are pinned: if someone tunes Evolve Sim and
 * accidentally drags ACTS or RPG along, this fails.
 *
 * The pinned numbers are main's (avatar-engine 0.5.35) — what those products
 * render today.
 */
const MAIN_0_5_35 = {
  'acts-education': { ambient: '#e8f5e9', ambientIntensity: 0.70, key: '#ffffff', keyIntensity: 1.50, fill: '#aed6f1', fillIntensity: 0.50 },
  'evolve-rpg':     { ambient: '#c7a8f5', ambientIntensity: 0.70, key: '#ffffff', keyIntensity: 1.60, fill: '#8e44ad', fillIntensity: 0.40 },
} as const

describe('per-product lighting rigs', () => {
  it('defines exactly the three products', () => {
    expect(Object.keys(LIGHTING_RIGS).sort()).toEqual(
      ['acts-education', 'evolve-rpg', 'evolve-sim'],
    )
  })

  for (const [product, expected] of Object.entries(MAIN_0_5_35)) {
    describe(product, () => {
      const rig = LIGHTING_RIGS[product as keyof typeof MAIN_0_5_35]

      it('keeps main 0.5.35 colours and intensities', () => {
        expect(rig.ambient).toBe(expected.ambient)
        expect(rig.ambientIntensity).toBeCloseTo(expected.ambientIntensity, 5)
        expect(rig.key).toBe(expected.key)
        expect(rig.keyIntensity).toBeCloseTo(expected.keyIntensity, 5)
        expect(rig.fill).toBe(expected.fill)
        expect(rig.fillIntensity).toBeCloseTo(expected.fillIntensity, 5)
      })

      it('keeps the original light positions', () => {
        expect(rig.keyPosition).toEqual([2, 4, 3])
        expect(rig.fillPosition).toEqual([-2, 2, -1])
      })

      it('does not opt into face-relative aiming', () => {
        // followFace false is what makes the placement collapse to the original
        // origin-aimed geometry. Flipping it would silently move their lights.
        expect(rig.followFace).toBe(false)
      })

      it('has no rim light (main had none)', () => {
        expect(rig.rimIntensity).toBe(0)
      })
    })
  }

  describe('evolve-sim', () => {
    const rig = LIGHTING_RIGS['evolve-sim']

    it('carries the dialled-in values', () => {
      expect(rig.ambientIntensity).toBeCloseTo(0.37, 5)
      expect(rig.keyIntensity).toBeCloseTo(1.50, 5)
      expect(rig.fillIntensity).toBeCloseTo(0.40, 5)
      expect(rig.rimIntensity).toBeCloseTo(0.24, 5)
    })

    it('is the only product using face-relative aiming', () => {
      // Its CC5 bodies stand at full height with the camera raised to eye level,
      // so lights aimed at the world origin would miss the face entirely.
      expect(rig.followFace).toBe(true)
      const others = Object.entries(LIGHTING_RIGS)
        .filter(([k]) => k !== 'evolve-sim')
        .map(([, v]) => v.followFace)
      expect(others).toEqual([false, false])
    })
  })
})
