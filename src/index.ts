/**
 * @evolve/avatar-engine — public barrel export
 *
 * Two downstream products consume this package:
 *   - acts-education-portal  (training context, Azure TTS + training director)
 *   - evolve-dnd             (RPG context, ElevenLabs + character director)
 *
 *   import {
 *     AvatarCanvas, useAvatarEngine,
 *     AzureTTSAdapter, ElevenLabsAdapter, MockTTSAdapter,
 *     trainingDirectorConfig, characterDirectorConfig,
 *   } from '@evolve/avatar-engine'
 */

// ── Core re-exports ───────────────────────────────────────────────────────────
export * from './core'

// ── Adapters ──────────────────────────────────────────────────────────────────
export * from './adapters'

// ── Director configs ──────────────────────────────────────────────────────────
export * from './director-configs'
