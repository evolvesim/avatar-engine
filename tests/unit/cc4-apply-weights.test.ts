import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { applyWeightsToMeshes } from '../../src/core/additive-blend'
import { ARKIT_TO_CC4, isCC4Dictionary } from '../../src/core/cc4-morph-alias'

// Minimal stand-in for a loaded SkinnedMesh: only morphTargetDictionary and
// morphTargetInfluences are read by applyWeightsToMeshes.
function makeMesh(morphNames: string[]): THREE.SkinnedMesh {
  const mesh = Object.create(THREE.SkinnedMesh.prototype) as THREE.SkinnedMesh
  mesh.morphTargetDictionary = Object.fromEntries(morphNames.map((n, i) => [n, i]))
  mesh.morphTargetInfluences = new Array(morphNames.length).fill(0)
  return mesh
}

// The morphs a real CC4 export carries (subset of CC_Base_Body, verified
// against an actual CC4 GLB dump). Includes the probe keys so the alias layer
// detects the mesh as CC4.
const CC4_MORPHS = [
  'V_Open', 'V_Explosive', 'V_Dental_Lip', 'V_Tight_O', 'V_Tight', 'V_Wide',
  'V_Affricate', 'V_Lip_Open', 'Jaw_Open', 'Mouth_Close',
  'Eye_Blink_L', 'Eye_Blink_R', 'Mouth_Smile_L', 'Mouth_Smile_R',
]

describe('applyWeightsToMeshes on CC4 rigs (aliased-name collisions)', () => {
  it('detects the fixture dictionary as CC4', () => {
    const mesh = makeMesh(CC4_MORPHS)
    expect(isCC4Dictionary(mesh.morphTargetDictionary)).toBe(true)
  })

  it('keeps the strongest weight when two ARKit names alias to one CC4 morph', () => {
    // viseme_aa (primary open vowel, strong) and mouthOpen (support, weak)
    // BOTH alias to V_Open. The strong primary must win regardless of key order.
    expect(ARKIT_TO_CC4['viseme_aa']).toBe('V_Open')
    expect(ARKIT_TO_CC4['mouthOpen']).toBe('V_Open')

    const primaryFirst = makeMesh(CC4_MORPHS)
    applyWeightsToMeshes({ viseme_aa: 0.52, mouthOpen: 0.16 }, { m: primaryFirst })
    expect(primaryFirst.morphTargetInfluences![0]).toBeCloseTo(0.52)

    const supportFirst = makeMesh(CC4_MORPHS)
    applyWeightsToMeshes({ mouthOpen: 0.16, viseme_aa: 0.52 }, { m: supportFirst })
    expect(supportFirst.morphTargetInfluences![0]).toBeCloseTo(0.52)
  })

  it('zeroes a shared morph when every aliased source is zero', () => {
    const mesh = makeMesh(CC4_MORPHS)
    applyWeightsToMeshes({ viseme_aa: 0.52, mouthOpen: 0.16 }, { m: mesh })
    applyWeightsToMeshes({ viseme_aa: 0, mouthOpen: 0 }, { m: mesh })
    expect(mesh.morphTargetInfluences![0]).toBe(0)
  })

  it('resolves rounded-vowel collisions (viseme_O / viseme_U / viseme_RR → V_Tight_O)', () => {
    const mesh = makeMesh(CC4_MORPHS)
    const idx = mesh.morphTargetDictionary!['V_Tight_O']
    applyWeightsToMeshes({ viseme_O: 0.6, viseme_U: 0.1, viseme_RR: 0 }, { m: mesh })
    expect(mesh.morphTargetInfluences![idx]).toBeCloseTo(0.6)
  })

  it('still writes distinct ARKit morphs 1:1 on non-CC4 rigs', () => {
    const mesh = makeMesh(['viseme_aa', 'mouthOpen', 'jawOpen'])
    applyWeightsToMeshes({ viseme_aa: 0.52, mouthOpen: 0.16, jawOpen: 0.3 }, { m: mesh })
    expect(mesh.morphTargetInfluences).toEqual([0.52, 0.16, 0.3])
  })
})
