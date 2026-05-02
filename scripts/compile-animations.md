# Animation Dictionary Compiler

The animation dictionary is built by the Node.js compiler in this directory.

## Quick Start

```bash
cd scripts/
npm install
node compile-animations.js
```

Output: `../public/avatar-engine/animations.glb`

The compiled GLB is already included in the repo at `public/avatar-engine/animations.glb`.
Rerun the compiler only if you add new animation clips to `compile-animations.js`.

## How It Works

`compile-animations.js` procedurally generates all 25 animation clips using
quaternion keyframes on the Mixamo/Avaturn skeleton (18 bones). It uses
`@gltf-transform/core` to write a valid binary GLB with no mesh geometry —
only animation tracks.

Each clip corresponds to an entry in `src/animation-dictionary.ts`'s
`ANIMATION_MANIFEST`. The clip name must match exactly.

## Adding New Animations

1. Add a `defineClips()` call in `compile-animations.js` with the new clip name
2. Add the matching entry to `ANIMATION_MANIFEST` in `src/animation-dictionary.ts`
3. Run `node compile-animations.js`
4. Commit both the updated JS and the new `animations.glb`

## Clip List (25 clips, ~40KB)

| Clip | Type | Duration |
|---|---|---|
| `quaternius_neutral_idle` | Loop | 4s |
| `quaternius_joy_breathing_idle` | Loop | 3s |
| `quaternius_anger_tense_idle` | Loop | 3s |
| `quaternius_sadness_slumped` | Loop | 5s |
| `quaternius_concentration_idle` | Loop | 4s |
| `mixamo_neutral_talking_default` | Once | 2s |
| `mixamo_neutral_thoughtful_nod` | Once | 1.5s |
| `mixamo_neutral_head_shake` | Once | 1.2s |
| `mixamo_joy_talking_hands` | Once | 2.5s |
| `mixamo_joy_thumbs_up` | Once | 1.8s |
| `mixamo_anger_dismissive_wave` | Once | 1.5s |
| `mixamo_anger_pointing` | Once | 1.8s |
| `mixamo_anger_arms_crossed` | Loop | 2s |
| `mixamo_sadness_apologetic_hands` | Once | 2s |
| `mixamo_sadness_head_down` | Once | 3s |
| `mixamo_surprise_step_back` | Once | 1.5s |
| `mixamo_empathy_open_hands` | Once | 2s |
| `mixamo_empathy_leaning_forward` | Loop | 3s |
| `mixamo_concentration_chin_stroke` | Once | 2.5s |
| `mixamo_confusion_head_tilt` | Once | 1.8s |
| `mesh2motion_neutral_weight_shift` | Loop | 4s |
| `mesh2motion_joy_celebratory_clap` | Once | 1.5s |
| `mesh2motion_sadness_shoulder_slump` | Loop | 5s |
| `mixamo_neutral_looking_around` | Loop | 6s |
| `mixamo_neutral_listening_sway` | Loop | 8s |
