# System Forge

A framework for letting users author their **own tabletop RPG systems** — not their own content
for someone else's system.

## Why this exists

Every homebrew tool on the market assumes the ruleset already exists. Rollplay, PCGen, Aurora
Builder, Foundry and World Anvil all give you character sheets, automation and lore layered on
top of rules somebody else wrote. None of them help you decide *what the rules are*.

System Forge fills that gap. It walks a user through the design decisions that constitute a game
system, in an order where each answer narrows the next, and emits a machine-readable
`GameSystem` document that downstream tools — character builders, virtual tabletops, an LLM game
master — can consume.

The flow completes **before** the user touches the story world. That ordering is deliberate:
world content needs a rules vocabulary to bind to. You cannot meaningfully write "the Iron
Compact is a Tier 3 faction with a 6-segment clock" until the system knows what a tier is, what a
faction is, and whether clocks exist.

## Status

**These documents are a design specification.** No code is implemented. The eventual home for
the implementation is most likely the `evolve-dnd` product rather than this repository — this is
an avatar rendering library and a rules compiler does not belong in its module graph. The specs
are written to be portable: nothing here depends on anything in `src/`.

## Reading order

| Document | What it covers |
|---|---|
| [`01-commonalities.md`](./01-commonalities.md) | The research. Twelve axes every TTRPG answers, with ~19 published systems mapped onto them. |
| [`02-creation-flow.md`](./02-creation-flow.md) | **The centrepiece.** The 13 ordered stages and every choice inside them. |
| [`03-schema.md`](./03-schema.md) | The `GameSystem` zod document schema. |
| [`04-step-graph.md`](./04-step-graph.md) | The flow expressed as data, so any host app can render it. |
| [`05-modification-tiers.md`](./05-modification-tiers.md) | Guided / composed / authored, and the typed rule vocabulary. |
| [`06-preset-lineages.md`](./06-preset-lineages.md) | Six forkable system families. |
| [`07-validation-and-math.md`](./07-validation-and-math.md) | Probability engine and coherence validators. |
| [`examples/`](./examples/) | Three worked systems that prove the schema generalises. |

If you read only one document, read `02-creation-flow.md`. If you read two, add
`01-commonalities.md` — it's the evidence the flow is built on.

## The whole thing on one page

**Stages.** `0 premise & dials` → `1 lineage` → `2 resolution core` → `3 difficulty scale` →
`4 chassis` → `5 creation procedure` → `6 progression` → `7 harm & recovery` → `8 economies` →
`9 conflict engine` → `10 optional subsystems` → `11 GM structure` → `12 compile & hand off`.

**Three ways to use it.**

- *Guided* — set six dials, fork a lineage, accept every default. About ten minutes to a playable
  system.
- *Composed* — swap modules, retune numbers, add and remove trait layers. Still entirely within
  enumerated options.
- *Authored* — define new mechanics from typed primitives: triggers, conditions, effects and
  formula trees.

**One mechanism underneath all three.** Every choice at every tier emits a `Modification`. The
composer applies them in layer order and records provenance, so the system can always answer
"why is this number 14, and who set it?"

**Two guardrails.** A probability engine that shows the user the curve their resolution core
actually produces, and a set of coherence validators that catch the mistakes homebrewers reliably
make — a lethality dial set to 9 with no death rules, a progression curve the difficulty ladder
can't absorb, an outcome band nothing consumes.

## Design commitments

These are decisions, not open questions. They're recorded here so they survive the next person
who asks.

1. **The step flow is data, not UI.** No React, no rendering, no strings baked into components.
   A host app reads the step graph and draws whatever it wants. This mirrors the
   manifest-drives-behaviour convention already used in this repo
   (`src/core/animation-dictionary.ts:61`).
2. **Structured composition only — no scripting, no text DSL.** Expert users compose formulas as
   typed expression *trees*, not strings that get parsed. See
   [`05-modification-tiers.md`](./05-modification-tiers.md) for the reasoning and the cost.
3. **Validation never throws.** Every entry point returns a result with diagnostics and a safe
   fallback, following the pattern at `src/core/virtual-director.ts:34-100`.
4. **Warnings don't block.** People build deliberately weird games. The tool says so and gets out
   of the way. Only structural errors — a formula referencing a deleted attribute — prevent
   compiling.
5. **Presets encode mechanics, not expression.** Game mechanics aren't copyrightable; rules text,
   names, spell lists and monster stats are. Every preset declares its provenance and ships with
   original labels and original prose. See [`06-preset-lineages.md`](./06-preset-lineages.md).
