# Animation Dictionary Compiler

Generates all 72 animation clips and packs them into a single binary GLB.

## Quick Start

```bash
cd scripts/
npm install
node compile-animations.js
```

Output: `../public/avatar-engine/animations.glb`

The compiled GLB is already included in the repo. Rerun the compiler only if you add new clips.

## Clip Taxonomy (72 clips, ~112KB)

| Group | Count | Description |
|---|---|---|
| NEUTRAL | 9 | Idle loops, weight shifts, talking gestures, self-reference |
| JOY | 7 | Breathing idle, talking hands, thumbs-up, clap, agree, smile nod, reveal |
| ANGER | 7 | Tense idle, dismissive wave, pointing, arms-crossed, finger wag, controlled release, emphatic |
| SADNESS | 6 | Slumped idle, apologetic, head-down, shoulder slump, slow shake, resigned sigh |
| SURPRISE | 5 | Step back, double-take, lean in, hands on face, recover |
| FEAR | 5 | Frozen idle, shrink back, protective arms, furtive glance, tension tremble |
| DISGUST | 4 | Recoil idle, look away, lean-back cross, sharp recoil |
| EMPATHY | 6 | Open hands, forward lean, gentle nod, reach out, hand over heart, soft head tilt |
| CONCENTRATION | 6 | Forward-lean idle, chin stroke, arms folded, step forward, finger tap temple, deliberate point |
| CONFUSION | 5 | Head tilt, shrug, look around, double head tilt, quizzical raise |
| PROFESSIONAL | 7 | Authority stance, present data, steeple fingers, formal nod, open pitch, confident cross, handshake prep |
| LISTENING | 5 | Active sway, affirm micro-nod, interested lean, reflective pause, attentive still |

## Adding New Clips

1. Add a `defineClips()` call in `compile-animations.js`
2. Add matching entry to `ANIMATION_MANIFEST` in `src/animation-dictionary.ts`
3. Run compiler and commit both files
