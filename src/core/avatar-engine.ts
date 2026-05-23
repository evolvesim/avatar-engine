/**
 * avatar-engine.ts — Central orchestrator
 *
 * AvatarEngine owns all subsystems and coordinates their interaction.
 * Products instantiate this once and pass it to AvatarCanvas + useAvatarEngine.
 *
 * Subsystems owned:
 *   - AnimationDictionary   (binary animation dictionary)
 *   - EmotionStateMachine   (persistent FACS→ARKit emotion state)
 *   - VirtualDirector       (secondary LLM cognitive pipeline)
 *   - SkeletalController    (AnimationMixer + WordBoundary sync)
 *   - FFTFallback           (WebAudio amplitude fallback)
 *   - TTSAdapter            (provided externally — Azure / ElevenLabs / Mock)
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
import type {
  TTSAdapter,
  VisemeEvent,
  DirectorConfig,
  AvatarCallbacks,
} from './types'
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

  /** Director preset (system prompt + clip set identifier). */
  directorConfig?: DirectorConfig

  /** TTS adapter instance — caller constructs and passes in. */
  adapter: TTSAdapter
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class AvatarEngine {
  readonly dictionary:  AnimationDictionary
  readonly emotion:     EmotionStateMachine
  readonly skeletal:    SkeletalController
  readonly fftFallback: FFTFallback
  readonly adapter:     TTSAdapter

  private director:     VirtualDirector | null = null
  private _ready:       boolean = false
  private _connected:   boolean = false

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
    this.adapter      = config.adapter

    this.visemeQueueRef = refs.visemeQueueRef
    this.visemeStartRef = refs.visemeStartRef
    this.isSpeakingRef  = refs.isSpeakingRef

    if (config.virtualDirector) {
      this.director = new VirtualDirector(
        config.virtualDirector,
        [],
        config.directorConfig?.systemPrompt,
      )
    }

    const dictUrl = config.animationDictionaryUrl ?? '/avatar-engine/animations.glb'
    this.dictionary.load(dictUrl).then(() => {
      if (this.director) {
        this.director.updateAnimIds(this.dictionary.animationIds)
      }
      this._ready = true
      this.skeletal.onEmotionChange(this.emotion.state.id)
    })
  }

  get ready(): boolean { return this._ready }

  // ── Conversational mode: connect/disconnect ────────────────────────────────

  async connect(): Promise<void> {
    if (this.adapter.mode !== 'conversational' || !this.adapter.connect) return
    if (this._connected) return
    await this.adapter.connect(this._buildCallbacks())
    this._connected = true
  }

  disconnect(): void {
    if (this.adapter.mode !== 'conversational' || !this.adapter.disconnect) return
    if (!this._connected) return
    this.adapter.disconnect()
    this._connected = false
  }

  // ── Core: handle a dialogue string from the primary LLM ──────────────────

  async handleDialogue(text: string): Promise<void> {
    const [performanceData] = await Promise.all([
      this.director
        ? this.director.analyse(text)
        : Promise.resolve<PerformanceData>({
            base_emotion:      'neutral',
            emotion_intensity:  0,
            gesture_cues:      [],
          }),
      this._startTTS(text),
    ])

    this._applyPerformanceData(performanceData)
  }

  private _buildCallbacks(): AvatarCallbacks {
    const q    = this.visemeQueueRef
    const sRef = this.visemeStartRef
    const spk  = this.isSpeakingRef

    return {
      onViseme: (visemeId, audioOffset) => {
        q.current.push({ visemeId, audioOffset })
      },
      onWordBoundary: () => {
        this.skeletal.onWordBoundary()
      },
      onSpeechStart: () => {
        spk.current      = true
        sRef.current     = performance.now()
        q.current.length = 0
      },
      onSpeechEnd: () => {
        spk.current = false
      },
      onError: (err) => {
        console.error('[AvatarEngine] TTS error:', err)
        spk.current = false
      },
    }
  }

  private async _startTTS(text: string): Promise<void> {
    if (this.adapter.mode !== 'oneshot' || !this.adapter.speak) return
    await this.adapter.speak(text, this._buildCallbacks())
  }

  private _applyPerformanceData(data: PerformanceData): void {
    this.emotion.set(data.base_emotion, data.emotion_intensity)
    this.skeletal.loadPerformance(data.gesture_cues)
    this.skeletal.onEmotionChange(data.base_emotion)
  }

  // ── Utility: stop current speech ─────────────────────────────────────────

  stopSpeaking(): void {
    this.adapter.stop?.()
    this.isSpeakingRef.current    = false
    this.visemeQueueRef.current   = []
    this.skeletal.reset()
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.adapter.dispose()
    this.fftFallback.dispose()
    this.skeletal.dispose()
  }
}
