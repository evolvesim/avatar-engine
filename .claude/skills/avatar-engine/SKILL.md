---
name: avatar-engine
description: >
  Orientation and working conventions for @evolvesim/avatar-engine — the shared
  real-time 3D avatar engine (Three.js/R3F: viseme lip-sync, emotion, skeletal
  animation, lighting) consumed by Evolve Sim, ACTS Education, and Evolve RPG.
  Use this whenever working in this repo: tuning lip-sync or mouth shapes,
  touching lighting, materials/shaders, rig/morph aliasing, or shipping a new
  engine version to a product. It records the distribution model and the
  hard-won lessons that must not be relearned by regression.
---

# Avatar Engine

## What this is

The single shared 3D avatar runtime for all Evolve Simulations products.
It loads a character GLB, drives ARKit/CC morphs from a 22-ID Azure-style
viseme stream (Azure Speech events, or product-derived timelines for
ElevenLabs voices), layers emotion + procedural animation additively, and
renders with per-product lighting rigs. Core files:

- `src/core/viseme-map.ts` — viseme ID → morph targets, per-viseme support
  shapes, jaw tiers, hold classes, rounding/closure caps. Most lip-sync
  tuning happens here.
- `src/core/AvatarCanvas.tsx` — the R3F component: GLB load, material passes
  (skin, hair, **mouth cavity shading**), lighting rigs, and the per-frame
  loop (viseme drain → additive blend → morph write → jaw bone → gaze).
- `src/core/cc4-morph-alias.ts` — ARKit names → CC morph names, **all naming
  generations** (CC4 Standard, unified, CC5 ExpressionPlus). Writes to absent
  morphs silently no-op.
- `src/core/additive-blend.ts` — weight-map blend + `applyWeightsToMeshes`
  (max-per-index when several names resolve to one morph).
- `src/adapters/` — Azure (real viseme events), ElevenLabs, mock.

## Distribution — vendored pushes, NOT registry installs

Products consume a **vendored build**, committed into each product repo as
`vendor/avatar-engine/` (`dist/` + `package.json`) referenced via
`"@evolvesim/avatar-engine": "link:vendor/avatar-engine"`.

- **Shipping a change**: bump `package.json` version, `npm run build`, copy
  `dist/` + `package.json` into the product's `vendor/avatar-engine/`, run the
  product's full test suite, commit there as
  `chore(avatar-engine): vendor X.Y.Z — <summary>`.
- Product repos: `evolvesim/evolve-sim-portal`, the ACTS Education portal
  (**separate GitHub org: `ACTS-Education-1`** — cross-org repo access needs
  its own session/credentials), and Evolve RPG.
- CI still auto-publishes to **GitHub Packages** on main when the version
  changed. Nothing installs from it; it's a byproduct and an emergency source
  for a built `dist/` when this repo isn't reachable.
- Product tests import the vendored dist directly (e.g. the portal's
  `face-pose.test.ts`), so engine behaviour changes can legitimately fail a
  product's tests — update the documented contract there, don't hack around it.

## Rig families — the same weights land very differently

- **Avaturn/RPM (and the engine's donor face rig `public/avatar-engine/
  face-rig.glb`)**: native ARKit morphs (`mouthPucker`, `jawOpen`…) + Oculus
  `viseme_*`; dedicated `Teeth_Mesh`/`Tongue_Mesh` meshes (tongue's material
  is literally named "Teeth"); no jaw bone assist.
- **CC4/CC5**: `V_*` viseme shapes + CC-named muscles; jaw driven by BOTH the
  `Jaw_Open` morph and the `CC_Base_JawRoot` bone
  (`CC4_JAW_BONE_RAD_PER_WEIGHT`) — they multiply, so cutting both compounds.
  CC bodies export as one multi-primitive mesh **sharing a single vertex
  buffer** — never trust `geometry.boundingBox`; measure over the vertices a
  primitive actually draws (index + material groups).
- **CC5 ExpressionPlus** renames nearly every mouth morph
  (`Mouth_Lips_Purse_UL/…`, `Mouth_Funnel_UL/…`, `Mouth_Lips_Together_*` for
  close, `Mouth_Corner_Pull/Narrow/Depress_*`; **no** `Mouth_Close`,
  `Mouth_Pucker`, or `Mouth_Smile_L`). The alias pair lists carry every
  generation. "The lips don't move on rig X" is almost always a naming gap.

## Lessons — do not relearn these by regression

1. **Teeth visibility is a shading problem.** Meshes cast no shadows, so
   scene lights shine straight **through the head** onto the back teeth. The
   fix is the cavity shading in `attachMouthInteriorAO`: teeth/tongue
   materials zero all scene-light terms and self-shade with a static
   front-to-back gradient (incisors lit, molars dark; CC gets darker floors
   than Avaturn), slightly eased by live jaw aperture. Never fix teeth by
   damping articulation (frozen-face regression) or moving lights.
2. **Face lighting is dialled and pinned.** Per-product rigs in
   `LIGHTING_RIGS`, enforced by `tests/unit/lighting-rigs.test.ts`
   (`acts-education`/`evolve-rpg` frozen at main-0.5.35 values). Hemispheric
   ambient, raised rim, and a skin down-occlusion shader were each tried for
   cavity brightness and all reverted — they degrade the face and never fixed
   the target. Bright **nostrils are baked into the head albedo texture** —
   a conversion-pipeline (texture) fix, not an engine lighting fix.
3. **Silence visemes (id 0) are honoured** as a soft partial rest
   (`SILENCE_REST_WEIGHT`) — the historical "skip id 0" starved the mouth of
   between-word relaxation. Producers of letter-derived timelines must emit
   silence only at REAL pauses (see the portal's `eleven-visemes.ts`,
   140ms gap gate), or the mouth over-relaxes.
4. **Held shapes expose overdriven poses.** The bilabial P/B/M stack is
   deliberately eased (primary 0.72, `mouthClose` 0.28, upper-bounded in
   tests): at the old full strength, a held word-final closure pushed the
   bottom lip over the top lip. If a pose looks wrong only at word/sentence
   ends, suspect amplitude tuned for a never-held era.
5. **Anatomy beats axis conventions.** Gradient direction on teeth/tongue is
   auto-detected (front = narrow end, back = wide end in lateral spread);
   exporters disagree on bind-space handedness, so never hard-code ±Z.

## Tuning knobs (single-line changes)

- Mouth darkness: `MOUTH_CAVITY_LIGHT`, `MOUTH_AO_BACK_TEETH[_CC]`,
  `MOUTH_AO_BACK_TONGUE[_CC]`, `MOUTH_AO_CURVE` (AvatarCanvas.tsx).
- Jaw travel: jaw tiers in viseme-map.ts (`JAW_AA`…), CC bone
  `CC4_JAW_BONE_RAD_PER_WEIGHT`; overall: `VISEME_PRIMARY_SCALE` and the
  per-product `articulationIntensity` prop (0.25–1.5, scales primary + jaw,
  never support shapes).
- Rounding: `PRIMARY_ROUNDED`, per-viseme `mouthPucker`/`mouthFunnel` under
  `ROUNDING_CAP`.

## Diagnostics (browser console, once per avatar load)

- `ENGINE <version> — lighting …` build/lighting fingerprint — first check
  that the running build is the one you think it is (stale vendored dists
  have burned multiple release cycles).
- `mouth-capable morphs: …` — the rig's real mouth-morph inventory. Ask for
  this paste before tuning a specific character.
- `mouth AO '<material>': …` — measured teeth/tongue geometry + chosen
  gradient direction.

## Workflow

- `npm test` (vitest, 128+ unit/integration tests), `npm run typecheck`,
  `npm run build` (tsc -b → `dist/`). Tests pin behavioural contracts
  (viseme table vs Microsoft's official grouping, caps, jaw ordering,
  lighting rigs) — when a deliberate change trips one, update the contract
  with a comment explaining the new reasoning.
- Visual verification happens in the consuming product (portal Vercel preview
  or the playground) — there is no renderer in CI. Iterate: vendor into the
  portal branch, let the preview build, get eyes on it.
