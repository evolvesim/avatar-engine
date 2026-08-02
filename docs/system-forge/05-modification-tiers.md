# 05 — Modification tiers

How a novice's dial, an intermediate's module swap and an expert's custom rule all write into the
same document through one mechanism.

## The three tiers

| Tier | Who | What they do | Visible when |
|---|---|---|---|
| **Guided** | Someone who wants to play this week | Set six dials, fork a lineage, answer ~12 questions, accept the rest | Always |
| **Composed** | Someone with a specific game in mind | Swap modules, retune numbers, add and remove trait layers, enable subsystems | crunch ≥ 4 |
| **Authored** | Someone designing a system on purpose | Define new mechanics from typed primitives: triggers, conditions, effects, formula trees | crunch ≥ 8 |

Tiers are a **filter on one step graph**, not three separate products. The expert sees every step
the novice sees, plus more. A novice who raises the crunch dial mid-flow gets more questions
without losing any answers.

## One mechanism: `Modification`

Every choice at every tier emits the same thing.

```ts
export type Modification =
  | { op: 'set';             path: DocPath; value: unknown }
  | { op: 'merge';           path: DocPath; value: Record<string, unknown> }
  | { op: 'append';          path: DocPath; value: unknown }
  | { op: 'removeById';      path: DocPath; id: string }
  | { op: 'installModule';   moduleId: ModuleId; config?: Record<string, unknown> }
  | { op: 'defineRule';      rule: CustomRule }
  | { op: 'overrideFormula'; path: DocPath; expr: Expr }

export interface ModRecord {
  mod: Modification
  layer: 0 | 1 | 2 | 3 | 4
  origin: { kind: 'preset' | 'step' | 'module' | 'expert'; id: string }
  note?: string
}
```

**Layers, applied in order:**

| Layer | Source |
|---|---|
| 0 | Preset base — the root of the lineage chain |
| 1 | Preset leaf — the specific fork the user picked |
| 2 | Step answers — everything the guided and composed tiers produce |
| 3 | Module installs — subsystems enabled at Stage 10 |
| 4 | Expert overrides — the authored tier |

`compose()` sorts by layer, then by insertion index within a layer, then applies sequentially onto
a structurally-cloned base. Deterministic and replayable: the same modifications in a different
submission order produce the same document.

Modules apply at layer 3, **after** step answers, because enabling a subsystem legitimately
overrides earlier general choices — turning on a magic module that needs a spell-point resource
should win over the default "at-will" answer. Expert edits apply last, because that's what expert
means.

## Path addressing

Do **not** use JSON Pointer array indices. Preset forks insert and remove bands and attributes, so
`bands/2` means different things in two lineages, and a fork that adds a band silently corrupts
every downstream modification.

Use keyed segments:

```
resolution.bands[id=partial].guidance
chassis.attributes[id=might].modifierFormula
harm.tracks[id=stress].recovery.rate
subsystems[id=magic].config.slotTable
```

The resolver parses segments, looks up `[key=value]` against array members, and creates
intermediate objects on write for `set` and `merge`. Around 120 lines of code, and it is the
difference between forks that survive an upstream change and forks that don't.

## Provenance

Every applied modification records last-writer-per-path, which buys three things:

1. **"Why is this 14?"** — *the d20 lineage set it to 10, the `hardened` background added 2, and
   you overrode it to 14 in the expert bench.*
2. **Clobber warnings.** If a user authors a custom HP formula at layer 4 and later returns to the
   guided HP question at layer 2, the composer can see that a lower layer is about to be
   overwritten by a higher-priority edit that the user may have forgotten. Surfacing that is the
   single most important UX affordance in the whole subsystem — silently discarding an hour of
   expert work is how a tool loses a user permanently.
3. **Rebasing.** A fork records its ancestry; when the ancestor preset changes, the user's own
   layer-2-through-4 modifications can be replayed onto the new base and conflicts reported.

## The authored tier

### Custom rules

A new mechanic is a trigger, an optional condition, and a list of effects.

```ts
export interface CustomRule {
  id: Ident
  label: string
  trigger: {
    on: 'before-roll' | 'after-roll' | 'on-band' | 'on-harm' | 'on-rest'
      | 'on-advance' | 'on-spend' | 'on-scene-start'
    filter?: Expr
  }
  condition?: Expr
  effects: Effect[]
  priority: number          // deterministic ordering when several rules fire on one event
}

export type Effect =
  | { kind: 'modify-roll';     amount: Expr }
  | { kind: 'add-die';         sides: DieSize; count: Expr }
  | { kind: 'shift-band';      steps: Expr }
  | { kind: 'adjust-resource'; resourceId: Ident; amount: Expr }
  | { kind: 'adjust-harm';     trackId: Ident; amount: Expr }
  | { kind: 'set-flag';        flag: Ident; value: Expr }
  | { kind: 'start-clock';     clockId: Ident; segments: Expr }
  | { kind: 'grant-option';    optionId: Ident }
  | { kind: 'narrate';         text: string }     // surfaces to an LLM game master
```

A **novel subsystem** is then just a resource track, a set of custom rules, and optionally some
step definitions — packaged as a user-authored module. The built-in catalog uses exactly the same
structure, which means the shipped modules double as worked examples of the authoring format.

### Formulas as typed trees

Formulas are composed as `Expr` trees, not typed as text. `HP = (hitDie + CON) × level` is:

```ts
{
  t: 'bin', op: '*',
  a: { t: 'bin', op: '+',
       a: { t: 'ref', path: 'archetype.hitDie' },
       b: { t: 'ref', path: 'attr.constitution.mod' } },
  b: { t: 'ref', path: 'tier' },
}
```

A host UI renders this as a nested builder — pick an operator, fill two slots, each slot being a
constant, a reference from a dropdown of what actually exists in this chassis, or another
operator. Verbose to author, but every reference is picked from a validated list rather than typed
and misspelled.

## Why no scripting and no text DSL

This is a deliberate constraint, recorded here so it survives the next person who asks.

**What's ruled out:** attaching JavaScript or Lua to hooks, and parsing user-typed formula strings
like `"floor((STR-10)/2) + prof"`.

**What's ruled in:** typed expression trees, composed as data.

The line is drawn at *is there a parser?* An `Expr` tree is composed structurally — there's no
grammar, no lexer, no string that could mean something other than it appears to. It's the same
kind of object as the rest of the document.

**What this buys:**

- **Full static analysis.** Every reference in every formula can be checked against the declared
  chassis. Deleting an attribute reliably finds every formula that used it. This is the single
  most common authoring error and it becomes impossible to ship.
- **The probability engine works on authored content.** The same tree walked by the numeric
  evaluator is walked by the distribution evaluator. An expert who writes a custom damage formula
  still gets a correct time-to-defeat estimate. With a scripting escape hatch, everything
  downstream of the script becomes Monte Carlo at best and opaque at worst.
- **Portability and safety.** The document is data end to end. It serialises, diffs, migrates
  across schema versions, and can be rendered into a rules brief for an LLM. Nothing needs a
  sandbox because there's nothing to sandbox.

**What it costs, honestly:**

- **Verbosity.** A three-term formula is a dozen lines of JSON. This is entirely a UI problem — a
  decent tree builder makes it fine — but the underlying document is not pleasant to hand-edit.
- **A real ceiling.** Anything not expressible as trigger + condition + effects over the
  vocabulary above cannot be built. A genuinely novel resolution structure — something with a
  fundamentally different shape from the eleven randomisers — needs a schema change, not a user
  action.
- **Vocabulary pressure.** Every unanticipated mechanic becomes a request to extend `Effect` or
  `BuiltinName`. The vocabulary will grow, and each addition has to be supported by the evaluator,
  the distribution evaluator and the validators.

**When to revisit.** If real users repeatedly hit the ceiling in the same place, the answer is to
extend the typed vocabulary — not to add scripting. The one change that would justify reopening
this is a serious need for user-authored *content* generation logic (procedural tables with
complex conditional branching), which is a different problem from rules and might deserve a
different, narrower tool.

## Two safety details worth keeping

Even without scripting, the evaluator should carry these — cheap, and they turn a class of bugs
into diagnostics:

- **Reference resolution rejects prototype paths.** Scope is a null-prototype map and the segment
  walk refuses `__proto__`, `constructor` and `prototype`. A malformed or hostile document can't
  reach host objects.
- **Node and depth caps.** A tree deeper than ~24 or larger than ~512 nodes is a diagnostic, not a
  stack overflow. There are no loops in the grammar, so this is belt-and-braces, but shared
  documents make it worth having.
