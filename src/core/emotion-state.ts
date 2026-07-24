/**
 * emotion-state.ts — Persistent emotional state machine
 *
 * Implements the FACS→ARKit mapping from the research spec.
 *
 * KEY DESIGN: Emotions persist until explicitly changed. A sad avatar stays
 * sad through subsequent utterances until the Virtual Director emits a new
 * base_emotion. This matches human behaviour — emotional states are durable,
 * not reset per sentence.
 *
 * Architecture:
 *   Virtual Director JSON → EmotionStateMachine.set(emotion, intensity)
 *                                      ↓
 *                    emotionWeights (ARKit blendshape targets, 0–1)
 *                                      ↓
 *              AvatarCanvas useFrame → additive blend with viseme layer
 *
 * Taxonomy (v0.5.34 — 7 emotions; surprise + tension removed):
 *   neutral      — baseline, professional composure
 *   happy        — pleased / agreeing / delighted (Duchenne smile)
 *   thoughtful   — reflecting / analysing / considering (brow furrow)
 *   sadness      — disappointment / empathetic sorrow / low energy
 *   displeasure  — anger / skepticism / annoyance / frustration
 *   shy          — bashful / hesitant / demure (uses the empathy face)
 *   empathy      — compassion / understanding (FACE-ONLY: no dedicated
 *                  gesture/idle; layered over a neutral body)
 *
 * `sadness` is the canonical token for the sad register (its preset actually
 * moves the face). `shy` reuses the empathy preset. Body animation exists for
 * every token except `empathy`, which the VD applies as a facial layer only.
 */

// ── Emotion identifiers ───────────────────────────────────────────────────────

export type EmotionId =
  | 'neutral'
  | 'happy'
  | 'thoughtful'
  | 'sadness'
  | 'displeasure'
  | 'shy'
  | 'empathy'

// ── ARKit blendshape weight map ───────────────────────────────────────────────

export type ARKitWeights = Partial<Record<string, number>>

/**
 * Full FACS→ARKit translation matrix derived from the research spec +
 * Melinda Ozel's cheat sheet + HapFACS 3.0 AU mappings.
 *
 * All weights are at intensity=1.0 (maximum). The EmotionStateMachine scales
 * them by the emotion_intensity scalar from the Virtual Director.
 */
// v0.5.5 — presets softened by ~30-40% overall. Prior values (0.72–0.8) read as
// cartoonish on high-fidelity CC4 rigs where a small morph delta already carries
// strong facial semantics. eyeWide capped at 0.45 (was 0.72/0.8) — real humans
// rarely open eyes past ~0.5 outside genuine shock, and higher values produce
// the "deer in headlights" look during idle+gesture blending.
const EMOTION_PRESETS: Record<EmotionId, ARKitWeights> = {
  neutral: {},

  // happy (formerly joy) — Duchenne smile: zygomaticus major + orbicularis oculi (crow's feet)
  happy: {
    mouthSmileLeft:    0.55,
    mouthSmileRight:   0.55,
    cheekSquintLeft:   0.45,
    cheekSquintRight:  0.45,
    eyeSquintLeft:     0.28,
    eyeSquintRight:    0.28,
  },

  // sadness — medial frontalis (inner brow up) + depressor anguli oris (mouth corners down)
  sadness: {
    browInnerUp:       0.5,
    mouthFrownLeft:    0.45,
    mouthFrownRight:   0.45,
    eyeLookDownLeft:   0.2,
    eyeLookDownRight:  0.2,
    mouthPucker:       0.1,
  },

  // empathy — mirrors sadness with softer mouth, adds attentive gaze
  empathy: {
    browInnerUp:       0.38,
    mouthFrownLeft:    0.22,
    mouthFrownRight:   0.22,
    eyeLookDownLeft:   0.14,
    eyeLookDownRight:  0.14,
    mouthSmileLeft:    0.16,
    mouthSmileRight:   0.16,
  },

  // shy — reuses the empathy face (soft inner-brow, gentle downward gaze,
  // faint frown-into-smile). Reads as bashful/demure, not sad.
  shy: {
    browInnerUp:       0.38,
    mouthFrownLeft:    0.22,
    mouthFrownRight:   0.22,
    eyeLookDownLeft:   0.14,
    eyeLookDownRight:  0.14,
    mouthSmileLeft:    0.16,
    mouthSmileRight:   0.16,
  },

  // thoughtful (replaces concentration + confusion) — brow furrow, reflective
  thoughtful: {
    browDownLeft:      0.42,
    browDownRight:     0.42,
    browInnerUp:       0.28,
    eyeSquintLeft:     0.22,
    eyeSquintRight:    0.22,
    mouthPressLeft:    0.22,
    mouthPressRight:   0.22,
  },

  // displeasure (replaces anger + disgust) — corrugator contraction + levator labii
  displeasure: {
    browDownLeft:      0.55,
    browDownRight:     0.55,
    mouthPressLeft:    0.38,
    mouthPressRight:   0.38,
    eyeSquintLeft:     0.32,
    eyeSquintRight:    0.32,
    noseSneerLeft:     0.28,
    noseSneerRight:    0.28,
    mouthFrownLeft:    0.22,
    mouthFrownRight:   0.22,
  },
}

// ── Emotion state machine ─────────────────────────────────────────────────────

export interface EmotionState {
  id:        EmotionId
  intensity: number         // 0.0–1.0 scalar from Virtual Director
  weights:   ARKitWeights   // scaled ARKit targets (intensity applied)
  /**
   * Attenuation factor α applied during active speech.
   * Per the research spec: momentarily softens emotion to prioritise
   * clear phonetic articulation. Range 0.4–0.8 (0.65 is a good default).
   */
  speechAttenuation: number
}

export class EmotionStateMachine {
  private _state: EmotionState = {
    id:                'neutral',
    intensity:          0,
    weights:           {},
    speechAttenuation:  1.0,   // no attenuation — emotions show fully while speaking
  }

  /**
   * Returns the current emotion state.
   * The same object reference is returned until set() is called —
   * safe to read in a useFrame loop without triggering React re-renders.
   */
  get state(): EmotionState {
    return this._state
  }

  /**
   * Set a new persistent emotion.
   *
   * Called by the Virtual Director when performance_data.base_emotion changes.
   * The emotion STAYS until this is called again — it does not reset between
   * utterances. A tense avatar stays tense.
   */
  set(id: EmotionId, intensity: number, speechAttenuation = 1.0): void {
    const preset = EMOTION_PRESETS[id] ?? {}
    const clamped = Math.max(0, Math.min(1, intensity))
    // v0.5.5 — softer power-curve (0.6 → 0.8). Prior 0.6 lifted mid-intensities
    // too aggressively (0.5→0.66, 0.7→0.81), pushing every emotion toward its
    // maximum. 0.8 gives 0.5→0.57, 0.7→0.75 — subtle stays subtle.
    const boosted = clamped > 0 ? Math.pow(clamped, 0.8) : 0
    const scaled: ARKitWeights = {}
    for (const [key, base] of Object.entries(preset)) {
      scaled[key] = (base as number) * boosted
    }
    this._state = {
      id,
      intensity: clamped,
      weights:   scaled,
      speechAttenuation,
    }
  }

  /**
   * Blend toward neutral over a specified number of frames.
   * Useful for gradual wind-down if the LLM does not specify a new emotion
   * for several turns. Call this from the render loop each frame.
   *
   * Returns the updated weights (does NOT mutate state — caller should
   * decide when to commit via set('neutral', 0)).
   */
  blendTowardNeutral(lerpFactor: number): ARKitWeights {
    const blended: ARKitWeights = {}
    for (const [key, value] of Object.entries(this._state.weights)) {
      const v = value ?? 0
      blended[key] = v * (1 - lerpFactor)
    }
    return blended
  }

  /**
   * Get the effective ARKit weights for a given frame, taking speech
   * attenuation into account.
   *
   * @param isSpeaking  true while the avatar is actively speaking (TTS playing)
   */
  effectiveWeights(isSpeaking: boolean): ARKitWeights {
    if (!isSpeaking) return this._state.weights
    const α = this._state.speechAttenuation
    const attenuated: ARKitWeights = {}
    for (const [key, value] of Object.entries(this._state.weights)) {
      attenuated[key] = (value ?? 0) * α
    }
    return attenuated
  }

  /**
   * Expose the raw preset table so the Virtual Director prompt builder
   * can enumerate available emotion IDs.
   */
  static availableEmotions(): EmotionId[] {
    return Object.keys(EMOTION_PRESETS) as EmotionId[]
  }
}

// ── Singleton export for shared use across components ─────────────────────────

/**
 * Application-level singleton. All three products share one instance via the
 * AvatarEngine class. Components should not instantiate this directly.
 */
export const emotionStateMachine = new EmotionStateMachine()
