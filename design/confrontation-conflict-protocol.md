# Design — Confrontation and `In Conflict` Protocol (Stage 2 Slice 8)

**Version:** 0.1.0 (draft for Codex design review and Human approval)
**Phase:** Phase 3 — Stage 2 Slice 8
**Status:** Draft — awaiting Codex design and architecture review, then Human approval (`docs/ai-workflow/operating-model.md` Design → Human Approval gate)
**Author:** Claude (design task)
**Tracks:** GitHub issue #155 (parent #119)
**Authority (treated as authoritative):** ADR-17 (Need System — Accepted); ADR-18 D1–D10 (Social Action Space — Accepted; Confrontation's own governing decisions, D4/D6/D7/D8/D9/D10); ADR-20 (Relationship Record Storage — Accepted); ADR-21 (Social Offer State Storage — Accepted) and ADR-24 (its amendment); ADR-22 (Per-Colonist Runtime Collection — Accepted); `design/social-offer-response-protocol.md` v0.2.0; `design/autonomous-three-colonist-runtime.md`; `design/comfort-assist-protocol.md` v0.4.0 (the sibling Support-category design; its `comfortParticipation.ts`-style immutable-basis pattern is reused here); `design/engineering-specification.md` v0.3.0 (seven-phase order, determinism obligations); `design/phase-2-architecture-freeze.md` (the only accessible source for "ADR-08"/"ADR-12" language ADR-18 cites — those numbers are not present as files under `ai-studio/adr/`; every claim attributed to them below is quoted from ADR-18's own restatement, not independently re-derived); `ai-studio/constitution/architecture-philosophy.md`
**This document is NOT implementation:** no code is written here. It specifies the data shape, deterministic rules, phase placement, and validation Cursor implements exactly, and the ADR this shape requires before implementation.

**Traceability rule:** every decision below cites its authorizing source. Every mechanism reused from the current implementation is cited by file and function, verified by reading, not assumed. A note on ADR-08/ADR-12: `ai-studio/adr/` contains no files numbered 01–16; those numbers appear only inside ADR-17/ADR-18's own text as citations to a pre-repository decision catalog (`design/phase-2-architecture-freeze.md`'s "locked decisions"). This design treats ADR-18's restatements of them ("conflict events must be exceptional punctuation," "active conflict behavior in proximity," the ADR-12 change-source table already implemented in `relationships.ts`) as the operative text, since no other copy is reachable from this repository.

---

## 1. Context — the gap this closes

ADR-18 names Confrontation and `In Conflict` explicitly, and defers exactly the wiring Issue #155 asks for. Reading the current implementation directly:

- `prototype/src/config/constants.ts`'s `AMBIENT_STATES` already includes `"inConflict"` as the seventh state — reserved, unreachable.
- `prototype/src/task/tasks.ts`'s closed `SocialTaskId` union already includes `"confrontation"`, and `prototype/src/task/execution.ts`'s `TASK_AMBIENT_STATE` table already maps `confrontation → "inConflict"` — both inert, mirrored from ADR-18 D1's table as unreachable vocabulary, exactly as `"comfort"`/`"assist"` were before Slice 7.
- `prototype/src/colonist/relationships.ts`'s closed `RELATIONSHIP_CHANGE_SOURCES` already includes `"directConflict"` — unused today. **This is the one piece of Slice 7's pattern that does *not* repeat here**: unlike Comfort's `mutualSupportCrisis` (which needed no ADR-20 change), Confrontation's `directConflict` source is also already present and needs no ADR-20 change either. Nothing in ADR-20's closed union requires widening.
- `prototype/src/colonist/stress.ts`'s module doc names the missing piece precisely: *"Hostile/positive-proximity sources belong to M10 (relationships), explicitly out of Stage 1."* Slice 7 built the positive half (`positiveSocialProximity`, D8's Comfort relief). The hostile half — an acute stress spike from Confrontation, scaled by Stress Response traits — is Slice 8's own new stress-system work, following the exact channel-addition pattern Slice 7 already proved (`StressChannelId` gains one member, `evaluateStress` gains one input).
- `prototype/src/colonist/traits.ts`'s only defined Stress Response trait is `resilient`, and its own comment states plainly: *"'resilient' has no direct stress-rate surface to touch."* **`"volatile"` — the second trait ADR-18 D8 names — is not a canonical trait today at all** (`TraitId = "driven" | "resilient" | "gregarious" | "wary"`). Issue #155's own risk list calls this "trait modulation hooks already authorized" — this design wires the hook (a bounded, generic multiplier, following the exact shape `decision/weights.ts`'s `weightTiltContributions` already establishes for goal-weight tilts) without inventing trait content: every currently-defined trait multiplies the new channel by exactly 1 until a future trait definition (or a revision to `resilient`'s own definition, out of this design's scope) supplies a real value.
- **Confrontation does not need the offer/response mechanism at all.** ADR-18 D3 is explicit: Confrontation is "encounter only... condition-triggered event, in the same architectural family as condition-triggered events (ADR-02)" — the *opposite* shape from Comfort/Assist's Sought, offer-backed path. This design adds **zero** members to `SocialOfferAction`/`socialOffers.ts` and requires **no** amendment to ADR-21/ADR-24.

## 2. D1 — The condition conjunction, Tier-1/fixed-snapshot inputs only

Per ADR-18 D4 (Encounter interactions): *"a pair whose relationship is Hostile or Fractured (in either direction), sharing a module, with combined stress past a threshold... may trigger a Confrontation event — probabilistically via the seeded PRNG, never deterministically."* Three conjuncts, each read from facts already computed by the tick's existing machinery — no new perception path:

**(a) Relationship — either direction Hostile or Fractured.** `perspective(relationships, i, j).state` or `perspective(relationships, j, i).state` is `"hostile"` or `"fractured"` (`deriveRelationshipState`'s existing bands: hostile `[-75, -40)`, fractured `< -75`). This is deliberately an **OR across directions**, unlike the sought-interaction gate's AND (D4 above requires *both* directions non-hostile to proceed; here, *either* direction being hostile/fractured is enough to make the pair eligible for risk) — matching ADR-18 D4's literal "in either direction" wording, which is the opposite polarity from D4.4's sought-interaction gate for exactly the reason a one-sided grudge is enough to produce friction even if the other party feels neutral.

**(b) Shared module.** Stage 2 has no colonist-position field; "location" is inferred exactly as it already implicitly is for `sharedMealPartnerId`-style co-location: two colonists share a module when both have an **in-progress** execution whose `taskDefinition(execution.taskId).moduleId` is the same non-null value (`"workstation"`, `"foodStation"`, or `"restBunk"` — Stage 2's only three moduled tasks). This requires **one new field on the shared observation basis**: `ObservableColonist` (`world/snapshot.ts`) gains `readonly moduleId: ModuleId | null` alongside its existing `id`/`ambientState`, populated in `tick.ts` from the same per-colonist execution state that already feeds `ambientStateFor` — a same-shape, same-timing addition (computed once, at the same point the shared basis is already built, per `design/autonomous-three-colonist-runtime.md` D3). This is **not** a colonist-internal read: a module id is exactly the kind of spatial-bounding fact locked #22 anticipates (`world/snapshot.ts`'s own doc: *"no crisis-stage labels... this is a standing constraint on future additions to this file"* — a location is not a stage label), and it is **not persisted state** — `ObservableColonist` is transient, discarded after the decision, per M4's own contract; adding a field to it is not a save-format trigger.

Colonists whose current task has `moduleId: null` (idle presence, or any of the four social tasks — Conversation, Shared Downtime, Comfort, and vocabulary-only Assist/Confrontation itself) are **structurally exempt** from the shared-module conjunct — they cannot be a Confrontation participant while so engaged. See §12 Finding 2.

**(c) Combined stress past a threshold.** `stressA.level + stressB.level >= <severity-keyed threshold>` (D2 below) — a literal sum, matching ADR-18 D4's "combined stress." Both `StressState.level` values are already-computed Phase-3 facts (this tick's `decayNeeds`/`evaluateStress` output), read the same way the existing tier-filter/re-decision-trigger checks already read them — no new stress computation, only a new comparison.

All three conjuncts are evaluated from facts fixed at the same point `design/autonomous-three-colonist-runtime.md` D3's shared observation basis is built (end of Phase 4, pre-Phase-5) — see D8 below for exact phase placement. No conjunct reads live cross-colonist state; all three are either the initiator-independent shared basis (module, relationship) or each colonist's own already-computed stress.

## 3. D2 — Resolution of DQ-18.3: Hostile vs. Fractured threshold differential

**Structure (fixed by this design):** two named, disjoint tuning constants —

```text
STRESS_TUNING.fracturedConflictStressThreshold  // lower bar — Fractured pairs conjoin more easily
STRESS_TUNING.hostileConflictStressThreshold    // higher bar
```

with a **structural invariant**, pinned by a unit test rather than a runtime check (both are compile-time constants, not per-instance values like `SOCIAL_OFFER_TUNING`'s `offerTimeoutTicks`/`responseDelayTicks` pair, so there is no per-call site to assert this at — a constants-module test suffices, exactly as `ADR-24`'s own structural constants are pinned by tests rather than assertions):

```text
fracturedConflictStressThreshold < hostileConflictStressThreshold
```

**Which threshold applies when the two directions disagree** (e.g. one direction Hostile, the other merely Tense — which does not independently qualify — or one direction Fractured and the other Hostile): the applicable threshold is keyed by the **more severe of the qualifying directions** — if *either* direction is Fractured, the (lower) Fractured threshold applies; otherwise (both qualifying directions are Hostile, none Fractured), the (higher) Hostile threshold applies. This directly implements ADR-18 D4's "Fractured pairs trigger at lower thresholds than Hostile ones" for every combination the OR-gate (D1a) can produce.

**A single, uniform fire-probability, not a second differentiated lever.** Once the conjunction holds (relationship-eligible, shared module, combined stress past the severity-keyed threshold), one PRNG draw (D4 below) decides whether Confrontation actually fires this tick, against one shared `conflictFireProbability` constant — **not** separately tuned per severity. ADR-18 D4 names only the *threshold* differential ("trigger at lower thresholds"); it does not ask for a second, probability-level differential, and this design does not introduce one unprompted — the threshold alone fully implements the cited text. Values are provisional (DQ-1/DQ-2, §13); the structure — two ordered thresholds, one shared probability — is fixed.

**Rate-environment fit (ADR-18 D4/D8, citing "ADR-08"):** *"conflict events must be exceptional punctuation, not daily noise... ADR-08's story-frequency floor and pressure modulation govern their rate-environment."* Because "ADR-08" is not independently readable from this repository (§ preamble), this design cannot verify a specific numeric band against it and does not invent one; it instead fixes the two-lever structure (threshold + probability) that gives prototype calibration the room ADR-18 promises "ADR-08" provides, and flags the calibration target itself as a deferred, Human-owned question (§13 DQ-1/DQ-2), exactly as `design/social-offer-response-protocol.md`'s own acceptance-probability magnitudes were deferred.

## 4. D3 — Encounter-only mechanics: no goal, no candidate, no offer/response path

**Confrontation is never generated by `decision/goals.ts`.** `generateCandidates`/`generateVoluntaryCandidates` gain **no** new candidate source, no new `relatedSocialTaskId` value, and no new `GoalSource`. No `Goal` is ever committed for Confrontation; `decision/decide.ts`'s commit/select/filter stages are entirely untouched by this design. This is the single hardest invariant Issue #155 names ("Confrontation never appears as an adoptable goal / sought social offer action") and it is satisfied structurally: there is no code path from candidate generation to Confrontation at all, by omission, not by a runtime gate that could later be loosened by mistake — the only way to make Confrontation reachable from the goal system would be to add a generator function for it, which this design does not do and explicitly forbids (§9 Invariant).

**Confrontation never touches `socialOffers.ts`.** No offer is created, no `SocialOfferAction` member is added, no `OfferResolutionReason` is consumed. ADR-21/ADR-24's entire closed-union discipline is irrelevant to this slice — there is nothing for those unions to widen.

**Confrontation is detected and resolved entirely within Phase 4** (condition & trigger detection), the same phase family that already detects `needThresholdCrossing`, `shiftBoundary`, and `higherPriorityCondition` — condition-triggered, never adopted, exactly ADR-18 D3's own words: *"the same architectural family as condition-triggered events (ADR-02)."* A dedicated, narrowly-scoped module (`prototype/src/simulation/conflictDetection.ts`, mirroring `comfortParticipation.ts`'s existing precedent as a small, pure, tick-called helper — not a new owning system) computes the tick's set of firing pairs; `tick.ts` calls it once, applies consequences, and moves on. No goal, no task, no execution is created or touched for either participant — Confrontation leaves whatever each colonist was already doing completely alone (see D6 for why this is the correct reading of "acute").

## 5. D4 — Seeded, attributed PRNG draw

One `next(prng)` draw **per conjunction-eligible pair**, in the fixed pair-iteration order (D10), attributed in the tick's event trace as `"confrontationTrigger"` (mirroring the existing `"socialOfferResponse"`-style attribution discipline). A pair whose conjunction does not hold (any of D1's three conjuncts false) consumes **zero** draws — identical in spirit to how an offer that fails D4's eligibility gate today consumes no acceptance draw. The draw is compared against the single `conflictFireProbability` (D2); below it, Confrontation fires this tick for that pair; at or above it, it does not, and the pair is simply not evaluated again until a later tick's conjunction re-holds (there is no "cooldown" state — the conjunction itself, re-evaluated fresh each tick from Phase-3-updated stress and the current shared basis, is the only gate; a pair whose stress or relationship has not moved re-evaluates identically next tick, which is intentional: nothing in ADR-18 asks for hysteresis on non-firing, and Stage 2's existing offer-based actions have no analogous "recently declined, don't ask again" state either).

## 6. D5 — Negative relationship, stress, and relational-memory consequences; non-repair confirmed

**Relationship (ADR-18 D6, verbatim: "Confrontation → Direct conflict event → Negative, high"):** `applyInteraction(relationships, { changeSource: "directConflict", aTowardBDelta: <negative>, bTowardADelta: <negative>, ... })` — both directions, one new `directConflictAffinityDelta` tuning constant (negative). **Confirmed non-repairing** (ADR-18 D6, verbatim: *"Confrontation can never directly improve a relationship... there is no 'clearing the air' bonus"*): this design's only relationship write for Confrontation is this one negative-both-directions call; no code path applies a positive delta as any part of Confrontation's own resolution. Repair remains exactly what ADR-18 already specifies — a later Comfort, Conversation, Shared Downtime, or Shared Meal moving affinity back up through their own existing, unmodified mechanisms; this design adds nothing to those paths and nothing new to repair through.

**Stress (ADR-18 D8, verbatim: "an acute instance of the hostile-proximity accumulation source — a stress spike for both participants, with Stress Response traits... scaling each side's accumulation"):** one new `StressChannelId` member, `"hostileProximityConflict"`, applied as a **one-shot spike** (not a per-tick ongoing rate like the other five channels) exactly on the tick Confrontation fires, to both participants, via a new `evaluateStress` input analogous to `isReceivingComfort` — e.g. `conflictSpike: number` (0 when not firing this tick, the tuning magnitude when it is), so the channel's `rawDelta` is `conflictSpike * traitMultiplier` rather than `magnitude * ticks` (Comfort/rest/etc. are ongoing-rate channels scaled by `ticks`; a Confrontation spike is a single discrete event, scaled by nothing but itself and the trait multiplier below — this is a real, specified difference in *shape* from the five existing channels, not an oversight).

**Trait modulation, wired not invented (§1's finding):** a new, narrowly-scoped pure function (e.g. `stressResponseConflictMultiplier(traits: readonly TraitId[]): number`, colocated in `stress.ts` beside `evaluateStress`) returns a bounded multiplier for the `hostileProximityConflict` channel only — reusing the exact clamp/bound shape `decision/weights.ts`'s `weightTiltContributions`/`FAMILY_TILT_FLOOR`/`FAMILY_TILT_CAP` already establish for goal-weight tilts, but scoped to this one stress channel, not the weight-composition pipeline. **Every currently-defined `TraitId` (`driven`, `resilient`, `gregarious`, `wary`) returns exactly `1` (no-op)** — `resilient`'s own definition today has, per its own code comment, no stress-rate surface; this design does not add one to `resilient` itself (that would reopen ADR-17 D7's need-trait-surface boundary question for a stress channel, out of this design's authority) and does not invent a `"volatile"` trait (canonical trait-list authorship is DQ-T1's own territory, explicitly out of scope for every prior Stage 2 design). The hook exists, is exercised by tests (§14), and returns 1 for everyone until a future, separately-authorized trait definition supplies a real value — satisfying Issue #155's "trait modulation hooks already authorized" without this design overstepping into trait-content authorship.

**Relational memory:** formed by ADR-16's existing significance criteria, unmodified — a Confrontation's relationship/stress movement is exactly the kind of measurable change that already triggers `considerRelationalFormation`/`considerConditionFormation` in `tick.ts`'s existing memory-formation phase (Phase 7-equivalent, after consequences). No new memory type, no new formation rule; ADR-18 D9's own text confirms this is expected: *"High-impact formations are the expected ones: Confrontations... in proportion to fading influence weight."*

**Non-effects, explicit (ADR-18 D7/D8, D1's table):** Confrontation credits **no** Social need (no restoration call for either participant — the existing `socialNeedRestorePerTick`-style function gains no `confrontation` case, matching its current `default: return 0` for every task not explicitly listed), and **no** direct Purpose credit through any path this design adds (Purpose has no serving task at Stage 2 at all, per `tasks.ts`'s existing structure — a regression pin, not new mechanism, identical to the equivalent claim in `design/comfort-assist-protocol.md` §8).

## 7. D6 — `In Conflict` ambient-state enter/exit rules

`ambientStateFor` (`execution.ts`) currently derives ambient state purely from `(execution, stress)`, checking `isStressedState` first, unconditionally overriding whatever the execution would otherwise show. Confrontation has no execution to read from at all (D3) — `In Conflict` needs its own transient signal, independent of both.

**New per-colonist persisted field:** `ColonistRuntime` (`simulation/tick.ts`, ADR-22 D1's territory) gains `readonly inConflictUntilTick: number | null`. Set to `clock.tick + IN_CONFLICT_DISPLAY_TICKS` (a new tuning constant, structurally `>= 1`, mirroring the response-delay floor's shape) for **both** participants the instant Confrontation fires; `null` otherwise. This is genuinely new persisted per-colonist state — see D9's ADR determination.

**`ambientStateFor` gains one more input and one more precedence rule**, checked **before** `isStressedState`:

```text
function ambientStateFor(execution, stress, inConflictUntilTick, currentTick): AmbientState {
  if (inConflictUntilTick !== null && currentTick < inConflictUntilTick) return "inConflict";
  if (isStressedState(stress)) return "stressed";
  ... (unchanged)
}
```

**Rationale for `inConflict` outranking `stressed`:** ADR-18 D8 calls Confrontation "acute," and the seven-state vocabulary's purpose (ADR-05) is to show the single most specifically informative current signal — a colonist mid-conflict-aftermath is more precisely described as `inConflict` than generically `stressed`, even though the stress spike (D5) may independently push them over the Stressed threshold in the same tick. This precedence is a two-line, testable rule, not a new architecture surface.

**Exit is purely time-bounded, with no interruption of the underlying execution/goal.** `In Conflict` is a display overlay only: neither participant's `Goal`, `Execution`, or goal-stack is suspended, blocked, or touched by Confrontation firing — whatever either colonist was doing (working, resting, idling — anything with `moduleId` non-null, per D1b) continues completely unaffected underneath the `inConflict` ambient display. The overlay ends the instant `currentTick >= inConflictUntilTick`; no other exit condition exists (no goal completion, no re-decision trigger — Confrontation does not fire a re-decision trigger for either participant, since nothing about their committed goal/execution has changed; see §12 Finding 3 for the case where this reads as counterintuitive).

`IN_CONFLICT_DISPLAY_TICKS` is deliberately short (a handful of ticks, DQ-3, §13) — long enough to be player-visible and inspector-traceable, short enough that it does not become a de facto second execution state competing with the real one.

## 8. D7 — Phase placement, deterministic ordering, PRNG attribution (recap against D2/D4/D5)

**No change to the seven-phase order, no change to the PRNG architecture, no change to `design/autonomous-three-colonist-runtime.md`'s phase-boundary rule.** Confrontation detection and resolution is one bounded addition inside the *existing* Phase 4 (condition & trigger detection):

- **Phase 3 (continuous state):** unchanged — needs decay, stress accumulates/dissipates (including, this tick, any `hostileProximityConflict` contribution from a Confrontation that fired in *this same* Phase 4 pass would be a same-tick-ordering violation — see D8 below for why the spike is applied in Phase 4, not folded back into Phase 3's already-completed stress evaluation).
- **The shared observation basis** (built once, end of Phase 4, per existing `design/autonomous-three-colonist-runtime.md` D3): gains the `moduleId` field (D1b) at the same construction point, no timing change.
- **Phase 4 (condition & trigger detection), new sub-step:** immediately after the existing interruption/suspension-resolution detection and before Phase 5's decisions begin, `conflictDetection.ts`'s pure function evaluates every eligible pair (D1's conjunction) in the fixed pair order (D10), draws PRNG for each eligible pair (D4), and returns the set of firing pairs plus each one's evidence (both relationship states, combined stress, shared module id). `tick.ts` then, for each firing pair: applies the relationship delta (D5), applies the stress spike directly to each participant's `StressState` (a discrete addition to `level`, clamped exactly as `evaluateStress`'s own `clamp01` already does — not routed back through a second `evaluateStress` call this same tick, since Phase 3's per-colonist stress evaluation already completed; the spike is a direct, attributed, one-shot mutation applied once here, decomposable in the same `stressEvaluated`-style event), sets `inConflictUntilTick` for both, and emits the new `confrontationOccurred` event (D9).
- **Phase 5 onward:** entirely unchanged. Neither participant's goal/execution is touched (D6); the shared basis used for Phase 5 decisions was already fixed before this sub-step ran (this sub-step reads it, never rebuilds it — no same-tick observability leak), and Phase 5's own re-decision-trigger check (already computed earlier in Phase 4, per the existing code) does not re-run for a Confrontation firing, since nothing tier-relevant changed for either participant's goal.

**Determinism:** the same canonical colonist-id ordering that already fixes every other cross-colonist iteration (`design/autonomous-three-colonist-runtime.md` D2/D4) fixes pair iteration here too (D10) — one more consumer of an already-fixed order, not a new ordering rule.

## 9. D8 — ADR determination

**An ADR is required — a new ADR amending ADR-22, not ADR-21/ADR-24 and not a new offer-storage ADR.** The trigger, precisely: `ColonistRuntime` (ADR-22 D1's exact territory) gains one new persisted field, `inConflictUntilTick`; `StressChannelId` gains one new persisted member, `"hostileProximityConflict"`, appearing inside the already-persisted `stressEvaluated` event contributions (the same site ADR-24 D3's row 4 already amended for `positiveSocialProximity` — that site "lives... in M7's `StressChannelId`; no ADR owns them exclusively," per ADR-24's own text, so recording this second addition belongs wherever the actually-changing persisted shape's owning ADR is, which for the *new field* is ADR-22). No offer, no action union, no reason code, nothing in `socialOffers.ts` changes at all — **ADR-21/ADR-24 need no amendment**, unlike Slice 7.

Save format bumps from v7 to v8 (one new `ColonistRuntime` field; the `StressChannelId` widening is a closed-list widening at an existing site, exactly ADR-24 D3's site-4 pattern, repeated once more).

**Why an amendment of ADR-22, not a new standalone ADR, following ADR-24's own reasoning verbatim:** ADR-22 D1 (the `ColonistRuntime` container shape), D2/D3 (phase realization, snapshot discipline — untouched), D4 (EQ-3's single PRNG stream — untouched, this design adds one more attributed draw inside the same stream, not a new one), and D6 (save/replay/inspector surfaces — the mechanism, not the field list, is untouched) remain entirely governing; only the *container's field list* and the *replay/save field set derived from it* change. `ai-studio/adr/README.md`'s immutable/append-only rule (cited by ADR-24 itself) means this cannot be an in-place edit; ADR-22's own D1 is not superseded, only extended by one field, so a full supersession would be the same over-reach ADR-24 rejected for ADR-21 (Option D there). **This design proposes drafting `ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md`, an amendment of ADR-22 D1/D6**, structured identically to how ADR-24 amended ADR-21 D2/D5 — same header shape (`Amends: ADR-22 (Accepted) — D1 and D6 only`), same "what this ADR does not change" section, same load-rejection-list-extension pattern (reject `inConflictUntilTick` values that are non-integer, negative, or — the one new cross-field invariant — earlier than or equal to the record's own last-known tick context at load, mirroring ADR-21 D5's `resolvedAtTick`-vs-loaded-clock check).

**No revision to ADR-17, ADR-18, ADR-20, ADR-21, or ADR-24 is required.** ADR-18 already fully authorizes Confrontation's behavioral vocabulary (D1, D3, D4, D6, D7, D8, D9); ADR-20's `directConflict` change source is already accepted and unused, needing no widening; ADR-21/ADR-24's offer mechanism is untouched because Confrontation never uses it.

The amendment is drafted alongside this design, in the same PR: `ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md`, per Issue #155's own instruction ("draft ADR if triggered"). It is `Proposed`, not `Accepted` — Codex architecture review and Human acceptance remain separate, sequenced gates, exactly as ADR-24 required after `design/comfort-assist-protocol.md`'s own approval; drafting it now only front-loads the artifact for that review, it does not pre-empt the review itself.

## 10. D9 — Save/load, replay, event-log, and inspector impact

- **Save/load:** one new `ColonistRuntime` field (`inConflictUntilTick: number | null`) and one new `StressChannelId` member. Load validation (in the drafted ADR-22 amendment) rejects a non-integer/negative `inConflictUntilTick`, and — the one new state-level invariant, mirroring ADR-24 Invariant 12's shape — a loaded value that is `<= 0`-relative-to-nothing-meaningful is not itself possible (the field has no other cross-reference to validate against, unlike Comfort's one-comforter-per-recipient rule, since `inConflictUntilTick` is single-colonist-scoped state with no pairing invariant to enforce at load time).
- **Replay:** no change to `STATE_FIELDS`'s mechanism — `colonists` is already a compared field, generically diffed; the new sub-field is covered automatically, exactly as ADR-22 D6 already anticipated for any future `ColonistRuntime` field.
- **Event log:** one new `TickEvent` variant, `{ kind: "confrontationOccurred"; colonistAId; colonistBId; sharedModuleId; combinedStress; severity: "hostile" | "fractured" }`, plus reuse of the existing `stressEvaluated` event (the new channel is one more decomposed contribution in its existing `contributions` array — no new event kind needed for the stress side, mirroring how Comfort's relief needed no new event kind either).
- **Inspector:** the existing per-colonist summary already exposes `ambientState` (now `inConflict`-capable) and stress with source breakdown (now showing the new channel); no new inspector field is required beyond what already exists generically. A reviewer may want the raw `inConflictUntilTick` value surfaced directly for debugging — flagged as an implementation-freedom choice, not a design requirement.

## 11. D10 — Deterministic multi-pair ordering

Multiple pairs can become conjunction-eligible in the same tick (e.g., three colonists sharing one module with mixed hostile relationships). Pairs are enumerated in a **fixed, canonical order**: iterate colonists in the collection's existing canonical (ordinal) id order (ADR-22 D1); for each colonist `i` in that order, consider pairs `(i, j)` for every `j` later in the same canonical order that shares `i`'s module — i.e., the same "ascending, stable, `(min, max)`-tuple" discipline ADR-20 D5 already established for relationship-pair identity, reused verbatim rather than inventing a second pair-ordering scheme. PRNG draws (D4) and consequence application (D5) both proceed in this exact order; a pair's resolution never depends on which other pairs fired earlier in the same tick's pass (each pair's conjunction inputs — relationship, stress, module — are all read from the same fixed pre-Phase-5 basis, D8, so processing order affects nothing about *whether* a pair is eligible, only the PRNG draw sequence, which is itself deterministic given the fixed order).

## 12. Findings and ambiguities requiring Human decision

1. **Whether `"volatile"` should be added to the canonical trait list now, alongside wiring the multiplier hook.** This design wires the hook (§6/D5) but adds no trait content — Issue #155's own scope note ("trait modulation hooks already authorized") reads as authorizing the hook, not trait authorship, and DQ-T1 (the canonical trait list) has consistently been treated as its own separate authority in every prior Stage 2 design. Flagged rather than assumed.
2. **The shared-module conjunct structurally exempts any colonist currently in a social task or idling** (moduleId null) from ever being a Confrontation participant, even if their relationship/stress facts would otherwise qualify. This may be an acceptable Stage 2 scale limitation (matching Comfort/Assist's own free-period/task-vocabulary limitations, `design/comfort-assist-protocol.md` Finding 2) or may be judged to need a broader "proximity" signal than task-module co-location — flagged for confirmation before implementation, since widening it would touch `WorldSnapshot`/`ObservableColonist` further.
3. **Whether an active Confrontation should fire a re-decision trigger for either participant.** This design's default (D6) is no — neither goal nor execution changes, so nothing tier-relevant is different. A reviewer may judge that a colonist who was just in a Confrontation should be more likely to re-evaluate their current commitment (e.g., abandon a shared-module task to create distance) — that would be a materially larger change (a new re-decision trigger kind) and is flagged rather than added silently.
4. **`directConflictAffinityDelta`'s asymmetry.** ADR-18 D6 does not distinguish initiator/responder for Confrontation (unlike Sought actions' initiator/responder framing, Confrontation genuinely has no initiator — it "happens between" two people, ADR-18 D3). This design defaults to a symmetric negative delta in both directions; flagged in case a reviewer wants asymmetric severity based on which direction was Hostile/Fractured.

## 13. Deferred Questions (prototype tuning, not architecture)

| # | Question | Owner |
|---|---|---|
| DQ-1 | `fracturedConflictStressThreshold` / `hostileConflictStressThreshold` magnitudes, and their ordering margin | Prototype calibration, targeting ADR-18/"ADR-08"'s exceptional-punctuation band (DQ-18.3) |
| DQ-2 | `conflictFireProbability` magnitude | Prototype calibration (DQ-18.3) |
| DQ-3 | `IN_CONFLICT_DISPLAY_TICKS` magnitude (structural floor `>= 1` is architecture; the value is pacing) | Prototype calibration |
| DQ-4 | `directConflictAffinityDelta` magnitude (both directions) | Prototype calibration (ADR-18 DQ-18.1's discipline, extended) |
| DQ-5 | `STRESS_TUNING`'s new `hostileProximityConflictSpike` magnitude | Prototype calibration, same discipline as every other `STRESS_TUNING` constant |

## 14. Test matrix

**Conjunction (D1/D2)**
- Eligible only when (either-direction hostile/fractured) AND (shared non-null module) AND (combined stress ≥ the severity-keyed threshold); each conjunct's absence alone makes the pair ineligible (three independent negative tests).
- A Fractured-involving pair becomes eligible at a strictly lower combined stress than a Hostile-only pair, all else equal.
- `fracturedConflictStressThreshold < hostileConflictStressThreshold` (constants-module structural test).
- A colonist with `moduleId: null` (idle, or any social task) is never a Confrontation participant regardless of relationship/stress.

**Encounter-only (D3)**
- Property test: no `GoalCandidate` produced by `generateCandidates` ever carries a Confrontation-related source, key, or `relatedSocialTaskId`, across every existing generator.
- No `SocialOffer` is ever created with a Confrontation-derived action; `socialOffers.ts`'s closed unions are unchanged by this slice (a compile-time/type-level check, not just a runtime one).

**PRNG (D4)**
- An eligible pair consumes exactly one attributed `confrontationTrigger` draw; an ineligible pair consumes zero.
- Determinism: two runs differing only in seed produce different fire outcomes for the same eligible pair, but identical *eligibility* (a property of already-recorded state, not of the draw).

**Consequences (D5)**
- A firing Confrontation applies `directConflictAffinityDelta` in both directions via `directConflict`, and nothing else changes relationally that tick for that pair.
- A firing Confrontation applies exactly one `hostileProximityConflict` stress contribution to each participant, scaled by `stressResponseConflictMultiplier`, decomposable in `stressEvaluated`.
- `stressResponseConflictMultiplier` returns exactly `1` for every currently-defined `TraitId`.
- Zero Social-need change, zero Purpose change, for either participant, on any Confrontation outcome.
- A Confrontation forms a Relational memory for both participants when ADR-16's existing significance criteria are met by the applied relationship/stress movement — no new formation rule.

**`In Conflict` (D6)**
- `ambientStateFor` returns `"inConflict"` for exactly `IN_CONFLICT_DISPLAY_TICKS` ticks after a firing Confrontation, for both participants, then reverts to whatever `(execution, stress)` would otherwise show.
- `inConflict` outranks `stressed` while active; reverts correctly to `stressed` if the stress spike alone keeps the colonist over threshold once the display window ends.
- Neither participant's `Goal` or `Execution` changes as a result of Confrontation firing (a regression-shaped test: state before/after is identical except `inConflictUntilTick` and the stress/relationship fields D5 names).

**Determinism, phase order, replay (D7/D8/D10)**
- Multi-pair ordering test: three colonists sharing a module with two independently eligible pairs resolve in fixed `(min, max)`-tuple order regardless of collection iteration starting point.
- A fixed-seed multi-colonist run including at least one Confrontation reproduces an identical event/decision trace on replay.
- Save/load round-trip of a state with a colonist mid-`inConflict` window preserves `inConflictUntilTick` bit-identically; load rejects a malformed value.
- The existing non-observability regression test (`design/autonomous-three-colonist-runtime.md` D3) extends cleanly: reordering colonist ids does not change which pairs are eligible or how they resolve.

**Regression (explicitly required by Issue #155's Shared Requirements)**
- Full existing Conversation, Shared Downtime, Shared Meal, Comfort, relationship, offer, and multi-colonist replay test suites remain green, unmodified in their assertions.

## 15. Required validation commands

```powershell
npm --prefix prototype test
npm exec --prefix prototype -- tsc --noEmit -p prototype/tsconfig.json
node tools/ai-workflow/validate-workflow-pack.mjs .
node --test tools/ai-workflow/validate-workflow-pack.test.mjs
node --test tools/ai-workflow/validate-workflow-record.test.mjs
git diff --check
```

## 16. Expected file areas

- `prototype/src/simulation/conflictDetection.ts` — new, small, pure module (mirrors `comfortParticipation.ts`'s precedent): conjunction evaluation, pair ordering, PRNG draw.
- `prototype/src/simulation/tick.ts` — new Phase-4 sub-step calling into it; `ColonistRuntime` gains `inConflictUntilTick`.
- `prototype/src/colonist/stress.ts` — new `hostileProximityConflict` channel, `stressResponseConflictMultiplier`.
- `prototype/src/task/execution.ts` — `ambientStateFor` gains the `inConflictUntilTick`/`currentTick` inputs and precedence rule.
- `prototype/src/world/snapshot.ts` — `ObservableColonist` gains `moduleId`.
- `prototype/src/config/tuning.ts` — new provisional constants (§13).
- `prototype/src/core/serialization.ts` — the new field/channel, per the drafted ADR-22 amendment.
- `prototype/src/replay/replay.ts`, `prototype/src/inspection/inspector.ts` — no change expected (D9); listed defensively.
- `ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md` — the amendment ADR, drafted alongside this design (Status: Proposed), a separately reviewed and separately accepted artifact.
- Corresponding colocated `*.test.ts` files for every module above.

## 17. Options Considered

| Option | Summary | Rejected because |
|---|---|---|
| Route Confrontation through the existing offer/response mechanism as a fifth `SocialOfferAction` | Reuses Slice 7's proven pattern | Directly contradicts ADR-18 D3: Confrontation is encounter-only, never sought/offered; the responder never "answers" a Confrontation the way they answer an offer — there is no response to weight |
| Model `In Conflict` as a real `Execution`/task (adopting `TASK_AMBIENT_STATE.confrontation`'s existing dead entry) | Reuses the existing execution machinery uniformly | Would make Confrontation adoptable/interruptible/resumable exactly like a goal-driven task, reopening D3's "never a script" guarantee; the existing `TASK_AMBIENT_STATE` entry is left as unreachable vocabulary, matching how `sharedMeal`'s own id is vocabulary-only under its overlay framing |
| A colonist-position/spatial field instead of module-derived co-location | More general "proximity" | Out of scope — Stage 2 has no spatial model at all (`world/snapshot.ts`'s own doc: "spatial bounding is a later, separately-owned concern"); module co-location is the only Tier-1-legal proximity fact that exists today |
| Differentiate `conflictFireProbability` by severity in addition to the threshold | More expressive calibration | ADR-18 D4 asks only for a threshold differential; adding an unrequested second lever is scope the text does not authorize |
| Give Confrontation its own re-decision trigger, interrupting whichever task either participant was doing | More "dramatic" | Not requested by ADR-18 D3/D8; goal/execution interruption is a materially larger change than a display overlay — flagged as Finding 3 instead of added |
| Fold the stress spike back through a second `evaluateStress` call this same tick | Keeps all stress math in one function call per colonist per tick | Phase 3's per-colonist stress evaluation has already completed by the time Phase 4's conflict detection runs; re-invoking it would either double-apply the ongoing channels or require threading conflict facts backward into Phase 3, which does not yet know about this tick's Phase-4-detected conflicts — a same-tick ordering violation `design/autonomous-three-colonist-runtime.md` D3 exists to prevent |

## 18. Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| Confrontation detected/resolved inside Phase 4, via a new small pure module, never through the goal/offer system | ADR-18 D3: encounter-only, condition-triggered, never adopted; Comfort/Assist's offer reuse is the wrong precedent here, not the right one | Offer/response reuse; a new goal source |
| Shared-module co-location derived from both colonists' in-progress execution's `taskDefinition.moduleId` | The only Tier-1-legal proximity fact Stage 2's data model has; reuses `tasks.ts`'s existing `TaskDefinition.moduleId`, no new spatial model | A new position field (out of scope; no spatial model exists) |
| Two ordered stress thresholds (Fractured lower, Hostile higher), one shared fire probability | Implements ADR-18 D4's threshold differential exactly, without adding an unrequested second differentiated lever | Differentiating probability by severity too (unrequested scope) |
| `In Conflict` is a time-bounded display overlay (`inConflictUntilTick`), outranking `stressed`, touching neither `Goal` nor `Execution` | Matches ADR-18 D8's "acute" framing; a two-line, testable precedence rule rather than a new interruption mechanism | Modeling Confrontation as a real interruptible task/execution (reopens D3's no-script guarantee) |
| Stress spike applied as a discrete one-shot channel (`hostileProximityConflict`), not folded into Phase 3's already-completed per-tick evaluation | Phase 3 has already run by the time Phase 4 detects the conflict; re-entering it would be a same-tick ordering violation | A second `evaluateStress` call this same tick (double-application / phase-order risk) |
| Trait-modulation hook wired (`stressResponseConflictMultiplier`, returns 1 for every current trait) without adding trait content or a `"volatile"` trait | Issue #155 authorizes the hook, not trait authorship; DQ-T1 (canonical trait list) is a separate, consistently-deferred authority across every prior Stage 2 design | Extending `resilient`'s own definition to cover this (reopens ADR-17 D7's need-trait-surface boundary for an unrelated stress channel); inventing `"volatile"` now (trait-content authorship, out of scope) |
| New ADR amending ADR-22 D1/D6 (not ADR-21/ADR-24, not a standalone new ADR) | The trigger is entirely a `ColonistRuntime` field addition — ADR-22's own territory; ADR-21/ADR-24's offer mechanism is untouched; ADR-22 D2-D5 remain fully governing, so a full supersession would over-reach exactly as ADR-24 reasoned for ADR-21 | Amending ADR-21/ADR-24 (wrong owner — no offer-store change exists); a standalone new ADR with no amendment relationship (would obscure that ADR-22's container/ordering/PRNG decisions are unchanged) |
| Pair-iteration order reuses ADR-20 D5's `(min, max)`-tuple discipline verbatim | One canonical pair-ordering scheme in the codebase, not two | A separate Confrontation-specific ordering rule (unnecessary duplication) |

---

## 19. Kanban Update

**Card:** [Phase 3] Stage 2 Slice 8 — Confrontation and Conflict (Design)
**Status:** Review — design artifact complete, ADR-25 (amending ADR-22 D1/D6) drafted alongside it as `Proposed`, both awaiting Codex design and architecture review, then Human approval. No implementation until both gates pass and ADR-25 is Accepted.
**Completed:** Produced `design/confrontation-conflict-protocol.md` — the exact three-conjunct condition (relationship OR-gate, shared-module co-location derived from existing task/moduleId data, combined-stress threshold) from Tier-1/fixed-snapshot facts only (D1); DQ-18.3 resolved as a fixed two-threshold structure (Fractured lower, Hostile higher) with one shared fire probability, provisional values deferred (D2); encounter-only mechanics confirmed structurally absent from the goal/candidate/offer system, never reusing Slice 7's offer path (D3); one attributed PRNG draw per eligible pair, zero for ineligible pairs (D4); full negative-consequence specification (relationship via the already-accepted `directConflict` source, a new one-shot stress channel with a wired-not-invented trait-multiplier hook, relational memory via existing ADR-16 criteria, explicit no-Social/no-Purpose non-effects) with non-repair confirmed against ADR-18 D6 (D5); `In Conflict`'s enter/exit rule as a time-bounded ambient-display overlay that touches neither goal nor execution, with an explicit precedence rule over `stressed` (D6); phase placement fully inside the existing Phase 4 with zero seven-phase or PRNG-architecture change (D7/D8); an explicit ADR determination — a new ADR amending ADR-22 D1/D6, not ADR-21/ADR-24 — with precise scope (D9); save/load/replay/event-log/inspector impact (D9/D10 numbering note: D9 covers persistence, D10 covers ordering); deterministic multi-pair ordering reusing ADR-20 D5's tuple discipline (D10); four findings for the Human gate; five deferred tuning questions; expected file areas; a full test matrix; and required validation commands.
**Changed Files:**
  CREATED  design/confrontation-conflict-protocol.md
  CREATED  ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md
**Validation:** Grounded directly against the current implementation — read `prototype/src/config/constants.ts`, `task/tasks.ts`, `task/execution.ts`, `colonist/relationships.ts`, `colonist/stress.ts`, `colonist/traits.ts`, `decision/weights.ts`, `world/snapshot.ts`, `simulation/tick.ts` (including the shipped Comfort/`comfortParticipation.ts` pattern and ADR-24's exact amendment shape) in full — every claim about what already exists (the `"inConflict"`/`"confrontation"` vocabulary, `directConflict`'s accepted-but-unused status, `resilient`'s absent stress-rate surface, the absence of a `"volatile"` trait, the module-only proximity data available) was confirmed present, not assumed. Cross-checked against ADR-17, ADR-18 D1-D10 in full, ADR-20 D2/D5/D7, ADR-21 D1-D6, ADR-22 D1-D6, ADR-24 in full (as the direct structural precedent for this design's own ADR-amendment recommendation), and all three prior Stage 2 design documents — no accepted decision reopened; the seven-phase order and PRNG architecture are unchanged; Confrontation credits no Social need or Purpose through any path this design adds; ADR-20/ADR-21/ADR-24's closed unions are untouched.
**Risks:** DQ-18.3's calibration (Finding-adjacent, §13 DQ-1/DQ-2) cannot be verified against "ADR-08"'s literal text since that document is not reachable from this repository — flagged rather than silently assumed correct. The shared-module proximity proxy (Finding 2) is the most likely candidate for reviewer pushback given how narrowly it scopes eligible participants at Stage 2. The trait-multiplier hook (D5) is new mechanism, not pure reuse, and deserves focused review attention, mirroring the equivalent flag in `design/comfort-assist-protocol.md`'s own Kanban Update for its stress-relief channel.
**Follow-up Tasks:** Draft `ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md` (§9) after design approval, through the architecture workflow, before any implementation begins. Resolve Findings 1-4 (§12) at the Human gate. No other follow-ups beyond what Issue #155 already tracks; Assist wiring, Stage 2 Slice 9, and Stage 3 scaling remain untouched and out of scope.

**Not committed** per instruction — this is a design artifact only; no code in `prototype/src` is created or modified by this task.
