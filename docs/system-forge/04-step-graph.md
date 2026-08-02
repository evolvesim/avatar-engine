# 04 — The flow as data

The creation flow in [`02-creation-flow.md`](./02-creation-flow.md) is prose for humans. This is
the machine-readable form: a `Record<StepId, StepDefinition>` that a host application reads to
render the wizard.

**No React, no rendering, no strings baked into components.** This mirrors the
manifest-drives-behaviour convention already used in this repo — `ANIMATION_MANIFEST`
(`src/core/animation-dictionary.ts:61`), `EMOTION_PRESETS`, `LIGHTING_RIGS`
(`src/core/AvatarCanvas.tsx:394`) — where a const table is the single source of truth and the
runtime consumes it rather than duplicating it.

## Step definition

```ts
export type StepKind =
  | 'preset-pick'      // choose a lineage
  | 'single-choice'    // radio
  | 'multi-choice'     // checkbox
  | 'dial'             // numeric slider
  | 'toggle'
  | 'text'
  | 'table-edit'       // author rows: attributes, bands, skills
  | 'formula'          // expert: build an expression tree
  | 'rule-builder'     // expert: trigger + condition + effects
  | 'review'           // read-only: curve preview and diagnostics

export interface StepDefinition {
  id: StepId
  stage: StageId
  order: number

  /** Tier gating. meta.dials.crunch filters this — one dial, same graph, different slice. */
  tier: 'guided' | 'standard' | 'expert'

  title: string
  prompt: string
  help?: string
  /** Stated at the point of choosing, not at compile time. */
  consequences?: string

  kind: StepKind

  /** Document paths this step owns. Used to detect clobbering of expert overrides. */
  writes: DocPath[]

  /** Resolution order: explicit answer > lineage value at path > literal */
  defaultFrom?:
    | { from: 'doc';     path: DocPath }
    | { from: 'literal'; value: unknown }
    | { from: 'expr';    expr: Expr }

  /** Conditional visibility — an Expr over scope { answers, doc, meta } */
  visibleWhen?: Expr

  options?: StepOption[]
  dial?: { path: DocPath; min: number; max: number; step: number; labels?: Record<string, string> }

  /** Blocking errors prevent advancing; warnings don't. */
  validate?: ValidatorId[]

  /** What live preview the host should show alongside this step */
  preview?: 'resolution-curve' | 'time-to-defeat' | 'progression-curve'
            | 'point-budget' | 'sheet-complexity' | 'none'
}

export interface StepOption {
  id: string
  label: string
  summary: string
  /** Orients novices without putting product names in rules text */
  exemplars: string[]
  /** The key field: an option is just a bundle of Modifications */
  patch: Modification[]
  /** Auto-answer downstream steps */
  implies?: Array<{ stepId: StepId; value: unknown }>
  conflicts?: ModuleId[]
}
```

The important line is `patch: Modification[]`. **An option is not a value — it's a set of edits.**
That's what lets a guided choice, a module install and an expert override all flow through one
composer. See [`05-modification-tiers.md`](./05-modification-tiers.md).

## A worked entry

```ts
'resolution.bands.shape': {
  id: 'resolution.bands.shape',
  stage: 'resolution',
  order: 40,
  tier: 'guided',

  title: 'How many degrees of outcome?',
  prompt: 'When someone rolls, how many different things can happen?',
  help: 'This is the shape of every roll in your game. It affects pacing more than any other '
      + 'single choice.',
  consequences: 'Choosing a partial-success band commits you to having something consume it — '
              + 'a cost, a complication, or reduced effect. The validator will check.',

  kind: 'single-choice',
  writes: ['resolution.bands'],
  defaultFrom: { from: 'doc', path: 'resolution.bands' },   // seeded by the chosen lineage

  visibleWhen: {
    t: 'bin', op: '||',
    a: { t: 'bin', op: '!=', a: { t: 'ref', path: 'answers.lineage.pick' },
                              b: { t: 'num', v: 0 } },       // 0 = 'scratch'
    b: { t: 'bin', op: '>=', a: { t: 'ref', path: 'meta.dials.crunch' },
                              b: { t: 'num', v: 2 } },
  },

  validate: ['bands-cover-range', 'bands-do-not-overlap', 'success-rate-in-window'],
  preview: 'resolution-curve',

  options: [
    {
      id: 'binary',
      label: 'Pass or fail',
      summary: 'Cleanest and fastest at the table. The GM supplies nuance.',
      exemplars: ['classic d20 adventure games', 'OSR-likes'],
      patch: [{ op: 'set', path: 'resolution.bands', value: BINARY_BANDS }],
    },
    {
      id: 'three-band',
      label: 'Fail, partial, full',
      summary: 'Every roll moves the fiction. Partial success is the most common result.',
      exemplars: ['2d6 move-driven games', 'd6-pool crew games'],
      patch: [{ op: 'set', path: 'resolution.bands', value: THREE_BAND }],
      implies: [{ stepId: 'conflict.initiative', value: 'conversational' }],
    },
    {
      id: 'four-band',
      label: 'Fail, partial, success, critical',
      summary: 'Adds a spike of triumph without a full degrees ladder.',
      exemplars: ['crew games', 'modern tactical hybrids'],
      patch: [{ op: 'set', path: 'resolution.bands', value: FOUR_BAND }],
    },
    {
      id: 'five-band',
      label: 'Fumble through critical',
      summary: 'Granular. Rewards high skill and punishes low. Slowest to adjudicate.',
      exemplars: ['percentile investigation games'],
      patch: [{ op: 'set', path: 'resolution.bands', value: FIVE_BAND }],
    },
  ],
},
```

The expert-tier sibling of this step is `resolution.bands.author`, a `table-edit` step writing to
the same path, visible only at crunch ≥ 8. When both are answered, the provenance layer flags that
the expert edit will be clobbered if the user returns and changes the guided choice.

## The session engine

A pure reducer over `(STEP_GRAPH, answers)`.

```ts
export interface ForgeSession {
  readonly answers: Readonly<Record<StepId, unknown>>
  readonly draft: GameSystemInput            // recomputed by compose(lineage, allMods)

  visibleSteps(): StepView[]                 // filtered by visibleWhen + tier, ordered
  current(): StepView | null
  progress(): { answered: number; visible: number; stage: StageId }

  answer(id: StepId, value: unknown): ForgeSession    // immutable — returns a new session
  revise(id: StepId): ForgeSession                    // jump back, reporting invalidated dependents
  diagnostics(): Diagnostic[]

  finish(): { ok: true; system: GameSystem } | { ok: false; diagnostics: Diagnostic[] }
}

export function createForgeSession(init?: {
  lineageId?: PresetId
  answers?: Record<StepId, unknown>
}): ForgeSession
```

Because it's pure, the host persists only `{ lineageId, answers, expertMods }` — a small JSON blob
— and replays to reconstruct the full document. That's the whole persistence story: the library
holds no state and does no I/O, matching how the rest of this repo delegates persistence to the
host over HTTP.

`revise()` deliberately *reports* invalidated dependents rather than silently dropping them. If a
user goes back and switches from a dice pool to a d20, their authored band conditions reference
`successes`, which no longer exists. The correct behaviour is to say so.

## Visibility and defaulting

**Visibility** uses the same `Expr` type as everything else — one condition language in the whole
spec, not two. A step is shown when `visibleWhen` is absent or evaluates truthy, *and* its tier
passes the crunch filter.

**Defaulting** resolves in one order, and the middle case is the one that matters:

1. An explicit answer, if the user gave one.
2. `defaultFrom: { from: 'doc', path }` — reads the current draft, which the lineage already
   seeded. **This is the whole preset mechanism.** No per-preset wiring, no per-step special
   cases: a preset writes to the document, and every step that reads from the document picks it
   up automatically.
3. A literal or computed fallback.

A preset only needs explicit `stepDefaults` for steps whose answer isn't a plain document path —
multi-selects that expand into several patches, and tier gates.

## Stage spine

```
0  identity      — name, pitch, play pattern, six dials
1  lineage       — fork a family or start from scratch
2  resolution    — dice, comparison, bands, secondary axis, contributions
3  difficulty    — anchor rate, ladder, opposition model, scaling
4  chassis       — layers, attributes, skills, archetypes, identity axes, derived
5  creation      — method, budget, starting tier, table-time, group steps
6  progression   — currency, triggers, purchase, curve, endgame
7  harm          — tracks, damage, mitigation, defeat, recovery
8  economy       — meta-currency, ability resources, wealth, downtime
9  conflict      — initiative, action economy, space, frames
10 subsystems    — opt-in modules, each with a mini-flow
11 gm            — adversary math, budgeting, pressure devices, GM moves
12 review        — validate, probability report, emit, lock
```

Roughly twelve steps are visible at crunch 3; roughly sixty at crunch 10.

## Integrity as a test, not a convention

The step graph is a large hand-authored table, which means it will rot. Two machine checks stop
that, in the spirit of `tests/unit/lighting-rigs.test.ts` — which pins manifest values so one
product's tuning can't silently drag another's:

- **`step-graph-integrity`** — every `writes` path resolves against the schema; every
  `visibleWhen` references known step ids; every step is reachable from a default session; no
  duplicate `order` within a stage; every `implies` target exists.
- **`preset-goldens`** — every preset parses clean and produces zero error-level diagnostics.

Adding a seventh lineage that's internally incoherent should fail CI, not ship.

Worth noting: CI in this repo currently runs `npm run typecheck` only, not `npm test`
(`.github/workflows/publish.yml`). For GPU and DOM code that's defensible. For a pure-logic rules
compiler it isn't — typecheck proves nothing about whether the dice math is right. Whenever this
spec becomes code, adding `npm test` to CI is part of the work.
