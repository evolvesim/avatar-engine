/**
 * core/index.ts — re-exports the pure engine surface (no TTS imports here).
 */

// Primary component + hook
export { AvatarCanvas, DEFAULT_FACE_RIG_URL } from './AvatarCanvas'
export type { AvatarCanvasProps }    from './AvatarCanvas'

// Runtime face-rig merge (consumed by product upload pipelines)
export {
  mergeFaceRig,
  hasFaceRig,
  FACE_MESH_NAMES,
  CANONICAL_IDLE_CLIP,
}                                    from './merge-face-rig'
export { useAvatarEngine }           from './use-avatar-engine'

// Engine class
export { AvatarEngine }              from './avatar-engine'
export type { AvatarEngineConfig }   from './avatar-engine'

// Emotion system
export { EmotionStateMachine, emotionStateMachine } from './emotion-state'
export type { EmotionId, ARKitWeights, EmotionState } from './emotion-state'

// Virtual Director
export { VirtualDirector }           from './virtual-director'
export type {
  PerformanceData,
  GestureCue,
  VirtualDirectorConfig,
}                                    from './virtual-director'

// Animation dictionary
export {
  AnimationDictionary,
  animationDictionary,
  ANIMATION_MANIFEST,
}                                    from './animation-dictionary'
export type { AnimationEntry }       from './animation-dictionary'

// Skeletal controller
export { SkeletalController }        from './skeletal-controller'

// FFT fallback
export { FFTFallback }               from './fft-fallback'

// Additive blend utilities
export {
  additiveBlend,
  lerpWeight,
  lerpWeightMap,
  applyWeightsToMeshes,
}                                    from './additive-blend'

// Procedural animation utilities
export {
  tickOcularMechanics,
  tickRespiration,
  tickHeadTracking,
  fixTPose,
  findBone,
}                                    from './procedural-animations'

// Viseme map
export {
  VISEME_TO_ARKIT,
  ALL_VISEME_NAMES,
  JAW_OPEN_SHAPES,
  AVATURN_MESH_NAMES,
  VISEME_SUPPORT,
  buildVisemeTargets,
}                                    from './viseme-map'
export type { VisemeSupport }        from './viseme-map'

// Shared types — including the new TTSAdapter contract
export type {
  TTSAdapter,
  AvatarCallbacks,
  DirectorConfig,
  VisemeEvent,
  CameraPreset,
  CameraConfig,
  LightingPreset,
  AzureTTSOptions,
  SimulationStatus,
  TranscriptEntry,
  SimulationState,
  UseSimulationOptions,
}                                    from './types'

export { CAMERA_PRESETS }            from './types'

// Legacy hook (kept for backwards compat)
export { useSimulation }             from './use-simulation'
export type { UseSimulationReturn }  from './use-simulation'
