/**
 * use-avatar-engine.ts — React hook for creating and managing an AvatarEngine
 *
 * Handles engine creation, ref initialisation, and cleanup.
 * Each product creates one engine instance per simulation session.
 *
 * Usage:
 *
 *   // ACTS / Evolve B2B (Azure + training director)
 *   const adapter = new AzureTTSAdapter({
 *     tokenEndpoint: '/api/speech/token',
 *     voiceName: 'en-AU-WilliamNeural',
 *   })
 *   const engine = useAvatarEngine({
 *     adapter,
 *     directorConfig: trainingDirectorConfig,
 *     virtualDirector: { endpoint: '...', apiKey: 'Bearer ...' },
 *   })
 *
 *   // Evolve RPG (ElevenLabs + character director)
 *   const adapter = new ElevenLabsAdapter({ agentId: '...', mascotbotWsUrl: 'wss://...' })
 *   const engine = useAvatarEngine({
 *     adapter,
 *     directorConfig: characterDirectorConfig,
 *   })
 */

'use client'

import { useRef, useEffect, useMemo } from 'react'
import { AvatarEngine, type AvatarEngineConfig } from './avatar-engine'
import type { VisemeEvent } from './types'

export function useAvatarEngine(config: AvatarEngineConfig): AvatarEngine {
  const visemeQueueRef = useRef<VisemeEvent[]>([])
  const visemeStartRef = useRef<number>(0)
  const isSpeakingRef  = useRef<boolean>(false)

  // Engine is session-scoped — config changes are not reactive.
  const engine = useMemo(() => {
    return new AvatarEngine(config, {
      visemeQueueRef,
      visemeStartRef,
      isSpeakingRef,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => { engine.dispose() }
  }, [engine])

  return engine
}
