# 01 — What every TTRPG has in common

The claim this whole framework rests on:

> Every tabletop RPG answers the same twelve questions. They differ in *where they sit on each
> axis*, not in which axes exist. A system that appears to skip an axis has answered it with
> "none" — and that's a design choice with consequences, not an absence.

If that's true, a single parameterised model can express all of them, and a single ordered flow
can elicit them. This document is the evidence.

**Proof obligation:** every system in the survey tables below must be expressible in
[`03-schema.md`](./03-schema.md). Any that isn't is a schema bug, to be recorded rather than
hidden.

---

## The twelve axes

### Axis 1 — Randomiser

What generates the uncertainty.

| Position | Description | Curve shape |
|---|---|---|
| `single` | One die: d20, d100, d6 | Flat — every result equally likely |
| `sum` | Add several dice: 2d6, 3d6 | Bell — clusters hard around the mean |
| `pool-count` | Roll N dice, count how many beat a threshold | Binomial in successes |
| `pool-highest` | Roll N dice, keep the single best | Steep diminishing returns per die |
| `keep-n` | Roll M, keep best/worst N: advantage, 4d6-drop-lowest | Skewed |
| `step-die` | Trait sets die *size*: d4→d6→d8→d10→d12 | Flat, but range grows with skill |
| `fudge` | 4dF, faces −1/0/+1 | Tight bell centred on zero |
| `symbol` | Faces carry symbols, not numbers; two axes at once | Multi-dimensional |
| `paired-asymmetric` | Two distinguishable dice; sum resolves, comparison signals tone | Bell + a second channel |
| `cards` | Draw from a deck; state persists between draws | Sampling without replacement |
| `diceless` | Spend a resource, compare fixed values | Deterministic |

The choice is mostly about **variance**, and variance is the single most felt property of a
system at the table. A d20 is swingy — the difference between a novice and an expert is often
smaller than the roll's own spread. 3d6 is not: competence dominates. Neither is better; they
model different fictions. A flat die says "anything can happen to anyone"; a bell says "skill
tells."

### Axis 2 — Comparison

How the roll becomes a verdict.

| Position | Description |
|---|---|
| `meet-or-beat` | Roll + mods ≥ target number |
| `roll-under` | Roll ≤ your own trait value |
| `opposed` | Both sides roll; compare |
| `count-vs` | Count successes in a pool, compare to a required count |
| `ladder` | No external target; the raw result indexes a fixed band table |

`roll-under` is quietly different from the rest: the character sheet *is* the difficulty. There's
no DC to set, which removes a whole category of GM decisions — and a whole category of GM
control.

### Axis 3 — Outcome bands

How many distinct things can happen.

| Position | Description |
|---|---|
| `binary` | Success or failure |
| `three-band` | Failure / partial / success — the mixed result is the default, not an exception |
| `four-band` | Adds a critical tier |
| `five-band` | Fumble / fail / partial / success / critical |
| `margin-degrees` | Degrees derived from how much you beat the target by |
| `count-degrees` | Each extra success buys an additional effect |

The three-band shape is the single most influential structural idea in modern design. Making
"yes, but" the *statistically most common* result changes what the game is about — the fiction
moves on every roll, so nobody is ever just told "nothing happens."

### Axis 4 — Secondary signal

A second, independent channel of information from the same roll.

| Position | Description |
|---|---|
| `none` | One axis only |
| `tone-die` | A distinguishable die colours the outcome regardless of success — and often pays out a currency |
| `symbol-axis` | Success/failure and advantage/threat resolve independently |
| `effect-die` | A second die sets magnitude while the first sets whether |
| `position-effect` | Stakes and magnitude are set *before* the roll, not derived from it |
| `explode` | Maximum results roll again and add |
| `botch` | Specific low faces actively subtract or cause harm |

This axis is where most of the last decade's innovation has happened. It lets one roll answer
"did it work?" and "what did it cost?" simultaneously, which is exactly the thing that otherwise
requires a second roll and kills pacing.

### Axis 5 — Character chassis

Which layers of trait a character has, and how they feed a roll.

| Layer | Typical role |
|---|---|
| `attributes` | 3–8 broad innate capacities |
| `skills` | Learned specifics; anywhere from 0 to 100+ |
| `tags` / `aspects` | Free-text descriptors with mechanical weight |
| `moves` / `abilities` | Discrete triggered rules the character owns |
| `derived` | Computed: HP, defence, initiative, carry capacity |
| `resources` | Spendable, refreshing pools |

Systems combine 0–6 of these. **The count is the crunch dial made concrete.** A system with
attributes + skills + moves + derived + resources is a fundamentally heavier object than one with
attributes alone, no matter how elegantly each part is written.

How a layer *encodes* into a roll matters as much as whether it exists: a value can add raw, feed
a modifier table, set a die size, set a pool size, or grant an extra die.

### Axis 6 — Archetype model

How a character is bundled at the top level.

| Position | Description |
|---|---|
| `none` | Classless; buy what you like |
| `class` | Pick a package; levels grant scheduled features |
| `playbook` | A complete character kit including its own moves, bonds and questions |
| `career-lifepath` | Build history in stages; each stage grants and constrains |
| `composite` | Several orthogonal axes multiply out |
| `frame` | The character is a pilot; the *chassis* is the mechanical loadout |

Classes optimise for onboarding: a new player reads one page and can play. Classless optimises
for expression, and costs the player a design task at exactly the moment they know least about
the game.

### Axis 7 — Creation procedure

| Position | Trade |
|---|---|
| `point-buy` | Maximum control, slowest, invites optimisation |
| `standard-array` | Fast and balanced; every character has the same shape |
| `roll` | Fast and characterful; wildly unequal |
| `lifepath` | Generates fiction as a side effect; slowest of all |
| `playbook-pick` | Fastest; the kit is pre-balanced |
| `freeform` | Describe and assign; needs an experienced table |

Worth asking explicitly: **how long should making a character take?** Ten minutes and ninety
minutes are both valid answers, and they imply different systems.

### Axis 8 — Progression

Five sub-questions: what currency, earned how, spent on what, along what curve, ending where.

| Sub-axis | Positions |
|---|---|
| Currency | XP / milestone / advance tokens / use-based ticks / none |
| Trigger | Defeating opposition / achieving goals / session count / acting in character / failing |
| Purchase | Level packages / à-la-carte / playbook advance list / trait tick-up |
| Curve | Linear / tiered / diminishing / capped / flat |
| Endgame | Retirement / legacy / domain play / ascension / open-ended |

The interesting hidden question is the **horizontal-to-vertical ratio**: does advancement mostly
make your numbers bigger, or mostly give you more things to do? Vertical growth forces the
difficulty ladder to chase it — the treadmill problem. Horizontal growth doesn't, but is harder
to write.

Use-based progression ("mark the skill when you fail with it") deserves special mention: it makes
advancement diegetic and removes the GM from the loop entirely.

### Axis 9 — Harm

| Model | Description |
|---|---|
| `hit-points` | An ablative pool, usually growing with progression |
| `wound-boxes` | Fixed boxes; filling them applies escalating penalties |
| `wound-levels` | Named severity tiers |
| `stress-trauma` | Spend stress to resist harm; overflow inflicts permanent trauma |
| `consequences` | Named narrative conditions occupying limited slots |
| `structure-stress` | Parallel tracks for different damage kinds |
| `narrative-only` | Fiction decides; no track |

Plus four sub-choices: **mitigation** (avoidance vs. reduction vs. soak roll), **death spiral**
(does being hurt make you worse at not getting hurt?), **defeat** (death / death saves / out of
action / narrative cost / retirement), and **recovery rate**.

Growing hit points are the most consequential quiet decision in the whole axis. They force damage
to scale, which forces adversaries to scale, which produces a treadmill where a 10th-level fight
feels exactly like a 1st-level fight with bigger numbers. Fixed harm tracks avoid this and make
lethality constant — which is a different game, not a better one.

### Axis 10 — Economies

| Economy | Positions |
|---|---|
| Meta-currency | None / player-held / GM-held / both-sided opposed / shared pool |
| Ability resource | At-will / slots / points / cooldown / recharge-on-roll |
| Material wealth | Coin-detailed / abstract level / supply die / none |
| Encumbrance | Weight / slots / none |
| Downtime | None / free-form / n actions per interval / project clocks |

Meta-currency is how a system hands narrative authority to players without giving it away
unconditionally. A both-sided economy where the GM banks a matching resource is a notably
different pressure device from a one-way player currency.

### Axis 11 — Conflict engine

| Sub-axis | Positions |
|---|---|
| Initiative | Rolled / static / side-based / popcorn / card-draw / none (conversational) |
| Action economy | Action+bonus+reaction / AP pool / one thing per turn / fiction-limited |
| Space | Grid / zones / abstract range bands / theatre of mind |
| Engagement | Attack-vs-defence / opposed / single-roll exchange |
| Non-combat frames | Social / chase / investigation / heist / downtime, each reusing the core or not |

The buried question: **is combat a special mode with its own rules, or just the core loop pointed
at someone?** Systems that answer "special mode" get tactical depth and a genre signal that
fighting matters. Systems that answer "same loop" get pacing and a much shorter book.

### Axis 12 — Table structure

| Sub-axis | Positions |
|---|---|
| GM role | Traditional / GM as fiction-only (never rolls) / rotating / none |
| Who rolls | Both / players only |
| Pressure devices | Clocks / fronts / doom pool / countdowns / none |
| Prep burden | Statted encounters / situation prep / random tables / zero prep |
| Player authority | Declare actions only / spend to declare facts / unconditional narrative rights |

"Players roll everything" is a deceptively large lever. It halves the dice at the table, keeps
attention on the players, and turns every GM threat into a player-facing decision.

---

## Survey: where published systems sit

Abbreviations: **R** randomiser, **C** comparison, **B** bands, **2nd** secondary signal.

| System | R | C | B | 2nd | Chassis | Archetype | Harm |
|---|---|---|---|---|---|---|---|
| D&D 5e | single d20 | meet-or-beat | binary + crit | advantage | attr + skills + abilities + derived | class | hit-points |
| Pathfinder 2e | single d20 | meet-or-beat | four-band by margin | none | attr + skills + feats + derived | class | hit-points |
| OSR / B-X | single d20, d6 | mixed | binary | none | attr + derived | class | hit-points |
| GURPS | 3d6 sum | roll-under | margin-degrees | crit tables | attr + skills + traits | none | hit-points |
| BRP / Call of Cthulhu | d100 | roll-under | five-band (fractional) | none | attr + skills + derived | occupation | hit-points + sanity |
| Savage Worlds | step-die + wild die | meet-or-beat | raises by margin | explode | attr + skills + edges | none | wound-levels |
| World of Darkness | d10 pool | count-vs | count-degrees | botch | attr + skills + disciplines | clan/splat | wound-boxes |
| Shadowrun | d6 pool | count-vs | count-degrees | glitch | attr + skills + gear | archetype | condition monitors |
| Year Zero | d6 pool | count-vs | count-degrees | push mechanic | attr + skills | career | wound-boxes |
| Fate | 4dF sum | ladder + opposed | four-band | none | aspects + approaches/skills + stunts | none | stress + consequences |
| PbtA / Dungeon World | 2d6 sum | ladder | three-band | none | attr + moves | playbook | hit-points or clocks |
| Forged in the Dark | d6 pool-highest | ladder | four-band | position/effect | attr (actions) + special abilities | playbook | stress + trauma |
| Cortex Prime | rated pool | opposed | total + effect die | effect-die | traits across sets | none | stress tracks |
| Genesys | symbol dice | ladder | two independent axes | symbol-axis | attr + skills + talents | career | wounds + strain |
| Cypher | single d20 | meet-or-beat | binary + intrusion | none | three stat pools + skills | composite | pool depletion |
| Ironsworn | d6 + 2d10 | opposed | three-band | match rule | attr + assets | none | health + spirit + supply |
| Mothership | d100 | roll-under | binary + crit | none | attr + skills + saves | class | wounds + stress/panic |
| Lancer | single d20 | meet-or-beat | binary | accuracy dice | pilot + mech frame | frame | structure + stress |
| Daggerheart | paired-asymmetric 2d12 | meta-currency-generating pair | tone-die | class + domains | hit-points + tiered damage | | |

*(Daggerheart's row is deliberately ragged — its tone die is a secondary signal that also drives a
two-sided meta-currency, which is exactly the kind of cross-axis coupling the schema has to
support.)*

### Economies and table structure

| System | Meta-currency | Ability resource | Initiative | Space | Who rolls |
|---|---|---|---|---|---|
| D&D 5e | Inspiration (thin) | slots + cooldown | rolled | grid or theatre | both |
| Pathfinder 2e | hero points | slots + cooldown | rolled | grid | both |
| GURPS | none | points | rolled | grid | both |
| Call of Cthulhu | luck spend | none | static | theatre | both |
| Savage Worlds | bennies | none | card draw | grid | both |
| World of Darkness | willpower | blood/vitae | static | theatre | both |
| Fate | fate points | stunts + refresh | static ladder | zones | both |
| PbtA | varies (hold, bonds) | at-will moves | conversational | theatre | players only |
| Forged in the Dark | stress + coin | at-will | conversational | theatre | players only |
| Cortex Prime | plot points | at-will | popcorn | theatre | both |
| Genesys | story points (two-sided) | strain | rolled | range bands | both |
| Cypher | pool spend (Effort) | pool spend | GM-set | theatre | players only |
| Ironsworn | momentum | assets | none | theatre | players only (solo) |
| Daggerheart | hope / fear (two-sided) | at-will + cards | conversational | range bands | both |

### What the tables show

1. **No cell is empty.** Every system answers every axis, including by declining.
2. **Positions recur.** Eleven positions cover randomisers across nineteen systems. The design
   space is broad but not infinite — which is what makes enumeration viable.
3. **Axes correlate but don't determine.** Players-only rolling clusters with conversational
   initiative and theatre-of-mind, but Cypher breaks the pattern. The model must allow
   combinations that no published game has shipped; that's the point of a homebrew tool.
4. **The coupling is the hard part.** Growing hit points force damage scaling force adversary
   scaling. Three-band outcomes want something to consume the partial band. These couplings are
   precisely what [`07-validation-and-math.md`](./07-validation-and-math.md) checks, because they
   are what naive homebrew gets wrong.

---

## The gaps the flow must not have

Reading across the survey, four things are load-bearing in real systems and easy to omit from a
builder:

- **The anchor number.** Nearly every system has an implicit target success rate for a competent
  character at standard difficulty. Nobody writes it down, and every balance decision depends on
  it. Stage 3 makes it explicit and the validators tune against it.
- **What consumes the partial band.** Three-band outcomes are worthless if no mechanic anywhere
  reads "partial". A system can define the band and never use it.
- **The horizontal/vertical ratio.** Determines whether the difficulty ladder has to chase
  progression.
- **Who holds narrative authority, mechanically.** Not a tone statement — a question about
  meta-currency, who rolls, and whether players can declare facts.

---

## Sources

Survey positions are drawn from the published rules of the systems named. General taxonomy
cross-checked against:

- [Taxonomy of dice systems — RPGnet Forums](https://forum.rpg.net/index.php?threads/taxonomy-of-dice-systems.295085/)
- [How to Choose Resolution Mechanics for Your TTRPG](https://www.ttrpg-games.com/blog/how-to-choose-resolution-mechanics-for-your-ttrpg)
- [Ultimate Guide to Dice-Based Resolution Systems](https://www.ttrpg-games.com/blog/ultimate-guide-to-dice-based-resolution-systems)
- [TTRPG Dice Systems Explained](https://jonasthegm.com/ttrpg-dice-systems-explained/)
- [Daggerheart core mechanics](https://daggerheart.fandom.com/wiki/Core_Mechanics)

Competitive landscape:

- [TTRPG Homebrew Tools guide](https://www.ttrpg-games.com/blog/ttrpg-homebrew-tools-ultimate-guide)
- [Rollplay — custom character sheet builder](https://www.daydreamteam.com/)
- [Best free character builder tools for homebrew RPGs](https://www.ttrpg-games.com/blog/best-free-character-builder-tools-for-homebrew-rpgs/)
