# 03 — The `GameSystem` schema

The document a completed flow produces. One zod schema per stage, composed into a root.

## Conventions

Follows the validate-with-fallback idiom already used in this repo at
`src/core/virtual-director.ts:34-100`: schema → `z.infer` type → `safeParse` → on failure return
diagnostics plus a safe fallback. **Nothing here ever throws.**

Two exported types, and the distinction matters because of how much `.default()` there is:

```ts
export type GameSystemInput  = z.input<typeof GameSystemSchema>   // what presets author — defaults optional
export type GameSystem       = z.output<typeof GameSystemSchema>  // resolved — every default applied
```

Presets are `DeepPartial<GameSystemInput>` using a hand-written `DeepPartial`, **not** zod's
`.deepPartial()` — it's deprecated in v3 and silently passes through `ZodEffects`, which the root
schema has because of `.superRefine`.

## Shared primitives

```ts
// primitives.ts
export const Ident = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab identifier')
export const DocPath = z.string()   // 'resolution.bands[id=partial].label' — see 05
export const DieSize = z.union([z.number().int().min(2).max(1000), z.literal('F')])

export const RangeSpec = z.object({
  min: z.number(),
  max: z.number(),
  typical: z.number(),
}).refine(r => r.min <= r.typical && r.typical <= r.max, 'typical must lie within min..max')
```

## Expressions

Formulas are **typed trees**, not strings. There is no parser and no evaluator escape hatch —
see [`05-modification-tiers.md`](./05-modification-tiers.md) for why.

```ts
// expr.ts
export type Expr =
  | { t: 'num';  v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'ref';  path: string }                        // 'attr.might.value', 'margin', 'tier'
  | { t: 'dice'; count: Expr; sides: DieSize; keep?: { n: Expr; end: 'high' | 'low' } }
  | { t: 'un';   op: '-' | '!'; a: Expr }
  | { t: 'bin';  op: BinOp; a: Expr; b: Expr }
  | { t: 'call'; fn: BuiltinName; args: Expr[] }       // whitelist only
  | { t: 'cond'; test: Expr; then: Expr; else: Expr }

export type BinOp = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||'
export type BuiltinName = 'min' | 'max' | 'floor' | 'ceil' | 'round' | 'abs' | 'clamp'

// Recursive schemas under `strict: true` need the explicit annotation or TS emits TS7022.
// Declare the TS union by hand first, then annotate — do not try to z.infer it.
export const ExprSchema: z.ZodType<Expr> = z.lazy(() => z.union([ /* … */ ]))
```

Dice are first-class AST nodes rather than opaque strings. That's what lets one authored formula
serve both the runtime roll and the probability curve — the same tree is walked by a numeric
evaluator and by a distribution evaluator.

## Metadata — Stage 0

```ts
export const DialsSchema = z.object({
  crunch:        z.number().int().min(0).max(10).default(5),
  lethality:     z.number().int().min(0).max(10).default(5),
  swinginess:    z.number().int().min(0).max(10).default(5),
  playerAuthority: z.number().int().min(0).max(10).default(3),
  prepBurden:    z.number().int().min(0).max(10).default(5),
  powerCeiling:  z.number().int().min(0).max(10).default(5),
})

export const MetadataSchema = z.object({
  id: Ident,
  name: z.string().min(1),
  pitch: z.string().default(''),
  toneTags: z.array(z.enum([
    'gritty','heroic','comedic','bleak','pulpy','mythic','procedural','romantic',
  ])).default([]),
  playPattern: z.enum(['gm-party','gm-less','solo','duet']).default('gm-party'),
  partySize: z.object({ min: z.number().int(), max: z.number().int() })
    .default({ min: 3, max: 5 }),
  sessionShape: z.enum(['one-shot','episodic','campaign','open-table']).default('campaign'),
  dials: DialsSchema,
})
```

## Resolution core — Stage 2

The unifying construct. Every surveyed system is *(a)* a dice expression producing one or two
numeric axes, *(b)* a comparison producing a margin, *(c)* an ordered band table over that margin.

```ts
export const DiceSpecSchema = z.object({
  kind: z.enum([
    'single', 'sum', 'pool-count', 'pool-highest', 'pool-lowest',
    'keep-n', 'step-die', 'fudge', 'symbol', 'paired-asymmetric', 'cards', 'diceless',
  ]),
  count: ExprSchema.default({ t: 'num', v: 1 }),   // may be a formula: pool size from a trait
  sides: DieSize.default(6),
  keep: z.object({ n: ExprSchema, end: z.enum(['high','low']) }).optional(),
  successOn: z.number().int().optional(),          // pool-count threshold
  botchOn: z.number().int().optional(),
  explode: z.object({
    on: z.number().int(),
    maxDepth: z.number().int().min(1).max(10).default(4),   // truncation depth for exact math
    mode: z.enum(['add','replace','add-new-die']).default('add'),
  }).optional(),
  reroll: z.object({
    on: z.array(z.number().int()),
    times: z.number().int().min(1).max(3).default(1),
  }).optional(),
  /** Wild dice, action dice, tone dice — anything distinguishable rolled alongside */
  companionDice: z.array(z.object({
    id: Ident,
    label: z.string(),
    sides: DieSize,
    combine: z.enum(['max','min','sum','separate-axis','compare-for-tone']),
  })).default([]),
})

export const ComparisonSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('meet-or-beat'), target: ExprSchema }),
  z.object({ mode: z.literal('roll-under'),   target: ExprSchema,
             fractionalBands: z.boolean().default(false) }),   // half/fifth of skill
  z.object({ mode: z.literal('opposed'),      opposing: DiceSpecSchema }),
  z.object({ mode: z.literal('count-vs'),     required: ExprSchema }),
  z.object({ mode: z.literal('ladder') }),                     // raw result indexes bands directly
])

export const OutcomeBandSchema = z.object({
  id: Ident,
  label: z.string(),
  /** Evaluated against scope { margin, total, successes, highest, raw, target } */
  when: ExprSchema,
  /** Semantic tag — lets other subsystems say "on any success" without knowing band names,
   *  and is what gets serialised into the LLM rules brief. */
  valence: z.enum(['critical-failure','failure','mixed','success','critical-success']),
  guidance: z.string().default(''),              // GM-facing prose
  effects: z.array(EffectSchema).default([]),
})

export const ResolutionCoreSchema = z.object({
  dice: DiceSpecSchema,
  direction: z.enum(['high','low']).default('high'),
  comparison: ComparisonSchema,
  bands: z.array(OutcomeBandSchema).min(2),
  /** Which chassis layers feed a roll, and how each encodes — Stage 2.7 */
  contributions: z.array(z.object({
    source: z.enum(['attribute','skill','tag','archetype','equipment','situational','meta-currency']),
    apply: z.enum(['raw','modifier-table','die-size','pool-size','extra-die','none']),
  })).default([]),
  swingModifiers: z.array(z.enum([
    'flat-bonus','extra-dice','step-die','reroll','take-best-n','shift-position',
  ])).default([]),
  /** Advantage/threat, effect die, position/effect — a second independent channel */
  secondaryAxis: z.object({
    id: Ident,
    label: z.string(),
    source: z.enum(['symbol','effect-die','position-effect','margin-derived','tone-die']),
    bands: z.array(OutcomeBandSchema),
    /** If the tone channel pays a currency, this links to economy.metaCurrencies */
    paysCurrency: Ident.optional(),
  }).optional(),
  /** Spend-to-alter-a-roll: fate points, bennies, momentum */
  interventions: z.array(z.object({
    id: Ident,
    label: z.string(),
    currency: Ident,
    cost: ExprSchema,
    effect: z.enum(['reroll','add-bonus','add-die','upgrade-band','declare-detail']),
    magnitude: ExprSchema.optional(),
  })).default([]),
})
```

## Difficulty — Stage 3

```ts
export const DifficultySchema = z.object({
  /** The anchor. Everything is tuned against this. */
  anchorSuccessRate: z.number().min(0).max(1).default(0.65),
  ladder: z.array(z.object({
    id: Ident,
    label: z.string(),
    value: z.number(),
    isStandard: z.boolean().default(false),
  })).min(1),
  opposition: z.enum(['symmetric','asymmetric']).default('asymmetric'),
  scalesWithProgression: z.boolean().default(true),
})
```

## Chassis — Stage 4

```ts
export const AttributeSchema = z.object({
  id: Ident,
  label: z.string(),
  abbrev: z.string().max(4),
  range: RangeSpec,
  encoding: z.enum(['raw','modifier-table','die-size','dot-rating','percentile']),
  /** Only when encoding is 'modifier-table' — e.g. floor((value - 10) / 2) */
  modifierFormula: ExprSchema.optional(),
})

export const SkillModelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('flat-list'),
             skills: z.array(SkillSchema),
             proficiencyStyle: z.enum(['binary','tiered','rank','percentile','die-rating']) }),
  z.object({ kind: z.literal('approaches'), approaches: z.array(SkillSchema) }),
  z.object({ kind: z.literal('domains'),
             domains: z.array(SkillSchema),
             specialisations: z.boolean().default(false) }),
  z.object({ kind: z.literal('freeform-tags'), suggested: z.array(z.string()).default([]) }),
])

export const ArchetypeModelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('class'), levelsGrantFeatures: z.boolean().default(true) }),
  z.object({ kind: z.literal('playbook'), carriesOwnAdvances: z.boolean().default(true) }),
  z.object({ kind: z.literal('career-lifepath'), stages: z.number().int().min(1) }),
  z.object({ kind: z.literal('composite'), axes: z.array(Ident) }),
  z.object({ kind: z.literal('frame') }),
])

export const IdentityAxisSchema = z.object({
  id: Ident,
  label: z.string(),                                  // 'species', 'culture', 'background'
  mechanical: z.boolean().default(true),              // false = purely descriptive
  options: z.array(z.object({
    id: Ident, label: z.string(), mods: z.array(ModificationSchema).default([]),
  })).default([]),
})

export const DerivedStatSchema = z.object({
  id: Ident,
  label: z.string(),
  formula: ExprSchema,
  rounding: z.enum(['floor','ceil','round','none']).default('floor'),
  clamp: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
})

export const ResourceTrackSchema = z.object({
  id: Ident,
  label: z.string(),
  max: ExprSchema,
  startsAt: z.enum(['full','empty','half']).default('full'),
  refresh: z.enum(['scene','rest','downtime','session','never','on-trigger']).default('rest'),
})

export const ChassisSchema = z.object({
  layers: z.array(z.enum(['attributes','skills','tags','moves','derived','resources']))
    .default(['attributes','derived']),
  attributes: z.array(AttributeSchema).default([]),
  skills: SkillModelSchema.default({ kind: 'none' }),
  archetypes: ArchetypeModelSchema.default({ kind: 'none' }),
  tags: z.object({
    enabled: z.boolean().default(false),
    costModel: z.enum(['free-pick','point-buy','level-gated','paired-drawback']).default('free-pick'),
    categories: z.array(Ident).default([]),
  }).default({}),
  identityAxes: z.array(IdentityAxisSchema).default([]),
  derived: z.array(DerivedStatSchema).default([]),
  resources: z.array(ResourceTrackSchema).default([]),
})
```

## Creation — Stage 5

```ts
export const CreationSchema = z.object({
  method: z.enum(['point-buy','standard-array','roll','lifepath','playbook-pick','freeform'])
    .default('standard-array'),
  budget: ExprSchema.optional(),
  array: z.array(z.number()).optional(),
  rollFormula: ExprSchema.optional(),
  startingTier: z.number().int().min(0).default(1),
  startingKit: z.array(z.string()).default([]),
  /** Minutes. Checked against the decision count the procedure actually requires. */
  tableTimeBudgetMin: z.number().int().positive().default(30),
  groupSteps: z.array(z.enum(['bonds','shared-origin','party-sheet','group-resources']))
    .default([]),
})
```

## Progression — Stage 6

```ts
export const ProgressionSchema = z.object({
  currency: z.enum(['xp','milestone','advance-tokens','use-based','none']).default('milestone'),
  earnTriggers: z.array(z.enum([
    'defeat-opposition','achieve-goals','session-attendance','act-on-beliefs',
    'fail-rolls','discover','spend-downtime',
  ])).default(['achieve-goals']),
  purchase: z.enum(['level-packages','a-la-carte','advance-list','trait-tick-up'])
    .default('level-packages'),
  curve: z.enum(['linear','tiered','diminishing','capped','flat']).default('tiered'),
  tiers: z.array(z.object({ id: Ident, label: z.string(), threshold: z.number() })).default([]),
  ceiling: z.number().int().positive().optional(),
  /** 0 = purely bigger numbers, 1 = purely more options. Feeds the treadmill validator. */
  horizontalRatio: z.number().min(0).max(1).default(0.5),
  endgame: z.enum(['retirement','legacy','domain-play','ascension','open-ended'])
    .default('open-ended'),
})
```

## Harm — Stage 7

```ts
export const HarmTrackSchema = z.object({
  id: Ident,
  label: z.string(),
  kind: z.discriminatedUnion('model', [
    z.object({ model: z.literal('hit-points'), formula: ExprSchema,
               scalesWithProgression: z.boolean().default(true) }),
    z.object({ model: z.literal('wound-boxes'), boxes: z.number().int(),
               penaltyPerBox: ExprSchema }),
    z.object({ model: z.literal('wound-levels'),
               levels: z.array(z.object({ id: Ident, label: z.string(), penalty: z.number() })) }),
    z.object({ model: z.literal('stress-trauma'), stressMax: ExprSchema,
               traumaMax: z.number().int() }),
    z.object({ model: z.literal('consequences'),
               slots: z.array(z.object({ id: Ident, label: z.string(), severity: z.number() })) }),
    z.object({ model: z.literal('narrative-only') }),
  ]),
  damage: z.enum(['fixed','dice','tiered-severity','margin-derived','narrative'])
    .default('dice'),
  mitigation: z.enum(['none','avoidance','flat-reduction','soak-roll','threshold','resist-spend'])
    .default('avoidance'),
  deathSpiral: z.boolean().default(false),
  defeat: z.enum(['death','death-saves','out-of-action','narrative-cost',
                  'permanent-injury','retirement','debt']).default('death-saves'),
  recovery: z.object({
    rate: z.enum(['scene','rest','downtime','slow-clock','never']).default('rest'),
    formula: ExprSchema.optional(),
    requiresRoll: z.boolean().default(false),
  }).default({}),
})

/** Physical, sanity, corruption, reputation — all the same shape. */
export const HarmSchema = z.object({
  tracks: z.array(HarmTrackSchema).min(1),
})
```

## Economy — Stage 8

```ts
export const EconomySchema = z.object({
  metaCurrencies: z.array(z.object({
    id: Ident,
    label: z.string(),
    holder: z.enum(['player','gm','both-sides','shared-pool']),
    earnTriggers: z.array(z.string()).default([]),
    cap: z.number().int().positive().optional(),
    refresh: z.enum(['session','scene','never']).default('session'),
  })).default([]),
  abilityResources: z.array(z.enum([
    'at-will','slots','points','cooldown','recharge-on-roll',
  ])).default(['at-will']),
  wealth: z.enum(['coin-detailed','abstract-level','supply-die','untracked'])
    .default('abstract-level'),
  encumbrance: z.enum(['weight','slots','soft','none']).default('none'),
  downtime: z.object({
    model: z.enum(['none','freeform','n-actions','project-clocks']).default('none'),
    actionsPerInterval: z.number().int().positive().optional(),
  }).default({}),
})
```

## Conflict — Stage 9

```ts
export const ConflictSchema = z.object({
  initiative: z.enum(['rolled','static','side-based','popcorn','card-draw','conversational'])
    .default('rolled'),
  actionEconomy: z.enum(['action-bonus-reaction','ap-pool','one-per-turn','fiction-limited'])
    .default('one-per-turn'),
  space: z.enum(['grid','zones','range-bands','theatre']).default('theatre'),
  roundScale: z.string().default('a few seconds'),
  engagement: z.enum(['attack-vs-defence','opposed','single-roll-exchange'])
    .default('attack-vs-defence'),
  frames: z.array(z.object({
    id: Ident,                                          // 'social', 'chase', 'heist'
    label: z.string(),
    mode: z.enum(['off','reuses-core','own-procedure']).default('off'),
  })).default([]),
  scaleConflicts: z.array(z.enum(['mass-battle','vehicles','ships','domains'])).default([]),
})
```

## Subsystems, rules, GM structure

```ts
export const SubsystemSchema = z.object({
  moduleId: Ident,                                      // key into the module catalog
  config: z.record(z.unknown()).default({}),
})

export const CustomRuleSchema = z.object({
  id: Ident,
  label: z.string(),
  trigger: z.object({
    on: z.enum(['before-roll','after-roll','on-band','on-harm','on-rest',
                'on-advance','on-spend','on-scene-start']),
    filter: ExprSchema.optional(),
  }),
  condition: ExprSchema.optional(),
  effects: z.array(EffectSchema).min(1),
  priority: z.number().int().default(0),                // deterministic ordering when several fire
})

export const GmStructureSchema = z.object({
  adversaryTemplate: z.array(z.object({ id: Ident, label: z.string(), formula: ExprSchema }))
    .default([]),
  encounterBudget: z.enum(['none','guideline','formal']).default('guideline'),
  pressureDevices: z.array(z.enum(['clocks','fronts','doom-pool','countdowns'])).default([]),
  randomTables: z.boolean().default(false),
  gmRolls: z.enum(['everything','opposition-only','never']).default('everything'),
  gmMoves: z.array(z.string()).default([]),
})
```

## The root

```ts
export const SCHEMA_VERSION = 1 as const

export const GameSystemSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: MetadataSchema,
  /** Fork ancestry, most-general first. Enables rebasing onto an updated ancestor. */
  lineage: z.array(Ident).default([]),
  resolution: ResolutionCoreSchema,
  difficulty: DifficultySchema,
  chassis: ChassisSchema,
  creation: CreationSchema,
  progression: ProgressionSchema,
  harm: HarmSchema,
  economy: EconomySchema,
  conflict: ConflictSchema,
  subsystems: z.array(SubsystemSchema).default([]),
  customRules: z.array(CustomRuleSchema).default([]),
  gm: GmStructureSchema,
  /** Audit trail: how this document came to look the way it does. */
  mods: z.array(ModRecordSchema).default([]),
}).superRefine(structuralChecks)
```

`structuralChecks` pushes issues rather than throwing — dangling references, unreachable bands,
formulas naming attributes that don't exist. Detail in
[`07-validation-and-math.md`](./07-validation-and-math.md).

## Notes on the shape

**Why harm is an array of tracks.** Sanity, corruption, stress and physical injury are the same
object with different labels. Modelling them separately would triple the schema and prevent a
user from inventing a fourth kind.

**Why bands carry a `valence`.** Without it, nothing else in the document can refer to outcomes
generically. With it, a subsystem can say "on any `success` or better" and work in a system whose
bands are named "Screaming Triumph" and "Adequate."

**Why `contributions` lives on the resolution core and not the chassis.** It's a statement about
how a *roll* is assembled, and it has to be readable by the probability engine without walking
the chassis. Putting it here keeps the dice math self-contained.

**Why `mods` is persisted in the document.** Provenance. A user needs to be able to ask "why is
this 14?" and get "the d20 lineage set it to 10, the `hardened` identity option added 2, and you
overrode it to 14 in the expert bench."

## Versioning

`schemaVersion` is a literal, and a migration map (`n → n+1`) upgrades persisted user documents.
This matters more here than in most schemas: users will have invested hours in documents, and the
schema will change substantially through Phase 2 and 3.
