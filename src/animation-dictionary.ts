/**
 * animation-dictionary.ts — Binary animation dictionary loader
 *
 * The research spec is explicit: do NOT load individual .fbx files at runtime.
 * Instead, compile all chosen animations into a single binary GLB (packed via
 * the Mesh2Motion platform or Blender) and load it once during app init.
 *
 * Architecture:
 *
 *   BUILD TIME (scripts/compile-animations.ts):
 *     Source GLBs/FBXs from Quaternius + Mesh2Motion + Mixamo
 *       → Blender --background --python pack_animations.py
 *       → Single animations.glb (all tracks, no mesh geometry, <500KB target)
 *       → public/avatar-engine/animations.glb
 *
 *   RUNTIME (this file):
 *     AnimationDictionary.load('/avatar-engine/animations.glb')
 *       → THREE.AnimationClip[] parsed from GLB
 *       → Indexed by clip.name (string)
 *       → AnimationMixer.clipAction(clip) on demand
 *
 * Animation naming convention (strict — Virtual Director must match exactly):
 *   <source>_<emotion>_<action>
 *   e.g. 'quaternius_neutral_idle'
 *        'mixamo_anger_dismissive_wave'
 *        'quaternius_joy_talking_hands'
 *        'mesh2motion_sadness_head_down'
 *
 * Sources & licensing:
 *   Quaternius Universal Animation Library — CC0 Public Domain
 *   Mesh2Motion — CC0 / MIT
 *   Mixamo (Adobe) — Free for commercial use
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnimationEntry {
  clip:      THREE.AnimationClip
  /** Emotion context this animation is appropriate for */
  emotion:   string
  /** Whether this clip loops (idle) or plays once (gesture) */
  loop:      THREE.AnimationActionLoopStyles
  /** Default crossfade duration when transitioning to/from this clip */
  defaultCrossfade: number
}

export type AnimationDictionaryState = 'idle' | 'loading' | 'ready' | 'error'

// ── Curated animation manifest ────────────────────────────────────────────────

/**
 * Defines which clips from the packed GLB correspond to which emotions.
 * Add entries here as animations are added to the compiled dictionary.
 *
 * This manifest is the single source of truth fed to the Virtual Director
 * prompt builder so the LLM knows exactly what animation IDs are valid.
 */
export const ANIMATION_MANIFEST: Record<string, Omit<AnimationEntry, 'clip'>> = {
  // ── Idle loops (emotion-tinted ambient movement) ──
  'quaternius_neutral_idle':        { emotion: 'neutral',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },
  'quaternius_joy_breathing_idle':  { emotion: 'joy',           loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },
  'quaternius_anger_tense_idle':    { emotion: 'anger',         loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },
  'quaternius_sadness_slumped':     { emotion: 'sadness',       loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },
  'quaternius_concentration_idle':  { emotion: 'concentration', loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },

  // ── Conversational gestures (play once, return to idle) ──
  'mixamo_neutral_talking_default':       { emotion: 'neutral',  loop: THREE.LoopOnce, defaultCrossfade: 0.25 },
  'mixamo_neutral_thoughtful_nod':        { emotion: 'neutral',  loop: THREE.LoopOnce, defaultCrossfade: 0.25 },
  'mixamo_neutral_head_shake':            { emotion: 'neutral',  loop: THREE.LoopOnce, defaultCrossfade: 0.25 },
  'mixamo_joy_talking_hands':             { emotion: 'joy',      loop: THREE.LoopOnce, defaultCrossfade: 0.25 },
  'mixamo_joy_thumbs_up':                 { emotion: 'joy',      loop: THREE.LoopOnce, defaultCrossfade: 0.25 },
  'mixamo_anger_dismissive_wave':         { emotion: 'anger',    loop: THREE.LoopOnce, defaultCrossfade: 0.2  },
  'mixamo_anger_pointing':                { emotion: 'anger',    loop: THREE.LoopOnce, defaultCrossfade: 0.2  },
  'mixamo_anger_arms_crossed':            { emotion: 'anger',    loop: THREE.LoopRepeat, defaultCrossfade: 0.4 },
  'mixamo_sadness_apologetic_hands':      { emotion: 'sadness',  loop: THREE.LoopOnce, defaultCrossfade: 0.35 },
  'mixamo_sadness_head_down':             { emotion: 'sadness',  loop: THREE.LoopOnce, defaultCrossfade: 0.35 },
  'mixamo_surprise_step_back':            { emotion: 'surprise', loop: THREE.LoopOnce, defaultCrossfade: 0.15 },
  'mixamo_empathy_open_hands':            { emotion: 'empathy',  loop: THREE.LoopOnce, defaultCrossfade: 0.3  },
  'mixamo_empathy_leaning_forward':       { emotion: 'empathy',  loop: THREE.LoopRepeat, defaultCrossfade: 0.4 },
  'mixamo_concentration_chin_stroke':     { emotion: 'concentration', loop: THREE.LoopOnce, defaultCrossfade: 0.3 },
  'mixamo_confusion_head_tilt':           { emotion: 'confusion', loop: THREE.LoopOnce, defaultCrossfade: 0.25 },
  'mesh2motion_neutral_weight_shift':     { emotion: 'neutral',  loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },
  'mesh2motion_joy_celebratory_clap':     { emotion: 'joy',      loop: THREE.LoopOnce, defaultCrossfade: 0.2  },
  'mesh2motion_sadness_shoulder_slump':   { emotion: 'sadness',  loop: THREE.LoopRepeat, defaultCrossfade: 0.5 },
}

// ── Animation dictionary ──────────────────────────────────────────────────────

export class AnimationDictionary {
  private clips:  Map<string, AnimationEntry> = new Map()
  private state:  AnimationDictionaryState = 'idle'
  private error:  Error | null = null
  private _onReady: (() => void)[] = []

  get status(): AnimationDictionaryState { return this.state }
  get loadError(): Error | null           { return this.error  }

  /**
   * Returns all animation IDs currently loaded.
   * Fed to VirtualDirector.updateAnimIds() after load completes.
   */
  get animationIds(): string[] {
    return Array.from(this.clips.keys())
  }

  /**
   * Load the packed animation GLB asynchronously.
   * Called once during app initialisation — does not block rendering.
   *
   * @param url  Path to the compiled animations.glb in /public
   */
  async load(url: string): Promise<void> {
    if (this.state === 'loading' || this.state === 'ready') return
    this.state = 'loading'

    return new Promise((resolve) => {
      const loader = new GLTFLoader()
      loader.load(
        url,
        (gltf) => {
          for (const clip of gltf.animations) {
            const manifest = ANIMATION_MANIFEST[clip.name]
            if (!manifest) {
              // Unknown clip in dictionary — still index it, use neutral defaults
              console.warn(`[AnimationDictionary] No manifest entry for clip "${clip.name}" — indexing with neutral defaults`)
              this.clips.set(clip.name, {
                clip,
                emotion:           'neutral',
                loop:              THREE.LoopOnce,
                defaultCrossfade:  0.25,
              })
              continue
            }
            this.clips.set(clip.name, { clip, ...manifest })
          }
          this.state = 'ready'
          console.info(`[AnimationDictionary] Loaded ${this.clips.size} animation clips from ${url}`)
          this._onReady.forEach(cb => cb())
          this._onReady = []
          resolve()
        },
        undefined,
        (err) => {
          this.error = err instanceof Error ? err : new Error(String(err))
          this.state = 'error'
          console.error('[AnimationDictionary] Failed to load:', this.error)
          resolve() // Don't reject — graceful degradation (no gestures, still functional)
        }
      )
    })
  }

  /**
   * Register a callback to fire when the dictionary finishes loading.
   * If already loaded, fires immediately.
   */
  onReady(cb: () => void): void {
    if (this.state === 'ready') { cb(); return }
    this._onReady.push(cb)
  }

  /**
   * Retrieve an AnimationEntry by ID.
   * Returns null if not loaded or ID unknown.
   */
  get(id: string): AnimationEntry | null {
    return this.clips.get(id) ?? null
  }

  /**
   * Return all clips for a given emotion, sorted with LoopRepeat (idle) clips last.
   * Used by the skeletal controller to pick a context-appropriate idle animation.
   */
  getByEmotion(emotion: string): AnimationEntry[] {
    return Array.from(this.clips.values())
      .filter(e => e.emotion === emotion)
      .sort((a, b) => {
        if (a.loop === THREE.LoopRepeat && b.loop !== THREE.LoopRepeat) return 1
        if (a.loop !== THREE.LoopRepeat && b.loop === THREE.LoopRepeat) return -1
        return 0
      })
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const animationDictionary = new AnimationDictionary()
