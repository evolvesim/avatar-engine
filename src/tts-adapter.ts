/**
 * tts-adapter.ts — Multi-provider TTS adapter
 *
 * Provides a unified interface for all TTS providers used across the three
 * Evolve products, normalising their different event models into:
 *
 *   onViseme(visemeId: number, audioOffsetMs: number)
 *   onWordBoundary()
 *   onSpeechStart()
 *   onSpeechEnd()
 *
 * Provider capabilities:
 *
 *   ┌─────────────────┬──────────┬────────────────┬──────────────┐
 *   │ Provider        │ Visemes  │ WordBoundary   │ Use case     │
 *   ├─────────────────┼──────────┼────────────────┼──────────────┤
 *   │ Azure Neural    │ ✓ 22 IDs │ ✓ ms-precise   │ Evolve B2B   │
 *   │ ElevenLabs      │ ✓ via WS │ ✗ (FFT fallbk) │ EvySim B2C   │
 *   │ Mascotbot       │ ✓ via WS │ ✗ (FFT fallbk) │ Test/2D      │
 *   └─────────────────┴──────────┴────────────────┴──────────────┘
 *
 * The adapter pattern means AvatarEngine does not care which TTS is active —
 * the same SkeletalController, EmotionStateMachine, and viseme queue receive
 * events regardless of provider.
 */

import type { VisemeEvent } from './types'

// ── Common event callbacks ────────────────────────────────────────────────────

export interface TTSAdapterCallbacks {
  onViseme:       (event: VisemeEvent) => void
  onWordBoundary: () => void
  onSpeechStart:  () => void
  onSpeechEnd:    () => void
  onError:        (err: Error) => void
}

// ── Base adapter interface ────────────────────────────────────────────────────

export interface TTSAdapter {
  readonly provider: 'azure' | 'elevenlabs' | 'mascotbot'
  speak(text: string, callbacks: TTSAdapterCallbacks): Promise<void>
  stop(): void
  dispose(): void
}

// ── 1. Azure Neural TTS Adapter ───────────────────────────────────────────────

export interface AzureAdapterConfig {
  /** Your app's speech token endpoint. Default: '/api/speech/token' */
  tokenEndpoint:  string
  /** Azure Neural TTS voice name. e.g. 'en-AU-WilliamNeural' */
  voiceName:      string
  /** Speech rate. Default: '0%' */
  speechRate?:    string
  /** Speech pitch. Default: '0%' */
  speechPitch?:   string
}

export class AzureTTSAdapter implements TTSAdapter {
  readonly provider = 'azure' as const
  private config: Required<AzureAdapterConfig>
  private sdk: typeof import('microsoft-cognitiveservices-speech-sdk') | null = null
  private synthesizer: import('microsoft-cognitiveservices-speech-sdk').SpeechSynthesizer | null = null

  constructor(config: AzureAdapterConfig) {
    this.config = {
      speechRate:  '0%',
      speechPitch: '0%',
      ...config,
    }
  }

  async speak(text: string, cb: TTSAdapterCallbacks): Promise<void> {
    // Lazy-load the Azure SDK — only pulled when Azure is the active provider
    if (!this.sdk) {
      this.sdk = await import('microsoft-cognitiveservices-speech-sdk')
    }
    const SDK = this.sdk

    // Fetch token from server-side proxy (keeps key server-side)
    const tokenRes  = await fetch(this.config.tokenEndpoint)
    const tokenData = await tokenRes.json()
    const config    = SDK.SpeechConfig.fromAuthorizationToken(tokenData.token, tokenData.region)
    config.speechSynthesisVoiceName = this.config.voiceName

    const synthesizer = new SDK.SpeechSynthesizer(config, SDK.AudioConfig.fromDefaultSpeakerOutput())
    this.synthesizer  = synthesizer

    // ── Viseme events ─────────────────────────────────────────────────────
    synthesizer.visemeReceived = (_s, e) => {
      cb.onViseme({
        visemeId:    e.visemeId,
        audioOffset: e.audioOffset / 10000, // 100ns ticks → ms
      })
    }

    // ── Word boundary events ──────────────────────────────────────────────
    synthesizer.wordBoundary = (_s, _e) => {
      cb.onWordBoundary()
    }

    // ── Build SSML ────────────────────────────────────────────────────────
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
             xmlns:mstts="http://www.w3.org/2001/mstts"
             xml:lang="en-AU">
        <voice name="${this.config.voiceName}">
          <prosody rate="${this.config.speechRate}" pitch="${this.config.speechPitch}">
            ${text}
          </prosody>
        </voice>
      </speak>`

    return new Promise((resolve) => {
      cb.onSpeechStart()
      synthesizer.speakSsmlAsync(
        ssml,
        (_result) => {
          cb.onSpeechEnd()
          synthesizer.close()
          this.synthesizer = null
          resolve()
        },
        (err) => {
          cb.onError(new Error(err))
          synthesizer.close()
          this.synthesizer = null
          resolve()
        }
      )
    })
  }

  stop(): void {
    this.synthesizer?.close()
    this.synthesizer = null
  }

  dispose(): void {
    this.stop()
  }
}

// ── 2. ElevenLabs Adapter ─────────────────────────────────────────────────────
//
// ElevenLabs does not emit Azure-format viseme events directly.
// Instead, the Mascotbot proxy intercepts the WebSocket stream and injects
// viseme data. For a direct ElevenLabs integration (without Mascotbot),
// the FFT fallback handles lip-sync.
//
// This adapter fires onSpeechStart/onSpeechEnd and lets the FFTFallback
// handle blendshapes via amplitude analysis of the audio stream.

export interface ElevenLabsAdapterConfig {
  /** Server-side signed URL endpoint. Default: '/api/elevenlabs-signed-url' */
  signedUrlEndpoint: string
}

export class ElevenLabsAdapter implements TTSAdapter {
  readonly provider = 'elevenlabs' as const
  private config: ElevenLabsAdapterConfig
  private activeConversation: { endSession: () => Promise<void> } | null = null

  constructor(config: ElevenLabsAdapterConfig) {
    this.config = config
  }

  /**
   * ElevenLabs operates as a bidirectional voice conversation, not one-shot TTS.
   * The speak() method here is a thin wrapper that signals speech state changes
   * to the avatar engine. The actual audio comes from the ElevenLabs WebSocket.
   */
  async speak(_text: string, cb: TTSAdapterCallbacks): Promise<void> {
    cb.onSpeechStart()
    // In practice, ElevenLabs speech end is signalled via onMessage callback
    // in the conversation hook — the AvatarEngine hooks into this separately
    cb.onSpeechEnd()
  }

  stop(): void {
    this.activeConversation?.endSession().catch(() => {})
    this.activeConversation = null
  }

  dispose(): void {
    this.stop()
  }
}

// ── 3. Mascotbot Adapter ──────────────────────────────────────────────────────
//
// Mascotbot proxy injects viseme events into the ElevenLabs WebSocket stream.
// The WebSocket interceptor in the 3D avatar lipsync skill handles decoding.
// This adapter provides the signed URL and signals speech state.

export interface MascotbotAdapterConfig {
  /** Server-side Mascotbot signed URL endpoint. Default: '/api/mascot-signed-url' */
  signedUrlEndpoint: string
}

export class MascotbotAdapter implements TTSAdapter {
  readonly provider = 'mascotbot' as const
  private config: MascotbotAdapterConfig

  constructor(config: MascotbotAdapterConfig) {
    this.config = config
  }

  async speak(_text: string, cb: TTSAdapterCallbacks): Promise<void> {
    cb.onSpeechStart()
    cb.onSpeechEnd()
  }

  stop(): void {}
  dispose(): void {}
}

// ── Factory ───────────────────────────────────────────────────────────────────

export type TTSProviderName = 'azure' | 'elevenlabs' | 'mascotbot'

export interface TTSAdapterFactoryConfig {
  provider:   TTSProviderName
  azure?:     AzureAdapterConfig
  elevenlabs?: ElevenLabsAdapterConfig
  mascotbot?:  MascotbotAdapterConfig
}

export function createTTSAdapter(config: TTSAdapterFactoryConfig): TTSAdapter {
  switch (config.provider) {
    case 'azure':
      if (!config.azure) throw new Error('[TTSAdapter] azure config required for azure provider')
      return new AzureTTSAdapter(config.azure)
    case 'elevenlabs':
      return new ElevenLabsAdapter(config.elevenlabs ?? { signedUrlEndpoint: '/api/elevenlabs-signed-url' })
    case 'mascotbot':
      return new MascotbotAdapter(config.mascotbot ?? { signedUrlEndpoint: '/api/mascot-signed-url' })
    default:
      throw new Error(`[TTSAdapter] Unknown provider: ${config.provider}`)
  }
}
