# Animation Dictionary Compiler

## Purpose

Compile animations from Quaternius, Mesh2Motion, and Mixamo into a single
`animations.glb` binary dictionary loaded asynchronously at app start.

This avoids runtime loading of individual FBX/GLB files — which would block
the conversation with network requests and destroy immersion.

---

## Step 1 — Download animation sources

### Quaternius Universal Animation Library (CC0)
- URL: https://quaternius.itch.io/universal-animation-library
- Download the `.zip`, extract to `scripts/sources/quaternius/`
- Select clips matching the names in `ANIMATION_MANIFEST` (see `animation-dictionary.ts`)

### Mesh2Motion (CC0 / MIT)
- URL: https://mesh2motion.org
- Use their web interface to select and export animations
- Export as GLB (multi-animation pack option)
- Save to `scripts/sources/mesh2motion/`

### Mixamo (Adobe — free commercial use)
- URL: https://mixamo.com
- Upload any standard humanoid FBX as the base (or use the default)
- Search for each clip name in `ANIMATION_MANIFEST` (e.g. "Dismissive Wave", "Thoughtful Head Shake")
- Download each as FBX with skeleton, 30fps
- Save to `scripts/sources/mixamo/`

---

## Step 2 — Rename clips to match the manifest

Each downloaded animation must be renamed to exactly match its key in
`ANIMATION_MANIFEST` in `animation-dictionary.ts`.

Examples:
- Quaternius "Idle" → `quaternius_neutral_idle`
- Mixamo "Dismissive Gesture" → `mixamo_anger_dismissive_wave`
- Mesh2Motion "Clap" → `mesh2motion_joy_celebratory_clap`

The GLB clip name (set in Blender's NLA editor) must match exactly.
The Virtual Director prompt lists these IDs — the LLM must emit exact matches.

---

## Step 3 — Pack into a single GLB using Blender

```bash
blender --background --python scripts/pack_animations.py
```

### pack_animations.py (create this script)

```python
import bpy
import os

SOURCE_DIR   = './scripts/sources'
OUTPUT_PATH  = './public/avatar-engine/animations.glb'

# Remove default scene objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Import each source file
for root, dirs, files in os.walk(SOURCE_DIR):
    for filename in files:
        path = os.path.join(root, filename)
        ext  = filename.lower().split('.')[-1]
        if ext == 'fbx':
            bpy.ops.import_scene.fbx(filepath=path)
        elif ext == 'glb' or ext == 'gltf':
            bpy.ops.import_scene.gltf(filepath=path)

# Export all as a single GLB
# The AnimationDictionary loader reads gltf.animations[] — clip names are preserved
bpy.ops.export_scene.gltf(
    filepath=OUTPUT_PATH,
    export_format='GLB',
    export_animations=True,
    export_skins=False,         # No mesh/skin — animations only
    export_morph=False,
    export_apply=False,
    use_selection=False,
)

print(f'Exported animation dictionary to {OUTPUT_PATH}')
```

---

## Step 4 — Verify

```bash
# Check clip names match ANIMATION_MANIFEST
node -e "
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js')
// ... or use a quick Python gltf inspector
"
```

A simpler verification: open `animations.glb` in https://gltf.report/ and
check the **Animations** tab. Each clip name must exactly match a key in
`ANIMATION_MANIFEST`.

---

## Target file size

- Target: < 500KB gzipped
- If over budget: reduce animation clip lengths (keep gestures under 2s)
- Remove keyframes outside the relevant range using Blender's NLA editor

---

## Output

Place the compiled file at:
```
public/avatar-engine/animations.glb
```

The engine loads it at:
```ts
AvatarEngine({ animationDictionaryUrl: '/avatar-engine/animations.glb' })
```

---

## Adding new animations later

1. Download/create the new clip
2. Add an entry to `ANIMATION_MANIFEST` in `animation-dictionary.ts`
3. Re-run `scripts/compile-animations.py`
4. Re-deploy `public/avatar-engine/animations.glb`
5. The Virtual Director automatically discovers the new ID on next load
