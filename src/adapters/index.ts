/**
 * adapters/index.ts — re-exports all TTS adapter implementations.
 */

export { AzureTTSAdapter }            from './azure'
export type { AzureAdapterConfig }    from './azure'

export { ElevenLabsAdapter }          from './elevenlabs'
export type { ElevenLabsAdapterConfig } from './elevenlabs'

export { MockTTSAdapter }             from './mock'
export type { MockSpeechEvent }       from './mock'
