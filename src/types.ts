/**
 * types.ts — shared types for the avatar engine
 *
 * Imported by all three products: Evolve B2B, EvySim, ACTS Education.
 */

import type React from 'react'

// ── Viseme event ──────────────────────────────────────────────────────────────

/**
 * A single viseme event emitted by Azure TTS (or ElevenLabs).
 *
 * visemeId:    0–21 per the Azure/ElevenLabs protocol.
 * audioOffset: milliseconds from audio start (already converted from Azure's
 *              100-nanosecond ticks — divide by 10,000 at the source).
 */
export interface VisemeEvent {
  visemeId: number
  audioOffset: number  // ms from audio start
}

// ── Camera presets ────────────────────────────────────────────────────────────

/**
 * Named camera presets for common framing needs.
 * Each product can choose the preset that fits its UI.
 */
export type CameraPreset = 'close-face' | 'head-and-shoulders' | 'half-body'

export interface CameraConfig {
  position: [number, number, number]
  target:   [number, number, number]
  fov:      number
}

export const CAMERA_PRESETS: Record<CameraPreset, CameraConfig> = {
  'close-face': {
    position: [0, 0.08, 0.72],
    target:   [0, 0.08, 0],
    fov:      28,
  },
  'head-and-shoulders': {
    position: [0, 0.3, 1.4],
    target:   [0, 0.1, 0],
    fov:      35,
  },
  'half-body': {
    position: [0, 0.0, 2.0],
    target:   [0, -0.2, 0],
    fov:      42,
  },
}

// ── Lighting presets ──────────────────────────────────────────────────────────

/**
 * Lighting context per product.
 *
 * 'boardroom'  — Evolve B2B: cool-neutral, professional office/meeting room feel
 * 'consumer'   — EvySim: warm purple accent, dopamine-forward
 * 'education'  — ACTS: bright, neutral, non-threatening
 */
export type LightingPreset = 'boardroom' | 'consumer' | 'education'

// ── AvatarCanvas props ────────────────────────────────────────────────────────

export interface AvatarCanvasProps {
  /**
   * Path to the GLB file relative to the Next.js /public directory.
   * All three products can use the same avatar or pass different personas.
   * Default: '/avatar.glb'
   */
  glbUrl?: string

  /**
   * Camera framing preset.
   * Evolve B2B → 'head-and-shoulders'
   * EvySim     → 'close-face'
   * ACTS       → 'head-and-shoulders'
   */
  cameraPreset?: CameraPreset

  /**
   * Lighting mood.
   * Default: 'consumer'
   */
  lightingPreset?: LightingPreset

  /**
   * Shared ref written by useSimulation and drained by the useFrame loop.
   * Pass the ref directly — do not copy the array.
   */
  visemeQueueRef: React.RefObject<VisemeEvent[]>

  /**
   * Set to true while the avatar is speaking (status === 'speaking').
   * Used to keep the mouth idle-gate open during active speech.
   */
  isAvatarSpeaking: boolean

  /**
   * performance.now() timestamp stamped synchronously at source.start(0).
   * The useFrame drain uses this as the time origin for viseme offsets.
   */
  visemeStartRef: React.RefObject<number>

  /**
   * Enable procedural blink (random eye blink every 3–7 seconds).
   * Default: true
   */
  blink?: boolean

  /**
   * Enable subtle head micro-movement (noise-based bob).
   * Default: true
   */
  headBob?: boolean

  /**
   * Horizontal offset rotation for the avatar body, in radians.
   * Use to angle the avatar slightly toward or away from the camera.
   * Default: 0.5 (slight left-facing angle, as in original EvySim)
   */
  bodyRotationY?: number

  /**
   * Tailwind / CSS class string applied to the wrapping div.
   * Default: 'w-full h-full'
   */
  className?: string
}

// ── useAzureTTS options ───────────────────────────────────────────────────────

/**
 * Options for useAzureTTS hook.
 * Each product configures its preferred AU voice and speech rate.
 */
export interface AzureTTSOptions {
  /**
   * Azure Neural TTS voice name.
   *
   * Evolve B2B suggestion: 'en-AU-WilliamNeural'  (professional AU male)
   * EvySim suggestion:     'en-AU-NatashaNeural'   (warm AU female)
   * ACTS suggestion:       'en-AU-AnnetteNeural'   (neutral, clear AU female)
   *
   * Full list: https://learn.microsoft.com/azure/ai-services/speech-service/language-support
   */
  voiceName: string

  /**
   * Speech rate relative adjustment.
   * '0%' = normal, '-10%' = slightly slower (good for ACTS education).
   * Default: '0%'
   */
  speechRate?: string

  /**
   * Pitch relative adjustment.
   * Default: '0%'
   */
  speechPitch?: string

  /**
   * Your app's speech token endpoint.
   * Default: '/api/speech/token'
   */
  tokenEndpoint?: string
}

// ── useSimulation options ─────────────────────────────────────────────────────

export interface UseSimulationOptions {
  /** Scenario type string passed to the chat API and stored in Supabase. */
  scenarioType: string
  /** Arbitrary config object passed to the chat API (e.g. difficulty, persona). */
  scenarioConfig: Record<string, unknown>
  /** Avatar ID for the session (nullable during onboarding). */
  avatarId: string | null
  /** Azure TTS configuration for this product. */
  ttsOptions: AzureTTSOptions
}

export type SimulationStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'ended'

export interface TranscriptEntry {
  role: 'user' | 'avatar'
  content: string
  timestamp: number
}

export interface SimulationState {
  status: SimulationStatus
  transcript: TranscriptEntry[]
  creditBalance: number
  creditsUsed: number
  simulationId: string | null
  avatarId: string | null
  error: string | null
}
