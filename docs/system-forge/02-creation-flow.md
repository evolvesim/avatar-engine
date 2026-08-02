# 02 — The creation flow

The ordered sequence of choices a user makes to create a game system, from nothing to a compiled
document ready for world building.

## Ordering principles

1. **Most constraining first.** Stage 2 (resolution core) determines what Stages 3, 7 and 9 can
   even mean. Getting it late means re-deciding everything.
2. **No world knowledge required.** Nothing in this flow asks about setting, factions, places or
   plot. A user who has not decided whether their game is fantasy or cyberpunk can complete every
   stage. This is what makes the system a reusable object rather than one campaign's rules.
3. **Every stage has a default.** From Stage 1 onward, a user can accept the lineage's answer and
   move on. The flow must be completable in about ten minutes by someone who only wants to tune a
   few things.
4. **Consequences are shown, not hidden.** Where a choice implies downstream constraints, the flow
   says so at the point of choosing, not at compile time.
5. **Revision is free.** Going back to Stage 2 invalidates dependent answers, and the flow tells
   the user which ones rather than silently discarding them.

## Stage map

| # | Stage | Load-bearing? | Skippable by novice? |
|---|---|---|---|
| 0 | Premise & dials | Yes | No — six sliders, ninety seconds |
| 1 | Lineage | Yes | No — but "just pick the recommended one" is valid |
| 2 | Resolution core | **Most** | Yes, with a lineage |
| 3 | Difficulty & opposition scale | Yes | Yes |
| 4 | Character chassis | Yes | Yes |
| 5 | Creation procedure | No | Yes |
| 6 | Progression | No | Yes |
| 7 | Harm, stakes & recovery | Yes | Yes |
| 8 | Economies | No | Yes |
| 9 | Conflict engine | No | Yes |
| 10 | Optional subsystems | No | Yes — default is none |
| 11 | GM-facing structure | No | Yes |
| 12 | Compile, validate, hand off | Yes | No |

---

## Stage 0 — Premise & dials

No mechanics yet. This stage produces a **design fingerprint** that seeds every downstream default
and is what the coherence validators check the finished system against.

**Identity**

- System name
- One-line pitch — *"what is a session of this game like?"* Prose, not mechanics.
- Tone tags (optional, from a controlled list: gritty, heroic, comedic, bleak, pulpy, mythic,
  procedural, romantic)

**Play pattern**

- GM + party / GM-less collaborative / solo journalling / duet (one GM, one player)
- Expected party size
- Session shape: one-shot / episodic / long campaign / open-table

**The six dials** (0–10)

| Dial | 0 | 10 |
|---|---|---|
| **Crunch** | One page of rules | Simulationist, exhaustive |
| **Lethality** | Characters don't die | Death is common and cheap |
| **Swinginess** | Competence dominates | Anything can happen |
| **Player authority** | Players declare actions only | Players author facts about the world |
| **Prep burden** | Zero prep, run from tables | Statted, mapped, prepared encounters |
| **Power ceiling** | Competent people stay competent | Zero to demigod |

The dials are not decoration. They do three things:

- **Recommend a lineage** in Stage 1 by nearest-neighbour match against each preset's own
  fingerprint.
- **Seed defaults** — swinginess picks the randomiser, crunch sets how many trait layers Stage 4
  proposes, lethality picks the harm model.
- **Anchor the validators** — at Stage 12 the compiled system is measured against the fingerprint,
  and divergence is reported. *"You set lethality to 2, but expected time-to-defeat is 1.4 rounds
  and there are no death saves."*

**Crunch also sets the tier filter**: crunch ≤ 3 shows only guided steps (roughly a dozen across
the whole flow), crunch ≥ 8 shows every expert step (roughly sixty). One dial, same graph,
different visible slice. This is the main answer to "let novices do fundamental things and let
experts do complex modifications."

---

## Stage 1 — Lineage

Fork a known family, or start from scratch.

Six families ship, each documented in [`06-preset-lineages.md`](./06-preset-lineages.md):

| Lineage | Feel | Good for |
|---|---|---|
| **d20 class-and-level** | Familiar, tactical, zero-to-hero | Adventure games with combat as a pillar |
| **2d6 move-driven** | Fast, fiction-first, always-consequential | Character drama, genre emulation |
| **Dice pool** | Granular, tense, scales by dice not by numbers | Intrigue, horror, competence-under-pressure |
| **Forged in the Dark** | Position/effect, player-facing, heist-shaped | Crews, scores, escalating trouble |
| **d100 skill-based** | Grounded, lethal, classless | Investigation, historical, survival horror |
| **Classless point-buy** | Maximum expression, simulationist | Any setting, experienced tables |

Picking a lineage fills every subsequent default. **"Start from scratch"** is fully supported and
means every later stage requires an explicit answer — the flow grows from ~12 questions to ~40
minimum.

Forking is **copy-and-mutate with recorded ancestry**. The document keeps its lineage chain, so a
fork can later be rebased onto an updated ancestor.

---

## Stage 2 — Resolution core

The single most constraining choice in the flow. Everything downstream reads from it.

**2.1 Randomiser** — the eleven positions from Axis 1. Selecting one immediately fixes what 2.3
and 2.4 can offer.

**2.2 Direction** — roll high or roll low. Roll-under has a consequence worth stating at the point
of choice: *the character sheet becomes the difficulty, so there is no DC for the GM to set.*

**2.3 Comparison** — meet-or-beat / roll-under / opposed / count-vs / ladder.

**2.4 Outcome bands** — how many results exist, and where the boundaries sit. This is a table
editor, not a dropdown, at the expert tier: each band has an id, a label, a condition, a valence
(`critical-failure` … `critical-success`) and optional GM guidance prose.

The valence tag matters beyond presentation — it's what lets other subsystems say "on any success"
without knowing this particular system's band names, and it's what gets serialised into a rules
brief for an LLM game master.

**2.5 Secondary signal** — none / tone die / symbol axis / effect die / position-and-effect /
exploding / botch. Choosing a tone die opens a linked question: *does it pay a currency?* If yes,
Stage 8 pre-fills a two-sided meta-currency.

**2.6 Swing modifiers** — how situational advantage is expressed: flat bonus / extra dice /
step the die up / reroll / take best N / shift position. A system can enable several.

**2.7 Roll assembly** — which character values contribute to a roll, and how each one encodes:
raw addition, modifier table, die size, pool size, or extra die. This is the join between Stage 2
and Stage 4, and it's the question most homebrew never answers explicitly.

**2.8 Probability preview** — not a question. Before leaving the stage the user sees the actual
curve: band probabilities at novice / typical / expert competence against easy / standard / hard
difficulty. Most bad resolution cores die here, which is the point.

---

## Stage 3 — Difficulty & opposition scale

**3.1 The anchor.** *What should a competent character's chance of success be, at standard
difficulty?* One number. Everything else in the flow is tuned against it, and it is the input to
half the validators. Typical answers run 55–75%; the flow warns outside 25–85%.

**3.2 Difficulty ladder.** Named tiers mapped to numbers — trivial, easy, standard, hard, extreme,
near-impossible. Which tiers exist, what they're called, what the numbers are. Roll-under systems
express this as modifiers to the trait rather than target numbers.

**3.3 Opposition modelling.** Are adversaries built on the same chassis as PCs (symmetric — one
rulebook, slower prep) or on separate simplified math (asymmetric — faster prep, needs its own
balance pass)? This choice propagates all the way to Stage 11.

**3.4 Scaling posture.** Does difficulty scale with character progression? Answering "yes"
commits to a treadmill and makes the Stage 6 curve load-bearing. Answering "no" means
high-progression characters trivialise early content — which is a legitimate design goal
(bounded accuracy is the deliberate middle path) but should be chosen, not stumbled into.

---

## Stage 4 — Character chassis

**4.1 Which layers exist.** Multi-select over attributes / skills / tags / moves / derived /
resources. The crunch dial pre-selects; the flow shows a live estimate of sheet complexity.

**4.2 Per-layer definition.** For each enabled layer: how many, what they're called, numeric
range, typical starting value, and how it encodes into a roll (from 2.7).

Attributes get an extra question: is the raw value used directly, or does it feed a modifier
table? The modifier-table pattern is what allows a wide, characterful attribute range to produce
a narrow, balanced bonus range — and it is a genuine complexity cost most systems pay without
noticing.

**4.3 Archetype model.** None / class / playbook / career-lifepath / composite / frame. Choosing
`playbook` implies a lot: the archetype carries its own moves, its own creation questions, and
usually its own advancement list, so Stages 5 and 6 restructure around it.

**4.4 Identity axes.** Species / heritage / culture / background / faction / upbringing — how many
exist, and for each, whether it's mechanical or purely descriptive. Worth its own question because
"descriptive only" is an increasingly common and deliberate choice.

**4.5 Derived values.** HP, defence, initiative, carry capacity, and anything else computed. Each
is a formula over the layers defined in 4.2. At the guided tier these are picked from common
shapes; at the expert tier they're authored as expression trees.

---

## Stage 5 — Creation procedure

**5.1 Method** — point-buy / standard array / random roll / lifepath / playbook pick / freeform.

**5.2 Budget or table** — the point total, the array values, or the roll formula.

**5.3 Starting power** — where on the progression curve characters begin.

**5.4 Starting kit** — gear, resources, and abilities at creation.

**5.5 Table-time budget.** *How long should making a character take?* This is a real constraint,
not a nicety: the answer is checked against the number of decisions the procedure actually
requires, and the flow warns when a fifteen-minute target collides with an eighty-decision
process.

**5.6 Group steps** — bonds and relationships, shared origin, party sheet, group resources.
Optional, and the thing that most reliably converts a set of characters into a party.

---

## Stage 6 — Progression

**6.1 Currency** — XP / milestone / advance tokens / use-based ticks / none.

**6.2 Earn trigger** — what actually generates it. Multi-select: defeating opposition, achieving
goals, session attendance, acting on bonds or beliefs, failing rolls, discovering things.

The trigger is a statement of what the game is about. A system that grants advancement for
defeating opposition is telling players to fight; one that grants it for acting on beliefs is
telling them to have beliefs. This is worth saying in the flow, because it's the single most
commonly copied-without-thinking element in homebrew.

**6.3 Purchase** — level packages / à-la-carte / playbook advance list / trait tick-up.

**6.4 Curve** — linear / tiered / diminishing / capped. Plus the ceiling, and the tier boundaries
if tiered.

**6.5 Horizontal/vertical ratio** — a slider. How much of advancement is bigger numbers versus
more options? Feeds directly into the treadmill validator.

**6.6 Endgame** — retirement / legacy characters / domain play / ascension / open-ended.

---

## Stage 7 — Harm, stakes & recovery

**7.1 Harm model** — hit points / wound boxes / wound levels / stress-and-trauma / consequence
slots / parallel tracks / narrative only. Pre-seeded from the lethality dial.

**7.2 Track sizing** — the formula, and whether it grows with progression. Growing tracks commit
to damage scaling; the flow says so here.

**7.3 Damage expression** — fixed / dice / tiered severity / derived from margin / narrative.

**7.4 Mitigation** — avoidance (harder to hit) vs. reduction (flat subtraction) vs. soak roll vs.
threshold vs. resist-with-a-resource. Avoidance and reduction feel completely different at the
table even when the expected values match: avoidance produces swingy all-or-nothing exchanges,
reduction produces reliable grinding.

**7.5 Death spiral** — do accumulated injuries penalise future rolls? Yes is realistic and makes
losing fights feel like losing; it also makes the losing player's remaining turns worse, which is
a real table cost.

**7.6 Defeat** — death / death saves / out of action / narrative cost / permanent injury /
retirement / debt.

**7.7 Recovery** — rate and tiers: per scene / per rest / per downtime / slow clock / never. Plus
whether recovery is a resource, a roll, or automatic.

**7.8 Non-physical tracks** — sanity, corruption, stress, reputation, fatigue. Each is a full harm
track with its own answers to 7.1–7.7.

---

## Stage 8 — Economies

**8.1 Meta-currency** — exists or not; name; who holds it (players / GM / both sides / shared
pool); earn triggers; what it buys; cap; whether it refreshes.

**8.2 Ability resources** — at-will / slots / points / cooldown / recharge-on-roll. Multiple
resource types allowed.

**8.3 Material wealth** — coin-detailed / abstract wealth level / supply die / not tracked.

**8.4 Encumbrance** — weight / slots / soft limits / none.

**8.5 Downtime economy** — none / freeform / n actions per interval / project clocks. Downtime is
where long-campaign systems either generate player-driven story or generate nothing.

---

## Stage 9 — Conflict engine

**9.1 Initiative** — rolled / static / side-based / popcorn / card draw / conversational.

**9.2 Action economy** — action + bonus + reaction / AP pool / one thing per turn /
fiction-limited.

**9.3 Space** — grid / zones / abstract range bands / theatre of mind. Choosing grid implies
per-square abilities, movement rates and probably a VTT.

**9.4 Round scale** — how much fictional time a round represents.

**9.5 Engagement model** — attack vs. static defence / opposed roll / single-roll exchange where
one roll resolves both sides.

**9.6 Non-combat conflict frames** — social, chase, investigation, heist, downtime. For each:
off, reuses the core loop, or has its own procedure. Giving a frame its own procedure is the
single biggest page-count decision in the flow.

**9.7 Scale conflicts** — mass battle, vehicles, ships, domains. Off by default.

---

## Stage 10 — Optional subsystems

Each is off by default and opens its own mini-flow when enabled. Enabling one may require another
(crafting wants a material economy) or conflict with one.

| Subsystem | Its own questions |
|---|---|
| **Magic / powers** | Source, cost model, list vs. freeform, failure and backlash, ritual casting, who can learn |
| **Tech & gear-as-abilities** | Whether gear grants moves, slots, upkeep |
| **Crafting** | Recipes vs. freeform, time, resources, quality outcomes |
| **Factions & domains** | Clocks, tiers, reputation, holdings |
| **Exploration & survival** | Travel procedure, supply, light, hazards, hex or point crawl |
| **Investigation** | Clue economy — are clues automatic or rolled for? |
| **Social influence** | Reputation tracks, influence as a conflict, NPC disposition |
| **Sanity / corruption** | Track, triggers, breakdown effects, recovery |
| **Companions & hirelings** | Statting, loyalty, action economy |

The magic mini-flow is by some distance the largest, and is where a "fantasy adventure" homebrew
usually spends half its design budget. It is deliberately *not* in the core flow — plenty of
systems don't have magic, and the ones that do disagree about it more than they disagree about
anything else.

---

## Stage 11 — GM-facing structure

**11.1 Adversary construction** — derived from 3.3 and Stage 7. If asymmetric, this is where the
monster math gets defined: what stats an adversary has, how they scale with threat level.

**11.2 Encounter budgeting** — none / guideline / formal budget. A formal budget needs the Stage 7
numbers to be real, and is only meaningful for tactical-combat systems.

**11.3 Reward pacing** — how often advancement, treasure and new options arrive.

**11.4 Pressure devices** — clocks / fronts / doom pool / countdown tracks / none. These are how a
system creates urgency without the GM cheating.

**11.5 Random tables** — whether the system ships generative tables, and what they cover.

**11.6 GM rolls** — everything / only opposition / never. "Never" is a structural choice that
changes Stage 2's opposed-roll options.

**11.7 GM moves** — for fiction-first systems: the list of things the GM does when players roll
badly or look to them.

---

## Stage 12 — Compile, validate, hand off

Not a question stage. Four things happen:

**12.1 Validation.** Structural errors (a formula referencing a deleted attribute) block. Coherence
warnings (lethality dial vs. actual time-to-defeat) don't — they're reported and the user can
proceed. See [`07-validation-and-math.md`](./07-validation-and-math.md).

**12.2 Probability report.** The full curve, band distribution at each competence and difficulty
level, projected success rates at progression tiers 1 / mid / max, and expected time-to-defeat.

**12.3 Playtest simulation.** Optional. Run N simulated conflicts and report round counts, defeat
frequency and resource depletion.

**12.4 Emit.** The compiled system produces:

- The `GameSystem` document — the canonical machine-readable artefact
- An SRD outline — section headings and the rules text the flow collected
- A character sheet layout — derived from which chassis layers exist
- An adversary template
- A one-page quick reference
- A compact **rules brief** for an LLM game master

That last one is worth flagging as a design constraint rather than an afterthought. If the
downstream consumer is an AI game master, then *"can this system be explained to a model in a few
hundred tokens?"* shapes the schema — it's why outcome bands carry a semantic `valence` tag and
optional GM guidance prose rather than just a numeric threshold.

**Locking the system unlocks the story-world builder.** World content can now bind to a real
vocabulary: the world builder knows what a skill is in this system, whether factions exist,
whether clocks are a thing, and what an adversary stat block looks like.

---

## Two worked paths

**The novice, ~10 minutes.** Stage 0: name, pitch, six dials. Stage 1: accept the recommended
lineage. Stages 2–11: the guided tier shows about a dozen questions total — outcome band count,
attribute count and names, harm model, progression trigger, initiative, and whether magic exists.
Everything else defaults from the lineage. Stage 12: compile, read the curve, ship.

**The expert, hours to days.** Same Stage 0, then "start from scratch". Every stage fully
expanded. Custom outcome bands with authored conditions and per-band effects. A derived-stat
formula tree. Two custom harm tracks. A novel subsystem built from triggers, conditions and
effects, packaged as a reusable module. Iterating on the probability report between changes.

Both paths write to the same document through the same mechanism. The difference is only how many
questions are visible and how much of each answer is authored versus picked.
