/**
 * avatar-engine — public barrel export
 *
 * All three Evolve Simulations products import from this single entry point:
 *
 *   import { AvatarCanvas, useSimulation } from '@/packages/avatar-engine/src'
 *
 * or, once published as an npm workspace package:
 *
 *   import { AvatarCanvas, useSimulation } from '@evolve/avatar-engine'
 */

// ── Primary components ────────────────────────────────────────────────────────
export { AvatarCanvas } from './AvatarCanvas'

// ── Primary hooks ─────────────────────────────────────────────────────────────
export { useSimulation } from './use-simulation'
export type { UseSimulationReturn } from './use-simulation'

// ── Types (re-export everything — consumers may need any of these) ─────────────
export type {
  // Viseme
  VisemeEvent,

  // Camera
  CameraPreset,
  CameraConfig,

  // Lighting
  LightingPreset,

  // AvatarCanvas props
  AvatarCanvasProps,

  // TTS configuration
  AzureTTSOptions,

  // useSimulation options and state
  UseSimulationOptions,
  SimulationStatus,
  TranscriptEntry,
  SimulationState,
} from './types'

export { CAMERA_PRESETS } from './types'

// ── Viseme map (exposed for advanced consumers who want custom mapping) ────────
export {
  VISEME_TO_ARKIT,
  ALL_VISEME_NAMES,
  JAW_OPEN_SHAPES,
  AVATURN_MESH_NAMES,
} from './viseme-map'
