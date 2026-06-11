/**
 * virtual-director.ts — Secondary LLM cognitive pipeline
 *
 * Implements the "Virtual Director" architecture from the research spec.
 *
 * The primary LLM generates dialogue. This module fires a CONCURRENT,
 * asynchronous secondary LLM call that:
 *   1. Performs sentiment analysis → base_emotion + intensity
 *   2. Selects a talking alias  → which talking animation plays during speech
 *   3. Extracts gesture cues    → gesture_cues[] with word-index triggers
 *   4. Optionally sets a new persistent facial expression → set_expression
 *   5. Validates against Zod schema before touching the render layer
 *
 * The Virtual Director is provider-agnostic — it works with Azure OpenAI,
 * OpenAI, or any OpenAI-compatible endpoint. Each Evolve product can point
 * it at a different model/endpoint via VirtualDirectorConfig.
 *
 * Output feeds:
 *   - EmotionStateMachine.set()           (persistent expression)
 *   - SkeletalAnimationController.queue() (gesture cues)
 *   - talking alias selection             (which talking clip plays during TTS)
 *
 * Emotion taxonomy (v0.3.86 — 8 emotions):
 *   neutral, happy, sadness, surprise, empathy, thoughtful, displeasure, tension
 *
 * Expression persistence model:
 *   - set_expression is a PERSISTENT state — it stays on the avatar's face
 *     until the next set_expression call changes it.
 *   - Only emit set_expression when the emotional tone genuinely shifts
 *     (typically every 3–5 exchanges, not every utterance).
 *   - The expression shows BETWEEN words and UNDERNEATH all viseme mouth shapes.
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
    'neutral', 'happy', 'sadness', 'surprise',
    'empathy', 'thoughtful', 'displeasure', 'tension',
  ]),
  /**
   * Scalar intensity multiplier 0.0–1.0.
   * Prevents mechanical repetition of identical expressions.
   */
  emotion_intensity: z.number().min(0).max(1),

  /**
   * Which talking animation alias to play during TTS speech.
   * Pick from the talking_alias list in the system prompt.
   * This controls body language while the avatar is speaking.
   */
  talking_alias: z.string().optional(),

  /** Ordered array of word-indexed skeletal animation triggers */
  gesture_cues:      z.array(GestureCueSchema),

  /**
   * Persistent facial expression to set NOW.
   * Only emit when the emotional tone genuinely shifts (every 3–5 exchanges).
   * null = keep current expression unchanged.
   * The expression stays on the face until the next set_expression call.
   */
  set_expression: z.enum([
    'neutral', 'happy', 'sadness', 'surprise',
    'empathy', 'thoughtful', 'displeasure', 'tension',
  ]).nullable().optional(),

  /**
   * Brief human-readable reason why the expression changed (or null).
   * For logging and debugging only — not shown to the user.
   */
  expression_reason: z.string().nullable().optional(),
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
   * The JSON payload is small — 300 tokens is enough for the new schema.
   * Default: 300
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
  private systemPromptOverride: string | undefined

  constructor(
    config: VirtualDirectorConfig,
    availableAnimIds: string[],
    systemPromptOverride?: string,
  ) {
    this.config = {
      model:       config.model       ?? 'gpt-4o-mini',
      maxTokens:   config.maxTokens   ?? 300,
      temperature: config.temperature ?? 0.3,
      ...config,
    }
    this.availableAnimIds  = availableAnimIds
    this.availableEmotions = EmotionStateMachine.availableEmotions()
    this.systemPromptOverride = systemPromptOverride
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
    const intro = this.systemPromptOverride
      ?? `You are a Virtual Director for a real-time 3D avatar system. Your only job is to analyse dialogue and output a JSON performance script.`
    return `${intro}

━━━ EMOTION TAXONOMY (8 emotions — use exact string) ━━━
neutral      — resting/baseline, professional composure
happy        — warm, positive, engaged (Duchenne smile)
sadness      — grief, disappointment, low energy
surprise     — shock, delight, unexpected news
empathy      — compassion, understanding, attentive listening
thoughtful   — reflecting, analysing, problem-solving (furrowed brow)
displeasure  — frustration, annoyance, disapproval
tension      — stress, anxiety, concern, high stakes

━━━ EXPRESSION PERSISTENCE RULES ━━━
CRITICAL: set_expression is PERSISTENT STATE — it stays on the avatar's face
until you explicitly change it in a future response.

Rules:
1. Only emit set_expression when the emotional tone GENUINELY SHIFTS.
   — Typical cadence: every 3–5 exchanges, NOT every utterance.
   — Do NOT flip expressions constantly — it looks robotic.
2. Once set, an expression persists through all subsequent responses until
   you emit a different set_expression.
3. For a new conversation or scene reset: emit set_expression: "neutral".
4. The expression LAYERS UNDERNEATH lip-sync — it shows on the face BETWEEN
   words and as a persistent base even while the avatar is speaking.
5. Use emotion_intensity (0.1–1.0) to control how pronounced the expression
   is. 0.3 = subtle background emotion. 0.7 = clearly visible. 1.0 = peak.

━━━ TALKING ALIASES (which body animation plays during speech) ━━━
Pick one that best matches the tone of this utterance:

talking_neutral        — calm, measured delivery
talking_explain        — instructional, explanatory gestures
talking_warm           — friendly, approachable tone
talking_expressive     — animated, emotive storytelling
talking_enthusiastic   — high energy, excited delivery
talking_focused        — concentrated, precise explanation
talking_empathetic     — compassionate, caring tone
talking_making_point   — assertive, emphasis-driven
talking_short          — brief reply, minimal movement
talking_quick          — fast-paced, energetic response

━━━ GESTURE ALIASES (one-off emphasis animations — word-indexed) ━━━
gesture_explain         — two-handed illustrative gesture
gesture_agree           — forward nod + open hands (agreement)
gesture_agree_quick     — quick single nod (short confirmation)
gesture_wave            — friendly greeting wave
gesture_clap            — celebratory clap
gesture_fist_pump       — victory / achievement moment
gesture_celebrate       — full celebration
gesture_empathy         — open hands toward audience (empathetic reach)
gesture_hand_to_heart   — hand to chest (sincerity / apology)
gesture_dismiss         — dismissive wave (rejecting an idea)
gesture_shake_no        — head shake left-right (disagreement)
gesture_think_nod       — thinking nod (processing / considering)
gesture_think_shake     — uncertain head tilt (unsure)
gesture_deciding        — weighing gesture (pros/cons)
gesture_open_forward    — palms open forward (transparency)
gesture_sigh_relief     — exhale + shoulder drop (tension released)
gesture_point           — directional point (directing attention)
gesture_assert          — firm downward gesture (authority)
gesture_delight         — delighted reaction
gesture_blow_kiss       — playful, affectionate
gesture_excited_dance   — full-body excitement (use sparingly)

AVAILABLE ANIMATION IDs (enum — anim_id must be EXACTLY one of these):
${this.availableAnimIds.length > 0 ? this.availableAnimIds.join(', ') : '(none loaded yet — use empty gesture_cues array)'}

━━━ GESTURE RULES ━━━
1. Pick 0–3 gesture_cues per response. Do NOT over-gesture.
2. Space gestures across the text (different word_index values).
3. Use gesture aliases for strong emphasis, declarations, or emotional peaks.
4. Never pick the same gesture twice in one response.
5. Match gesture energy to talking_alias energy.

━━━ OUTPUT FORMAT ━━━
Respond with ONLY this JSON, no explanation, no markdown:
{
  "base_emotion": "<emotion_id>",
  "emotion_intensity": <0.0 to 1.0>,
  "talking_alias": "<talking alias from list above>",
  "gesture_cues": [
    {
      "anim_id": "<exact animation id from list above>",
      "target_word": "<word from dialogue>",
      "word_index": <zero-based integer>,
      "crossfade_duration": 0.25
    }
  ],
  "set_expression": "<emotion_id> or null",
  "expression_reason": "<brief reason or null>"
}

HARD RULES:
1. base_emotion MUST be one of: neutral, happy, sadness, surprise, empathy, thoughtful, displeasure, tension
2. anim_id MUST be one of the available animation IDs listed above (or omit gesture_cues entirely).
3. emotion_intensity 0.1 = subtle, 0.5 = moderate, 1.0 = maximum. Vary it to prevent mechanical repetition.
4. word_index is zero-based, counting ALL words in the dialogue string split by spaces.
5. set_expression: only include when emotion genuinely shifts. Otherwise set to null.
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
      talking_alias:     'talking_neutral',
      gesture_cues:      [],
      set_expression:    null,
      expression_reason: null,
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
