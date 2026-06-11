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
   * Default: '/avatar-engine/animations.glb' (0.3.72+ — real RPM mocap clips)
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

  /**
   * Refresh the Virtual Director's animation ID list after loading a new pack.
   * Call this after `engine.dictionary.loadPack(url)` completes.
   */
  refreshAnimIds(): void {
    if (this.director) {
      this.director.updateAnimIds(this.dictionary.animationIds)
    }
  }

  // ── Core: handle a dialogue string from the primary LLM ──────────────────

  async handleDialogue(text: string): Promise<void> {
    const [performanceData] = await Promise.all([
      this.director
        ? this.director.analyse(text)
        : Promise.resolve<PerformanceData>({
            base_emotion:      'neutral',
            emotion_intensity:  0,
            talking_alias:     'talking_neutral',
            gesture_cues:      [],
            set_expression:    null,
            expression_reason: null,
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
        // Azure fires visemeReceived BEFORE onSpeechStart fires, so the queue
        // may already have events when onSpeechStart tries to clear it.
        // Stamp startTime on the FIRST viseme of each utterance instead, so
        // the drain offset arithmetic is always relative to when events arrived.
        if (q.current.length === 0) {
          sRef.current = performance.now()
        }
        q.current.push({ visemeId, audioOffset })
      },
      onWordBoundary: () => {
        this.skeletal.onWordBoundary()
      },
      onSpeechStart: () => {
        spk.current = true
        // Do NOT clear the queue or reset startTime here — visemes may have
        // already arrived before this callback fires (Azure fires viseme
        // events synchronously before the audio playback callback).
      },
      onSpeechEnd: () => {
        spk.current = false
        // Signal mouth-close: clear queue and reset startTime so the
        // recentlyFired gate expires and targetW zeroes naturally.
        q.current.length = 0
        sRef.current     = 0
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
    // Apply persistent facial expression if VD signals a change
    // set_expression=null means "keep current expression" — do not reset
    if (data.set_expression != null) {
      this.emotion.set(data.set_expression, data.emotion_intensity)
      this.skeletal.onEmotionChange(data.set_expression)
      if (data.expression_reason) {
        console.info(`[VirtualDirector] Expression → ${data.set_expression} (${data.expression_reason})`)
      }
    } else {
      // No expression change — still apply base_emotion intensity for idle pool selection
      // but do not override the persistent expression blendshapes
      this.skeletal.onEmotionChange(data.base_emotion)
    }

    // Queue gesture cues (word-indexed)
    this.skeletal.loadPerformance(data.gesture_cues)

    // Log talking alias for debugging (skeletal controller wires this when implemented)
    if (data.talking_alias) {
      console.debug(`[VirtualDirector] Talking alias: ${data.talking_alias}`)
    }
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
