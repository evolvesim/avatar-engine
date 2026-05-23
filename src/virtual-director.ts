/**
 * virtual-director.ts — Secondary LLM cognitive pipeline
 *
 * Implements the "Virtual Director" architecture from the research spec.
 *
 * The primary LLM generates dialogue. This module fires a CONCURRENT,
 * asynchronous secondary LLM call that:
 *   1. Performs sentiment analysis → base_emotion + intensity
 *   2. Extracts kinetic cues     → gesture_cues[] with word-index triggers
 *   3. Validates against Zod schema before touching the render layer
 *
 * The Virtual Director is provider-agnostic — it works with Azure OpenAI,
 * OpenAI, or any OpenAI-compatible endpoint. Each Evolve product can point
 * it at a different model/endpoint via VirtualDirectorConfig.
 *
 * Output feeds:
 *   - EmotionStateMachine.set()           (persistent emotion)
 *   - SkeletalAnimationController.queue() (gesture cues)
 */

import { z } from 'zod'
import type { EmotionId } from './emotion-state'
import { EmotionStateMachine } from './emotion-state'

// ── Zod schema ────────────────────────────────────────────────────────────────

/**
 * Strict schema validated before any data reaches the render layer.
 * If validation fails, the system falls back to 'neutral' — it never crashes.
 */
const GestureCueSchema = z.object({
  /** Must exactly match a key in the loaded animation dictionary */
  anim_id:     z.string(),
  /** The text token that triggers this gesture */
  target_word: z.string(),
  /** Zero-based word index for disambiguation */
  word_index:  z.number().int().nonnegative(),
  /**
   * Optional crossfade duration in seconds.
   * Default: 0.25s (per research spec)
   */
  crossfade_duration: z.number().min(0).max(2).optional().default(0.25),
})

const PerformanceDataSchema = z.object({
  /**
   * Persistent base emotion for this utterance.
   * Stays active until the next Virtual Director call changes it.
   */
  base_emotion:      z.enum([
    'neutral', 'joy', 'anger', 'sadness', 'surprise',
    'fear', 'disgust', 'empathy', 'concentration', 'confusion',
  ]),
  /**
   * Scalar intensity multiplier 0.0–1.0.
   * Prevents mechanical repetition of identical expressions.
   */
  emotion_intensity: z.number().min(0).max(1),
  /** Ordered array of word-indexed skeletal animation triggers */
  gesture_cues:      z.array(GestureCueSchema),
})

export type PerformanceData   = z.infer<typeof PerformanceDataSchema>
export type GestureCue        = z.infer<typeof GestureCueSchema>

// ── Provider configuration ────────────────────────────────────────────────────

export interface VirtualDirectorConfig {
  /**
   * OpenAI-compatible chat completions endpoint.
   *
   * Azure OpenAI (AU region, Evolve B2B):
   *   'https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-01'
   *
   * OpenAI direct (EvySim B2C fallback):
   *   'https://api.openai.com/v1/chat/completions'
   */
  endpoint: string

  /**
   * Authorization header value.
   * Azure: 'Bearer <azure-openai-key>'
   * OpenAI: 'Bearer sk-...'
   */
  apiKey: string

  /**
   * Model identifier.
   * Azure: not required in URL-based deployments (set in endpoint).
   * OpenAI: 'gpt-4o-mini' (fast + cheap for this secondary pipeline)
   */
  model?: string

  /**
   * Maximum tokens for the Virtual Director response.
   * The JSON payload is small — 256 tokens is more than enough.
   * Default: 256
   */
  maxTokens?: number

  /**
   * Temperature for the Virtual Director.
   * Low = deterministic classification. Default: 0.3
   */
  temperature?: number
}

// ── Virtual Director ──────────────────────────────────────────────────────────

export class VirtualDirector {
  private config: Required<VirtualDirectorConfig>
  private availableAnimIds: string[]
  private availableEmotions: EmotionId[]

  constructor(config: VirtualDirectorConfig, availableAnimIds: string[]) {
    this.config = {
      model:       config.model       ?? 'gpt-4o-mini',
      maxTokens:   config.maxTokens   ?? 256,
      temperature: config.temperature ?? 0.3,
      ...config,
    }
    this.availableAnimIds  = availableAnimIds
    this.availableEmotions = EmotionStateMachine.availableEmotions()
  }

  /**
   * Update the available animation IDs after the animation dictionary loads.
   * Call this once the binary dictionary has been parsed.
   */
  updateAnimIds(ids: string[]): void {
    this.availableAnimIds = ids
  }

  // ── System prompt ───────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `You are a Virtual Director for a real-time 3D avatar system. Your only job is to analyse dialogue and output a JSON performance script.

AVAILABLE EMOTIONS (enum — use exact string):
${this.availableEmotions.join(', ')}

AVAILABLE ANIMATION IDs (enum — anim_id must be EXACTLY one of these):
${this.availableAnimIds.length > 0 ? this.availableAnimIds.join(', ') : '(none loaded yet — use empty gesture_cues array)'}

OUTPUT FORMAT — respond with ONLY this JSON, no explanation, no markdown:
{
  "base_emotion": "<emotion_id>",
  "emotion_intensity": <0.0 to 1.0>,
  "gesture_cues": [
    {
      "anim_id": "<exact animation id from list above>",
      "target_word": "<word from dialogue>",
      "word_index": <zero-based integer>,
      "crossfade_duration": 0.25
    }
  ]
}

RULES:
1. base_emotion MUST be one of the available emotions listed above.
2. anim_id MUST be one of the available animation IDs listed above. If none fit, use an empty gesture_cues array.
3. emotion_intensity 0.1 = subtle, 0.5 = moderate, 1.0 = maximum expression. Vary it to prevent mechanical repetition.
4. word_index is zero-based counting ALL words in the dialogue string split by spaces.
5. gesture_cues should contain 0–3 gestures per utterance. Do not over-gesture.
6. Output ONLY the raw JSON object. No prose, no markdown code blocks.`
  }

  // ── Primary analyse method ──────────────────────────────────────────────────

  /**
   * Analyse a dialogue string and return a validated PerformanceData payload.
   *
   * Called concurrently with the primary TTS call — never awaited before
   * audio starts. The caller applies the result at the appropriate word
   * boundary during audio playback.
   *
   * Returns a safe neutral fallback on any error — never throws.
   */
  async analyse(dialogue: string): Promise<PerformanceData> {
    const FALLBACK: PerformanceData = {
      base_emotion:      'neutral',
      emotion_intensity:  0,
      gesture_cues:      [],
    }

    if (!dialogue.trim()) return FALLBACK

    try {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'system',  content: this.buildSystemPrompt() },
          { role: 'user',    content: `Analyse this dialogue:\n\n"${dialogue}"` },
        ],
        max_tokens:  this.config.maxTokens,
        temperature: this.config.temperature,
      }
      // Only include model key for non-Azure endpoints
      if (this.config.model !== 'gpt-4o-mini' || !this.config.endpoint.includes('openai.azure.com')) {
        body.model = this.config.model
      }

      const res = await fetch(this.config.endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': this.config.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000), // 4s hard timeout — audio must not wait
      })

      if (!res.ok) {
        console.warn(`[VirtualDirector] API error ${res.status} — using neutral fallback`)
        return FALLBACK
      }

      const data = await res.json()
      const raw  = data?.choices?.[0]?.message?.content ?? ''

      // Strip markdown code fences if the model disobeys
      const json = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()

      const parsed     = JSON.parse(json)
      const validated  = PerformanceDataSchema.safeParse(parsed)

      if (!validated.success) {
        console.warn('[VirtualDirector] Schema validation failed:', validated.error.flatten())
        return FALLBACK
      }

      // Filter out any anim_ids that aren't in the loaded dictionary
      const safe = validated.data
      safe.gesture_cues = safe.gesture_cues.filter(cue => {
        const valid = this.availableAnimIds.includes(cue.anim_id)
        if (!valid) {
          console.warn(`[VirtualDirector] Unknown anim_id "${cue.anim_id}" — removed`)
        }
        return valid
      })

      return safe
    } catch (err) {
      console.warn('[VirtualDirector] Error during analysis:', err)
      return FALLBACK
    }
  }
}
