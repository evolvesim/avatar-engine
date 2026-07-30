/**
 * AvatarCanvas.tsx — Shared avatar engine for all Evolve Simulations products
 *
 * Integrates all subsystems from the animation system design:
 *   - Viseme queue drain + ARKit morph target lerp
 *   - Additive blending (emotion baseline × α + viseme + procedural)
 *   - Emotion-persistent facial expression state machine
 *   - Skeletal animation controller (AnimationMixer + WordBoundary triggers)
 *   - Procedural micro-animations (blink, respiration, head tracking, saccades)
 *   - WebAudio FFT fallback for non-Azure providers
 *   - T-pose correction for Avaturn GLBs
 *   - Camera framing presets
 *   - Lighting presets (boardroom / consumer / education)
 *
 * ─── Architecture ─────────────────────────────────────────────────────────────
 *
 *   AvatarEngine
 *     → visemeQueueRef (Azure viseme events)
 *     → emotionStateMachine (persistent FACS→ARKit)
 *     → skeletalController (AnimationMixer + gestures)
 *     → fftFallback (WebAudio amplitude)
 *          ↓
 *   useFrame (60fps):
 *     drain viseme queue → viseme ARKit weights
 *     emotion.effectiveWeights(isSpeaking) → attenuated emotion weights
 *     fftFallback.tick() → fallback weights (if viseme queue empty)
 *     ocular tick → blink + saccade weights
 *     additiveBlend(emotion, viseme|fft, procedural)
 *     lerpWeightMap(current, target, delta)
 *     applyWeightsToMeshes(lerped, meshRefs)
 *     tickRespiration → spine/chest bones
 *     tickHeadTracking → neck/head bones (FFT amplitude)
 *     skeletalController.update(delta)
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   <AvatarCanvas
 *     engine={avatarEngine}
 *     glbUrl="/avatars/professional-male.glb"
 *     cameraPreset="head-and-shoulders"
 *     lightingPreset="boardroom"
 *   />
 */

'use client'

import React, {
  Suspense,
  useRef,
  useEffect,
  useMemo,
} from 'react'
import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import * as THREE from 'three'

import type { AvatarEngine }     from './avatar-engine'
import type {
  CameraPreset,
  LightingPreset,
  TTSAdapter,
  DirectorConfig,
} from './types'
import { CAMERA_PRESETS }        from './types'
import { VISEME_TO_ARKIT, AVATURN_MESH_NAMES, buildVisemeTargets } from './viseme-map'
import {
  additiveBlend,
  lerpWeightMap,
  applyWeightsToMeshes,
} from './additive-blend'
import {
  createOcularState,
  createRespirationState,
  createHeadTrackingState,
  createGazeState,
  tickOcularMechanics,
  tickRespiration,
  tickHeadTracking,
  tickGaze,
  tickGazeEyeContact,
  fixTPose,
  findBone,
} from './procedural-animations'
import type { ARKitWeights } from './emotion-state'
import { hasFaceRig, mergeFaceRig } from './merge-face-rig'

/**
 * Default URL for the engine-shipped donor face rig (canonical Avaturn face meshes
 * + ARKit blendshapes + `avaturn_animation` idle). Consumers can override via the
 * `faceRigUrl` prop, but the typical case is to leave this default — the engine
 * ships face-rig.glb under /avatar-engine/.
 *
 * IMPORTANT: This is a path relative to the host site's public root. The hosting
 * product (Evolve RPG / ACTS / EvySim) must serve `face-rig.glb` at this URL —
 * either by copying it from `node_modules/@evolvesim/avatar-engine/public/avatar-engine/`
 * to its own `public/avatar-engine/` directory, or by setting up a build-time
 * symlink. See the upload-pipeline section in the 3d-avatar-lipsync skill.
 */
export const DEFAULT_FACE_RIG_URL = '/avatar-engine/face-rig.glb'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AvatarCanvasProps {
  engine:          AvatarEngine
  /**
   * TTSAdapter for this avatar. The engine already holds an adapter; this prop
   * is exposed for callers that want to wire the adapter explicitly at the
   * canvas level (e.g. for conversational-mode connect/disconnect on mount).
   * If omitted, `engine.adapter` is used.
   */
  adapter?:        TTSAdapter
  /** Optional VirtualDirector preset — defaults to trainingDirectorConfig in callers. */
  directorConfig?: DirectorConfig
  glbUrl?:         string
  /**
   * URL of the canonical face rig GLB used when `mergeFaceRig` is true (or auto-
   * detected as needed). Defaults to `DEFAULT_FACE_RIG_URL` (engine-shipped asset).
   * The donor must contain the six face meshes (Head_Mesh, Teeth_Mesh, Tongue_Mesh,
   * Eye_Mesh, Eyelash_Mesh, EyeAO_Mesh) with ARKit blendshapes and an `avaturn_animation`
   * clip. See merge-face-rig.ts for the contract.
   */
  faceRigUrl?:     string
  /**
   * Controls whether the engine merges the face rig (`faceRigUrl`) into the body
   * GLB at load time.
   *   - `'auto'` (default): merge only when the body GLB has no ARKit blendshapes
   *     (i.e. body-only Avaturn exports). Already-rigged GLBs are left untouched.
   *   - `true`: always merge.
   *   - `false`: never merge (body GLB must already have face meshes + ARKit shapes).
   *
   * The `'auto'` mode is what every product upload pipeline should use — drop
   * any Avaturn export in and the engine handles the rest.
   */
  mergeFaceRig?:   'auto' | boolean
  cameraPreset?:   CameraPreset
  lightingPreset?: LightingPreset
  /**
   * Per-light intensity overrides on top of `lightingPreset`. Intended for live
   * tuning (the playground exposes these as sliders); omit in production to use
   * the preset's calibrated values.
   */
  lightingOverrides?: LightingOverrides
  bodyRotationY?:  number
  /**
   * Y offset applied to the avatar primitive in world space.
   * Default -1.52 (Avaturn standard Hips=1.52m).
   * Override if your GLB's Hips bone is at a different height.
   * Use: -(headWorldY - cameraTargetY) to frame head at the camera target.
   *
   * Issue #4 (May 2026): prior 0.3.1 publish appeared to ignore this prop
   * for some consumers. Republished as 0.3.2 from a clean build to ensure
   * the prop reaches the underlying `<primitive>` correctly. The prop chain
   * is: AvatarCanvas → AvatarScene → `<primitive position={[x, y, 0]}>`.
   */
  avatarYOffset?:  number
  /**
   * When false, skip the Avaturn-arm `fixTPose()` correction.
   * Default true (back-compatible — corrects classic Avaturn T-pose exports).
   * Set false when consuming an Avaturn A-pose export or any rig that already
   * has natural arm rotation and does NOT need the ±1.1 rad shoulder fix.
   */
  applyTPoseFix?:  boolean
  /**
   * X offset applied to the avatar primitive in world space. Default 0 (centred).
   * Use this for horizontal positioning inside the canvas — CSS translates on the
   * wrapper don't move the avatar visually because the camera re-centres around
   * world X=0. Example: `avatarXOffset={-0.1}` nudges the avatar 10cm to the left.
   */
  avatarXOffset?:  number
  /**
   * When true, automatically compute `avatarYOffset` at runtime by measuring
   * the head bone's world Y position in the loaded GLB. Overrides any
   * manually supplied `avatarYOffset` value.
   *
   * The formula targets Y ≈ 1.6 in camera space (the `head-and-shoulders`
   * camera preset target): `computedOffset = -(headWorldY - 1.6)`.
   *
   * If no head bone is found, falls back to the supplied `avatarYOffset`
   * prop (or the default `-1.52`) and logs a warning.
   *
   * Default: false (backwards-compatible).
   */
  autoCalibrate?:  boolean
  /**
   * Override the camera world-space position. When supplied, takes precedence
   * over the `cameraPreset` position. Format: [x, y, z].
   * Example: `cameraPosition={[0, -0.1, 1.4]}` lowers the camera so it looks
   * up at the avatar's face, achieving natural eye contact.
   */
  cameraPosition?: [number, number, number]
  /**
   * Override the camera look-at target. When supplied, takes precedence over
   * the `cameraPreset` target. Format: [x, y, z].
   */
  cameraTarget?:   [number, number, number]
  /**
   * URL to a custom animation pack GLB file.
   * When provided, the AnimationDictionary reloads clips from this URL.
   * Changing this prop at runtime triggers a pack reload.
   *
   * Pack options (set by admin or avatar builder):
   *   '/avatar-engine/animations.glb'        — default (RPM clips, all styles)
   *   '/avatar-engine/animations-pack1.glb'  — Pack 1: Motion Male (mx_m_)
   *   '/avatar-engine/animations-pack2.glb'  — Pack 2: Motion Female (mx_f_ + cross-pack)
   *   '/avatar-engine/animations-pack3.glb'  — Pack 3: RPM Male (rpm_, rpm2_)
   *   '/avatar-engine/animations-pack4.glb'  — Pack 4: RPM Female (rpm2f_)
   *   '/avatar-engine/animations-pack5.glb'  — Pack 5: MoCap Central Male (mc_m_)
   *   '/avatar-engine/animations-pack6.glb'  — Pack 6: MoCap Central Female (mc_f_)
   *   '/avatar-engine/animations-pack7.glb'  — Pack 7: Legal test set (Judge, Lawyer x2, Witness)
   *   '/avatar-engine/animations-pack8.glb'  — Pack 8: MCU Motion Capture Unity idle (mcu_)
   *
   * Default: undefined (keeps the engine's existing loaded dictionary)
   */
  animationPackUrl?: string
  className?:      string
}

// ── Camera setup ──────────────────────────────────────────────────────────────

function CameraSetup({
  preset,
  positionOverride,
  targetOverride,
}: {
  preset: CameraPreset
  positionOverride?: [number, number, number]
  targetOverride?: [number, number, number]
}) {
  const { camera } = useThree()
  const cfg = CAMERA_PRESETS[preset]

  useEffect(() => {
    const pos = positionOverride ?? cfg.position
    const tgt = targetOverride   ?? cfg.target
    camera.position.set(...pos)
    ;(camera as THREE.PerspectiveCamera).fov = cfg.fov
    ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    camera.lookAt(...tgt)
  }, [camera, cfg, positionOverride, targetOverride])

  return null
}

// ── Image-based lighting ──────────────────────────────────────────────────────
//
// v0.5.37 — the missing half of the v0.5.36 lighting rebalance. Cutting total
// light energy (to stop skin highlights clipping into ACES tonemapping's white
// rolloff) left the scene simply DARK, because nothing replaced the energy the
// flat ambient had been supplying.
//
// An environment map is the right replacement: it puts the light back as soft,
// directional, all-around illumination instead of a flat ambient term, which is
// also what gives skin its gradients and a believable fresnel falloff. three
// ships RoomEnvironment (a small procedurally-lit box), so this needs NO HDRI
// download, no CDN fetch, and no new dependency — important because the engine
// must build offline and the products vendor it as a plain file: dependency.
//
// Note: `scene.environmentIntensity` does not exist in three 0.160, so env
// strength is controlled per-material via `envMapIntensity` (see ENV_MAP_*).
function EnvironmentIBL() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const rt = pmrem.fromScene(room, 0.04)
    scene.environment = rt.texture
    return () => {
      scene.environment = null
      rt.dispose()
      pmrem.dispose()
      // RoomEnvironment builds real geometry/materials — release them.
      room.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((mm) => mm?.dispose())
      })
    }
  }, [gl, scene])
  return null
}

// How strongly the environment lights each surface. Skin sits slightly lower so
// the IBL reads as soft scatter rather than a reflective sheen — the exact
// problem we are trying to remove.
// v0.5.38 — halved. RoomEnvironment is a brightly-lit box and contributes far
// more irradiance than first assumed: at 1.0 it blew skin midtones out entirely
// and lit the avatar much hotter than the backdrop plate it composites over,
// which reads as "pasted on". Skin is pulled down hardest — it is the surface
// whose highlights clip first and the one we most need to keep midtones in.
// v0.5.44 — cut hard. Evidence from the portal: with ambient 0 and the direct
// lights at 0.17/0.23/0.26, the render was indistinguishable from the original
// ambient-0.95 + key-1.5 setup, and moving those direct values changed nothing
// visible. That only holds if the ENVIRONMENT is supplying essentially all the
// light — env went 0.69 -> 0.65 across those builds (6%), which is precisely why
// consecutive builds looked identical. RoomEnvironment is a brightly-lit box, so
// at that strength it drowns every other source and flattens the face.
// It is now a subtle wrap-around fill; the softbox does the shaping.
const ENV_MAP_INTENSITY      = 0.18
const ENV_MAP_INTENSITY_SKIN = 0.13

// ── Soft key (softbox) ────────────────────────────────────────────────────────
//
// v0.5.39 — a directionalLight is a hard, infinitely-distant source: it gives a
// sharp terminator and a small specular hotspot, which is exactly the "lit by a
// bare bulb" look. A RectAreaLight is a real area source (a softbox), so the
// terminator is broad and the specular is a soft rectangle rather than a point.
// That is what "soft directional" means physically, and it lets ambient — the
// flat, shape-destroying term — be cut right back while the face still reads.
//
// RectAreaLight only affects MeshStandardMaterial / MeshPhysicalMaterial (all CC
// and RPM materials are), needs its LTC lookup tables initialised once, and does
// not cast shadows — the low directional key below stays for that.
const SOFT_KEY_SIZE     = 2.6
// Offset RELATIVE to the lit subject's face, not absolute world space. The
// portal leaves CC4 bodies at full height and raises the camera to eyeHeight
// (~1.67m) instead of auto-calibrating the head down to CAMERA_TARGET_Y, so a
// hard-coded world position put this softbox at chest height aimed at the FLOOR.
// RectAreaLight is single-sided, so the face — above and behind its emitting
// surface — received exactly nothing, leaving the environment map to do all the
// lighting: bright and flat, the very symptom the softbox was added to fix.
const SOFT_KEY_OFFSET: [number, number, number] = [1.1, 0.8, 1.7]
// RectAreaLight intensity is not in the same units as a directionalLight, so the
// preset's `keyIntensity` is scaled by this to keep one intuitive slider range.
const SOFT_KEY_GAIN = 3.5

let rectAreaLibReady = false

/**
 * Build fingerprint, logged once on mount. Bump with the package version — it is
 * the only way to tell "this lighting change looks wrong" apart from "this build
 * is not the code you think it is", which cost several release cycles once.
 */
const ENGINE_BUILD = '0.5.45'
let lightingFingerprintLogged = false

function SoftKeyLight({ color, intensity, focusY }: { color: string; intensity: number; focusY: number }) {
  const ref = useRef<THREE.RectAreaLight>(null)
  if (!rectAreaLibReady) {
    RectAreaLightUniformsLib.init()
    rectAreaLibReady = true
  }
  useEffect(() => {
    // Aim at the face, wherever it actually is for this rig and framing.
    ref.current?.lookAt(0, focusY, 0)
  })
  return (
    <rectAreaLight
      ref={ref}
      color={color}
      intensity={intensity * SOFT_KEY_GAIN}
      width={SOFT_KEY_SIZE}
      height={SOFT_KEY_SIZE}
      position={[SOFT_KEY_OFFSET[0], focusY + SOFT_KEY_OFFSET[1], SOFT_KEY_OFFSET[2]]}
    />
  )
}

/**
 * A directionalLight that actually points at the face.
 *
 * v0.5.44 — a directionalLight's direction is (position - target), and its
 * target defaults to the world origin. v0.5.42 raised these lights by focusY to
 * "follow the face", which instead made them steeply TOP-DOWN: at focusY 1.54 a
 * light at [2, 5.54, 3] aimed at (0,0,0) rakes the top of the head and barely
 * touches the face. Offsetting the target by the same focusY keeps the intended
 * angle (the raw offset vector) while re-aiming at the head.
 *
 * The default target is not part of the scene graph, so its matrix has to be
 * updated by hand or three keeps using a stale one.
 */
function AimedDirectionalLight({
  color, intensity, position, focusY, castShadow = false,
}: {
  color: string
  intensity: number
  position: [number, number, number]
  focusY: number
  castShadow?: boolean
}) {
  const ref = useRef<THREE.DirectionalLight>(null)
  useEffect(() => {
    const light = ref.current
    if (!light) return
    light.target.position.set(0, focusY, 0)
    light.target.updateMatrixWorld()
  })
  return (
    <directionalLight
      ref={ref}
      color={color}
      intensity={intensity}
      position={position}
      castShadow={castShadow}
    />
  )
}

// ── Lighting ──────────────────────────────────────────────────────────────────

/** Per-light intensity overrides, for live tuning (see the playground panel). */
export interface LightingOverrides {
  ambient?: number
  key?:     number
  fill?:    number
  rim?:     number
  /** Environment-map strength (applied to materials, skin scaled down). */
  env?:     number
  /**
   * Rim light direction, in degrees. Azimuth is measured from straight behind
   * the camera axis (+Z) rotating toward the avatar's left (+X); elevation is
   * height above the horizon. Rim angle matters more than rim intensity for
   * edge separation, so these are exposed for tuning.
   */
  rimAzimuth?:   number
  rimElevation?: number
}

// Rim placement. Defaults reproduce the previous hard-coded [-1.5, 2.5, -3]
// exactly (verified by round-trip), so this is a pure refactor until overridden.
const RIM_RADIUS            = 4.18
// v0.5.43 — dialled in on a CC5 character. Elevation is NEGATIVE: the rim now
// sits behind and slightly BELOW the face rather than above it, which skims the
// jaw and neck instead of the top of the head.
const RIM_AZIMUTH_DEFAULT   = -152
const RIM_ELEVATION_DEFAULT = -20

function rimPosition(azimuthDeg: number, elevationDeg: number, focusY: number): [number, number, number] {
  const a = (azimuthDeg   * Math.PI) / 180
  const e = (elevationDeg * Math.PI) / 180
  return [
    RIM_RADIUS * Math.cos(e) * Math.sin(a),
    focusY + RIM_RADIUS * Math.sin(e),
    RIM_RADIUS * Math.cos(e) * Math.cos(a),
  ]
}

function Lighting({ preset, overrides, focusY }: { preset: LightingPreset; overrides?: LightingOverrides; focusY: number }) {
  // v0.5.22 — boardroom softened for lifelike skin: the key was a hard white
  // 1.4 directional that blew a specular hotspot on skin. Warmed slightly and
  // eased, fill warmed + lifted, and ambient raised so the face is lit by soft
  // room fill rather than a single spotlight. consumer/education keep their prior
  // look (ambientIntensity 0.7). Per-preset ambientIntensity.
  // v0.5.36 — total light energy cut and a rim added. Every preset summed to
  // ~3.3–3.4 across ambient+key+fill, which pushed skin highlights into ACES
  // tonemapping's white rolloff — read as a waxy sheen no amount of roughness
  // could remove. Totals now land ~2.6: the face is still clearly lit, but the
  // highlights sit inside the tonemap's linear range instead of clipping.
  // A back/rim light adds edge separation (the shape cue flat frontal lighting
  // destroys) at a cost the energy reduction more than pays for.
  // v0.5.37 — now that EnvironmentIBL supplies broad soft illumination, ambient
  // steps back to a small tint term (it was the flat, shape-destroying part) and
  // the key comes back up. Direct total ~2.4 PLUS the environment, which lands
  // brighter overall than the original 3.35 flat-ambient setup while keeping
  // highlights inside the tonemap's linear range.
  // v0.5.38 — direct light cut alongside ENV_MAP_INTENSITY. The key takes the
  // largest reduction because it is what produces the specular hotspot that
  // clips first on skin. Avatars composite over a photographic backdrop, so the
  // target is matching that plate's exposure, not "as bright as possible" —
  // over-lighting the avatar relative to its background is what reads as pasted-on.
  // v0.5.39 — two corrections.
  //
  // 1. AMBIENT DOWN, DIRECTIONAL UP. Ambient is a flat term applied equally to
  //    every surface, so it actively destroys the shading gradients that make a
  //    face read as a face. It is now a small tint only; shaping comes from the
  //    soft key.
  // 2. PRESETS MATCHED BY LUMINANCE, NOT RAW INTENSITY. The presets previously
  //    summed to similar intensity numbers but very different actual brightness,
  //    because boardroom's lights are near-white while consumer's fill is a dark
  //    saturated purple. Measured with Rec.709 luma, boardroom came out ~40%
  //    brighter than consumer — which is exactly why the portal (boardroom) read
  //    "too bright" while the playground (consumer) read "too dark" at the same
  //    numbers. Intensities are now scaled per preset so all three land at a
  //    comparable luminance, and the low-luma purple fill is compensated up.
  // v0.5.40 — boardroom is now the values dialled in on a real CC5 character
  // against the café backdrop (ambient 0, key 0.41, fill 0.23, rim 0.63,
  // env 0.69). Ambient lands at ZERO: the softbox and the environment carry the
  // whole frame, which is what finally removed the flat, pasted-on look.
  //
  // consumer/education keep their colour identity but are derived from those
  // numbers by matching Rec.709 LUMINANCE per channel, not by copying the raw
  // values — e.g. consumer's fill (#8e44ad) has ~1/6th the luma of boardroom's
  // (#dde4ea), so it needs ~6x the intensity to contribute the same light. This
  // is the correction that stopped the two previews disagreeing.
  // v0.5.45 — main's (0.5.35) values restored verbatim for ambient/key/fill,
  // because main is the version that actually looked right. The only addition is
  // a modest rim, which main did not have; set rim to 0 to get main exactly.
  // Tune from here with the playground sliders rather than from first principles
  // — every value derived analytically so far has been wrong in practice.
  const configs = {
    boardroom: { ambient: '#eef3f7', ambientIntensity: 0.95, key: '#fdfdff', keyIntensity: 1.5, fill: '#dde4ea', fillIntensity: 0.9, rim: '#eaf2ff', rimIntensity: 0.25 },
    consumer:  { ambient: '#c7a8f5', ambientIntensity: 0.70, key: '#ffffff', keyIntensity: 1.6, fill: '#8e44ad', fillIntensity: 0.4, rim: '#d9c2ff', rimIntensity: 0.30 },
    education: { ambient: '#e8f5e9', ambientIntensity: 0.70, key: '#ffffff', keyIntensity: 1.5, fill: '#aed6f1', fillIntensity: 0.5, rim: '#dcefff', rimIntensity: 0.28 },
  }
  const c = configs[preset]
  // v0.5.41 — build/lighting fingerprint. The portal spent several releases
  // rendering a stale vendored engine while looking identical, which is
  // indistinguishable from "the lighting change did nothing" unless the running
  // build identifies itself. Logged once per mount so which code is actually
  // live is never a guess again.
  if (!lightingFingerprintLogged) {
    lightingFingerprintLogged = true
    // Stringified, not an object: the browser collapses objects to "Object" and
    // the interesting numbers stay hidden behind a disclosure triangle in a
    // console that is already noisy.
    console.info(
      `[AvatarCanvas] ENGINE ${ENGINE_BUILD} — lighting '${preset}': ` + JSON.stringify({
        ambient: overrides?.ambient ?? c.ambientIntensity,
        softKey: overrides?.key     ?? c.keyIntensity,
        fill:    overrides?.fill    ?? c.fillIntensity,
        rim:     overrides?.rim     ?? c.rimIntensity,
        env:     overrides?.env     ?? ENV_MAP_INTENSITY,
        softKeyIsRectAreaLight: true,
        // The height the lights are aimed at. If this reads ~0.1 for a CC4
        // avatar framed at eye height (~1.4-1.7), the key is missing the face.
        focusY: Number(focusY.toFixed(3)),
      }),
    )
  }
  const ambientI = overrides?.ambient ?? c.ambientIntensity
  const keyI     = overrides?.key     ?? c.keyIntensity
  const fillI    = overrides?.fill    ?? c.fillIntensity
  const rimI     = overrides?.rim     ?? c.rimIntensity
  const rimPos   = rimPosition(
    overrides?.rimAzimuth   ?? RIM_AZIMUTH_DEFAULT,
    overrides?.rimElevation ?? RIM_ELEVATION_DEFAULT,
    focusY,
  )
  return (
    <>
      {/* v0.5.45 — back to main's rig: ambient + directionals, no softbox.
          The RectAreaLight is gone with the environment map. On its own, without
          IBL to fill the shadow side, a single area light left the face
          half-dark, and it cannot cast shadows either. main's arrangement is the
          one that actually looked right; it is the baseline again, with the
          lights aimed at the face and a rim available on top. */}
      <ambientLight color={c.ambient} intensity={ambientI} />
      <AimedDirectionalLight color={c.key}  intensity={keyI}  position={[2, focusY + 4, 3]}   focusY={focusY} castShadow />
      <AimedDirectionalLight color={c.fill} intensity={fillI} position={[-2, focusY + 2, -1]} focusY={focusY} />
      {/* Rim / back light — direction set by rimAzimuth / rimElevation. */}
      <AimedDirectionalLight color={c.rim}  intensity={rimI}  position={rimPos}               focusY={focusY} />
    </>
  )
}

// ── Avatar scene ──────────────────────────────────────────────────────────────

const HEAD_BONE_NAMES = ['head', 'mixamorighead', 'bip001_head']

// Guard against re-running the merge on the same cached GLTF. useLoader returns
// the same object across re-renders; we mutate it in place once, then skip.
const mergedBodies = new WeakSet<object>()
// Camera target Y for the 'head-and-shoulders' preset (see CAMERA_PRESETS in types.ts).
// autoCalibrate shifts the avatar so the head bone sits at this Y in world space,
// putting the head at the camera's look-at point and framing it correctly.
const CAMERA_TARGET_Y = 0.1

// CC4 bone-assisted jaw: radians of jaw-bone pitch per unit of `jawOpen` weight.
// jawOpen peaks at ~0.30 for open vowels, so the bone contributes ~6° of chin
// drop at full open — a natural speech jaw excursion on top of the Jaw_Open
// morph, well short of a yawn.
const CC4_JAW_BONE_RAD_PER_WEIGHT = 0.52

// ── Procedural skin detail (v0.5.36) ──────────────────────────────────────────
//
// CC exports ship NO roughness map and NO AO map — verified against real CC5
// Headshot 3 GLBs (Std_Skin_* carry a flat roughnessFactor 0.7 plus baseColor +
// normal, nothing else). A single flat roughness scalar means every square
// millimetre of the face reflects light identically, which is the classic "CG
// plastic" tell — far more than the roughness VALUE itself. And once the normal
// map is exported at 512 (needed to keep GLBs small) the pore-scale detail that
// breaks up skin shading is simply gone, so the surface reads glass-smooth.
//
// Both are fixed here at zero asset cost: one small tileable noise texture,
// generated once and shared by every avatar, used two ways —
//   • as a roughnessMap, so specular varies across the face (oily vs matte)
//   • as a fine detail-normal (shader-injected), restoring pore-scale shading
// This is why the export resolution stops mattering for pores: the micro-detail
// comes from here, not from the GLB's normal map.
const SKIN_DETAIL_TEX_SIZE = 256
// Roughness range the noise is mapped into. Mean ≈ 0.80 — real skin sits around
// 0.6–0.9 and VARIES; the old flat 0.97 floor traded "shiny plastic" for
// "matte clay", which is equally unconvincing.
const SKIN_ROUGH_MIN = 0.66
const SKIN_ROUGH_MAX = 0.94
// How many times the noise tiles across the skin UV atlas for each use.
const SKIN_ROUGH_REPEAT  = 6   // broad oily/dry zones
const SKIN_DETAIL_REPEAT = 26  // pore-scale micro-shading
const SKIN_DETAIL_STRENGTH = 0.55

let skinDetailTex: THREE.DataTexture | null = null

/**
 * Build (once) a small tileable greyscale value-noise texture used for both the
 * skin roughness map and the injected detail normal. Deterministic — a fixed
 * hash, not Math.random — so every avatar and every reload gets the same grain.
 */
function getSkinDetailTexture(): THREE.DataTexture {
  if (skinDetailTex) return skinDetailTex

  const N = SKIN_DETAIL_TEX_SIZE
  const data = new Uint8Array(N * N * 4)

  // Deterministic hash → [0,1)
  const hash = (x: number, y: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return h - Math.floor(h)
  }
  // Tileable value noise at a given cell frequency (wraps via modulo).
  const valueNoise = (u: number, v: number, freq: number): number => {
    const x = u * freq
    const y = v * freq
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    // smoothstep interpolation
    const sx = xf * xf * (3 - 2 * xf)
    const sy = yf * yf * (3 - 2 * yf)
    const w = (a: number, b: number) => ((a % b) + b) % b
    const p00 = hash(w(xi, freq),     w(yi, freq))
    const p10 = hash(w(xi + 1, freq), w(yi, freq))
    const p01 = hash(w(xi, freq),     w(yi + 1, freq))
    const p11 = hash(w(xi + 1, freq), w(yi + 1, freq))
    return (p00 * (1 - sx) + p10 * sx) * (1 - sy) + (p01 * (1 - sx) + p11 * sx) * sy
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N
      // Multi-octave so the grain clumps like pores rather than looking like TV static.
      const n =
        valueNoise(u, v, 8)  * 0.5 +
        valueNoise(u, v, 16) * 0.3 +
        valueNoise(u, v, 32) * 0.2
      const r = SKIN_ROUGH_MIN + n * (SKIN_ROUGH_MAX - SKIN_ROUGH_MIN)
      const b = Math.round(THREE.MathUtils.clamp(r, 0, 1) * 255)
      const i = (y * N + x) * 4
      data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255
    }
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  skinDetailTex = tex
  return tex
}

/**
 * Inject a tiled detail-normal into a skin material's fragment shader.
 *
 * three applies bumpMap only when no normalMap is present (`#elif` in
 * normal_fragment_maps), and CC skin always has a normalMap — so a second layer
 * of micro-detail has to be added by hand, after the base normal is resolved.
 * The perturbation is deliberately tiny, so approximating the tangent frame in
 * view space is imperceptible and avoids needing tangents.
 */
function attachSkinDetailNormal(mat: THREE.Material, detail: THREE.Texture): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailMap      = { value: detail }
    shader.uniforms.uDetailScale    = { value: SKIN_DETAIL_REPEAT }
    shader.uniforms.uDetailStrength = { value: SKIN_DETAIL_STRENGTH }
    // A missing chunk name would make .replace() a silent no-op — the detail
    // would just never appear, with no error. Fail loudly instead.
    if (!shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
      console.warn(
        '[AvatarCanvas] skin detail-normal: <normal_fragment_maps> chunk not found — ' +
        'three.js shader layout changed; pore detail is inactive.',
      )
      return
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uDetailMap;
         uniform float uDetailScale;
         uniform float uDetailStrength;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         #if defined( USE_MAP )
         {
           vec2 dUv = vMapUv * uDetailScale;
           float e  = 1.0 / ${SKIN_DETAIL_TEX_SIZE.toFixed(1)};
           float h  = texture2D( uDetailMap, dUv ).g;
           float hx = texture2D( uDetailMap, dUv + vec2( e, 0.0 ) ).g;
           float hy = texture2D( uDetailMap, dUv + vec2( 0.0, e ) ).g;
           normal = normalize( normal + uDetailStrength * vec3( h - hx, h - hy, 0.0 ) );
         }
         #endif`,
      )
  }
  // Distinct cache key so these programs never collide with un-patched materials.
  mat.customProgramCacheKey = () => 'evolve-skin-detail-v1'
}

function findHeadBoneByNames(root: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (found) return
    if (HEAD_BONE_NAMES.includes(obj.name.toLowerCase())) {
      found = obj
    }
  })
  return found
}

function AvatarScene({
  engine,
  glbUrl,
  faceRigUrl,
  mergeFaceRigMode,
  bodyRotationY,
  avatarYOffset,
  applyTPoseFix,
  avatarXOffset,
  autoCalibrate,
  envIntensity,
}: {
  engine:           AvatarEngine
  glbUrl:           string
  faceRigUrl:       string
  mergeFaceRigMode: 'auto' | boolean
  bodyRotationY:    number
  avatarYOffset:    number
  applyTPoseFix:    boolean
  avatarXOffset:    number
  autoCalibrate:    boolean
  envIntensity?:    number
}) {
  // Decide up-front whether we need the donor face rig. When `mergeFaceRigMode`
  // is explicitly false the donor URL is omitted from the loader call so the
  // engine never fetches face-rig.glb on already-rigged GLBs.
  // Parallel load: useLoader accepts an array of URLs and returns an array of
  // GLTFs, so body + donor stream together when a merge is possible.
  const loadUrls = mergeFaceRigMode === false ? [glbUrl] : [glbUrl, faceRigUrl]
  const loaded   = useLoader(GLTFLoader, loadUrls) as unknown as (
    typeof loadUrls extends string[] ? Array<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> : never
  )
  const bodyGltf  = loaded[0] as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }
  const donorGltf = loaded[1] as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] } | undefined

  // ── Merge face rig (idempotent, runs once per body GLTF instance) ─────────
  // We mutate the cached bodyGltf so the next time useLoader returns it the merge
  // is already applied. A WeakSet guards against double-merging on re-render.
  const gltf = useMemo(() => {
    if (mergeFaceRigMode === false || !donorGltf) return bodyGltf
    if (mergedBodies.has(bodyGltf)) return bodyGltf
    const shouldMerge = mergeFaceRigMode === true ? true : !hasFaceRig(bodyGltf.scene)
    if (!shouldMerge) {
      console.info('[AvatarCanvas] face rig already present in body GLB — skipping runtime merge.')
      mergedBodies.add(bodyGltf)
      return bodyGltf
    }
    console.info('[AvatarCanvas] merging donor face rig into body GLB.')
    mergeFaceRig(bodyGltf as unknown as Parameters<typeof mergeFaceRig>[0], donorGltf as unknown as Parameters<typeof mergeFaceRig>[1])
    mergedBodies.add(bodyGltf)
    return bodyGltf
  }, [bodyGltf, donorGltf, mergeFaceRigMode])

  // ── Per-mount working copy of the template scene ──────────────────────────
  // useLoader caches the parsed GLTF by URL for the whole SPA session, and
  // everything below MUTATES its scene: rebindSkeletons rewrites skeleton.bones,
  // the mixer animates the bones, bodyRotationY is written every frame. Doing
  // that to the cached template poisons the NEXT load of the same URL (switch
  // away and back, or Sim Creator → sim navigation): the second clone inherits a
  // skeleton wired to the previous mount's orphaned bones and the avatar renders
  // as stretched spikes.
  //
  // Fix: deep-copy the template once per mount (SkeletonUtils.clone gives the
  // copy its own bones AND its own Skeleton), then restore the file's EXACT
  // bindMatrix/bindMatrixInverse pairs — SkeletonUtils calls bind(), which
  // recomputes bindMatrixInverse as a true inverse, but rebindSkeletons' CC4
  // bindMatrix mismatch detection must see the original (possibly inconsistent)
  // pair from the file to apply its fix, exactly as on a first pristine load.
  const workingScene = useMemo(() => {
    const copy = cloneWithSkeleton(gltf.scene)
    const srcMeshes: THREE.SkinnedMesh[] = []
    const dstMeshes: THREE.SkinnedMesh[] = []
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) srcMeshes.push(o as THREE.SkinnedMesh) })
    copy.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) dstMeshes.push(o as THREE.SkinnedMesh) })
    for (let i = 0; i < dstMeshes.length && i < srcMeshes.length; i++) {
      dstMeshes[i].bindMatrix.copy(srcMeshes[i].bindMatrix)
      dstMeshes[i].bindMatrixInverse.copy(srcMeshes[i].bindMatrixInverse)
    }
    return copy
  }, [gltf])
  const scene = useMemo(() => workingScene.clone(true), [workingScene])
  const clips = gltf.animations  // animations live on gltf, NOT on gltf.scene

  // ── R3F camera (for VOR gaze) ─────────────────────────────────────────────
  const { camera } = useThree()

  // ── Compute effective Y offset (auto-calibrate or supplied) ────────────────
  const effectiveYOffset = useMemo(() => {
    if (!autoCalibrate) return avatarYOffset
    workingScene.updateMatrixWorld(true)
    const head = findHeadBoneByNames(workingScene)
    if (!head) {
      console.warn(
        '[AvatarCanvas] autoCalibrate: no head bone found (tried head/mixamorigHead/Bip001_Head). ' +
        'Falling back to avatarYOffset=', avatarYOffset
      )
      return avatarYOffset
    }
    const headWorldY = head.getWorldPosition(new THREE.Vector3()).y
    const computedOffset = -(headWorldY - CAMERA_TARGET_Y)
    console.log(
      '[AvatarCanvas] autoCalibrate: headWorldY=', headWorldY,
      'computed avatarYOffset=', computedOffset
    )
    return computedOffset
  }, [autoCalibrate, avatarYOffset, gltf])

  // ── Mesh refs ──────────────────────────────────────────────────────────────
  const meshRefs = useRef<Record<string, THREE.SkinnedMesh | null>>(
    Object.fromEntries(AVATURN_MESH_NAMES.map(n => [n, null]))
  )

  // ── Bone refs ──────────────────────────────────────────────────────────────
  const headBone         = useRef<THREE.Bone | null>(null)
  const headBoneOriginal = useRef<THREE.Bone | null>(null)  // mixer-driven working scene bone
  const leftEyeBone  = useRef<THREE.Bone | null>(null)      // eye-contact gaze (CC4 + RPM)
  const rightEyeBone = useRef<THREE.Bone | null>(null)
  const neckBone   = useRef<THREE.Bone | null>(null)
  const spineBone  = useRef<THREE.Bone | null>(null)
  const chestBone  = useRef<THREE.Bone | null>(null)

  // ── CC4 jaw bone assist ────────────────────────────────────────────────────
  // CC4 exports skin the chin/lower-lip region AND the lower-teeth/tongue meshes
  // to the `CC_Base_JawRoot` BONE — the `Jaw_Open` morph moves the skin but the
  // teeth meshes carry no morph targets at all, so a morph-only jaw reads as
  // talking through clenched teeth. During speech we rotate the jaw bone (on the
  // mixer-driven ORIGINAL scene — the clone's SkinnedMeshes deform from those
  // bones) in proportion to the engine's `jawOpen` weight so chin, lower teeth
  // and tongue drop together. Avaturn/RPM rigs have no CC_Base_JawRoot, so this
  // is inert for them.
  const jawBoneOriginal = useRef<THREE.Bone | null>(null)
  const jawRestQuat     = useRef<THREE.Quaternion | null>(null)
  // The jaw's hinge axis (the avatar's left-right axis) expressed in the jaw
  // bone's PARENT space, captured once at rest. Anatomically fixed relative to
  // the skull, so it stays valid while the head animates.
  const jawHingeAxis    = useRef<THREE.Vector3 | null>(null)


  // ── Bind-pose flash guard ──────────────────────────────────────────────────
  // The GLB is rendered in raw bind pose for the first few frames before the
  // AnimationMixer fires its first update. For acts-guide.glb, the Armature
  // root has a 28° Y rotation baked in and the Head bind pose is 0° relative,
  // so the avatar looks ~28° sideways until avaturn_animation drives the head
  // to its rest pose (~2.4° yaw). Fix: hide the scene until mixer frame 1.
  const mixerHasFired = useRef(false)

  // ── Camera-lock: head always faces forward ─────────────────────────────────
  // Root cause: the avaturn_animation base clip has a Head bone track that holds
  // the head at the GLB's baked-in off-angle rest pose (~28° sideways) every frame.
  // A gentle slerp (Phase B alpha=0.06) cannot overcome the mixer driving the bone
  // back each frame — the mixer wins.
  //
  // Fix: after the mixer runs each frame, decompose the Head bone's local quaternion
  // into Euler (YXZ order) and HARD-ZERO the Y component before recomposing.
  // This zeroes yaw while preserving the X (pitch/nod) and Z (roll/tilt) components
  // that come from the animation — head nods, tilts, and micro-movement all play
  // naturally. Only the sideways yaw is stripped.
  //
  // Phase A (frames 0–30): still used for fast initial correction (alpha=0.5 slerp
  //   toward the zero-yaw target) so the transition from bind-pose isn't jarring.
  // Phase B (frame 30+): hard-zero Y every frame — no slerp, no reference quat.
  const headCamFrame   = useRef(0)  // frame counter for phase transition

  // ── Blendshape state (useRef — never triggers re-renders) ──────────────────
  const currentWeights = useRef<ARKitWeights>({})

  // ── Viseme persistent weights (targetW/currentW pattern) ──────────────────
  // These refs persist between frames — the recentlyFired guard keeps the mouth
  // open between closely spaced viseme events instead of snapping to zero.
  const targetW    = useRef<Record<string, number>>({})
  const currentW   = useRef<Record<string, number>>({})
  const lastApplyAt = useRef<number>(0)

  // ── Procedural state ───────────────────────────────────────────────────────
  const ocular      = useRef(createOcularState())
  const respiration = useRef(createRespirationState())
  const headTrack   = useRef(createHeadTrackingState())
  const gazeState   = useRef(createGazeState())
  const cameraPosRef = useRef(new THREE.Vector3())

  // ── Viseme timing ──────────────────────────────────────────────────────────
  const lastVisemeAt = useRef<number>(0)
  // Hold class of the most recently fired viseme. Drives how long the mouth holds
  // a shape before the recentlyFired gate releases it: vowels carry over a little
  // (natural co-articulation); consonants/closures release fast so a wrong
  // consonant shape never lingers into the next phoneme.
  const lastHold = useRef<'vowel' | 'consonant' | 'closure'>('vowel')

  // ── Word boundary estimation from viseme drain ─────────────────────────────
  // Azure offline synthesis has no live wordBoundary events — the synthesizer is
  // already closed before audio plays. We estimate word boundaries by counting
  // drained visemes: every ~3 non-silence visemes ≈ 1 spoken word. This drives
  // SkeletalController.onWordBoundary() so gesture cues fire at roughly the right
  // word in the utterance without needing real Azure wordBoundary events.
  const visemeDrainCountRef   = useRef<number>(0)  // total visemes drained this utterance
  const wordBoundaryCountRef  = useRef<number>(0)  // word boundaries fired this utterance
  const VISEMES_PER_WORD      = 3                  // tunable: 3 phonemes ≈ 1 word

  // ── Initialise on scene load ───────────────────────────────────────────────
  useEffect(() => {
    if (!scene) return

    // Collect mesh refs — first seed with known Avaturn names (backwards compat),
    // then also collect any SkinnedMesh with morph targets not already captured
    // (supports CC4 and other avatar vendors whose mesh names differ).
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.SkinnedMesh)) return
      if (obj.name in meshRefs.current) {
        // Known Avaturn mesh name
        meshRefs.current[obj.name] = obj
      } else if (obj.morphTargetDictionary && Object.keys(obj.morphTargetDictionary).length > 0) {
        // Unknown mesh name but has morph targets — add it dynamically
        meshRefs.current[obj.name] = obj
      }
    })

    // v0.5.5 — Hair/eyelash alpha fix.
    //
    // CC4 exports hair, brows-as-decal, eyelashes, and eye occlusion with
    // alphaMode=BLEND (i.e. transparent=true, depthWrite=false). Multiple
    // overlapping BLEND surfaces at similar depths (hair strands, fringe, brows
    // painted on the head material's alpha channel) cause depth-sort chaos:
    // strands render in the wrong order, eyebrows clip through the fringe, and
    // the scalp shows through holes where alpha-blend ordering fails.
    //
    // Fix: switch hair/scalp/eyelash/occlusion materials to alphaTest (MASK)
    // — the texture's alpha is still used, but each fragment either fully
    // writes or fully discards. Depth buffer works correctly, no more sort
    // artefacts. TearLine kept as BLEND (needs true translucency for wet eye
    // sheen — never overlaps other transparent surfaces).
    //
    // Per-material category thresholds (v0.5.6):
    //   Hair: 0.15  — hair-strand alpha maps have wide soft gradients (0.2–0.7
    //                 on strand edges). 0.5 chops mid-strands and looks eaten;
    //                 0.15 keeps almost all visible strands.
    //   Scalp: 0.4  — covers head under hair; can afford harder threshold
    //                 because it doesn't need soft edges.
    //   Brow/Eyelash: 0.3 — brow-card alpha is generally solid with soft tips.
    //   Occlusion: kept BLEND (weight=1 dark shadow under eyes, must be soft).
    //   TearLine: kept BLEND (wet-eye sheen, must be soft).
    //
    // For BLEND materials we keep, we still force depthWrite=true so opaque
    // surfaces behind them get correct depth — the classic "transparent hair
    // hides brows" bug.
    //
    // v0.5.14 — restore v0.5.11 hair behaviour (CC4 default BLEND + scalp darken).
    // No depthWrite override, no renderOrder change. User will avoid fringed
    // hairstyles so the eyebrow ordering issue is a non-issue.
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of materials) {
        if (!m) continue
        const matName = m.name ?? ''
        if (/^Scalp_Transparency/i.test(matName)) {
          const mat = m as THREE.MeshStandardMaterial
          if (mat.color && !(mat as unknown as { __scalpDarkened?: boolean }).__scalpDarkened) {
            mat.color.multiplyScalar(0.4)
            ;(mat as unknown as { __scalpDarkened?: boolean }).__scalpDarkened = true
            mat.needsUpdate = true
          }
        }
        // Skin de-shine / lifelike pass (v0.5.31). CC skin
        // (Std_Skin_Head/Body/Arm/Leg, Std_Nails) reads "plastic" for two
        // reasons: (1) roughness is a single flat scalar with no roughness map,
        // so the whole surface reflects uniformly — the classic CG tell; (2) no
        // subsurface scatter, so a hard key produces a wet/plastic hotspot. CC4
        // exports ~0.55 with a KHR_materials_specular layer; CC5 Headshot 3
        // exports ~0.7 as a plain MeshStandardMaterial with NO specular ext.
        // Fix, per material, once: drive roughness from a procedural noise map
        // so it VARIES (v0.5.36 — the old flat 0.97 floor just read as clay);
        // add a soft warm sheen (subsurface-like scatter — sheen needs
        // MeshPhysicalMaterial, so upgrade plain-standard skin); add pore-scale
        // detail-normal; tame specularIntensity + kill clearcoat.
        // Wrapped so any failure leaves the (roughened) standard material intact.
        // Environment response for every lit material (hair, clothing, eyes…).
        // three defaults envMapIntensity to 1, but set it explicitly so the
        // scene's IBL strength is tunable from one constant. Skin overrides this
        // below with ENV_MAP_INTENSITY_SKIN.
        if ('envMapIntensity' in m) {
          (m as THREE.MeshStandardMaterial).envMapIntensity = ENV_MAP_INTENSITY
        }
        if (/^(Std_Skin|Std_Nails)/i.test(matName)) {
          const std = m as THREE.MeshStandardMaterial & { __skinLifelike?: boolean }
          if (!std.__skinLifelike) {
            const apply = (mat: THREE.MeshPhysicalMaterial & { __skinLifelike?: boolean }) => {
              mat.metalness = 0
              // v0.5.36 — spatially-varying roughness replaces the old flat 0.97
              // floor. three multiplies `roughness` by roughnessMap.g, so the
              // scalar is 1.0 and the map alone carries the SKIN_ROUGH_MIN..MAX
              // range. Varying specular is what reads as skin; a uniform value
              // reads as plastic (high gloss) or clay (low gloss) either way.
              const detail = getSkinDetailTexture()
              mat.roughness = 1.0
              mat.roughnessMap = detail.clone()
              mat.roughnessMap.wrapS = THREE.RepeatWrapping
              mat.roughnessMap.wrapT = THREE.RepeatWrapping
              mat.roughnessMap.repeat.set(SKIN_ROUGH_REPEAT, SKIN_ROUGH_REPEAT)
              mat.roughnessMap.needsUpdate = true
              if ('specularIntensity' in mat) mat.specularIntensity = 0.20
              if ('sheen' in mat) {
                mat.sheen = 0.15
                mat.sheenRoughness = 1.0
                mat.sheenColor = new THREE.Color(0xffd9c8)
              }
              if ('clearcoat' in mat) mat.clearcoat = 0
              if ('envMapIntensity' in mat) mat.envMapIntensity = ENV_MAP_INTENSITY_SKIN
              if (mat.normalMap && mat.normalScale) mat.normalScale.multiplyScalar(1.3)
              // Pore-scale micro-detail — recovers what a 512px normal export loses.
              attachSkinDetailNormal(mat, detail)
              mat.__skinLifelike = true
              mat.needsUpdate = true
            }
            if ('sheen' in std) {
              // Already physical (e.g. CC4 KHR_materials_specular rig).
              apply(std as unknown as THREE.MeshPhysicalMaterial & { __skinLifelike?: boolean })
            } else {
              // Plain MeshStandardMaterial (CC5 Headshot export): rebuild as
              // physical so sheen is available. Carry every map/flag that defines
              // the look; only the shading terms change.
              try {
                const phys = new THREE.MeshPhysicalMaterial() as THREE.MeshPhysicalMaterial & { __skinLifelike?: boolean }
                phys.name = std.name
                phys.color.copy(std.color)
                phys.map = std.map
                phys.normalMap = std.normalMap
                if (std.normalScale && phys.normalScale) phys.normalScale.copy(std.normalScale)
                phys.aoMap = std.aoMap
                phys.aoMapIntensity = std.aoMapIntensity
                phys.emissive.copy(std.emissive)
                phys.emissiveMap = std.emissiveMap
                phys.transparent = std.transparent
                phys.alphaTest = std.alphaTest
                phys.depthWrite = std.depthWrite
                phys.side = std.side
                apply(phys)
                if (Array.isArray(obj.material))
                  obj.material = obj.material.map((mm) => (mm === std ? phys : mm))
                else
                  obj.material = phys
                std.__skinLifelike = true
              } catch (e) {
                console.warn('[AvatarCanvas] skin physical upgrade failed; roughening in place:', e)
                apply(std as unknown as THREE.MeshPhysicalMaterial & { __skinLifelike?: boolean })
              }
            }
          }
        }
      }
    })

    // Collect bone refs
    headBone.current  = findBone(scene, 'Head')
    neckBone.current  = findBone(scene, 'Neck')
    spineBone.current = findBone(scene, 'Spine') ?? findBone(scene, 'Spine1')
    chestBone.current = findBone(scene, 'Spine2')


    // Fix T-pose (skip when caller's GLB is already in A-pose)
    if (applyTPoseFix) {
      fixTPose(scene)
    }

    // Initialise skeletal controller with the per-mount workingScene — the
    // mixer drives ITS bones, and the rendered clone's SkinnedMesh.skeleton
    // still references those same bones (shared skeleton within this mount),
    // so the clone renders with correct world positions while the avatarYOffset
    // is applied only to the clone's root primitive. The loader-cached template
    // is never driven or mutated.
    console.info('[AvatarCanvas] init — clips count:', clips.length, clips.map(c=>c.name))
    engine.skeletal.init(workingScene, clips)
    // Collect the head + eye bones from the WORKING scene (mixer-driven) for
    // gaze. The rendered clone's bones are not driven by the mixer so their
    // world matrices never update — gaze must read from workingScene. Fall back
    // to the CC4 (`CC_Base_*`) names so eye contact works on CC4 avatars too,
    // whose head bone is `CC_Base_Head` rather than `Head`.
    headBoneOriginal.current = findBone(workingScene, 'Head') ?? findBone(workingScene, 'CC_Base_Head')
    leftEyeBone.current = findBone(workingScene, 'LeftEye') ?? findBone(workingScene, 'CC_Base_L_Eye')
    rightEyeBone.current = findBone(workingScene, 'RightEye') ?? findBone(workingScene, 'CC_Base_R_Eye')
    console.info('[AvatarCanvas] gaze bones:', {
      head: headBoneOriginal.current?.name ?? 'NONE',
      lEye: leftEyeBone.current?.name ?? 'NONE',
      rEye: rightEyeBone.current?.name ?? 'NONE',
    })

    // CC4 jaw bone (working scene — the skin-driving skeleton). Capture the
    // rest pose and the hinge axis: the avatar's left-right axis (world X at
    // rest, before bodyRotationY applies in the frame loop) expressed in the
    // jaw bone's parent space. Rotating about it pitches the chin down.
    const jaw = findBone(workingScene, 'CC_Base_JawRoot')
    jawBoneOriginal.current = jaw
    if (jaw && jaw.parent) {
      workingScene.updateMatrixWorld(true)
      const parentWorldQuat = jaw.parent.getWorldQuaternion(new THREE.Quaternion())
      jawHingeAxis.current = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(parentWorldQuat.invert())
        .normalize()
      jawRestQuat.current = jaw.quaternion.clone()
      console.info('[AvatarCanvas] CC4 jaw bone found — bone-assisted jaw enabled')
    } else {
      jawHingeAxis.current = null
      jawRestQuat.current = null
    }
  }, [scene, gltf, clips, engine, applyTPoseFix])

  // Live environment-map strength. The load pass sets this once from the
  // ENV_MAP_* constants; this re-applies it whenever a caller drives the
  // `lightingOverrides.env` slider, so the playground can tune it without a
  // reload. No-op in production, where `envIntensity` is undefined.
  useEffect(() => {
    if (envIntensity == null) return
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mm of mats) {
        if (!mm || !('envMapIntensity' in mm)) continue
        const isSkin = /^(Std_Skin|Std_Nails)/i.test(mm.name ?? '')
        ;(mm as THREE.MeshStandardMaterial).envMapIntensity = isSkin
          ? envIntensity * (ENV_MAP_INTENSITY_SKIN / ENV_MAP_INTENSITY)
          : envIntensity
      }
    })
  }, [scene, envIntensity])

  // Hide until mixer fires (prevents bind-pose sideways-look flash on first render)
  useEffect(() => {
    scene.visible = false
    mixerHasFired.current = false
  }, [scene])

  // Disable frustum culling on all SkinnedMesh nodes AND allocate the GPU bone
  // texture. After rebindSkeletons() (in SkeletalController.init) the mixer
  // drives bones away from bind pose each frame; the rest-pose bounding sphere
  // no longer matches actual vertex positions, causing the renderer to cull
  // the mesh as soon as animation starts.
  //
  // `computeBoneTexture()` allocates the GPU DataTexture that holds bone
  // matrices. It requires an active WebGL context, so it MUST run here in a
  // useEffect after mount (not in SkeletalController.init() which runs before
  // R3F's WebGL context is ready). Without this, bone matrices are never
  // uploaded to the GPU and the mesh renders with all vertices collapsed at
  // origin (invisible).
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      mesh.frustumCulled = false
      if (mesh.skeleton) {
        try {
          mesh.skeleton.computeBoneTexture()
        } catch {
          // computeBoneTexture may throw if WebGL context isn't ready yet;
          // Three.js will re-allocate lazily on first render. Not fatal.
        }
      }
    })
  }, [scene])

  // ── useFrame: core render loop ─────────────────────────────────────────────
  useFrame((_, delta) => {
    const now        = performance.now()
    const nowMs      = Date.now()
    const queue      = engine.visemeQueueRef.current
    const startTime  = engine.visemeStartRef.current
    const isSpeaking = engine.isSpeakingRef.current

    // ── 1. Drain viseme queue (targetW/currentW pattern with recentlyFired guard)
    // applyViseme: zeros all viseme shapes, then sets only the fired one.
    // Skip id=0 (silence) — it would snap the mouth shut mid-sentence.
    // Word boundary estimation: every VISEMES_PER_WORD non-silence visemes drained
    // we call engine.skeletal.onWordBoundary() to advance gesture cue timing.
    const applyViseme = (id: number) => {
      if (id === 0) return
      const arkit = VISEME_TO_ARKIT[id]
      if (!arkit) return
      // Zero all viseme shapes first
      for (const k of Object.keys(targetW.current)) {
        targetW.current[k] = 0
      }
      // Primary Oculus mouth shape(s) at 0.6 + conservative ARKit support shapes
      // (cheeks / funnel / pucker / press / lower-lip) layered per viseme.
      // Support shapes the GLB lacks are ignored harmlessly in applyWeightsToMeshes.
      const { weights, jaw, hold } = buildVisemeTargets(id, 0.78)
      for (const [shapeName, value] of Object.entries(weights)) {
        targetW.current[shapeName] = value
      }
      // jawOpen differentiated per viseme (aa high, E/I medium, O/U low, consonants closed)
      targetW.current['jawOpen'] = jaw
      lastApplyAt.current = nowMs
      lastVisemeAt.current = now
      lastHold.current = hold

      // Word boundary estimation: count non-silence visemes; every VISEMES_PER_WORD
      // phonemes ≈ one spoken word. Call onWordBoundary() to advance gesture cue timing.
      visemeDrainCountRef.current++
      const expectedWords = Math.floor(visemeDrainCountRef.current / VISEMES_PER_WORD)
      while (wordBoundaryCountRef.current < expectedWords) {
        engine.skeletal.onWordBoundary()
        wordBoundaryCountRef.current++
      }
    }

    // Guard: startTime===0 means no audio is playing yet (reset state between sentences).
    // elapsed would be ~millions of ms → all visemes drain instantly in frame 1 → mouth
    // twitches once then closes. Skip the drain entirely until startTime is stamped.
    //
    // Also reset word boundary counters at the start of each new utterance so
    // gesture cue word_index counts restart from 0 for every sentence.
    const elapsed = startTime > 0 ? now - startTime : -1
    if (startTime > 0 && visemeDrainCountRef.current === 0 && queue.length > 0) {
      // New utterance just started (counters at 0, queue non-empty, audio running).
      // wordBoundaryCountRef already 0 — nothing to reset, but ensure skeletal counter
      // is also fresh. loadPerformance() already resets wordCounter in the controller.
    }
    // Reset counters when audio stops (startTime goes back to 0)
    if (startTime === 0 && visemeDrainCountRef.current > 0) {
      visemeDrainCountRef.current  = 0
      wordBoundaryCountRef.current = 0
    }
    while (queue.length > 0 && queue[0].audioOffset <= elapsed) {
      applyViseme(queue.shift()!.visemeId)
    }

    // recentlyFired gate: keep mouth open between closely spaced visemes.
    // Only zero targetW when there are no future events AND no recent fire.
    // The hold window is per-phoneme-class so a wrong consonant shape does not
    // linger: vowels carry over (co-articulation) while consonants/closures
    // release quickly. The vowel window stays at the proven 300ms that fixed the
    // mouth-snapping-shut regression between closely spaced visemes.
    const holdWindow    = lastHold.current === 'vowel' ? 300 : 120
    const hasFuture     = queue.length > 0
    const recentlyFired = (nowMs - lastApplyAt.current) < holdWindow
    if (!hasFuture && !recentlyFired) {
      for (const k of Object.keys(targetW.current)) {
        targetW.current[k] = 0
      }
      targetW.current['jawOpen'] = 0
    }

    // Per-frame asymmetric lerp: targetW → currentW (attack fast, release tuned).
    // Consonants/closures release faster than vowels so a transient consonant
    // shape clears before the next phoneme instead of smearing across it; vowels
    // keep the slower, natural release. Attack is always fast so onsets are crisp.
    const releaseSpeed = lastHold.current === 'vowel' ? 6 : 11
    for (const [name, target] of Object.entries(targetW.current)) {
      const cur   = currentW.current[name] ?? 0
      const alpha = target > cur
        ? 1 - Math.exp(-14 * delta)            // attack — fast
        : 1 - Math.exp(-releaseSpeed * delta)  // release — class-dependent
      currentW.current[name] = THREE.MathUtils.lerp(cur, target, alpha)
    }

    // Build visemeWeights from the lerped currentW for the additive blend below
    const visemeWeights: ARKitWeights = { ...currentW.current }

    // ── 2. FFT fallback (if viseme queue exhausted but still speaking) ─────
    const useFftFallback = isSpeaking
      && queue.length === 0
      && (now - lastVisemeAt.current) > 200
      && engine.fftFallback.connected

    const fftAmp = engine.fftFallback.tick()
    const activeVisemeWeights = useFftFallback
      ? engine.fftFallback.getBlendshapeWeights()
      : visemeWeights

    // ── 3. Emotion baseline (attenuated during speech) ─────────────────────
    const emotionWeights = engine.emotion.effectiveWeights(isSpeaking)

    // ── 4. Procedural layer (blink, saccades) ─────────────────────────────
    // The rest lid-lower is a CC4-only relax (its neutral eye is wide/staring);
    // Avaturn/RPM eyes are already relaxed, so pass restLid=0 to leave them be.
    const isCC4Avatar = headBoneOriginal.current?.name === 'CC_Base_Head'
    const { blinkWeights, eyeRotationX, eyeRotationY } = tickOcularMechanics(ocular.current, delta, isCC4Avatar ? undefined : 0)

    // ── 5. Additive blend: emotion + viseme + procedural ───────────────────
    const blended = additiveBlend(emotionWeights, activeVisemeWeights, blinkWeights)

    // ── 6. Lerp toward target (organic muscle transition) ─────────────────
    // Viseme keys are already lerped in step 1 (currentW) — passing them
    // through lerpWeightMap a second time would double-smooth them, causing
    // sluggish response. Apply lerpWeightMap for emotion+blink, then overwrite
    // viseme keys directly from the pre-lerped currentW values.
    lerpWeightMap(currentWeights.current, blended, delta, 12)
    // Overwrite viseme keys with the already-lerped values from step 1
    for (const [name, val] of Object.entries(currentW.current)) {
      if (val > 0 || (currentWeights.current[name] ?? 0) > 0) {
        currentWeights.current[name] = val
      }
    }
    // Apply the blink lids directly — a blink is a fast ~80ms motion (already
    // ramped in tickOcularMechanics) and the weight lerp above would damp it so
    // the eyes never fully close. Overwrite after the lerp, like visemes.
    for (const [name, val] of Object.entries(blinkWeights)) {
      currentWeights.current[name] = val as number
    }

    // ── 7. (morph targets applied after gaze — see step 10d) ────────────

    // ── 8. Procedural respiration ──────────────────────────────────────────
    tickRespiration(respiration.current, delta, spineBone.current, chestBone.current)

    // ── 9. Audio-reactive head tracking ───────────────────────────────────
    tickHeadTracking(headTrack.current, delta, fftAmp, headBone.current, neckBone.current)

    // ── 10. Skeletal animation mixer ───────────────────────────────────────
    engine.skeletal.update(delta)

    // Show avatar only after mixer has fired at least once (hides bind-pose flash)
    if (!mixerHasFired.current) {
      mixerHasFired.current = true
      scene.visible = true
    }

    // ── 10b. Head camera-lock — always face the viewer ─────────────────────
    // Every frame after the mixer runs: decompose the Head bone's local quaternion
    // into Euler (YXZ), hard-zero the Y (yaw), recompose. The mixer's Head track
    // drives the bone to the GLB's off-angle rest every frame — we strip the yaw
    // component AFTER the mixer runs so it never accumulates visually.
    // X (pitch/nod) and Z (roll/tilt) pass through unmodified — animations play
    // as designed, only the sideways rotation is removed.
    // Phase A (frames 0–30): slerp alpha=0.5 toward zero-yaw — smooth entry.
    // Phase B (frame 30+): hard-zero Y every frame — overrides mixer completely.
    if (headBone.current) {
      const bone  = headBone.current
      const frame = ++headCamFrame.current

      const e = new THREE.Euler().setFromQuaternion(bone.quaternion, 'YXZ')
      e.y = 0
      const targetQ = new THREE.Quaternion().setFromEuler(e)

      if (frame <= 30) {
        // Phase A: fast slerp toward zero-yaw — smooth initial correction
        bone.quaternion.slerp(targetQ, 0.5)
        if (frame === 30) {
          console.log('[AvatarCanvas] headCamLock: Phase B active (hard-zero yaw each frame)')
        }
      } else {
        // Phase B: hard-zero yaw every frame after mixer — mixer cannot win
        bone.quaternion.copy(targetQ)
      }
    }

    // ── 10b². CC4 bone-assisted jaw ─────────────────────────────────────────
    // Rotate CC_Base_JawRoot about its (rest-captured) hinge axis in proportion
    // to the current jawOpen weight, on top of the rest pose. Runs AFTER the
    // mixer so a body clip can never freeze the jaw shut; inert on non-CC4 rigs
    // (no jaw bone found). The Jaw_Open MORPH still fires through the alias
    // layer — the bone adds the chin/teeth/tongue drop the morph cannot give.
    if (jawBoneOriginal.current && jawRestQuat.current && jawHingeAxis.current) {
      const jawOpen = currentWeights.current['jawOpen'] ?? 0
      const jawBone = jawBoneOriginal.current
      jawBone.quaternion.copy(jawRestQuat.current)
      if (jawOpen > 0.001) {
        const deltaQ = new THREE.Quaternion().setFromAxisAngle(
          jawHingeAxis.current,
          jawOpen * CC4_JAW_BONE_RAD_PER_WEIGHT,
        )
        jawBone.quaternion.premultiply(deltaQ)
      }
    }

    // ── 10c. VOR Gaze — camera-lock eyes with head comfort cone ─────────────
    // Update camera position from R3F camera each frame (stable vector ref —
    // no allocation per frame). Then call tickGaze which:
    //   • Measures head deviation from its reference orientation
    //   • Inside ±20° yaw / ±15° pitch cone → lockWeight lerps to 1 (eyes track camera)
    //   • Outside cone → lockWeight lerps to 0 (eyes ride with head naturally)
    //   • Saccade offsets from tickOcularMechanics are passed through so micro-
    //     movements still apply when locked (eyeRotationX/Y from step 4).
    // tickGaze is called AFTER skeletal.update() AND head cam-lock so all
    // world matrices are fully resolved for this frame.
    cameraPosRef.current.copy(camera.position)
    // When the avatar exposes distinct eye bones (CC4 or RPM/Avaturn), use the
    // eye-bone-derived eye-contact gaze — it needs no head-bone axis assumption
    // and aims at the real camera position, so eye direction follows the active
    // camera preset. Both CC4 and RPM/Avaturn skin the eyeball mesh directly to
    // the LeftEye/RightEye bones, so rotating those bones moves the eye — we drive
    // the bones for both (driveBones=true). Only avatars with no eye bones at all
    // fall back to the head-local ARKit-morph gaze.
    const gazeWeights = (leftEyeBone.current && rightEyeBone.current)
      ? tickGazeEyeContact(
          gazeState.current,
          delta,
          headBoneOriginal.current,
          leftEyeBone.current,
          rightEyeBone.current,
          cameraPosRef.current,
          eyeRotationX,
          eyeRotationY,
          // 25° eye-travel socket for both characters — eyeLimitYaw caps travel
          // equally in every direction (side to side and up and down).
          { eyeLimitYaw: 25 },
          true,
        )
      : tickGaze(
          gazeState.current,
          delta,
          headBoneOriginal.current,   // working scene — mixer keeps world matrix current
          cameraPosRef.current,
          eyeRotationX,
          eyeRotationY,
        )

    // ── 10d. Apply gaze weights + paint morph targets ───────────────────
    // Merge gaze blendshape weights into currentWeights THEN apply to mesh,
    // so eye-look weights are included in this frame's morph target paint.
    // gazeWeights is {} when lockWeight < 0.01 — no-op when eyes ride free.
    for (const [k, v] of Object.entries(gazeWeights)) {
      currentWeights.current[k] = v
    }
    applyWeightsToMeshes(
      currentWeights.current,
      meshRefs.current as Record<string, THREE.SkinnedMesh | null>
    )

    // ── 11. Apply position offset + rotation every frame ─────────────────
    // Set scene.position every frame — R3F reconciler resets it to [0,0,0]
    // after useEffect when using <primitive> without a position prop.
    // Also apply bodyRotationY to the mixer-driven workingScene so bone world
    // matrices include the intended facing direction.
    scene.position.set(avatarXOffset, effectiveYOffset, 0)
    workingScene.rotation.y = bodyRotationY
    workingScene.updateMatrixWorld(true)
  })

  return (
    <primitive
      object={scene}
    />
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function AvatarCanvas({
  engine,
  adapter,
  directorConfig: _directorConfig,
  glbUrl         = '/avatar.glb',
  faceRigUrl     = DEFAULT_FACE_RIG_URL,
  mergeFaceRig: mergeFaceRigMode = 'auto',
  cameraPreset   = 'head-and-shoulders',
  lightingPreset = 'consumer',
  lightingOverrides,
  bodyRotationY  = 0.5,
  avatarYOffset  = -1.52,
  avatarXOffset  = 0,
  applyTPoseFix  = true,
  autoCalibrate  = false,
  cameraPosition,
  cameraTarget,
  animationPackUrl,
  className      = 'w-full h-full',
}: AvatarCanvasProps) {
  // For conversational-mode adapters, open the WS on mount and tear it down on unmount.
  const activeAdapter = adapter ?? engine.adapter
  useEffect(() => {
    if (activeAdapter.mode !== 'conversational') return
    engine.connect().catch((err) => console.error('[AvatarCanvas] connect failed:', err))
    return () => { engine.disconnect() }
  }, [engine, activeAdapter])

  // Reload animation dictionary when the pack URL changes
  useEffect(() => {
    if (!animationPackUrl) return
    engine.dictionary.loadPack(animationPackUrl).then(() => {
      engine.refreshAnimIds()
      console.info(`[AvatarCanvas] Animation pack loaded: ${animationPackUrl}`)
    }).catch((err) => {
      console.error('[AvatarCanvas] Failed to load animation pack:', err)
    })
  }, [engine, animationPackUrl])

  return (
    <div className={className}>
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ position: cameraPosition ?? CAMERA_PRESETS[cameraPreset].position, fov: CAMERA_PRESETS[cameraPreset].fov }}
        shadows
      >
        <CameraSetup preset={cameraPreset} positionOverride={cameraPosition} targetOverride={cameraTarget} />
        {/* v0.5.45 — EnvironmentIBL REMOVED. main (0.5.35) had no environment
            map and no softbox, only ambient + two directionals, and looked
            better than everything built on top of it. RoomEnvironment lights
            from every direction at once, so it flattened the face AND made the
            direct lights irrelevant: cutting env 0.69 -> 0.18 and dropping the
            key still produced an identical render, because the environment was
            doing effectively all the work. */}
        {/* Lights are placed relative to whatever the camera is looking at, so
            they follow the face for both conventions: auto-calibrated rigs
            (head parked near CAMERA_TARGET_Y) and full-height CC4 bodies framed
            at their real eye height (~1.4-1.7m), which the portal uses. */}
        <Lighting
          preset={lightingPreset}
          overrides={lightingOverrides}
          focusY={(cameraTarget ?? CAMERA_PRESETS[cameraPreset].target)[1]}
        />
        <Suspense fallback={null}>
          <AvatarScene
            engine={engine}
            glbUrl={glbUrl}
            faceRigUrl={faceRigUrl}
            mergeFaceRigMode={mergeFaceRigMode}
            bodyRotationY={bodyRotationY}
            envIntensity={lightingOverrides?.env}
            avatarYOffset={avatarYOffset}
            avatarXOffset={avatarXOffset}
            applyTPoseFix={applyTPoseFix}
            autoCalibrate={autoCalibrate}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
