# 06 — Preset lineages

Six forkable system families. Picking one at Stage 1 fills every downstream default; the user
mutates from there.

## The preset object

```ts
export interface SystemPreset {
  id: PresetId
  family: FamilyId
  extends?: PresetId                         // the fork point — presets form a chain
  label: string
  pitch: string                              // one line for the picker

  /** Matched against the Stage 0 dials to recommend a lineage */
  fingerprint: {
    crunch: number; lethality: number; swinginess: number
    playerAuthority: number; prepBurden: number; powerCeiling: number
  }

  doc: DeepPartial<GameSystemInput>          // partial overlay onto its parent
  recommendedModules: ModuleId[]

  /** Only for steps whose answer isn't a plain doc path — multi-selects, tier gates */
  stepDefaults: Partial<Record<StepId, unknown>>

  /** Which stages this family pins hard vs. leaves genuinely open */
  pins: StageId[]
  open: StageId[]

  provenance: {
    basis: 'original' | 'srd-ogl' | 'cc-by' | 'inspired-by'
    note: string
  }
}

export const SYSTEM_PRESETS: Record<PresetId, SystemPreset> = { /* … */ }
```

Chain flattening is a deep merge root → leaf: `scratch` → family → variant → user fork. The
resolved `doc` becomes the session's layer-0/1 base, which is how presets seed step defaults with
no per-preset wiring — see [`04-step-graph.md`](./04-step-graph.md#visibility-and-defaulting).

---

## The six

### 1. d20 class-and-level

**Pitch:** familiar, tactical, zero to hero.
**Fingerprint:** crunch 7, lethality 4, swinginess 8, authority 3, prep 7, ceiling 9.

| Stage | Default |
|---|---|
| Resolution | Single d20, meet-or-beat, binary + critical, advantage/disadvantage as the swing modifier |
| Difficulty | Ladder 5–30, standard 15, asymmetric opposition, scales with progression |
| Chassis | Six attributes with a modifier table, flat skill list, class archetype, derived HP/defence/initiative |
| Creation | Standard array or point-buy, tier 1 |
| Progression | XP or milestone, level packages, tiered curve, ceiling 20, horizontal ratio 0.4 |
| Harm | Hit points scaling with tier, dice damage, avoidance mitigation, no death spiral, death saves |
| Conflict | Rolled initiative, action + bonus + reaction, grid or theatre |

**Anchor check:** a competent character at +7 against standard difficulty 15 needs an 8 or better
— **65%**, which is the family's implicit target. With advantage that becomes 51% on a hard (DC
15, +0) roll versus 30% straight.

**Pins:** resolution, difficulty, progression. **Open:** subsystems, economies, GM structure.

**Characteristic failure of naive forks:** raising the power ceiling without touching the
difficulty ladder. Vertical progression and a fixed ladder produce a game that is tense at tier 1
and trivial at tier 10. The `bounded-accuracy-drift` validator exists specifically for this.

### 2. 2d6 move-driven

**Pitch:** fast, fiction-first, every roll changes something.
**Fingerprint:** crunch 2, lethality 4, swinginess 4, authority 7, prep 2, ceiling 4.

| Stage | Default |
|---|---|
| Resolution | 2d6 sum, ladder comparison, three bands at 6−/7–9/10+, no secondary axis |
| Difficulty | No ladder — the bands *are* the difficulty. Anchor 0.70 combined success. |
| Chassis | Attributes only (−1 to +3), no skill list, playbook archetype carrying its own moves |
| Creation | Playbook pick, ~20 minutes, bonds as a group step |
| Progression | Advance tokens from acting on bonds and beliefs, advance list, capped, horizontal 0.8 |
| Harm | Hit points or clocks, tiered severity damage, narrative-cost defeat |
| Conflict | Conversational initiative, fiction-limited actions, theatre of mind |
| GM | GM never rolls, GM moves list, fronts as the pressure device |

**Anchor check:** at +1, the bands come out **27.8% / 44.4% / 27.8%** (miss / partial / hit). At
+2, **16.7% / 41.7% / 41.7%**. The partial band being the single most likely result at typical
competence is the entire point of the family.

**Pins:** resolution, conflict, GM structure. **Open:** chassis details, harm, progression.

**Characteristic failure of naive forks:** defining the 7–9 band and then never using it.
A partial-success band with no mechanism to spend it against — a cost, a complication, reduced
effect — collapses the system to binary with extra steps. The `band-consumed` validator checks
that something, somewhere, reads the `mixed` valence.

### 3. Dice pool

**Pitch:** granular and tense; competence adds dice, not numbers.
**Fingerprint:** crunch 6, lethality 6, swinginess 5, authority 4, prep 5, ceiling 6.

| Stage | Default |
|---|---|
| Resolution | d10 pool, success on 8+, count-vs required successes, count-degrees bands, botch rule |
| Difficulty | Difficulty as required-success count, 1 standard; pool size from attribute + skill |
| Chassis | Attributes and skills both as 1–5 dot ratings, both contributing pool size |
| Creation | Point-buy across attribute and skill dot budgets |
| Progression | XP, à-la-carte dot purchase with escalating cost, diminishing curve |
| Harm | Wound boxes with escalating penalty, death spiral on |
| Conflict | Static initiative, one action per turn, theatre of mind |

**Anchor check:** a 3-dice pool at 30% per die succeeds **65.7%** of the time; 5 dice, **83.2%**.
Pool systems front-load: the first three dice buy most of the reliability, and the tenth die is
nearly worthless. That's the shape a forker needs to see, and it's why the progression curve
defaults to diminishing.

**Pins:** resolution, chassis encoding, harm. **Open:** conflict, economies, subsystems.

**Characteristic failure of naive forks:** letting maximum pool size grow past about a dozen dice.
The math barely moves and the table-time cost is real. The `pool-size-table-time` validator warns
at the projected maximum, not the starting value.

### 4. Forged in the Dark

**Pitch:** position and effect, player-facing, built around scores and consequences.
**Fingerprint:** crunch 4, lethality 5, swinginess 5, authority 8, prep 2, ceiling 5.

| Stage | Default |
|---|---|
| Resolution | d6 pool, take highest, four bands (1–3 / 4–5 / 6 / two 6s), position-and-effect as the secondary axis |
| Difficulty | Not a target number — position and effect set stakes *before* the roll |
| Chassis | Action ratings 0–4, playbook archetype with special abilities |
| Creation | Playbook pick with an action-rating budget |
| Progression | XP from acting on beliefs and pushing yourself, à-la-carte, capped |
| Harm | Stress with trauma overflow — spend stress to resist consequences |
| Economy | Stress and coin, project clocks, downtime with n actions |
| Conflict | Conversational initiative, fiction-limited, theatre of mind, players roll everything |
| GM | Clocks as the pressure device, GM never rolls |

**Anchor check:** 2 dice take-highest gives **25% / 44.4% / 27.8% / 2.8%** across the four bands.
Zero dice — roll 2, take the *lowest* — gives **75% / 22.2% / 2.8%**. The family's signature is
that the worst band is common enough to matter and consequences are graded rather than binary.

**Pins:** resolution, harm, economy, GM structure. **Open:** chassis content, subsystems.

**Characteristic failure of naive forks:** keeping the dice and dropping position-and-effect. The
resolution core is only half the mechanism — without the pre-roll stakes conversation, a d6
take-highest pool is just a swingy dice pool with fewer options.

### 5. d100 skill-based

**Pitch:** grounded, lethal, classless; the sheet is the difficulty.
**Fingerprint:** crunch 5, lethality 8, swinginess 6, authority 3, prep 5, ceiling 3.

| Stage | Default |
|---|---|
| Resolution | d100, roll-under, five bands with fractional thresholds (half and one-fifth of skill), fumble on 96–00 |
| Difficulty | Modifiers to the skill rather than target numbers; no GM-set DC |
| Chassis | Attributes and percentile skills, occupation as a soft archetype |
| Creation | Point-buy across skill percentages, occupation-gated |
| Progression | Use-based — mark a skill on failure, improve it between sessions. Diminishing curve. |
| Harm | Hit points that do *not* scale, dice damage, flat reduction, major-wound threshold, death |
| Conflict | Static initiative, one action per turn, theatre of mind |

**Anchor check:** a skill of 60 succeeds **60%** of the time, hard (half, ≤30) **30%**, extreme
(one-fifth, ≤12) **12%**. Fractional bands come free from a percentile roll-under, which is why
this family gets granularity without an extra mechanism.

**Pins:** resolution, harm, progression. **Open:** conflict, economies, subsystems.

**Characteristic failure of naive forks:** adding scaling hit points. Fixed lethality is what this
family *is*; making characters durable removes the tension the rest of the design assumes and
leaves a slow percentile system with nothing to show for it.

### 6. Classless point-buy

**Pitch:** maximum expression, simulationist, any setting.
**Fingerprint:** crunch 9, lethality 7, swinginess 3, authority 3, prep 8, ceiling 5.

| Stage | Default |
|---|---|
| Resolution | 3d6 sum, roll-under, margin-derived degrees, critical and fumble tables |
| Difficulty | Modifiers to effective skill; standard task is unmodified |
| Chassis | Four attributes, large skill list, traits with a paired-drawback cost model, no archetype |
| Creation | Point-buy with a single unified budget across everything, 60–90 minutes |
| Progression | Points from session and goals, à-la-carte, linear, horizontal 0.6 |
| Harm | Hit points that don't scale, flat reduction, death spiral on, death |
| Conflict | Rolled initiative, AP pool, grid |

**Anchor check:** 3d6 roll-under a skill of 10 is exactly **50%**; skill 12 is **74.1%**. The
tight bell is the whole point — a +2 difference in skill moves success by 24 percentage points,
where on a d20 it would move it by 10. Competence dominates and luck is a garnish.

**Pins:** resolution, chassis, creation. **Open:** everything else.

**Characteristic failure of naive forks:** unbounded point budgets with no category caps. A single
unified currency across attributes, skills and traits invites a character who is extraordinary in
one dimension and non-functional elsewhere. The `creation-budget-feasible` validator checks that a
legal character is affordable; a separate warning fires when no category caps exist.

---

## Fork-and-mutate semantics

A fork copies the resolved document and records ancestry in `lineage[]`. From there the user's
edits accumulate as layers 2–4 (see [`05-modification-tiers.md`](./05-modification-tiers.md)).

Because ancestry is recorded and modifications are replayable, a fork can be **rebased** onto an
updated ancestor: re-resolve the preset chain, replay the user's own modifications, report
conflicts. This is worth designing for now even if it ships late — retrofitting provenance onto a
document format that didn't have it is painful.

## Provenance and legality

Presets encode **mechanical parameters** — die sizes, band thresholds, track shapes, curve shapes.
They ship with **original labels and original prose**.

Game mechanics are not copyrightable; expression is. Rules text, class names, spell lists, monster
stats, setting material and distinctive terminology are all expression. The `provenance.basis`
field forces whoever authors a preset to declare their footing:

| Basis | Meaning |
|---|---|
| `original` | Designed here |
| `srd-ogl` | Derived from openly licensed material, with the licence obligations met |
| `cc-by` | Creative Commons source, attributed |
| `inspired-by` | Structurally similar to a commercial system, but carrying no text, names or content from it |

`inspired-by` presets must contain **numbers and structure only**. The six lineages above are
described by family shape rather than by product name for exactly this reason, and any
customer-facing labels should be reviewed before shipping.
