# avatar-engine

Shared 3D avatar engine for all Evolve Simulations products.

Single source of truth for:

- Avaturn GLB loading and mesh refs
- Azure Speech SDK TTS with real viseme events
- Viseme queue drain and ARKit morph target lerp
- Procedural blink and head micro-movement
- Camera framing presets
- Lighting presets (boardroom / consumer / education)
- Error boundary and Suspense fallback

---

## Installation

Published to **GitHub Packages** under the `@evolvesim` scope. Add a project `.npmrc`
so the scope resolves to the GitHub Packages registry:

```ini
# .npmrc
@evolvesim:registry=https://npm.pkg.github.com
```

Then install:

```bash
npm install @evolvesim/avatar-engine
```

> **Note on authentication:** the GitHub Packages npm registry requires a token for
> *all* reads, even for public packages. In CI use the built-in `GITHUB_TOKEN`; for
> local installs use a personal access token with the `read:packages` scope:
>
> ```ini
> # .npmrc
> @evolvesim:registry=https://npm.pkg.github.com
> //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
> ```
>
> ```bash
> export NODE_AUTH_TOKEN=ghp_yourReadPackagesToken
> npm install @evolvesim/avatar-engine
> ```

Then import from the package instead of a local path:

```ts
import { AvatarCanvas, useSimulation } from '@evolvesim/avatar-engine'
```

---

## Package structure

```
avatar-engine/
  src/
    AvatarCanvas.tsx    Three.js Canvas + avatar model + all animations
    use-simulation.ts   Session lifecycle hook (TTS, STT, credits, barge-in)
    viseme-map.ts       Azure 22 viseme IDs -> ARKit blendshape names
    types.ts            All shared TypeScript types and camera/lighting presets
    index.ts            Barrel export
  README.md
```

---

## Quick start — copy-paste per product

### Evolve B2B (corporate L&D)

```tsx
// app/simulation/page.tsx
'use client'

import { AvatarCanvas, useSimulation } from '@/packages/avatar-engine/src'

export default function SimulationPage() {
  const { state, startSession, sendTranscript, endSession, visemeQueueRef, visemeStartRef } =
    useSimulation({
      scenarioType:   'sales-discovery',
      scenarioConfig: { difficulty: 'intermediate', persona: 'sceptical-cfo' },
      avatarId:       null,
      ttsOptions: {
        voiceName:    'en-AU-WilliamNeural',
        speechRate:   '0%',
        tokenEndpoint: '/api/speech/token',
      },
    })

  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <div className="flex-1">
        <AvatarCanvas
          glbUrl="/avatars/professional-male.glb"
          cameraPreset="head-and-shoulders"
          lightingPreset="boardroom"
          visemeQueueRef={visemeQueueRef}
          visemeStartRef={visemeStartRef}
          isAvatarSpeaking={state.status === 'speaking'}
        />
      </div>

      <div className="p-4 flex gap-2">
        <button onClick={startSession} disabled={state.status !== 'idle'}>
          Start
        </button>
        <button onClick={endSession} disabled={state.status === 'idle'}>
          End
        </button>
      </div>
    </div>
  )
}
```

---

### EvySim (B2C consumer coaching)

```tsx
// app/sim/page.tsx
'use client'

import { AvatarCanvas, useSimulation } from '@/packages/avatar-engine/src'

export default function EvySimPage() {
  const { state, startSession, sendTranscript, endSession, visemeQueueRef, visemeStartRef } =
    useSimulation({
      scenarioType:   'salary-negotiation',
      scenarioConfig: { userGoal: 'ask-for-raise', difficulty: 'easy' },
      avatarId:       null,
      ttsOptions: {
        voiceName:    'en-AU-NatashaNeural',
        speechRate:   '0%',
        tokenEndpoint: '/api/speech/token',
      },
    })

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#0e0e1a]">
      <div className="flex-1">
        <AvatarCanvas
          glbUrl="/avatars/evysim-coach.glb"
          cameraPreset="close-face"
          lightingPreset="consumer"
          visemeQueueRef={visemeQueueRef}
          visemeStartRef={visemeStartRef}
          isAvatarSpeaking={state.status === 'speaking'}
          bodyRotationY={0.5}
        />
      </div>
    </div>
  )
}
```

---

### ACTS Education (K-12 / tertiary)

```tsx
// app/acts/scenario/page.tsx
'use client'

import { AvatarCanvas, useSimulation } from '@/packages/avatar-engine/src'

export default function ACTSScenarioPage() {
  const { state, startSession, sendTranscript, endSession, visemeQueueRef, visemeStartRef } =
    useSimulation({
      scenarioType:   'acara-personal-social-capability',
      scenarioConfig: { yearLevel: '10', strand: 'self-management' },
      avatarId:       null,
      ttsOptions: {
        voiceName:    'en-AU-AnnetteNeural',
        speechRate:   '-10%',     // slightly slower — better for K-12 comprehension
        tokenEndpoint: '/api/speech/token',
      },
    })

  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <div className="flex-1">
        <AvatarCanvas
          glbUrl="/avatars/acts-guide.glb"
          cameraPreset="head-and-shoulders"
          lightingPreset="education"
          visemeQueueRef={visemeQueueRef}
          visemeStartRef={visemeStartRef}
          isAvatarSpeaking={state.status === 'speaking'}
        />
      </div>
    </div>
  )
}
```

---

## Props reference

### AvatarCanvas

| Prop | Type | Default | Notes |
|---|---|---|---|
| `glbUrl` | `string` | `'/avatar.glb'` | Path relative to /public |
| `cameraPreset` | `'close-face' \| 'head-and-shoulders' \| 'half-body'` | `'head-and-shoulders'` | |
| `lightingPreset` | `'boardroom' \| 'consumer' \| 'education'` | `'consumer'` | |
| `visemeQueueRef` | `RefObject<VisemeEvent[]>` | required | From useSimulation |
| `visemeStartRef` | `RefObject<number>` | required | From useSimulation |
| `isAvatarSpeaking` | `boolean` | required | `state.status === 'speaking'` |
| `blink` | `boolean` | `true` | Procedural eye blink every 3-7s |
| `headBob` | `boolean` | `true` | Subtle noise-based head micro-movement |
| `bodyRotationY` | `number` | `0.5` | Radians — slight left-facing angle |
| `className` | `string` | `'w-full h-full'` | Wrapping div class |

### useSimulation

| Option | Type | Notes |
|---|---|---|
| `scenarioType` | `string` | Passed to /api/chat and stored in Supabase |
| `scenarioConfig` | `Record<string, unknown>` | Arbitrary scenario config (difficulty, persona, etc.) |
| `avatarId` | `string \| null` | Supabase avatar ID (nullable during onboarding) |
| `ttsOptions.voiceName` | `string` | Azure Neural TTS voice (see voice table below) |
| `ttsOptions.speechRate` | `string` | `'0%'` = normal, `'-10%'` = slower |
| `ttsOptions.speechPitch` | `string` | `'0%'` = normal |
| `ttsOptions.tokenEndpoint` | `string` | Default: `'/api/speech/token'` |

### Voice table

| Product | Voice | Character |
|---|---|---|
| Evolve B2B | `en-AU-WilliamNeural` | Professional AU male |
| EvySim | `en-AU-NatashaNeural` | Warm AU female |
| ACTS Education | `en-AU-AnnetteNeural` | Clear, neutral AU female |

---

## Azure Speech token route

All three products need this route. The token is cached for 9 minutes inside `useSimulation`
so only one call is made per session regardless of how many sentences are spoken.

```ts
// app/api/speech/token/route.ts
import { NextResponse } from 'next/server'

export async function GET() {
  const key    = process.env.AZURE_SPEECH_KEY!
  const region = process.env.AZURE_SPEECH_REGION ?? 'australiaeast'

  const res = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key } },
  )

  if (!res.ok) {
    return NextResponse.json({ error: 'Token fetch failed' }, { status: 500 })
  }

  const token = await res.text()
  return NextResponse.json({ token, region })
}
```

Required environment variables:

```bash
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=australiaeast
```

---

## GLB requirements

The engine is built for Avaturn GLB exports with the following:

- ARKit 52 blendshapes (the mouth viseme shapes and jaw/eye shapes)
- Standard Mixamo/Avaturn skeleton (Hips -> Spine -> Head, LeftArm, RightArm, etc.)
- Idle animation clip named `avaturn_animation` (optional — T-pose fix runs automatically if absent)

### Mesh names the engine expects

```
Head_Mesh
Teeth_Mesh
Tongue_Mesh
Eye_Mesh
EyeAO_Mesh
Eyelash_Mesh
```

If your GLB uses different mesh names, export `AVATURN_MESH_NAMES` from `viseme-map.ts` and
update the array there. All three products share the same list.

---

## How viseme timing works

Azure TTS fires `visemeReceived` events while synthesising audio. Each event has:

- `visemeId` — integer 0-21 (same 22-ID protocol as ElevenLabs)
- `audioOffset` — time from audio start in 100-nanosecond ticks

The hook converts ticks to milliseconds at source (`audioOffset / 10_000`) and stores the
events in `visemeQueueRef`. The drain condition in `AvatarCanvas` useFrame is:

```
fire when: visemeStartRef.current + event.audioOffset <= performance.now()
```

`visemeStartRef` is stamped synchronously at `source.start(0)` (Web Audio API) — making
the timing origin match actual audio playback to the millisecond.

`viseme_sil` (id=0) is skipped. Applying it during speech would zero all mouth shapes
between phonemes, creating an unnatural snap.

The `visemeId` → ARKit mapping in `viseme-map.ts` follows Microsoft's official
[viseme table](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme):
IDs group phonemes by *visual mouth pose* (e.g. `p/b/m` = 21, `f/v` = 18, `s/z` = 15),
not in a sequential vowel-then-consonant order. Consonants/closures use a faster release
than vowels so a transient consonant shape never smears into the following phoneme.

---

## iOS audio unlock

iOS Safari requires a user gesture before AudioContext can play. Call `primeAudio()` inside
any button click handler — typically the "Start" or mic button:

```tsx
const { primeAudio, startSession } = useSimulation(...)

<button onClick={() => { primeAudio(); startSession() }}>
  Start
</button>
```

---

## Barge-in

If the user starts speaking while the avatar is talking, `sendTranscript()` will automatically
abort the in-flight TTS, clear the viseme queue, and stop the audio source before starting
the new response. No extra wiring needed.

---

## Parent container requirements

The Canvas needs a parent with a real height (not just `min-height`) to fill correctly:

```tsx
// Correct
<div className="h-[100dvh] w-full flex flex-col">
  <AvatarCanvas className="flex-1" ... />
</div>

// Wrong — min-height does not propagate height to flex children
<div className="min-h-[100dvh] w-full flex flex-col">
```

---

## Dependencies

```json
{
  "dependencies": {
    "@react-three/drei": "^9",
    "@react-three/fiber": "^8",
    "microsoft-cognitiveservices-speech-sdk": "^1",
    "react": "^18 || ^19",
    "three": "^0.160"
  }
}
```

The Azure Speech SDK is lazy-loaded (`await import(...)`) on first TTS call. It is
browser-only and is excluded from the server-side bundle automatically.

---

## Preloading avatars

The engine preloads `/avatar.glb` at import time. Products using a different GLB path
should call `useGLTF.preload()` in their page or layout file:

```ts
// app/simulation/layout.tsx
import { useGLTF } from '@react-three/drei'
useGLTF.preload('/avatars/professional-male.glb')
```

This puts the GLB in Three.js cache before the first render, eliminating the visible
load delay on scene entry.
