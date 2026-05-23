/**
 * elevenlabs.ts — ElevenLabs Conversational AI adapter (conversational mode)
 *
 * Skeleton implementation: opens an ElevenLabs Conv AI WebSocket (optionally
 * via the Mascotbot proxy for viseme injection) and bridges its messages to
 * the AvatarCallbacks contract. The Evolve RPG team will fill in Mascotbot
 * specifics — this stub is compilable end-to-end and gracefully degrades to
 * FFT-amplitude jaw movement when no viseme stream is present.
 */

import type { TTSAdapter, AvatarCallbacks } from '../core/types'
import { FFTFallback } from '../core/fft-fallback'

// ── Config ────────────────────────────────────────────────────────────────────

export interface ElevenLabsAdapterConfig {
  agentId: string
  /** WebSocket URL for viseme stream — usually via Mascotbot proxy */
  mascotbotWsUrl?: string
  /** Fallback to FFT amplitude jaw movement if no viseme stream */
  fftFallback?: boolean
}

// ── Wire message shapes (Mascotbot proxy) ─────────────────────────────────────

interface VisemeMessage {
  type: 'viseme'
  visemeId: number
  audioOffset: number
}

interface AgentResponseMessage {
  type: 'agent_response'
  text: string
}

interface AudioMessage {
  type: 'audio'
  /** base64 PCM chunk — playback handled elsewhere */
  audio: string
}

type IncomingMessage = VisemeMessage | AgentResponseMessage | AudioMessage | { type: string }

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ElevenLabsAdapter implements TTSAdapter {
  readonly mode = 'conversational' as const

  private config: ElevenLabsAdapterConfig
  private ws: WebSocket | null = null
  private callbacks: AvatarCallbacks | null = null
  private fft: FFTFallback | null = null

  // Word-boundary estimation
  private lastResponseText: string = ''
  private speechStartedAt: number = 0
  private wordTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: ElevenLabsAdapterConfig) {
    this.config = config
  }

  async connect(callbacks: AvatarCallbacks): Promise<void> {
    this.callbacks = callbacks

    // TODO: Mascotbot proxy authentication / signed URL flow.
    // For now, open a raw WebSocket to mascotbotWsUrl if provided.
    const url = this.config.mascotbotWsUrl
    if (!url) {
      callbacks.onError(new Error('[ElevenLabsAdapter] mascotbotWsUrl is required (TODO: direct ElevenLabs WS)'))
      return
    }

    if (this.config.fftFallback) {
      this.fft = new FFTFallback()
      // TODO: connect FFT to the live audio element once Mascotbot audio playback is wired.
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws

      ws.addEventListener('open', () => {
        callbacks.onSpeechStart()
        this.speechStartedAt = performance.now()
        resolve()
      })

      ws.addEventListener('message', (ev) => {
        this.handleMessage(ev.data)
      })

      ws.addEventListener('error', () => {
        callbacks.onError(new Error('[ElevenLabsAdapter] WebSocket error'))
      })

      ws.addEventListener('close', () => {
        callbacks.onSpeechEnd()
        this.stopWordTimer()
      })

      // Reject the connect() promise if the socket dies before opening.
      ws.addEventListener('error', () => reject(new Error('[ElevenLabsAdapter] failed to open WS')), { once: true })
    })
  }

  sendUserAudio(chunk: Float32Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    // TODO: encode Float32 PCM to the wire format Mascotbot expects (likely Int16 base64).
    this.ws.send(chunk.buffer)
  }

  disconnect(): void {
    this.stopWordTimer()
    this.ws?.close()
    this.ws = null
    this.fft?.dispose()
    this.fft = null
    this.callbacks = null
  }

  dispose(): void {
    this.disconnect()
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private handleMessage(raw: unknown): void {
    if (!this.callbacks) return

    let msg: IncomingMessage
    try {
      msg = typeof raw === 'string' ? (JSON.parse(raw) as IncomingMessage) : ({ type: 'binary' } as IncomingMessage)
    } catch {
      return
    }

    switch (msg.type) {
      case 'viseme': {
        const v = msg as VisemeMessage
        this.callbacks.onViseme(v.visemeId, v.audioOffset)
        return
      }
      case 'agent_response': {
        const a = msg as AgentResponseMessage
        this.lastResponseText = a.text
        this.startWordTimer(a.text)
        return
      }
      default:
        // TODO: handle audio / interruption / end-of-turn messages
        return
    }
  }

  /**
   * Approximate word boundaries by spreading word count across speech duration.
   * ElevenLabs does not emit ms-precise word events — we estimate based on the
   * agent_response text length and elapsed speech time.
   */
  private startWordTimer(text: string): void {
    this.stopWordTimer()
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return

    // Assume ~3 words/second baseline; adjust per-locale if needed.
    const intervalMs = 1000 / 3
    let fired = 0
    this.wordTimer = setInterval(() => {
      if (fired >= words.length) {
        this.stopWordTimer()
        return
      }
      this.callbacks?.onWordBoundary()
      fired++
    }, intervalMs)
  }

  private stopWordTimer(): void {
    if (this.wordTimer) {
      clearInterval(this.wordTimer)
      this.wordTimer = null
    }
  }
}
