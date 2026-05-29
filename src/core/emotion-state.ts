/**
 * emotion-state.ts — Persistent emotional state machine
 *
 * Implements the FACS→ARKit mapping from the research spec.
 *
 * KEY DESIGN: Emotions persist until explicitly changed. An angry avatar stays
 * angry through subsequent utterances until the Virtual Director emits a new
 * base_emotion. This matches human behaviour — emotional states are durable,
 * not reset per sentence.
 *
 * Architecture:
 *   Virtual Director JSON → EmotionStateMachine.set(emotion, intensity)
 *                                      ↓
 *                    emotionWeights (ARKit blendshape targets, 0–1)
 *                                      ↓
 *              AvatarCanvas useFrame → additive blend with viseme layer
 */

// ── Emotion identifiers ───────────────────────────────────────────────────────

export type EmotionId =
  | 'neutral'
  | 'joy'
  | 'anger'
  | 'sadness'
  | 'surprise'
  | 'fear'
  | 'disgust'
  | 'empathy'
  | 'concentration'
  | 'confusion'

// ── ARKit blendshape weight map ───────────────────────────────────────────────

export type ARKitWeights = Partial<Record<string, number>>

/**
 * Full FACS→ARKit translation matrix derived from the research spec +
 * Melinda Ozel's cheat sheet + HapFACS 3.0 AU mappings.
 *
 * All weights are at intensity=1.0 (maximum). The EmotionStateMachine scales
 * them by the emotion_intensity scalar from the Virtual Director.
 */
const EMOTION_PRESETS: Record<EmotionId, ARKitWeights> = {
  neutral: {},

  // Duchenne smile: zygomaticus major + orbicularis oculi (crow's feet)
  joy: {
    mouthSmileLeft:    0.8,
    mouthSmileRight:   0.8,
    cheekSquintLeft:   0.6,
    cheekSquintRight:  0.6,
    eyeSquintLeft:     0.3,
    eyeSquintRight:    0.3,
  },

  // Corrugator contraction (brow down) + orbicularis oris (lip press)
  anger: {
    browDownLeft:      0.9,
    browDownRight:     0.9,
    mouthPressLeft:    0.5,
    mouthPressRight:   0.5,
    eyeSquintLeft:     0.4,
    eyeSquintRight:    0.4,
    noseSneerLeft:     0.2,
    noseSneerRight:    0.2,
  },

  // Medial frontalis (inner brow up) + depressor anguli oris (mouth corners down)
  sadness: {
    browInnerUp:       0.8,
    mouthFrownLeft:    0.6,
    mouthFrownRight:   0.6,
    eyeLookDownLeft:   0.2,
    eyeLookDownRight:  0.2,
    mouthPucker:       0.1,
  },

  // Empathy mirrors sadness with softer mouth, adds attentive gaze
  empathy: {
    browInnerUp:       0.5,
    mouthFrownLeft:    0.2,
    mouthFrownRight:   0.2,
    eyeLookDownLeft:   0.1,
    eyeLookDownRight:  0.1,
    mouthSmileLeft:    0.15,
    mouthSmileRight:   0.15,
  },

  // Full frontalis elevation + masseter relaxation (jaw drop)
  surprise: {
    browOuterUpLeft:   0.9,
    browOuterUpRight:  0.9,
    browInnerUp:       0.9,
    eyeWideLeft:       0.8,
    eyeWideRight:      0.8,
    jawOpen:           0.4,
  },

  // Fear: brow up + wide eyes + slight mouth stretch (fight-or-flight)
  fear: {
    browOuterUpLeft:   0.7,
    browOuterUpRight:  0.7,
    browInnerUp:       0.6,
    eyeWideLeft:       0.9,
    eyeWideRight:      0.9,
    mouthStretchLeft:  0.3,
    mouthStretchRight: 0.3,
    jawOpen:           0.2,
  },

  // Disgust: levator labii (nose sneer) + brow down asymmetric
  disgust: {
    noseSneerLeft:     0.6,
    noseSneerRight:    0.6,
    browDownLeft:      0.4,
    browDownRight:     0.4,
    mouthFrownLeft:    0.4,
    mouthFrownRight:   0.4,
    mouthShrugUpper:   0.3,
  },

  // Concentration: brow furrow, slight squint, focused expression
  concentration: {
    browDownLeft:      0.5,
    browDownRight:     0.5,
    browInnerUp:       0.3,
    eyeSquintLeft:     0.2,
    eyeSquintRight:    0.2,
    mouthPressLeft:    0.2,
    mouthPressRight:   0.2,
  },

  // Confusion: asymmetric brow raise, slight head tilt implied, mouth open slightly
  confusion: {
    browOuterUpLeft:   0.6,
    browInnerUp:       0.4,
    eyeWideLeft:       0.3,
    mouthFrownLeft:    0.2,
    mouthFrownRight:   0.2,
    jawOpen:           0.1,
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
   * utterances. An angry avatar stays angry.
   */
  set(id: EmotionId, intensity: number, speechAttenuation = 1.0): void {
    const preset = EMOTION_PRESETS[id] ?? {}
    const scaled: ARKitWeights = {}
    for (const [key, base] of Object.entries(preset)) {
      scaled[key] = (base as number) * Math.max(0, Math.min(1, intensity))
    }
    this._state = {
      id,
      intensity: Math.max(0, Math.min(1, intensity)),
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
