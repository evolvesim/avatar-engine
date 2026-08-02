# CC5 Animation Pack Builder

Builds the two CC5 packs from the iClone-exported FBX motions.

```bash
cd scripts/
npm install
node build-cc5-packs.mjs "/path/to/iClone to Mixamo to fbx"
```

Output (written to `../public/avatar-engine/` by default, `--out <dir>` to override):

| Pack | Clips | Size |
|---|---|---|
| `animations-pack-cc5-male.glb`   | 30 (`cc5_m_*`) | ~4.7 MB |
| `animations-pack-cc5-female.glb` | 15 (`cc5_f_*`) | ~6.4 MB |

The built GLBs live in **avatar-playground** `public/avatar-engine/` — that's where
the product serves packs from. Copy them across after a rebuild.

## What these are

The same 45 Mixamo clips already shipped as packs 1/2/5, retargeted to the CC5
standard rig in iClone. Packs 1/2/5 are on the **Mixamo** rig
(`Hips`/`Spine`/`LeftArm`, 52 nodes) so they can't drive a CC avatar; these are
the **CC** rig equivalents (`CC_Base_*`), matching the four CC4 portal packs.

Clip ids mirror the Mixamo-rig originals one-for-one — `mx_m_waving` →
`cc5_m_waving` — so the two rigs' manifests stay diffable.

## Source FBX requirements

One motion per FBX, exported from iClone with the CC5 skeleton intact:

- **`CC_Base_*` bone names.** The engine retargets by matching bone names against
  the live avatar's skeleton (`retargetClipToUUIDs` in `skeletal-controller.ts`);
  renaming to a Mixamo/Humanoid scheme on export would just recreate packs 1/2/5.
- **Named animation stacks** — the clip id is derived from the stack name
  (`M_Ch02_nonPBR_Waving` → `cc5_m_waving`). iClone also writes a `0_T-Pose`
  stack into every file; the builder discards it and asserts exactly one real
  motion clip remains.
- **One shared skeleton across all files.** The builder fails loudly if any FBX's
  bone list differs, since all clips in a pack share one node tree.

## Output conventions

Taken from the existing CC4 portal packs so these are drop-in equivalents:

| | Value |
|---|---|
| node chain | `RootNode` → `root` → `CC_Base_Hip` → … |
| units / axis | metres, Z-up (FBX exports cm → ÷100) |
| translation channels | `CC_Base_Hip` only |
| scale channels | none |
| interpolation | LINEAR |

`RL_BoneRoot` (the FBX skeleton root) is renamed to `root`, and the FBX's unnamed
group root becomes `RootNode`.

Per clip the builder prunes ~102 scale tracks, ~100 non-hip translation tracks,
and any rotation track that never leaves its bone's rest pose — leaving ~56
channels per clip, in line with the CC4 packs' 75. Tracks targeting
`CC_Game_Tongue` (an empty FBX helper group, not a bone) are dropped.

## Verifying a rebuild

Because these clips also exist on the Mixamo rig, durations are a free
correctness check — every `cc5_*` clip should match its `mx_*` counterpart in
packs 1/2/5 to within a frame. A mismatch means the wrong animation stack was
picked up.

## Registering new clips

1. Add rows to `RAW_MANIFEST` in the playground's `components/Playground.tsx`
   (id, pack, category, emotion, loop).
2. If the clip is an **idle**, add its id to the `CC5_IDLES_*` pools in
   `src/core/skeletal-controller.ts` — that's what makes the engine play it as a
   looping rest pose rather than a one-shot gesture. Keep sitting/seated idles
   out of the standing pools.
3. No `ANIMATION_MANIFEST` entry is needed; like the CC4 packs, CC5 clips rely on
   `loadPack`'s defaults plus the idle pools.
