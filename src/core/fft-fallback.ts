/**
 * fft-fallback.ts — WebAudio FFT lip-sync fallback
 *
 * Implements the research spec's "WebAudio API Fast Fourier Transform (FFT)
 * Fallback" mechanism.
 *
 * When Azure TTS viseme events lag or fail to arrive, this module:
 *   1. Attaches a WebAudio AnalyserNode to the playing audio stream
 *   2. Runs an FFT at 60 FPS
 *   3. Isolates the human speech frequency band (85–255 Hz)
 *   4. Maps amplitude → jawOpen + mouthFunnel blendshapes
 *   5. Also feeds the amplitude to procedural head tracking
 *
 * The fallback activates automatically when:
 *   - The last viseme event was >200ms ago but audio is still playing
 *   - Azure SDK fails to connect
 *   - ElevenLabs / Mascotbot providers (which don't emit Azure-format visemes)
 *
 * This is also the ALWAYS-ON fallback layer for ElevenLabs and Mascotbot
 * providers, which do not emit Azure WordBoundary events.
 */

import type { ARKitWeights } from './emotion-state'

// ── FFT configuration ─────────────────────────────────────────────────────────

const FFT_SIZE         = 2048   // Frequency resolution: sampleRate / FFT_SIZE Hz per bin
const SPEECH_FREQ_MIN  = 85     // Hz — lower bound of human voiced speech (F0)
const SPEECH_FREQ_MAX  = 255    // Hz — upper bound of fundamental frequency range

// ── Analyser ──────────────────────────────────────────────────────────────────

export class FFTFallback {
  private audioCtx:     AudioContext | null = null
  private analyser:     AnalyserNode | null = null
  private source:       MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null
  private dataArray:    Uint8Array<ArrayBuffer> | null = null
  private _amplitude:   number = 0        // Normalised 0–1
  private _connected:   boolean = false

  get amplitude(): number  { return this._amplitude  }
  get connected(): boolean { return this._connected  }

  /**
   * Attach to an HTMLAudioElement (Azure TTS / standard audio playback).
   */
  attachToAudioElement(audio: HTMLAudioElement): void {
    this.detach()
    try {
      this.audioCtx = new AudioContext()
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = FFT_SIZE
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)

      this.source = this.audioCtx.createMediaElementSource(audio)
      this.source.connect(this.analyser)
      this.analyser.connect(this.audioCtx.destination)

      this._connected = true
    } catch (err) {
      console.warn('[FFTFallback] Failed to attach to audio element:', err)
    }
  }

  /**
   * Attach to a MediaStream (microphone or WebRTC stream).
   * Useful for ElevenLabs / Mascotbot WebRTC audio.
   */
  attachToStream(stream: MediaStream): void {
    this.detach()
    try {
      this.audioCtx = new AudioContext()
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = FFT_SIZE
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)

      this.source = this.audioCtx.createMediaStreamSource(stream)
      this.source.connect(this.analyser)
      // Do NOT connect to destination for stream sources — would echo back to user
      this._connected = true
    } catch (err) {
      console.warn('[FFTFallback] Failed to attach to stream:', err)
    }
  }

  /**
   * Tick: compute the normalised speech-band amplitude.
   * Call this every frame from the useFrame loop.
   *
   * Returns the amplitude (same as .amplitude getter) for convenience.
   */
  tick(): number {
    if (!this.analyser || !this.dataArray || !this.audioCtx) {
      this._amplitude = 0
      return 0
    }

    this.analyser.getByteFrequencyData(this.dataArray)

    const sampleRate = this.audioCtx.sampleRate
    const binHz      = sampleRate / FFT_SIZE
    const minBin     = Math.floor(SPEECH_FREQ_MIN / binHz)
    const maxBin     = Math.ceil(SPEECH_FREQ_MAX  / binHz)

    let sum   = 0
    let count = 0
    for (let i = minBin; i <= maxBin && i < this.dataArray.length; i++) {
      sum += this.dataArray[i]
      count++
    }

    // Normalise to 0–1 (byte values are 0–255)
    this._amplitude = count > 0 ? (sum / count) / 255 : 0
    return this._amplitude
  }

  /**
   * Compute fallback ARKit weights from the current FFT amplitude.
   *
   * Maps amplitude → jawOpen + mouthFunnel.
   * These are the two dominant blendshapes for open-mouth speech.
   * The mapping uses a power curve to reduce noise floor chatter.
   */
  getBlendshapeWeights(): ARKitWeights {
    const amp = this._amplitude

    // Apply power curve to reduce noise floor chatter
    // Low amplitude → near-zero jaw; loud amplitude → wide jaw
    const curved = Math.pow(Math.max(0, amp - 0.05), 0.7)

    return {
      jawOpen:      Math.min(curved * 0.8,  0.6),  // cap at 0.6 — realistic max
      mouthFunnel:  Math.min(curved * 0.35, 0.4),
    }
  }

  detach(): void {
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.audioCtx?.close().catch(() => {})
    this.audioCtx   = null
    this.analyser   = null
    this.source     = null
    this.dataArray  = null
    this._amplitude = 0
    this._connected = false
  }

  dispose(): void {
    this.detach()
  }
}
