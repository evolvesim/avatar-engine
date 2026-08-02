# 07 — Probability and validation

Two engines. One shows the user the curve their choices actually produce; the other catches the
mistakes homebrewers reliably make.

This is the part that distinguishes a system builder from a form.

---

## The probability engine

### Distribution

```ts
export interface Distribution {
  /** outcome value → probability. Sums to ≤ 1. */
  pmf: Map<number, number>
  /** Probability mass lost to exploding-dice depth truncation. */
  truncated: number
}

export function convolve(a: Distribution, b: Distribution,
                         op: (x: number, y: number) => number): Distribution
export function summarise(d: Distribution): {
  mean: number; stdev: number; min: number; max: number
  percentiles: Record<50 | 90 | 95, number>
}
```

`truncated` is not decoration. Exploding dice have unbounded support, so exact enumeration has to
stop somewhere; carrying the lost mass explicitly means the UI can say "accurate to 99.98%"
instead of quietly under-reporting the tail.

### Exact methods

Every randomiser in [`01-commonalities.md`](./01-commonalities.md) has a closed or enumerable
form. Monte Carlo is a fallback, not the default.

| Construct | Method |
|---|---|
| `NdS` sum | Iterated convolution, memoised per (N, S) |
| Keep highest / lowest N of M | Order-statistic DP over CDFs — O(M·S), exact |
| Count successes | Binomial DP; per-die success probability, so heterogeneous pools work |
| Pool take-highest | `1 − CDF(k)^N`; critical mass from P(≥2 at max face) |
| Exploding | Recursive expansion to `maxDepth`; residual reported in `truncated` |
| Fudge (4dF) | Convolution over {−1, 0, +1} |
| Opposed | Difference distribution: `convolve(a, b, (x, y) => x − y)` |
| Roll-under with fractional bands | Direct CDF partition |
| Paired asymmetric | Joint distribution over the die pair; sum for outcome, comparison for tone |
| Symbol dice | Per-face vector convolution over a multi-axis pmf |

**Guardrail:** `EXACT_STATE_CAP` of about 2 million pmf entries. Beyond it — huge heterogeneous
pools, stacked explosions — `analyseResolution` switches to a seeded Monte Carlo sampler and
reports `method: 'monte-carlo'` with a 95% confidence interval, so the UI can label the result
approximate.

Monte Carlo is also the **only** path once custom rules with `before-roll` effects are active,
since those aren't closed-form.

**Determinism:** the sampler uses a seeded xorshift PRNG, never `Math.random()`. Two runs of the
same analysis produce identical output, which is what makes the numbers testable.

### The analysis entry point

```ts
export function analyseResolution(sys: GameSystem, ctx: {
  competence: 'novice' | 'typical' | 'expert'   // sampled from each attribute's range.typical
  difficulty: 'easy' | 'standard' | 'hard'
  trials?: number
}): {
  method: 'exact' | 'monte-carlo'
  bands: Array<{ bandId: string; label: string; p: number }>
  curve: Array<{ value: number; p: number; cumulative: number }>
  stats: {
    mean: number
    stdev: number
    /** stdev / range — the "how random does this feel" number */
    swinginess: number
  }
  truncated: number
  ci?: { lower: number; upper: number }        // monte-carlo only
  warnings: Diagnostic[]
}
```

### Reference values

Hand-checkable anchors. If an implementation can't reproduce these, it's wrong.

| Configuration | Expected |
|---|---|
| d20 + 7 vs. target 15 | 65% |
| d20 + 0 vs. 15, straight | 30% |
| d20 + 0 vs. 15, advantage | 51% |
| 2d6 + 1, bands at 6−/7–9/10+ | 27.8% / 44.4% / 27.8% |
| 2d6 + 2, same bands | 16.7% / 41.7% / 41.7% |
| 2d6 take-highest, bands 1–3 / 4–5 / 6 / two 6s | 25% / 44.4% / 27.8% / 2.8% |
| Same, roll 2 take-lowest | 75% / 22.2% / 2.8% |
| 5d10, success on 8+, ≥1 success | 83.2% |
| 3d10, success on 8+, ≥1 success | 65.7% |
| 5d6 counting 6s, ≥1 success | 59.8% |
| 3d6 roll-under 10 | 50% |
| 3d6 roll-under 12 | 74.1% |
| d100 roll-under 60, with half and fifth bands | 60% / 30% / 12% |
| 4d6 drop lowest, mean | 12.24 |
| 4dF, P(≥ 0) | 61.7% |
| Exploding d8 or wild d6, best of two, target 4 | 81.25% |
| Paired 2d12, P(tie) | 8.3% |

Two of these are worth internalising because they explain why families feel different:

- **d20 + 0 vs. 15 is 30%; 3d6 roll-under 10 is 50% and roll-under 12 is 74%.** A two-point skill
  difference moves a 3d6 system by 24 percentage points and a d20 system by 10. Flat dice make
  luck dominate; bells make competence dominate.
- **A 3-dice pool is 65.7% and a 5-dice pool is 83.2%.** The first three dice buy most of the
  reliability. Pool systems have a natural ceiling that number-adding systems don't.

---

## Coherence validators

A `Record<CheckId, Validator>` manifest, each returning `Diagnostic[]`. Same const-table idiom as
the rest of the spec.

```ts
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  code: CheckId
  message: string
  path?: DocPath
  fix?: { label: string; mods: Modification[] }   // one-click remediation where obvious
}
```

**Errors block compiling. Warnings don't.** People build deliberately weird games; the tool says
so and gets out of the way. Only structural impossibility — a formula referencing an attribute
that no longer exists — actually prevents emitting a document.

### Structural (errors)

| Check | Catches |
|---|---|
| `formula-references-resolve` | Every `ref` in every `Expr` resolves against the declared chassis. **The single most common authoring error** — delete an attribute, and three derived formulas silently break. |
| `bands-cover-range` | The band conditions, evaluated across the full support of the roll, leave no gap. A result that matches no band is unresolvable. |
| `bands-do-not-overlap` | No result matches two bands. |
| `module-requirements` | Installed subsystems' `requires` are met and `conflicts` are absent. |
| `identity-uniqueness` | No duplicate ids within any collection. |
| `expr-bounds` | No expression tree exceeds the node or depth caps. |

### Coherence (warnings)

Each is tied to the Stage 0 fingerprint, so the message can name the contradiction rather than
just the symptom.

| Check | Fires when |
|---|---|
| `success-rate-in-window` | P(success) at typical competence and standard difficulty falls outside 25–85%, or diverges from the declared `anchorSuccessRate` by more than 15 points. |
| `swinginess-vs-dial` | Measured `stdev / range` contradicts the swinginess dial. *"Your dial says competence should dominate, but a d20 gives luck a wider spread than skill."* |
| `crunch-vs-complexity` | Crunch dial low but many trait layers and subsystems enabled. Counts actual decisions on a character sheet. |
| `lethality-vs-time-to-defeat` | Expected rounds-to-defeat, computed from harm track, mean damage and mitigation, contradicts the lethality dial in either direction. |
| `lethality-without-consequences` | Lethality high but `defeat` is `narrative-cost` and no permanent-injury or death rule exists. |
| `authority-without-currency` | Player-authority dial high but there's no player-held meta-currency, players don't roll, and no `declare-detail` intervention exists. The dial is aspirational, not mechanical. |
| `bounded-accuracy-drift` | Projected success rate at progression tiers 1 / mid / max drifts more than 40 points. **The treadmill check** — reads `progression.curve`, `horizontalRatio` and `difficulty.scalesWithProgression` together. |
| `band-consumed` | An outcome band is defined but nothing anywhere reads its valence — no rule, no effect, no subsystem. A partial-success band that nothing consumes is binary with extra steps. |
| `pool-size-table-time` | Projected *maximum* pool size at the power ceiling exceeds ~12 dice. Checks the endgame, not the starting value. |
| `economy-solvency` | Expected meta-currency income per session versus expected spend across `resolution.interventions`. A currency nobody can afford to use, or one that accumulates unspent, is dead weight. |
| `creation-budget-feasible` | The point-buy budget can actually afford a legal character meeting all minimums. |
| `creation-time-realistic` | `tableTimeBudgetMin` versus the number of decisions the procedure requires. |
| `spatial-coherence` | Grid tactics enabled with no range or movement model; or zone-based movement with per-square abilities. |
| `harm-scaling-mismatch` | Harm track scales with progression but damage expression doesn't, or vice versa. |
| `progression-trigger-vs-pitch` | Advancement rewards defeating opposition while the pitch and tone tags describe a game about something else. Informational, but it catches copied-without-thinking progression more often than you'd expect. |

### Reporting

```ts
export function analyseSystem(sys: GameSystem): {
  diagnostics: Diagnostic[]                 // sorted: errors, then warnings, then info
  resolution: ResolutionReport              // curves at each competence × difficulty
  progression: ProgressionReport            // success rate projected across tiers
  combat: CombatReport                      // expected rounds to defeat, resource depletion
  fingerprintDelta: Record<DialId, number>  // declared dial vs. measured behaviour
}
```

`fingerprintDelta` is the summary the Stage 12 review screen leads with: six numbers showing where
the system the user built diverges from the system they said they wanted. It's more useful than a
diagnostics list, because it's a single glance and it's about *their* stated intent rather than
someone else's rules.

---

## Playtest simulation

Optional, and it answers questions the closed-form analysis can't.

Run N simulated conflicts against a generated adversary at the declared difficulty and report:

- Round-count distribution
- Defeat frequency for both sides
- Resource depletion curves — do characters actually run out of the things they're meant to
  manage?
- Meta-currency flow — earned versus spent per session
- How often each outcome band actually comes up in play, as opposed to in isolation

The last one matters more than it sounds. A critical band with a 2.8% chance appears roughly once
per 36 rolls, which at a normal table is once or twice a session — worth writing rules for. A band
at 0.1% is decoration. Homebrewers routinely write elaborate rules for outcomes that will never
occur at a real table, and the simulator is the only thing that shows this.

---

## Test strategy

Vitest, `environment: 'node'`, matching the existing setup in `vitest.config.ts`. Everything here
is pure functions, which is the point of the architecture.

| Test | What it pins |
|---|---|
| `dice-exact.test.ts` | Every reference value in the table above, hand-computed |
| `dice-exact-vs-mc.test.ts` | Every exact method within 3σ of 200k seeded samples |
| `dice-explode.test.ts` | `pmf` sum + `truncated` = 1 within 1e-12 |
| `expr-evaluator.test.ts` | Arithmetic, reference resolution, prototype-path rejection, depth caps |
| `expr-distribution.test.ts` | The distribution evaluator agrees with the numeric evaluator under a seeded RNG |
| `paths.test.ts` | Keyed segment addressing, create-on-write, missing-id behaviour |
| `compose.test.ts` | Layer ordering is deterministic — same mods, different insertion order, same document |
| `provenance.test.ts` | Last-writer attribution; the clobber warning fires |
| `validators.test.ts` | Each check fires on a crafted bad document and stays silent on a good one |
| `preset-goldens.test.ts` | Every preset parses clean and yields zero error diagnostics |
| `step-graph-integrity.test.ts` | Every `writes` path exists; every `visibleWhen` parses; every step reachable |
| `fuzz-never-throws.test.ts` | Random modification streams and malformed documents return diagnostics, never throw |

`preset-goldens` and `step-graph-integrity` are load-bearing. They turn the two big hand-authored
const tables into machine-checked artefacts, the same guarantee
`tests/unit/lighting-rigs.test.ts` gives the avatar side today by pinning manifest values so one
product's tuning can't silently drag another's.

**CI note:** the workflow at `.github/workflows/publish.yml` currently runs `npm run typecheck`
only, not `npm test`. Typecheck proves nothing about whether 4d6-drop-lowest has the right mean.
Adding `npm test` to CI is part of implementing this spec, not a follow-up.
