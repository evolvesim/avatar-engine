/**
 * additive-blend.ts — Additive blending engine
 *
 * Implements the research spec's formula for combining two simultaneous
 * ARKit blendshape systems without vertex tearing:
 *
 *   FinalWeight_key = min((E_w,key × α) + V_w,key, 1.0)
 *
 * Where:
 *   E_w,key = emotion baseline weight for blendshape key
 *   α       = speech attenuation factor (0.4–0.8)
 *             softens emotion during rapid speech to prioritise articulation
 *   V_w,key = viseme target weight for blendshape key
 *
 * The additive approach means emotions colour phonetic articulation without
 * conflict. A smiling avatar produces slightly rounded vowels; an angry
 * avatar produces slightly tightened consonants.
 *
 * This module is pure computation — no Three.js dependency — so it can be
 * unit tested without a WebGL context.
 */

import type * as THREE from 'three'
import type { ARKitWeights } from './emotion-state'

// ── Blending ──────────────────────────────────────────────────────────────────

/**
 * Compute the final ARKit blendshape weights for a single frame.
 *
 * @param emotionWeights    Current emotion baseline (from EmotionStateMachine.effectiveWeights())
 *                          Already attenuated by α — pass the attenuated form.
 * @param visemeWeights     Current viseme target weights (from VISEME_TO_ARKIT lookup)
 * @param proceduralWeights Optional procedural overlay (blink, saccade micro-corrections)
 *
 * @returns  Blended weight map, all values clamped to [0, 1]
 */
export function additiveBlend(
  emotionWeights:    ARKitWeights,
  visemeWeights:     ARKitWeights,
  proceduralWeights: ARKitWeights = {}
): ARKitWeights {
  const result: ARKitWeights = {}

  // Collect all keys from all three layers
  const allKeys = new Set([
    ...Object.keys(emotionWeights),
    ...Object.keys(visemeWeights),
    ...Object.keys(proceduralWeights),
  ])

  for (const key of allKeys) {
    const e = emotionWeights[key]    ?? 0
    const v = visemeWeights[key]     ?? 0
    const p = proceduralWeights[key] ?? 0
    // Clamp to [0, 1] — prevents vertex tearing on extreme combinations
    result[key] = Math.min(e + v + p, 1.0)
  }

  return result
}

// ── Lerp helpers ──────────────────────────────────────────────────────────────

/**
 * Exponential lerp for smooth ARKit transitions.
 * Avoids the strobe-like artifact of instant blendshape snapping.
 *
 * Standard Three.js lerp formula adapted for delta-time independence:
 *   current + (target - current) * (1 - e^(-speed * delta))
 *
 * @param current   Current blendshape value
 * @param target    Target blendshape value
 * @param delta     Seconds since last frame
 * @param speed     Higher = faster convergence. Default: 12 (per existing engine)
 */
export function lerpWeight(
  current: number,
  target:  number,
  delta:   number,
  speed:   number = 12
): number {
  return current + (target - current) * (1 - Math.exp(-speed * delta))
}

/**
 * Apply lerp across an entire ARKit weight map.
 * Handles keys that exist in target but not current (treated as 0),
 * and keys that exist in current but not target (lerp toward 0).
 *
 * @param current   Current running weights (mutated in place for performance)
 * @param target    Target weights from additiveBlend()
 * @param delta     Seconds since last frame
 * @param speed     Convergence speed
 *
 * @returns  The mutated current object (same reference)
 */
export function lerpWeightMap(
  current: ARKitWeights,
  target:  ARKitWeights,
  delta:   number,
  speed:   number = 12
): ARKitWeights {
  const allKeys = new Set([...Object.keys(current), ...Object.keys(target)])

  for (const key of allKeys) {
    const c = current[key] ?? 0
    const t = target[key]  ?? 0
    current[key] = lerpWeight(c, t, delta, speed)
    // Clean up near-zero values to avoid accumulating float dust
    if (Math.abs(current[key]!) < 0.001) current[key] = 0
  }

  return current
}

/**
 * Apply the final running weights to Three.js mesh morphTargetInfluences.
 *
 * Called once per frame after all blending is complete.
 *
 * @param weights     Final blended + lerped weight map
 * @param meshRefs    Record of mesh names → SkinnedMesh objects
 *                    (e.g. { Head_Mesh, Teeth_Mesh, Tongue_Mesh, ... })
 */
export function applyWeightsToMeshes(
  weights:  ARKitWeights,
  meshRefs: Record<string, THREE.SkinnedMesh | null>
): void {
  for (const mesh of Object.values(meshRefs)) {
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) continue
    for (const [name, value] of Object.entries(weights)) {
      const idx = mesh.morphTargetDictionary[name]
      if (idx !== undefined) {
        mesh.morphTargetInfluences[idx] = value ?? 0
      }
    }
  }
}


