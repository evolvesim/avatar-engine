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

import { ARKIT_TO_CC4, ARKIT_TO_CC4_PAIRS, isCC4Dictionary } from './cc4-morph-alias'

/**
 * Per-mesh cache: has this mesh been detected as CC4? Populated once on first
 * apply, then reused for the mesh's lifetime. Uses WeakMap so meshes GC'd on
 * avatar swap don't leak.
 */
const cc4MeshCache = new WeakMap<THREE.SkinnedMesh, boolean>()

/**
 * Resolve a target morph-target index for a given ARKit name on a given mesh.
 * On CC4 avatars, first tries the CC4-aliased name (and paired L+R names when
 * the ARKit key is unified). On ARKit/Avaturn avatars, uses the ARKit name
 * directly. Returns the list of indices to write (may be 0, 1, or many).
 */
function resolveMorphIndices(
  mesh: THREE.SkinnedMesh,
  arkitName: string,
): number[] {
  const dict = mesh.morphTargetDictionary!

  // Detect + cache CC4-ness once per mesh.
  let isCC4 = cc4MeshCache.get(mesh)
  if (isCC4 === undefined) {
    isCC4 = isCC4Dictionary(dict)
    cc4MeshCache.set(mesh, isCC4)
  }

  // Direct hit — most common on ARKit/Avaturn avatars, but also possible on
  // CC4 for names that happen to match (e.g. 'Mouth_Close' is already CC4
  // named). Take the fast path.
  const direct = dict[arkitName]
  if (direct !== undefined) return [direct]

  if (!isCC4) return []

  // CC4 avatar: consult paired alias first (some ARKit shapes are unified
  // L+R but CC4 splits them). If not paired, fall back to single alias.
  const paired = ARKIT_TO_CC4_PAIRS[arkitName]
  if (paired) {
    const indices: number[] = []
    for (const cc4Name of paired) {
      const idx = dict[cc4Name]
      if (idx !== undefined) indices.push(idx)
    }
    if (indices.length > 0) return indices
  }

  const single = ARKIT_TO_CC4[arkitName]
  if (single) {
    const idx = dict[single]
    if (idx !== undefined) return [idx]
  }

  return []
}

/**
 * Apply the final running weights to Three.js mesh morphTargetInfluences.
 *
 * Called once per frame after all blending is complete.
 *
 * Handles both ARKit (Avaturn/RPM) and CC4 Standard (Character Creator 4)
 * morph naming automatically per-mesh. See `cc4-morph-alias.ts` for the
 * full ARKit → CC4 rename table.
 *
 * @param weights     Final blended + lerped weight map (ARKit names)
 * @param meshRefs    Record of mesh names → SkinnedMesh objects
 *                    (e.g. { Head_Mesh, Teeth_Mesh, Tongue_Mesh, ... })
 */
export function applyWeightsToMeshes(
  weights:  ARKitWeights,
  meshRefs: Record<string, THREE.SkinnedMesh | null>
): void {
  for (const mesh of Object.values(meshRefs)) {
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) continue
    // CC4 aliasing is many-ARKit-names-to-one-CC4-morph (e.g. `viseme_aa` AND
    // `mouthOpen` both land on `V_Open`; `viseme_O`/`viseme_U`/`viseme_RR` all
    // land on `V_Tight_O`). A plain per-name assignment lets whichever aliased
    // key happens to be enumerated last clobber the earlier one — a weak 0.16
    // support shape silently overwrote the 0.52 primary vowel every frame,
    // which is why CC4 mouths barely moved. Resolve every name first, keep the
    // strongest weight per morph index, then write once. On ARKit/Avaturn
    // rigs every name is a distinct index, so this is behaviour-identical.
    const resolved = new Map<number, number>()
    for (const [name, value] of Object.entries(weights)) {
      const indices = resolveMorphIndices(mesh, name)
      const v = value ?? 0
      for (const idx of indices) {
        const prev = resolved.get(idx)
        if (prev === undefined || v > prev) resolved.set(idx, v)
      }
    }
    for (const [idx, v] of resolved) {
      mesh.morphTargetInfluences[idx] = v
    }
  }
}


