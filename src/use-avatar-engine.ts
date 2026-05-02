/**
 * use-avatar-engine.ts — React hook for creating and managing an AvatarEngine
 *
 * Handles engine creation, ref initialisation, and cleanup.
 * Each product creates one engine instance per simulation session.
 *
 * Usage:
 *
 *   // Evolve B2B (Azure TTS, Virtual Director on Azure OpenAI)
 *   const engine = useAvatarEngine({
 *     tts: {
 *       provider: 'azure',
 *       azure: { tokenEndpoint: '/api/speech/token', voiceName: 'en-AU-WilliamNeural' },
 *     },
 *     virtualDirector: {
 *       endpoint: process.env.NEXT_PUBLIC_AZURE_OAI_ENDPOINT!,
 *       apiKey:   `Bearer ${process.env.NEXT_PUBLIC_AZURE_OAI_KEY}`,
 *     },
 *   })
 *
 *   // EvySim B2C (ElevenLabs, Virtual Director on OpenAI)
 *   const engine = useAvatarEngine({
 *     tts: {
 *       provider: 'elevenlabs',
 *       elevenlabs: { signedUrlEndpoint: '/api/elevenlabs-signed-url' },
 *     },
 *     virtualDirector: {
 *       endpoint:    'https://api.openai.com/v1/chat/completions',
 *       apiKey:      `Bearer ${process.env.NEXT_PUBLIC_OPENAI_KEY}`,
 *       model:       'gpt-4o-mini',
 *     },
 *   })
 *
 *   // ACTS Education (Azure TTS, Virtual Director on Azure OpenAI)
 *   const engine = useAvatarEngine({
 *     tts: {
 *       provider: 'azure',
 *       azure: { tokenEndpoint: '/api/speech/token', voiceName: 'en-AU-AnnetteNeural' },
 *     },
 *   })
 *
 *   // Then:
 *   <AvatarCanvas engine={engine} glbUrl="/avatars/acts-guide.glb" lightingPreset="education" />
 *   await engine.handleDialogue("Hello, let's practice your presentation.")
 */

'use client'

import { useRef, useEffect, useMemo } from 'react'
import { AvatarEngine, type AvatarEngineConfig } from './avatar-engine'
import type { VisemeEvent } from './types'

export function useAvatarEngine(config: AvatarEngineConfig): AvatarEngine {
  // Refs shared between engine and AvatarCanvas
  const visemeQueueRef = useRef<VisemeEvent[]>([])
  const visemeStartRef = useRef<number>(0)
  const isSpeakingRef  = useRef<boolean>(false)

  // Create engine once — config changes are not reactive by design
  // (changing TTS provider mid-session would be disruptive)
  const engine = useMemo(() => {
    return new AvatarEngine(config, {
      visemeQueueRef,
      visemeStartRef,
      isSpeakingRef,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — engine is session-scoped

  // Cleanup on unmount
  useEffect(() => {
    return () => { engine.dispose() }
  }, [engine])

  return engine
}
