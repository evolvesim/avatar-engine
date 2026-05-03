/**
 * avatar-engine.ts — Central orchestrator
 *
 * AvatarEngine is the single object that owns all subsystems and coordinates
 * their interaction. Products instantiate this once and pass it to the
 * AvatarCanvas and useAvatarEngine hook.
 *
 * Subsystems owned:
 *   - AnimationDictionary   (binary animation dictionary)
 *   - EmotionStateMachine   (persistent FACS→ARKit emotion state)
 *   - VirtualDirector       (secondary LLM cognitive pipeline)
 *   - SkeletalController    (AnimationMixer + WordBoundary sync)
 *   - FFTFallback           (WebAudio amplitude fallback)
 *   - TTSAdapter             (Azure / ElevenLabs / Mascotbot)
 *
 * Data flow per utterance:
 *
 *   1. Primary LLM generates dialogue string
 *   2. AvatarEngine.handleDialogue(text) is called
 *   3. CONCURRENT:
 *      a. TTSAdapter.speak(text) → audio plays
 *         → onViseme → visemeQueueRef (drained by AvatarCanvas useFrame)
 *         → onWordBoundary → SkeletalController (gesture triggers)
 *      b. VirtualDirector.analyse(text) → PerformanceData
 *         → EmotionStateMachine.set(emotion, intensity)  [PERSISTENT]
 *         → SkeletalController.loadPerformance(cues)
 *         → SkeletalController.onEmotionChange(emotion)
 *   4. useFrame loop (AvatarCanvas):
 *      - Drains viseme queue → ARKit viseme weights
 *      - EmotionStateMachine.effectiveWeights(isSpeaking) → emotion baseline
 *      - additiveBlend(emotion, viseme, procedural) → final weights
 *      - lerpWeightMap → smooth interpolation
 *      - applyWeightsToMeshes → morphTargetInfluences
 *      - tickOcularMechanics → blink + saccades
 *      - tickRespiration → spine/chest movement
 *      - tickHeadTracking → head micro-movement
 *      - SkeletalController.update(delta) → AnimationMixer
 */

import {
  AnimationDictionary,
  animationDictionary as defaultDictionary,
} from './animation-dictionary'
import {
  EmotionStateMachine,
  emotionStateMachine as defaultEmotion,
} from './emotion-state'
import {
  VirtualDirector,
  type VirtualDirectorConfig,
  type PerformanceData,
} from './virtual-director'
import {
  SkeletalController,
} from './skeletal-controller'
import {
  FFTFallback,
} from './fft-fallback'
import {
  createTTSAdapter,
  type TTSAdapterFactoryConfig,
  type TTSAdapter,
} from './tts-adapter'
import type { VisemeEvent } from './types'
import type React from 'react'

// ── Configuration ─────────────────────────────────────────────────────────────

export interface AvatarEngineConfig {
  /**
   * Path to the compiled animations.glb in /public.
   * Default: '/avatar-engine/animations.glb'
   */
  animationDictionaryUrl?: string

  /** Virtual Director configuration. Optional — if omitted, VD is disabled. */
  virtualDirector?: VirtualDirectorConfig

  /** TTS provider configuration. */
  tts: TTSAdapterFactoryConfig
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class AvatarEngine {
  readonly dictionary:  AnimationDictionary
  readonly emotion:     EmotionStateMachine
  readonly skeletal:    SkeletalController
  readonly fftFallback: FFTFallback
  readonly tts:         TTSAdapter

  private director:     VirtualDirector | null = null
  private _ready:       boolean = false

  /**
   * Shared refs — written by this engine, read by AvatarCanvas useFrame.
   * Pass these directly to AvatarCanvas props.
   */
  visemeQueueRef:   React.MutableRefObject<VisemeEvent[]>
  visemeStartRef:   React.MutableRefObject<number>
  isSpeakingRef:    React.MutableRefObject<boolean>

  constructor(
    config: AvatarEngineConfig,
    refs: {
      visemeQueueRef:  React.MutableRefObject<VisemeEvent[]>
      visemeStartRef:  React.MutableRefObject<number>
      isSpeakingRef:   React.MutableRefObject<boolean>
    }
  ) {
    this.dictionary   = defaultDictionary
    this.emotion      = defaultEmotion
    this.skeletal     = new SkeletalController(this.dictionary)
    this.fftFallback  = new FFTFallback()
    this.tts          = createTTSAdapter(config.tts)

    this.visemeQueueRef = refs.visemeQueueRef
    this.visemeStartRef = refs.visemeStartRef
    this.isSpeakingRef  = refs.isSpeakingRef

    if (config.virtualDirector) {
      this.director = new VirtualDirector(config.virtualDirector, [])
    }

    // Load animation dictionary asynchronously
    const dictUrl = config.animationDictionaryUrl ?? '/avatar-engine/animations.glb'
    this.dictionary.load(dictUrl).then(() => {
      if (this.director) {
        this.director.updateAnimIds(this.dictionary.animationIds)
      }
      this._ready = true
      // If skeletal.init() already ran (GLB loaded before dictionary),
      // kick off the idle animation now that clips are available.
      this.skeletal.onEmotionChange(this.emotion.state.id)
    })
  }

  get ready(): boolean { return this._ready }

  // ── Core: handle a dialogue string from the primary LLM ──────────────────

  /**
   * Process a dialogue utterance.
   *
   * Call this with each sentence/utterance from the primary LLM as soon as
   * the text is available (before TTS finishes — fire concurrently).
   *
   * The Virtual Director analyses the text concurrently with TTS playback.
   * Gesture cues and emotion are applied at the appropriate word boundaries.
   */
  async handleDialogue(text: string): Promise<void> {
    // Fire Virtual Director analysis and TTS concurrently
    const [performanceData] = await Promise.all([
      this.director
        ? this.director.analyse(text)
        : Promise.resolve<PerformanceData>({
            base_emotion:      'neutral',
            emotion_intensity:  0,
            gesture_cues:      [],
          }),
      // TTS starts immediately — don't await
      this._startTTS(text),
    ])

    // Apply performance data once VD resolves
    // (TTS may still be playing — that's fine, word-index cues fire on boundary events)
    this._applyPerformanceData(performanceData)
  }

  private async _startTTS(text: string): Promise<void> {
    const q    = this.visemeQueueRef
    const sRef = this.visemeStartRef
    const spk  = this.isSpeakingRef

    await this.tts.speak(text, {
      onViseme: (event) => {
        q.current.push(event)
      },
      onWordBoundary: () => {
        this.skeletal.onWordBoundary()
      },
      onSpeechStart: () => {
        spk.current      = true
        sRef.current     = performance.now()
        q.current.length = 0  // clear stale queue
      },
      onSpeechEnd: () => {
        spk.current = false
      },
      onError: (err) => {
        console.error('[AvatarEngine] TTS error:', err)
        spk.current = false
      },
    })
  }

  private _applyPerformanceData(data: PerformanceData): void {
    // Update persistent emotion state
    this.emotion.set(data.base_emotion, data.emotion_intensity)

    // Update skeletal controller with gesture cues + emotion-tinted idle
    this.skeletal.loadPerformance(data.gesture_cues)
    this.skeletal.onEmotionChange(data.base_emotion)
  }

  // ── Utility: stop current speech ─────────────────────────────────────────

  stopSpeaking(): void {
    this.tts.stop()
    this.isSpeakingRef.current    = false
    this.visemeQueueRef.current   = []
    this.skeletal.reset()
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.tts.dispose()
    this.fftFallback.dispose()
    this.skeletal.dispose()
  }
}
