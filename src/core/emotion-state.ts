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
  // Boosted 0.3.69: smile 0.8→1.0, cheek 0.6→0.85, eyeSquint 0.3→0.5
  joy: {
    mouthSmileLeft:    1.0,
    mouthSmileRight:   1.0,
    cheekSquintLeft:   0.85,
    cheekSquintRight:  0.85,
    eyeSquintLeft:     0.5,
    eyeSquintRight:    0.5,
  },

  // Corrugator contraction (brow down) + orbicularis oris (lip press)
  // Boosted 0.3.69: browDown already strong, press 0.5→0.7, squint 0.4→0.6
  anger: {
    browDownLeft:      1.0,
    browDownRight:     1.0,
    mouthPressLeft:    0.7,
    mouthPressRight:   0.7,
    eyeSquintLeft:     0.6,
    eyeSquintRight:    0.6,
    noseSneerLeft:     0.35,
    noseSneerRight:    0.35,
  },

  // Medial frontalis (inner brow up) + depressor anguli oris (mouth corners down)
  // Boosted 0.3.69: frown 0.6→0.85, eyeLookDown 0.2→0.35, pucker 0.1→0.2
  sadness: {
    browInnerUp:       0.9,
    mouthFrownLeft:    0.85,
    mouthFrownRight:   0.85,
    eyeLookDownLeft:   0.35,
    eyeLookDownRight:  0.35,
    mouthPucker:       0.2,
  },

  // Empathy mirrors sadness with softer mouth, adds attentive gaze
  // Boosted 0.3.69: ALL values doubled — was too subtle at typical intensities
  empathy: {
    browInnerUp:       0.7,
    mouthFrownLeft:    0.4,
    mouthFrownRight:   0.4,
    eyeLookDownLeft:   0.25,
    eyeLookDownRight:  0.25,
    mouthSmileLeft:    0.3,
    mouthSmileRight:   0.3,
  },

  // Full frontalis elevation + masseter relaxation (jaw drop)
  // Boosted 0.3.69: jawOpen 0.4→0.55 for more visible open-mouth surprise
  surprise: {
    browOuterUpLeft:   1.0,
    browOuterUpRight:  1.0,
    browInnerUp:       1.0,
    eyeWideLeft:       0.9,
    eyeWideRight:      0.9,
    jawOpen:           0.55,
  },

  // Fear: brow up + wide eyes + slight mouth stretch (fight-or-flight)
  // Boosted 0.3.69: stretch 0.3→0.5, jawOpen 0.2→0.35
  fear: {
    browOuterUpLeft:   0.85,
    browOuterUpRight:  0.85,
    browInnerUp:       0.75,
    eyeWideLeft:       1.0,
    eyeWideRight:      1.0,
    mouthStretchLeft:  0.5,
    mouthStretchRight: 0.5,
    jawOpen:           0.35,
  },

  // Disgust: levator labii (nose sneer) + brow down asymmetric
  // Boosted 0.3.69: sneer 0.6→0.85, frown 0.4→0.65, shrugUpper 0.3→0.5
  disgust: {
    noseSneerLeft:     0.85,
    noseSneerRight:    0.85,
    browDownLeft:      0.6,
    browDownRight:     0.6,
    mouthFrownLeft:    0.65,
    mouthFrownRight:   0.65,
    mouthShrugUpper:   0.5,
  },

  // Concentration: brow furrow, slight squint, focused expression
  // Boosted 0.3.69: browDown 0.5→0.75, browInnerUp 0.3→0.5, squint 0.2→0.4, press 0.2→0.4
  concentration: {
    browDownLeft:      0.75,
    browDownRight:     0.75,
    browInnerUp:       0.5,
    eyeSquintLeft:     0.4,
    eyeSquintRight:    0.4,
    mouthPressLeft:    0.4,
    mouthPressRight:   0.4,
  },

  // Confusion: asymmetric brow raise, slight head tilt implied, mouth open slightly
  // Boosted 0.3.69: browOuterUp 0.6→0.85, browInnerUp 0.4→0.65, eyeWide 0.3→0.55, frown 0.2→0.4, jawOpen 0.1→0.25
  confusion: {
    browOuterUpLeft:   0.85,
    browInnerUp:       0.65,
    eyeWideLeft:       0.55,
    mouthFrownLeft:    0.4,
    mouthFrownRight:   0.4,
    jawOpen:           0.25,
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
    const clamped = Math.max(0, Math.min(1, intensity))
    // 0.3.69: Power-curve lift — raises mid-range intensities so subtle VD calls
    // are still clearly visible. Formula: intensity^0.6 lifts 0.3→0.46, 0.5→0.66,
    // 0.7→0.79, while preserving 0=0 and 1=1 boundaries.
    // For neutral (no preset keys) this is a no-op.
    const boosted = clamped > 0 ? Math.pow(clamped, 0.6) : 0
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
