/**
 * avatar-engine — public barrel export
 *
 * All three Evolve Simulations products import from this single entry point:
 *
 *   import { AvatarCanvas, useAvatarEngine, AvatarEngine } from '@evolve/avatar-engine'
 *
 * ─── Quick start (EvySim B2C example) ────────────────────────────────────────
 *
 *   const engine = useAvatarEngine({
 *     tts: { provider: 'elevenlabs', elevenlabs: { signedUrlEndpoint: '/api/signed-url' } },
 *     virtualDirector: { endpoint: '...', apiKey: 'Bearer sk-...' },
 *   })
 *
 *   <AvatarCanvas engine={engine} glbUrl="/avatars/evysim-coach.glb" lightingPreset="consumer" />
 *
 *   await engine.handleDialogue("Let's practise your pitch.")
 *
 * ─── Architecture overview ───────────────────────────────────────────────────
 *
 *   AvatarEngine orchestrates:
 *     AnimationDictionary   — binary GLB with all skeletal clips
 *     EmotionStateMachine   — persistent FACS→ARKit state (anger stays angry)
 *     VirtualDirector       — secondary LLM → PerformanceData JSON
 *     SkeletalController    — AnimationMixer + WordBoundary gesture triggers
 *     FFTFallback           — WebAudio amplitude fallback for lip-sync
 *     TTSAdapter            — Azure / ElevenLabs / Mascotbot
 *
 *   AvatarCanvas useFrame loop:
 *     viseme queue drain → ARKit viseme weights
 *     emotion.effectiveWeights(isSpeaking) → attenuated baseline
 *     additiveBlend(emotion, viseme, procedural) → final weights
 *     lerpWeightMap → smooth organic transitions
 *     applyWeightsToMeshes → morphTargetInfluences
 *     procedural: blink, saccades, respiration, head tracking
 *     skeletalController.update → AnimationMixer
 */

// ── Primary component ─────────────────────────────────────────────────────────
export { AvatarCanvas }              from './AvatarCanvas'
export type { AvatarCanvasProps }    from './AvatarCanvas'

// ── Primary hook ──────────────────────────────────────────────────────────────
export { useAvatarEngine }           from './use-avatar-engine'

// ── Engine class (for advanced consumers) ────────────────────────────────────
export { AvatarEngine }              from './avatar-engine'
export type { AvatarEngineConfig }   from './avatar-engine'

// ── Emotion system ────────────────────────────────────────────────────────────
export { EmotionStateMachine, emotionStateMachine } from './emotion-state'
export type { EmotionId, ARKitWeights, EmotionState } from './emotion-state'

// ── Virtual Director ──────────────────────────────────────────────────────────
export { VirtualDirector }           from './virtual-director'
export type {
  PerformanceData,
  GestureCue,
  VirtualDirectorConfig,
}                                    from './virtual-director'

// ── Animation dictionary ──────────────────────────────────────────────────────
export { AnimationDictionary, animationDictionary, ANIMATION_MANIFEST } from './animation-dictionary'
export type { AnimationEntry }       from './animation-dictionary'

// ── Skeletal controller ───────────────────────────────────────────────────────
export { SkeletalController }        from './skeletal-controller'

// ── TTS adapters ──────────────────────────────────────────────────────────────
export {
  createTTSAdapter,
  AzureTTSAdapter,
  ElevenLabsAdapter,
  MascotbotAdapter,
}                                    from './tts-adapter'
export type {
  TTSAdapter,
  TTSProviderName,
  TTSAdapterFactoryConfig,
  AzureAdapterConfig,
  ElevenLabsAdapterConfig,
  MascotbotAdapterConfig,
}                                    from './tts-adapter'

// ── FFT fallback ──────────────────────────────────────────────────────────────
export { FFTFallback }               from './fft-fallback'

// ── Additive blend utilities ──────────────────────────────────────────────────
export {
  additiveBlend,
  lerpWeight,
  lerpWeightMap,
  applyWeightsToMeshes,
}                                    from './additive-blend'

// ── Procedural animation utilities ───────────────────────────────────────────
export {
  tickOcularMechanics,
  tickRespiration,
  tickHeadTracking,
  fixTPose,
  findBone,
}                                    from './procedural-animations'

// ── Viseme map ────────────────────────────────────────────────────────────────
export {
  VISEME_TO_ARKIT,
  ALL_VISEME_NAMES,
  JAW_OPEN_SHAPES,
  AVATURN_MESH_NAMES,
}                                    from './viseme-map'

// ── Shared types ──────────────────────────────────────────────────────────────
export type {
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

// ── Legacy hook (kept for backwards compat) ───────────────────────────────────
export { useSimulation }             from './use-simulation'
export type { UseSimulationReturn }  from './use-simulation'
