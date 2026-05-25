/**
 * azure.ts — Azure Neural TTS adapter (oneshot mode)
 *
 * Implements the TTSAdapter interface from core/types.ts.
 * Lazy-imports the Azure SDK so the package stays SSR-safe.
 */

import type { TTSAdapter, AvatarCallbacks } from '../core/types'

// ── Config ────────────────────────────────────────────────────────────────────

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _speechSDK: any | null = null

async function getSpeechSDK() {
  if (!_speechSDK) {
    _speechSDK = await import('microsoft-cognitiveservices-speech-sdk')
  }
  return _speechSDK
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class AzureTTSAdapter implements TTSAdapter {
  readonly mode = 'oneshot' as const
  private config: Required<AzureAdapterConfig>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private synthesizer: any | null = null

  constructor(config: AzureAdapterConfig) {
    this.config = {
      speechRate:  '0%',
      speechPitch: '0%',
      ...config,
    }
  }

  async speak(text: string, cb: AvatarCallbacks): Promise<void> {
    const SDK = await getSpeechSDK()

    const tokenRes  = await fetch(this.config.tokenEndpoint)
    const tokenData = await tokenRes.json()
    const config    = SDK.SpeechConfig.fromAuthorizationToken(tokenData.token, tokenData.region)
    config.speechSynthesisVoiceName = this.config.voiceName

    const synthesizer = new SDK.SpeechSynthesizer(config, SDK.AudioConfig.fromDefaultSpeakerOutput())
    this.synthesizer  = synthesizer

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    synthesizer.visemeReceived = (_s: any, e: any) => {
      cb.onViseme(e.visemeId, e.audioOffset / 10000) // 100ns ticks → ms
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    synthesizer.wordBoundary = (_s: any, _e: any) => {
      cb.onWordBoundary()
    }

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_result: any) => {
          cb.onSpeechEnd()
          synthesizer.close()
          this.synthesizer = null
          resolve()
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any) => {
          cb.onError(new Error(String(err)))
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
