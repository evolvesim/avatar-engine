'use client'

/**
 * use-simulation.ts — Shared simulation hook for all Evolve Simulations products
 *
 * Manages the full simulation session lifecycle:
 *   1. startSession()   — create Supabase row, fire opening greeting via TTS
 *   2. sendTranscript() — user text → chat SSE → sentence-streaming TTS → lip-sync
 *   3. endSession()     — mark session completed, save credits used
 *   4. togglePause()    — pause / resume
 *
 * Each product configures its own Azure Neural TTS voice via ttsOptions:
 *
 *   Evolve B2B  →  en-AU-WilliamNeural   (professional AU male)
 *   EvySim      →  en-AU-NatashaNeural   (warm AU female)
 *   ACTS        →  en-AU-AnnetteNeural   (neutral, clear AU female)
 *
 * Performance notes:
 *   - Sentence-streaming TTS: first sentence fires as soon as the LLM produces
 *     a sentence boundary. No waiting for the full response.
 *   - Azure Speech SDK runs entirely in the browser → australiaeast region.
 *     Audio never leaves Australian Azure infrastructure (data sovereignty).
 *   - Real visemeReceived events from the Azure Speech SDK replace synthetic timing.
 *     audioOffset is in 100ns ticks — we divide by 10,000 at source for ms.
 *   - Speech token cached for 9 minutes (1 call per session for all sentences).
 *   - null audioConfig silences the SDK's built-in speaker output; Web Audio API
 *     plays the decoded audio exclusively to avoid double-play / echo.
 *
 * visemeQueueRef is shared with AvatarCanvas's useFrame loop.
 * visemeStartRef is stamped synchronously at source.start(0).
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type RefObject,
} from 'react'

import type {
  VisemeEvent,
  SimulationStatus,
  SimulationState,
  TranscriptEntry,
  UseSimulationOptions,
  AzureTTSOptions,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Return type
// ─────────────────────────────────────────────────────────────────────────────

export interface UseSimulationReturn {
  state: SimulationState
  /** Create a new session and play the avatar's opening greeting. */
  startSession: () => Promise<void>
  /** Accept a finalised transcript string (from Azure STT) and run the full pipeline. */
  sendTranscript: (userText: string) => Promise<void>
  /** @deprecated — kept for back-compat; migrate callers to sendTranscript. */
  sendAudioBlob: (blob: Blob) => Promise<void>
  /** Mark the session as completed and persist credits used. */
  endSession: () => Promise<void>
  /** Toggle pause/resume — suspends the AudioContext while paused. */
  togglePause: () => void
  /** Call inside a user-gesture handler to unblock iOS audio before mic starts. */
  primeAudio: () => void
  /** Shared viseme queue — written here, drained by AvatarCanvas useFrame loop. */
  visemeQueueRef: RefObject<VisemeEvent[]>
  /**
   * performance.now() timestamp stamped synchronously at source.start(0).
   * AvatarCanvas uses this as the time origin for viseme drain:
   *   fire when (visemeStartRef.current + event.audioOffset) <= performance.now()
   */
  visemeStartRef: RefObject<number>
  /** WebAudio AnalyserNode — available as FFT fallback for avatar-renderer. */
  analyserRef: RefObject<AnalyserNode | null>
}

// ─────────────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────────────

type SimulationAction =
  | { type: 'SET_STATUS';         payload: SimulationStatus }
  | { type: 'SET_SIMULATION_ID';  payload: string }
  | { type: 'SET_AVATAR_ID';      payload: string }
  | { type: 'APPEND_TRANSCRIPT';  payload: TranscriptEntry }
  | { type: 'INCREMENT_CREDITS' }
  | { type: 'SET_CREDIT_BALANCE'; payload: number }
  | { type: 'SET_ERROR';          payload: string | null }
  | { type: 'RESET_ERROR' }

const initialState: SimulationState = {
  status:        'idle',
  transcript:    [],
  creditBalance: 0,
  creditsUsed:   0,
  simulationId:  null,
  avatarId:      null,
  error:         null,
}

function simulationReducer(
  state: SimulationState,
  action: SimulationAction,
): SimulationState {
  switch (action.type) {
    case 'SET_STATUS':         return { ...state, status:        action.payload }
    case 'SET_SIMULATION_ID':  return { ...state, simulationId:  action.payload }
    case 'SET_AVATAR_ID':      return { ...state, avatarId:      action.payload }
    case 'APPEND_TRANSCRIPT':  return { ...state, transcript:    [...state.transcript, action.payload] }
    case 'INCREMENT_CREDITS':  return { ...state, creditsUsed:   state.creditsUsed + 1 }
    case 'SET_CREDIT_BALANCE': return { ...state, creditBalance: action.payload }
    case 'SET_ERROR':          return { ...state, error:         action.payload }
    case 'RESET_ERROR':        return { ...state, error:         null }
    default:                   return state
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentence-splitting helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits text on sentence boundaries (. ! ?) followed by whitespace or end-of-string.
 * Returns complete sentences and any trailing fragment not yet terminated.
 */
function splitSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  const re = /[^.!?]*[.!?](?:\s|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    sentences.push(match[0].trim())
    lastIndex = re.lastIndex
  }
  return { sentences, remainder: text.slice(lastIndex).trim() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useSimulation({
  scenarioType,
  scenarioConfig,
  avatarId,
  ttsOptions,
  onAvatarText,
}: UseSimulationOptions): UseSimulationReturn {

  // Destructure with defaults so callers can omit optional fields
  const {
    voiceName,
    speechRate   = '0%',
    speechPitch  = '0%',
    tokenEndpoint = '/api/speech/token',
  } = ttsOptions

  const [state, dispatch] = useReducer(simulationReducer, {
    ...initialState,
    avatarId,
  })

  // Shared refs consumed by AvatarCanvas useFrame
  const visemeQueueRef = useRef<VisemeEvent[]>([])
  const visemeStartRef = useRef<number>(0)

  // Abort controller for in-flight fetch chains
  const abortControllerRef = useRef<AbortController | null>(null)

  // Web Audio
  const audioContextRef        = useRef<AudioContext | null>(null)
  const analyserRef            = useRef<AnalyserNode | null>(null)
  const currentAudioSourceRef  = useRef<AudioBufferSourceNode | null>(null)

  // Cached Azure Speech token { token, region, expiresAt }
  const speechTokenRef = useRef<{
    token:     string
    region:    string
    expiresAt: number
  } | null>(null)

  // Stable refs for values used inside async callbacks (avoid stale closure bugs)
  const statusRef       = useRef<SimulationStatus>('idle')
  const simulationIdRef = useRef<string | null>(null)
  const transcriptRef   = useRef<TranscriptEntry[]>([])

  useEffect(() => { statusRef.current = state.status },          [state.status])
  useEffect(() => { simulationIdRef.current = state.simulationId }, [state.simulationId])
  useEffect(() => { transcriptRef.current = state.transcript },   [state.transcript])

  const onAvatarTextRef = useRef<((text: string) => void) | undefined>(onAvatarText)
  useEffect(() => { onAvatarTextRef.current = onAvatarText }, [onAvatarText])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      try { currentAudioSourceRef.current?.stop() } catch { /* already stopped */ }
      audioContextRef.current?.close()
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: get (or create) AudioContext + AnalyserNode
  // ─────────────────────────────────────────────────────────────────────────
  function getAudioContext(): AudioContext {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const ctx     = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      audioContextRef.current = ctx
      analyserRef.current     = analyser
    }
    return audioContextRef.current
  }

  // ─────────────────────────────────────────────────────────────────────────
  // primeAudio — call inside any user-gesture handler to unblock iOS audio
  // ─────────────────────────────────────────────────────────────────────────
  function primeAudioContext() {
    getAudioContext()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: play an audio Blob via Web Audio API
  // ─────────────────────────────────────────────────────────────────────────
  async function playAudioBlob(blob: Blob): Promise<void> {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()

    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

    return new Promise((resolve) => {
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer

      if (analyserRef.current) {
        source.connect(analyserRef.current)
        analyserRef.current.connect(ctx.destination)
      } else {
        source.connect(ctx.destination)
      }

      currentAudioSourceRef.current = source
      source.onended = () => {
        currentAudioSourceRef.current = null
        visemeStartRef.current = 0
        resolve()
      }

      // Stamp synchronously before start() — accurate origin for viseme drain
      visemeStartRef.current = performance.now()
      source.start(0)
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: get a valid Azure Speech token (cached 9 minutes)
  // ─────────────────────────────────────────────────────────────────────────
  async function getSpeechToken(): Promise<{ token: string; region: string }> {
    const cached = speechTokenRef.current
    if (cached && Date.now() < cached.expiresAt) {
      return { token: cached.token, region: cached.region }
    }
    const res = await fetch(tokenEndpoint)
    if (!res.ok) throw new Error(`Failed to get speech token (${res.status})`)
    const { token, region } = await res.json()
    speechTokenRef.current = {
      token,
      region,
      expiresAt: Date.now() + 9 * 60 * 1000,
    }
    return { token, region }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: synthesise one sentence via Azure Speech SDK and play it
  //
  // Pipeline (all in australiaeast for data sovereignty):
  //   1. Fetch Azure Speech token (cached — 0ms after first call)
  //   2. Build SSML with the product-specific voiceName + speechRate + speechPitch
  //   3. Attach visemeReceived handler — real viseme events (not synthetic timing)
  //   4. speakSsmlAsync — synthesises and returns audioData (full MP3 bytes)
  //   5. Decode + play via Web Audio API (SDK silenced via null audioConfig)
  //   6. Stamp visemeStartRef at source.start(0)
  //
  // audioOffset from Azure is in 100-nanosecond ticks — divided by 10,000 → ms.
  // null audioConfig: the SDK never routes audio to the speaker. We play via
  // Web Audio API exclusively to avoid double-play / echo.
  // ─────────────────────────────────────────────────────────────────────────
  async function synthesiseAndPlay(text: string, signal: AbortSignal): Promise<void> {
    if (!text.trim()) return
    if (signal.aborted) return

    // 1. Token (cached)
    const { token, region } = await getSpeechToken()
    if (signal.aborted) return

    // 2. Build SSML — product-specific voice, rate, pitch
    const safeText = text
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&apos;')

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-AU'>
  <voice name='${voiceName}'>
    <prosody rate='${speechRate}' pitch='${speechPitch}'>${safeText}</prosody>
  </voice>
</speak>`

    // 3. Lazy-load Azure Speech SDK (browser-only, keeps SSR bundle clean)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk: any = await import('microsoft-cognitiveservices-speech-sdk')
    if (signal.aborted) return

    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region)
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3

    // null audioConfig: SDK is silenced — Web Audio API handles playback
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null as any)

    // 4. Collect real viseme events
    //    audioOffset is in 100ns ticks — divide by 10,000 for ms
    const visemes: VisemeEvent[] = []
    synthesizer.visemeReceived = (
      _s: unknown,
      e: { audioOffset: number; visemeId: number },
    ) => {
      visemes.push({
        visemeId:    e.visemeId,
        audioOffset: e.audioOffset / 10_000,
      })
    }

    // 5. Synthesise
    const audioData = await new Promise<ArrayBuffer>((resolve, reject) => {
      if (signal.aborted) {
        synthesizer.close()
        return reject(new Error('AbortError'))
      }

      synthesizer.speakSsmlAsync(
        ssml,
        (result: { reason: number; audioData: ArrayBuffer; errorDetails?: string }) => {
          synthesizer.close()
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve(result.audioData)
          } else {
            reject(new Error(`Azure TTS failed: ${result.errorDetails ?? result.reason}`))
          }
        },
        (err: string) => {
          synthesizer.close()
          reject(new Error(`Azure TTS error: ${err}`))
        },
      )

      signal.addEventListener('abort', () => {
        try { synthesizer.close() } catch { /* already closed */ }
        reject(new Error('AbortError'))
      }, { once: true })
    })

    if (signal.aborted) return

    // 6. Load visemes into shared queue before playing
    visemeQueueRef.current = visemes

    dispatch({ type: 'SET_STATUS', payload: 'speaking' })

    // 7. Decode + play — SDK was silenced above, so no echo
    await playAudioBlob(new Blob([audioData], { type: 'audio/mpeg' }))

    visemeQueueRef.current = []
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: sentence-streaming TTS
  // Reads from an already-open SSE reader and fires TTS sentence-by-sentence.
  // The first sentence fires as soon as the LLM produces a sentence boundary —
  // without waiting for the full LLM response to complete.
  // ─────────────────────────────────────────────────────────────────────────
  async function streamingTTS(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
    onText: (fullText: string) => void,
  ): Promise<void> {
    const decoder   = new TextDecoder()
    let buffer   = ''  // LLM text not yet synthesised
    let fullText = ''  // complete response (for transcript append)

    // Synthesis promises are chained so sentences play in order
    const synthQueue: Promise<void>[] = []
    // Track whether we’ve fired the pre-speech onAvatarText callback
    let avatarTextFired = false

    const flushSentence = (sentence: string) => {
      // Fire onAvatarText before queuing the first sentence so emotion
      // is applied before any audio plays.
      if (!avatarTextFired) {
        avatarTextFired = true
        const snapshot = fullText.trim()
        if (snapshot) onAvatarTextRef.current?.(snapshot)
      }
      const prev = synthQueue[synthQueue.length - 1] ?? Promise.resolve()
      const next = prev.then(() =>
        synthesiseAndPlay(sentence, signal).catch((e) => {
          console.warn('[streamingTTS] sentence synthesis failed, skipping:', e.message)
        }),
      )
      synthQueue.push(next)
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') break
        try {
          const parsed = JSON.parse(data)
          if (parsed.content) {
            buffer   += parsed.content
            fullText += parsed.content
          }
        } catch {
          // Plain-text stream (non-JSON)
          buffer   += data
          fullText += data
        }
      }

      const { sentences, remainder } = splitSentences(buffer)
      for (const sentence of sentences) {
        if (sentence.trim()) flushSentence(sentence)
      }
      buffer = remainder
    }

    // Flush any remaining fragment after the stream closes
    if (buffer.trim()) flushSentence(buffer.trim())

    // Wait for the last sentence to finish playing
    if (synthQueue.length > 0) {
      await synthQueue[synthQueue.length - 1]
    }

    onText(fullText.trim())
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. startSession
  // ─────────────────────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    dispatch({ type: 'RESET_ERROR' })
    dispatch({ type: 'SET_STATUS', payload: 'processing' })

    try {
      const response = await fetch('/api/simulation/session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scenarioType, scenarioConfig, avatarId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? `Failed to create session (${response.status})`)
      }

      const { simulationId, creditBalance } = await response.json()
      dispatch({ type: 'SET_SIMULATION_ID', payload: simulationId })
      if (typeof creditBalance === 'number') {
        dispatch({ type: 'SET_CREDIT_BALANCE', payload: creditBalance })
      }

      // Pre-warm speech token so first TTS call is instant
      getSpeechToken().catch(() => { /* non-fatal */ })

      // Opening greeting — avatar speaks first
      try {
        dispatch({ type: 'SET_STATUS', payload: 'speaking' })

        const chatRes = await fetch('/api/chat', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            simulationId,
            scenarioType,
            scenarioConfig,
            history: [{ role: 'user', content: '(start)', timestamp: Date.now() }],
          }),
        })

        if (chatRes.ok && chatRes.body) {
          const reader = chatRes.body.getReader()
          const abortController = new AbortController()
          abortControllerRef.current = abortController

          let openingText = ''
          await streamingTTS(reader, abortController.signal, (text) => {
            openingText = text
          })

          if (openingText.trim()) {
            dispatch({
              type:    'APPEND_TRANSCRIPT',
              payload: { role: 'avatar', content: openingText, timestamp: Date.now() },
            })
          }
        }
      } catch {
        // Non-fatal — if opening greeting fails, proceed to listening
      }

      dispatch({ type: 'SET_STATUS', payload: 'listening' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start session'
      dispatch({ type: 'SET_ERROR',  payload: message })
      dispatch({ type: 'SET_STATUS', payload: 'idle' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioType, scenarioConfig, avatarId, voiceName, speechRate, speechPitch])

  // ─────────────────────────────────────────────────────────────────────────
  // 2. sendTranscript — main pipeline, driven by Azure STT
  // ─────────────────────────────────────────────────────────────────────────
  const sendTranscript = useCallback(
    async (userText: string) => {
      const s = statusRef.current
      if (s === 'paused' || s === 'ended') return
      if (!userText?.trim()) return
      if (!simulationIdRef.current) {
        console.warn('[useSimulation] sendTranscript — simulationId not set yet, ignoring')
        return
      }

      // Barge-in: abort in-flight TTS immediately so the avatar stops speaking
      if (s === 'speaking' || s === 'processing') {
        abortControllerRef.current?.abort()
        visemeQueueRef.current = []
        try { currentAudioSourceRef.current?.stop() } catch { /* already stopped */ }
      }

      abortControllerRef.current?.abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      const { signal } = abortController

      dispatch({ type: 'SET_STATUS', payload: 'processing' })
      dispatch({ type: 'RESET_ERROR' })
      dispatch({
        type:    'APPEND_TRANSCRIPT',
        payload: { role: 'user', content: userText, timestamp: Date.now() },
      })

      try {
        // Step 1: Chat SSE stream
        const chatResponse = await fetch('/api/chat', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            simulationId: simulationIdRef.current,
            scenarioType,
            scenarioConfig,
            history: [
              ...transcriptRef.current,
              { role: 'user', content: userText, timestamp: Date.now() },
            ],
          }),
          signal,
        })

        if (!chatResponse.ok) {
          const errBody = await chatResponse.json().catch(() => ({}))
          throw new Error(errBody.error ?? `Chat API failed (${chatResponse.status})`)
        }
        if (!chatResponse.body) {
          throw new Error('Chat API returned no body')
        }

        // Step 2+3: Sentence-streaming TTS — fires on first sentence boundary,
        // not waiting for the full LLM response
        const reader = chatResponse.body.getReader()
        let assistantText = ''
        await streamingTTS(reader, signal, (text) => {
          assistantText = text
        })

        if (assistantText.trim()) {
          dispatch({
            type:    'APPEND_TRANSCRIPT',
            payload: { role: 'avatar', content: assistantText, timestamp: Date.now() },
          })
        }

        // Step 4: Credit tracking
        dispatch({ type: 'INCREMENT_CREDITS' })
        dispatch({ type: 'SET_STATUS', payload: 'listening' })
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        const message = error instanceof Error ? error.message : 'An error occurred'
        console.error('[useSimulation] sendTranscript pipeline error:', message)
        if (!message.includes('Speech synthesis')) {
          dispatch({ type: 'SET_ERROR', payload: message })
        }
        dispatch({ type: 'SET_STATUS', payload: 'listening' })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenarioType, scenarioConfig, voiceName, speechRate, speechPitch],
  )

  // ─────────────────────────────────────────────────────────────────────────
  // sendAudioBlob — @deprecated back-compat shim
  // Azure STT now handles transcription client-side via sendTranscript.
  // ─────────────────────────────────────────────────────────────────────────
  const sendAudioBlob = useCallback(
    async (_blob: Blob) => {
      console.warn(
        '[useSimulation] sendAudioBlob is deprecated — use sendTranscript with Azure STT',
      )
    },
    [],
  )

  // ─────────────────────────────────────────────────────────────────────────
  // 3. endSession
  // ─────────────────────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    abortControllerRef.current?.abort()
    try { currentAudioSourceRef.current?.stop() } catch { /* already stopped */ }
    visemeQueueRef.current = []

    dispatch({ type: 'SET_STATUS', payload: 'ended' })

    if (!simulationIdRef.current) return

    try {
      await fetch('/api/simulation/session', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          simulationId: simulationIdRef.current,
          status:       'completed',
          credits_used: state.creditsUsed,
        }),
      })
    } catch (error) {
      console.error('[useSimulation] failed to mark session completed:', error)
    }
  }, [state.creditsUsed])

  // ─────────────────────────────────────────────────────────────────────────
  // 4. togglePause
  // ─────────────────────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (state.status === 'paused') {
      dispatch({ type: 'SET_STATUS', payload: 'listening' })
    } else if (state.status === 'listening' || state.status === 'speaking') {
      dispatch({ type: 'SET_STATUS', payload: 'paused' })
      audioContextRef.current?.suspend().catch(console.warn)
    }
  }, [state.status])

  return {
    state,
    startSession,
    sendTranscript,
    sendAudioBlob,
    endSession,
    togglePause,
    primeAudio: primeAudioContext,
    visemeQueueRef,
    visemeStartRef,
    analyserRef,
  }
}
