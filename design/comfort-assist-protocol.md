# Design — Comfort and Assist Protocol (Stage 2 Slice 7)

**Version:** 0.1.0 (draft for Codex design review and Human approval)
**Phase:** Phase 3 — Stage 2 Slice 7
**Status:** Draft — awaiting Codex design review and Human approval (`docs/ai-workflow/operating-model.md` Design → Human Approval gate; `ai-studio/workflows/kanban-update-protocol.md`'s review pipeline)
**Author:** Claude (design task)
**Tracks:** GitHub issue #151 (parent #119)
**Authority (treated as authoritative):** ADR-17 (Need System — Accepted); ADR-18 D1–D10 (Social Action Space — Accepted; Comfort/Assist's own governing decisions); ADR-20 (Relationship Record Storage — Accepted); ADR-21 (Social Offer State Storage — Accepted); ADR-22 (Per-Colonist Runtime Collection — Accepted); `design/social-offer-response-protocol.md` v0.2.0 (the offer/response mechanism this design reuses); `design/autonomous-three-colonist-runtime.md` (the multi-colonist phase realization this design plugs into, including its still-deferred DQ-2); `design/engineering-specification.md` v0.3.0 (seven-phase order, determinism obligations); `ai-studio/constitution/architecture-philosophy.md`
**This document is NOT implementation:** no code is written here. It specifies the data shape, deterministic rules, phase placement, and validation Cursor implements exactly, and the ADR revision this shape requires before implementation.

**Traceability rule:** every decision below cites its authorizing source. Every mechanism reused from the current implementation is cited by file and function, verified by reading, not assumed.

---

## 1. Context — the gap this closes

ADR-18 D1 names Comfort and Assist as two of the six canonical social actions — both Sought, both category **Support** — and reserves their wiring for a future slice: "Comfort, Assist, Confrontation, `In Conflict` state — the offer/response protocol here is reachable only from `conversation`/`sharedDowntime`'s existing `relatedSocialTaskId` union; extending it to another `SocialTaskId` is explicitly a future slice's decision" (`design/social-offer-response-protocol.md` §12). Slice 6c closed out the three-colonist offer-hardening work for Conversation and Shared Downtime only. Issue #151 is that future slice for exactly Comfort and Assist — Confrontation and `In Conflict` remain out of scope.

Reading the current implementation directly:

- `prototype/src/task/tasks.ts` already lists `"comfort"` and `"assist"` in the closed `SocialTaskId` union and in the `TASKS` table (`taskClass: "social"`, `moduleId: null`), with a comment marking them "vocabulary-only until their own wiring." `candidateTaskIdsFor`'s `voluntary` case does not yet route to them.
- `prototype/src/decision/goals.ts`'s `generateVoluntaryCandidates` generates social candidates only for `"conversation"` and `"sharedDowntime"`, from `snapshot.nearbyColonists`, gated to `currentPeriod === "free"`.
- `prototype/src/task/socialOffers.ts` (ADR-21) has a **closed** `SocialOfferAction = "conversation" | "sharedDowntime"` union and a closed seven-member `OfferResolutionReason` union — both explicitly documented as requiring an ADR-21 revision to extend.
- `prototype/src/task/execution.ts`'s `TASK_AMBIENT_STATE` table already maps `comfort → "socializing"` and `assist → "working"`, mirrored verbatim from ADR-18 D1's ambient-expression column, as inert unreachable data.
- `prototype/src/colonist/relationships.ts`'s `RELATIONSHIP_CHANGE_SOURCES` already includes `"mutualSupportCrisis"` — ADR-18 D6's Comfort row — unused today.
- `prototype/src/colonist/stress.ts` realizes only two of decision-loop §7's four reliefs (rest adequacy, needs-satisfied); a "positive social proximity" relief — the mechanism ADR-18 D8 assigns an accepted Comfort to — does not exist yet.
- `prototype/src/simulation/tick.ts`'s Phase 6 offer-acceptance path begins execution for the **initiator only**; the responder receives no goal/execution of their own (`design/autonomous-three-colonist-runtime.md` D5, DQ-2 — explicitly still deferred, not resolved by this design).

Every piece of scaffolding ADR-18 anticipated is present and unused. This design specifies exactly how to reach it — reusing the existing offer/response mechanism (ADR-21) rather than inventing a second one, and extending exactly the closed unions ADR-18/ADR-21 already flagged as the extension points.

---

## 2. D1 — Comfort candidate generation (Tier-1 `Stressed` state)

Comfort is generated exactly like Conversation/Shared Downtime — a tier-5 voluntary candidate from `generateVoluntaryCandidates` (`goals.ts`), gated to `snapshot.currentPeriod === "free"` (ADR-18 D4.1: "free period for tier 5" is the opportunity condition for every tier-5 sought action; this is not a new rule, it is the existing gate applied to a third action).

For each `other` in `snapshot.nearbyColonists` whose `other.ambientState === "stressed"`:

```text
{
  source: "voluntary",
  tier: GOAL_SOURCE_TIER.voluntary,
  key: `voluntary:social:comfort:${other.id}`,
  baseUrgency: WEIGHT_TUNING.voluntaryBaseWeight,   // same uniform base as every voluntary candidate
  relatedColonistId: other.id,
  relatedSocialTaskId: "comfort",
}
```

`ambientState === "stressed"` is exactly `isStressedState` (`stress.ts`) as published through `ambientStateFor` (`execution.ts`) into the tick's single shared observation basis (`design/autonomous-three-colonist-runtime.md` D3) — the same Tier-1 registry every other candidate and the inspector already read. No new perception path, no colonist-internal read: `ambientStateFor` checks `isStressedState(stress)` **before** consulting execution state at all, so a Stressed colonist is reported as `"stressed"` regardless of what task they were nominally executing — this is existing behavior, not something this design changes.

**`baseUrgency` is uniform, not distress-scaled.** The candidate's base weight does not encode how stressed the target is (Tier-1 exposes only the boolean crossing, not a magnitude — locked #21's spirit: no internals). "Distress must not force acceptance" (Issue #151 Scope-In) is satisfied structurally: generation never privileges a Comfort candidate over any other tier-5 candidate, and the accept/decline weighting (D5 below) is entirely the **responder's**, not a function of how the candidate was generated.

## 3. D2 — Assist candidate generation (`Working`/`Blocked` + skill × permission × requirement)

Same tier-5 voluntary path, same free-period gate (ADR-18 D4.1), for each `other` with `other.ambientState === "working"` **or** `other.ambientState === "blocked"`:

```text
{
  source: "voluntary",
  tier: GOAL_SOURCE_TIER.voluntary,
  key: `voluntary:social:assist:${other.id}`,
  baseUrgency: WEIGHT_TUNING.voluntaryBaseWeight,
  relatedColonistId: other.id,
  relatedSocialTaskId: "assist",
}
```

**Eligibility (ADR-18 D4.3: "skill ∩ permission ∩ requirement applies to the assisted task — Assist never bypasses the frozen eligibility model") is checked against the assisted colonist's underlying work task, not against a separate `assist` requirement.** Stage 2's task vocabulary has exactly one task that produces `"working"`/`"blocked"` ambient state: `workAtWorkstation` (`TASK_AMBIENT_STATE`). Which specific task the target is doing is therefore a closed structural fact at this scale, not something read from the target's internals — observing `"working"`/`"blocked"` *is* observing "doing `workAtWorkstation`," with no additional perception surface required (locked #21 is honored: the fact used is Tier-1-observable, and its mapping to a task identity is closed vocabulary, not a read of colonist state).

Eligibility and availability reuse the exact existing functions, called against `taskDefinition("workAtWorkstation")`:

```text
checkEligibility(taskDefinition("workAtWorkstation"), initiator.identity.skills, snapshot)
checkAvailability(taskDefinition("workAtWorkstation"), snapshot)
```

Both are pure, already-shared by `resolveTask` and `candidateActionability` (`tasks.ts`) — this design adds no new eligibility logic, only a new caller. `checkEligibility`'s `requiredSkill` check and `checkAvailability`'s module-functional/food-stock checks are Stage 2's entire "requirement" surface today; `workAtWorkstation` currently declares no `requiredSkill`, so the check is presently a no-op beyond `isPermitted` (itself a stub returning `true` — `world/policy.ts`) — this design does not change that; it wires Assist through the same gate so a future tightening of either function automatically governs Assist too, with no Assist-specific code to keep in sync.

An initiator who fails this eligibility/availability check produces **no** Assist candidate for that target at generation time (mirroring `generateVoluntaryCandidates`'s existing all-or-nothing per-candidate shape — an ineligible candidate is simply absent, not generated-then-rejected). This is stricter than Conversation/Shared Downtime, which generate unconditionally and let the offer-eligibility pass (Phase 6) reject; Assist's eligibility is closed-form and snapshot-computable at generation time, so filtering earlier avoids ever spending a response-delay tick on an offer that structurally could never succeed. (Availability can still change between generation and the Phase-6 eligibility re-check — D6 below re-verifies it there, exactly as it would for any other candidate whose world state moves between ticks.)

## 4. D3 — Voluntary-assistance boundary

**Assist is reachable only from `source === "voluntary"`.** `candidateTaskIdsFor`'s `shiftAssignment` case (`tasks.ts`) continues to return exactly `["workAtWorkstation"]`, unchanged — no code path from tier-3 assignment generation, task resolution, or execution ever produces an `assist` task. Stage 2 has no collaborative-assignment or co-worker-pairing mechanism at all today (`workAtWorkstation` is solo per colonist, unconditionally), so this boundary is presently satisfied vacuously by construction: there is no existing code that could be mistaken for policy-assigned collaboration. This design adds no such mechanism, and this boundary is the reason it must not: if a future slice ever adds assignment-time collaboration, that slice inherits this invariant as a hard constraint (tier-3-sourced work is never Assist, never credits Social through D7 below, and is not gated by this design's relationship/eligibility checks — it is a different tier, a different source, and this design's candidate generator never runs for it).

**Required invariant (testable today):** no `GoalCandidate` with `source !== "voluntary"` ever carries `relatedSocialTaskId === "assist"`. **Required invariant (testable today):** `candidateTaskIdsFor("shiftAssignment", ...)` returns exactly `["workAtWorkstation"]` for every input.

## 5. D4 — Relationship compatibility gate

Both actions reuse the **existing two-sided non-hostile check** already implemented in `tick.ts`'s Phase 6 eligibility step for Conversation/Shared Downtime (`isNonHostile` checked on both `perspective(relationships, initiatorId, responderId).state` and `perspective(relationships, responderId, initiatorId).state`). This is the codebase's actual convention — stricter than ADR-18 D4.4's literal "initiator's own relationship record," matching the same "Codex-confirmed defect" fix already applied to `sharedMealPartnerId`: relationship drift is directional, so a one-sided check can pass on the initiator's stale, more-favorable view. Comfort and Assist inherit this convention for consistency; introducing a one-sided gate for only these two actions would make the codebase's relationship-gate rule inconsistent across the four offer-backed actions for no specified reason.

A Hostile-or-Fractured pair, in either direction, declines immediately with `relationshipGate`, before any acceptance draw (or, for Assist under Option B in D5, before auto-acceptance) — identical to Conversation/Shared Downtime's existing step 5.

**Comfort's one specified asymmetry (ADR-18 D5) is in acceptance weighting, not in the gate.** "The distressed partner's acceptance gate is widened by their own state... but a Comfort offer from a colonist the distressed party holds at Hostile/Fractured is declined by the same weighting as anything else" — the hard relationship gate is unchanged; what widens is the **acceptance-probability table** (D5 below), which may set Comfort's acceptance probability higher than Conversation's at the same relationship band, expressing "a Stressed colonist is more receptive to being comforted than to ordinary conversation" entirely through tuning, with the hostile/fractured hard gate identical and unaffected.

## 6. D5 — Acceptance/decline semantics; resolution of ADR-18 DQ-18.7

Comfort's acceptance draw is **mechanically identical** to Conversation/Shared Downtime's existing step 6 (`tick.ts`): one attributed `next(prng)` draw, compared against a per-relationship-state probability table, modulated by the **responder's** directional perspective toward the initiator (`perspective(relationships, responderId, initiatorId).state`) — the same responder-side-only modulation already used for the other two actions. Comfort gets its **own** `SOCIAL_OFFER_TUNING`-style table (`comfortAcceptanceProbability`), not a reuse of Conversation's, so the "widened" acceptance (D4 above) is expressible without disturbing Conversation/Shared Downtime's existing calibration.

**DQ-18.7 (ADR-18): does Assist require the assisted colonist's acceptance, or only non-rejection?**

This design resolves it as follows, and flags the resolution for explicit Human confirmation as Issue #151 requires (§9 below records this as a Finding).

**Resolution — non-rejection (no acceptance draw).** Assist's offer resolution runs the identical steps 1–5 every offer already runs (expiry, cancellation, hold, response-delay, eligibility — including this design's D4 relationship gate and D3's requirement-reuse), then resolves directly to `"accepted"` with `reason: null` — **skipping step 6 entirely.** No PRNG draw is attributed to Assist's acceptance. Concretely, in `resolveOffer` terms this is simply: a well-formed `("accepted", null)` transition reached without ever calling `next(prng)` for this offer.

Rationale for this resolution over the alternative (a weighted acceptance draw identical to Comfort/Conversation):

- **Assist's voluntariness is entirely the initiator's** (ADR-18 D3: "Assist exists only as a tier-4/5 *choice* — the initiator was not assigned to this work and elected to take it on... The voluntariness is the social content"). The offer/response protocol's purpose for Conversation/Comfort is to let the *responder* refuse an unwanted interaction; Assist's target is not being asked to change their own behavior — they simply continue their observed work while help arrives. There is no responder-side commitment to weigh acceptance of (`design/autonomous-three-colonist-runtime.md` DQ-2 remains deferred and unresolved by this design — see D9).
- It keeps the protocol's eligibility/gate machinery (steps 1–5) **fully shared** across all four offer-backed actions — no divergence there — while adding **zero** new architecture for the one action that plausibly does not need a weighted response: no new acceptance-probability table, no new PRNG attribution site, no new `OfferResolutionReason` member (an "accepted" resolution already carries `reason: null` under ADR-21 D2's existing matrix — this needs no revision to that matrix).
- It is the minimal reading of "non-rejection": rejection is still possible (ineligibility, hostility, initiator/responder unavailability, timeout all still apply and still decline/cancel/expire exactly as today), but *given* those gates clear, nothing further stands between the initiator's choice and its effect.

**The alternative** (explicit acceptance via a weighted draw, mirroring Comfort) was considered and is recorded in §11 as the rejected option, together with why: it would make "weighted, not rule-bound" (ADR-18 D5) apply uniformly across all sought interactions at the cost of inventing a responder-side "receptiveness to being helped" signal Stage 2 has no data to compute honestly (unlike Comfort's Stressed-state-driven distinction, an Assist target's "receptiveness" has no Tier-1-observable basis distinct from what D4's relationship gate already captures) — a probability table with no principled basis to differ from a flat constant is worse than no draw at all.

**Both are within D5's weighting architecture per ADR-18 DQ-18.7's own framing** ("both are within D5's weighting architecture; the difference is feel") — this design picks non-rejection as the smaller, better-grounded extension, and asks the Human gate to confirm or override it explicitly (§9).

## 7. D6 — Reuse of the social-offer lifecycle (ADR-21 revision required)

Comfort and Assist reuse `design/social-offer-response-protocol.md` v0.2.0's entire mechanism (D1–D9 of that document) and `socialOffers.ts`'s storage (ADR-21) **unmodified in shape**, extended only at the two places ADR-18/ADR-21 already named as extension points:

- `SocialOfferAction` widens from `"conversation" | "sharedDowntime"` to `"conversation" | "sharedDowntime" | "comfort" | "assist"`.
- The target-ambient-state eligibility check generalizes from the single `isInterruptibleAmbientState` predicate to an **action-keyed** table (new, but additive — Conversation/Shared Downtime's existing behavior is unchanged):

```text
function isEligibleTargetState(action: SocialOfferAction, ambientState: AmbientState): boolean {
  switch (action) {
    case "conversation":
    case "sharedDowntime":
      return isInterruptibleAmbientState(ambientState);   // unchanged — INTERRUPTIBLE_AMBIENT_STATES
    case "comfort":
      return ambientState === "stressed";
    case "assist":
      return ambientState === "working" || ambientState === "blocked";
  }
}
```

Neither `"stressed"` nor `"working"`/`"blocked"` is in `INTERRUPTIBLE_AMBIENT_STATES` — reusing that predicate unmodified for Comfort/Assist would make them permanently ineligible (they would decline every offer with `responderNotInterruptible`), which is the opposite of ADR-18 D4.3's intent (Comfort's whole premise is targeting exactly the Stressed state). The `responderNotInterruptible` reason code (already in ADR-21's closed `OfferResolutionReason` union) is reused unchanged — its meaning generalizes to "the responder's Tier-1 state does not admit this specific action" without needing a new reason code, since the union's members are already action-agnostic outcome codes, not per-action codes.

**No other lifecycle step changes.** Expiry, the two cancellation conditions (initiator unavailable / responder unavailable incl. double-booking), the suspension hold, the one-tick response-delay floor, ascending-`id` processing order, and bounded resolved-offer retention all apply to Comfort/Assist exactly as specified for Conversation/Shared Downtime, with zero new code beyond widening the closed `action` union those functions already switch on.

**This requires a revision of ADR-21**, per that ADR's own explicit closure discipline: "Adding a status is a revision of this ADR, not a tuning or implementation choice" (D2) applies identically to the `action` union (D2's opening line: "`action: 'conversation' | 'sharedDowntime'` ... the closed two-member union"), and D5's load-rejection list enumerates `action outside the closed two-member union` as a rejected shape — extending it to four members is a Data-model/Serialization-surface change to an already-Accepted ADR, which is itself an architecture-review trigger (`ai-studio/workflows/kanban-update-protocol.md`'s table: Data model, Serialization). See §10.

## 8. D7 — Need, stress, relationship, and relational-memory consequences

All of the below apply **only** to an offer that resolves to `"accepted"`, applied while the resulting execution is `"inProgress"`, in `tick.ts`'s existing per-tick execution-progress loop (Phase 6, second half) — the same loop, the same `relatedColonistId`-keyed pattern already used for Conversation/Shared Downtime's Social-need/affinity credit and for Shared Meal's partner writes. **Declined, cancelled, and expired attempts apply none of D7's positive effects** — this is the existing, unmodified rule (`declineWithFriction` for eligibility-failure/draw-decline; no interaction call at all for cancellation/expiry) inherited verbatim; Comfort/Assist add no new decline/cancel/expire consequence beyond what every other offer-backed action already does (see D6 — decline continues to route through `forcedProximityMutualStress`, cancellation/expiry continue to apply nothing).

### Comfort (accepted)

| Effect | Mechanism | Direction | Source citation |
|---|---|---|---|
| Relationship | New `comfortAffinityDeltaPerTick` constant, applied via `applyInteraction` with `changeSource: "mutualSupportCrisis"` | Both directions, positive (existing `RELATIONSHIP_CHANGE_SOURCES` already lists `mutualSupportCrisis`, unused until now) | ADR-18 D6: "Comfort (accepted) → Mutual support... Positive, medium — high when the distress is crisis-linked" |
| Social need | New `comfortSocialRestorePerTick` constant, applied to **both** initiator and responder while execution is in progress | Both | ADR-18 D7: "Participation credits... interaction with Bonded/Positive partners credits more" — applies to Support-category participation generically |
| Stress relief (responder only) | **New** stress-relief input to `evaluateStress` (see below) | Responder only | ADR-18 D8: "an accepted Comfort is that relief in deliberate, directed form" |
| Purpose | None, ever | — | ADR-17 D6 / ADR-18 D7 distinctness constraint |

**Stress relief requires one new, narrowly-scoped input to `stress.ts`'s `evaluateStress`.** Decision-loop §7 names four reliefs; Stage 1/2 realized two (rest adequacy, needs-satisfied — `stress.ts` module doc). "Positive social proximity" is the third, and an accepted Comfort is its first concrete trigger. This design adds exactly one boolean parameter, e.g. `isReceivingComfort: boolean`, read in `tick.ts`'s per-colonist continuous-state loop (Phase 3) by checking whether that colonist is the **responder** of a currently-accepted, in-progress Comfort execution (found via `runtimes` lookup against the initiator's `execution.taskId === "comfort"` and `currentGoal.relatedColonistId === thisColonistId`) — the same shape of live-shared-state read Phase 6 already performs for Shared Meal partners, just relocated to the phase that owns stress evaluation. **This does not touch Conversation or Shared Downtime's stress behavior** — the new relief channel is Comfort-specific by construction (its trigger condition is "currently the responder of an accepted Comfort," not "currently in any companionship execution"), so no existing test's stress trajectory changes. Magnitude is a new provisional `STRESS_TUNING` constant (deferred, DQ-3 below).

**Because the responder receives a direct need/stress write without a goal or execution of their own** (mirroring Shared Meal's existing partner-write pattern, not the "responder-side goal commitment" DQ-2 explicitly leaves deferred), this design does **not** resolve DQ-2 — the responder still runs their own independent decision loop, unaware at the goal-stack level that they are being comforted; only their `NeedsState`/`StressState` moves, exactly as Shared Meal's partner's Social need already moves without the partner adopting an "eat" goal.

### Assist (accepted)

| Effect | Mechanism | Direction | Source citation |
|---|---|---|---|
| Relationship | New `assistAffinityDeltaPerTick` constant, applied via `applyInteraction` with `changeSource: "sharedTaskCompletion"` | Both directions, positive-low-to-medium | ADR-18 D6: "Assist (accepted) → Shared task completion + cover behavior → Positive, low–medium" |
| Social need (initiator only) | New `assistSocialRestorePerTick` constant | Initiator only | ADR-18 D7: Assist "serves... the initiator's Social/relationship surfaces" — the assisted colonist's own Social need is not named as credited by Assist itself |
| Stress | None | — | Not named in ADR-18 D8 for Assist; the assisted colonist's work continues, no new relief channel is specified or added |
| Purpose (initiator) | None through this action | — | ADR-18 D7, verbatim: "the initiator's Purpose is credited only if the assisted task itself is skill-matched completed work for them, through ADR-17 D9's ordinary inputs, not through a social bonus" — i.e. Assist adds no Purpose path; if the initiator's own work happens to satisfy D9's existing inputs that is D9's mechanism, untouched by this design |
| Purpose (assisted colonist) | None, ever | — | Same distinctness constraint |

`sharedTaskCompletion` is reused (already in `RELATIONSHIP_CHANGE_SOURCES`, already used for Shared Meal's partner credit) rather than introducing a new change source — ADR-18 D6 explicitly maps Assist to "Shared task completion + cover behavior," and no new source is authorized by that ADR.

### Non-effects (declined, cancelled, expired) — for both actions

- **No** Social-need restoration, for either party.
- **No** positive relationship delta. Declines apply the existing `forcedProximityMutualStress` friction (`declineAffinityDelta`, both directions) exactly as Conversation/Shared Downtime's declines already do — Comfort/Assist introduce no new decline-friction magnitude beyond reusing the existing tuning constant, unless the Human gate directs otherwise (flagged as a deferred question, not a design gap).
- **No** stress relief (Comfort) and no stress change of any kind (Assist).
- **No** memory formation beyond what ADR-16's existing significance criteria would form from the relationship/stress movement actually applied (i.e., a decline/cancel/expiry with zero relationship and zero stress movement forms nothing, exactly as today).

## 9. D8 — Phase placement, deterministic ordering, PRNG attribution

**No change to the seven-phase order, no change to the PRNG architecture.** Comfort and Assist plug into the exact phase slots `design/social-offer-response-protocol.md` D3 and `design/autonomous-three-colonist-runtime.md` D2 already fixed:

- **Phase 5 (Decisions):** a committed `voluntary` goal with `relatedSocialTaskId` of `"comfort"` or `"assist"` creates a pending offer instead of beginning execution, via the same `createPendingOffer` call already used for the other two actions — the `tick.ts` conditional that currently tests `decision.goal.relatedSocialTaskId === "conversation" || ... === "sharedDowntime"` widens to include `"comfort"`/`"assist"`, with no other change to that branch.
- **Phase 6 (Execution & consequences), offer lifecycle pass:** processed in the same ascending-`id` loop, same six (five, for Assist under D5) steps, interleaved with Conversation/Shared Downtime offers in one shared array — there is no separate "Comfort/Assist pass"; one loop, one order, exactly as today, because `SocialOfferStore.offers` is a single append-ordered array regardless of `action`.
- **PRNG:** Comfort's acceptance draw consumes exactly one `next(prng)` call per resolving Comfort offer, in the same position in the fixed iteration Conversation/Shared Downtime's draws already occupy (offer resolution order = ascending `id`, which is creation order, which is canonical colonist iteration order within Phase 5 — unchanged). Assist (under D5's non-rejection resolution) consumes **zero** PRNG draws — this is a real, specified difference in draw-count between action types, already true today in a smaller way (an offer that fails D4's eligibility/relationship gate before reaching step 6 also consumes zero draws) — replay determinism is unaffected because draw consumption remains a pure function of already-recorded state (which offers exist, their fields, and the shared relationship/observation state), not of anything Comfort/Assist add.

No new re-decision trigger kind, no new phase, no new PRNG stream, no change to canonical colonist iteration order. This design's only phase-level addition is the widened `switch`/`if` conditions already named above — the control flow shape is unchanged.

## 10. D9 — Save/load, replay, event-log, and inspector impact

- **Save/load:** `SocialOfferAction`'s widened union changes `socialOffers.ts`'s `validateSocialOfferStore` action check (`SOCIAL_OFFER_ACTIONS` grows from 2 to 4 members) — this is the same load-rejection rule, re-evaluated against a wider closed list, not a new rule. No other field, no new `OfferResolutionReason` member (D6), no new store shape, no save-version bump beyond what an ADR-21 revision itself may require to record (see §11 for the ADR-21 revision scope; if the revision changes no persisted *shape*, only the closed *action* vocabulary, no save-version bump is structurally required — existing saves remain valid, since a save from before this slice simply never contains `action: "comfort" | "assist"`).
- **Replay:** no change. `socialOffers` and `colonists` are already in `replay.ts`'s `STATE_FIELDS`, diffed generically; a divergence in a Comfort/Assist-derived field (an offer's `action`, a colonist's `needs.social`, `stress`, or a relationship pair's affinity) is already covered by the existing generic field-by-field comparison with no new comparison logic required.
- **Event log:** the existing `socialOfferCreated`/`socialOfferResolved`/`stressEvaluated`/`memoryFormed` `TickEvent` variants (`tick.ts`) already carry `action: SocialOfferAction` and generic contribution/reason fields — no new `TickEvent` variant is required. The one new fact this design introduces — Comfort's stress-relief channel — surfaces through the **existing** `stressEvaluated` event (its `contributions` array already exists precisely to make every stress movement decomposable; the new relief channel is one more named `StressContribution` entry, not a new event kind).
- **Inspector:** no new surface. `inspect()`'s existing per-colonist summary (needs, stress with source breakdown, current goal, relationship perspectives) and the existing detached `socialOffers` list already expose everything Comfort/Assist add — a Comfort-in-progress is visible as: the initiator's `currentGoal.relatedColonistId`/`relatedSocialTaskId`, the initiator's `execution.taskId === "comfort"`, the responder's `stress` with the new relief channel decomposed in its own history, and the offer's own record in the inspected `socialOffers` list. No new inspector field is required by this design.

## 11. D10 — ADR determination

**An ADR revision is required before implementation — a revision of ADR-21, not a new ADR.**

Per `ai-studio/workflows/kanban-update-protocol.md`'s Architecture Review Required table, this design's only trigger is **Data model / Serialization**: widening `SocialOfferAction` (ADR-21 D2) and the target-ambient-state eligibility rule that D3 of `design/social-offer-response-protocol.md` (governed by ADR-21's closed-list discipline via its own action union) implicitly scopes to two members. Every other decision in this document (D1–D3, D5's non-rejection resolution, D7's consequence wiring, D8's phase placement) instantiates already-Accepted architecture (ADR-17, ADR-18, ADR-20, ADR-22, and the un-revised parts of ADR-21) and is governed by this design document and those ADRs directly, exactly as `design/social-offer-response-protocol.md` D3–D7 and `design/autonomous-three-colonist-runtime.md` D2–D6 were governed by design documents alone once their own ADR gates (ADR-21, ADR-22) were satisfied.

**Why a revision, not a new ADR:** ADR-21 already owns the entire "what shape is a social offer, what closed unions does it carry, how is it validated" surface. `SocialOfferAction` is ADR-21's own D2 decision, and ADR-21 D2 states explicitly: "Adding a status is a revision of this ADR, not a tuning or implementation choice" — the same sentence's discipline applies identically to the `action` union it is written directly beneath. A new ADR would duplicate authority over the same store this design does not otherwise change the shape of (no new field, no new record type, no new status, no new reason code — see D6/D9). ADR-20's own precedent (Comfort/Assist reuse `perspective`/`applyInteraction` unmodified) and ADR-22's precedent (unmodified `ColonistRuntime`, unmodified phase realization) both confirm: this slice's only genuine architecture-review trigger is the one closed union ADR-21 owns.

**The revision's scope, precisely:**

1. Widen `ArtifactRef`-analogous `SocialOfferAction` (ADR-21 D2) from `"conversation" | "sharedDowntime"` to the four-member closed union including `"comfort" | "assist"`.
2. Record that the `responderNotInterruptible` reason code (already closed, D5's declined-set member) now denotes "the responder's Tier-1 state does not admit this specific action" generically, rather than only "not in `INTERRUPTIBLE_AMBIENT_STATES`" — a wording clarification, not a new reason.
3. Record, per D5 above, that `"accepted"` may be reached for an `"assist"` offer without a PRNG draw — a clarification of D2's already-existing rule ("`accepted` → `resolvedAtTick` number, `reason` null") rather than a new validity-matrix row (the row is unchanged; only the *mechanism* that reaches it varies by `action`, which the persisted record does not need to distinguish — a loaded `"accepted"` `"assist"` offer is indistinguishable in shape from a loaded `"accepted"` `"conversation"` offer, by design).
4. Carry the Decision Log entries for this design's D4 (reused two-sided gate), D5 (DQ-18.7 resolution), and D6/D9 (no save-version bump; no new event/inspector surface) into ADR-21's own Decision Log, exactly as ADR-22 D6 recorded save-v5's implications without ADR-20/ADR-21 needing their own revisions (because those ADRs' shapes did not change).

**No revision of ADR-17, ADR-18, ADR-20, or ADR-22 is required.** ADR-18 itself already fully authorizes Comfort/Assist's behavioral vocabulary (D1, D3, D4, D5, D6, D7, D8) — this design instantiates it, resolves its one open deferred question (DQ-18.7), and adds nothing ADR-18 did not already name. **No new stress-system ADR is required**: the new relief channel is a value-level addition within M7's already-Accepted ownership of "the four reliefs" (decision-loop §7, referenced by the engineering specification's M7 row) — it is Stage 2 realizing a relief the frozen design already enumerated, not a new stress architecture.

**Sequencing (mirrors ADR-21/ADR-22's own precedent):** this design document → Codex design review → Human design approval → the ADR-21 revision drafted from D6/D10 → the revision's own architecture review and Human acceptance → only then does Cursor implementation begin. Implementation touching `socialOffers.ts`'s closed unions, `stress.ts`'s `evaluateStress` signature, or `serialization.ts`'s save/load of the offer store is blocked until the revision is Accepted — identical to the blocking language ADR-21 and ADR-22's own source designs used.

---

## 12. Findings and ambiguities requiring Human decision

These are the items this design could not resolve by tracing to an existing accepted source, or where more than one traceable resolution exists — presented for the Human gate, not decided unilaterally.

1. **DQ-18.7's resolution (§6/D5) — the single most consequential open call.** This design recommends **non-rejection** (no acceptance draw for Assist) over explicit weighted acceptance, for the reasons in D5. Both are within ADR-18's own framing. **Requires explicit Human confirmation or override before the ADR-21 revision is drafted**, since the revision's scope (whether a `assistAcceptanceProbability` tuning table is needed at all) depends on this call.
2. **Comfort/Assist's free-period gate (D1/D2)** inherits ADR-18 D4.1's literal "free period for tier 5" rule, exactly as Conversation/Shared Downtime already do. At Stage 2's 3-colonist scale, this means Assist can only be *initiated* during the initiator's own free time toward a colleague still observably `working`/`blocked` (e.g., staggered shifts) — Assist can never be initiated by a colonist who is themselves mid-shift, even toward a struggling colleague in the same shift. This is architecturally consistent (D4.1 is unambiguous) but narrows Assist's practical reachability considerably at this scale; flagged in case the Human gate wants this called out as an acceptable Stage 2 limitation versus a signal that D4.1 itself needs a scoped exception for Assist specifically (which would be an ADR-18 revision, out of this design's authority).
3. **Whether Comfort/Assist's decline-friction magnitude should differ from Conversation/Shared Downtime's existing `declineAffinityDelta`, or reuse it as-is.** This design defaults to reuse (§8, non-effects) for minimal surface; ADR-18 D6 does not specify a distinct decline magnitude per action, so reuse is the traceable default, but a reviewer may want Support-category declines (Comfort/Assist) tuned separately from Companionship-category declines (Conversation/Shared Downtime) given the different social stakes.
4. **Comfort's stress-relief scope: responder only, or also a smaller relief for the initiator.** ADR-18 D8 names the recipient's relief explicitly and is silent on the comforter's own stress. This design grants none to the initiator (§8); a reviewer may judge that "positive social proximity" should generically apply to whoever is present in a Companionship/Support execution, which would be a larger, more symmetric change (and would also then raise the question of retrofitting Conversation/Shared Downtime, which is explicitly out of this design's scope per Issue #151 — "no existing regression" is one of the Scope-In shared requirements).

## 13. Deferred Questions (prototype tuning, not architecture)

| # | Question | Owner |
|---|---|---|
| DQ-1 | `comfortAcceptanceProbability` values per relationship state (must differ from, and per D4 generally exceed, Conversation's table at comparable bands) | Prototype calibration (ADR-18 DQ-18.1 discipline) |
| DQ-2 | `comfortAffinityDeltaPerTick`, `assistAffinityDeltaPerTick` magnitudes | Prototype calibration (ADR-18 DQ-18.1) |
| DQ-3 | The new "positive social proximity" stress-relief magnitude (`STRESS_TUNING` constant) | Prototype calibration, same discipline as `restReliefPerTick`/`satisfiedReliefPerTick` |
| DQ-4 | `comfortSocialRestorePerTick`, `assistSocialRestorePerTick` magnitudes | Prototype calibration |
| DQ-5 | Whether decline friction for Comfort/Assist reuses `declineAffinityDelta` or gets its own constant (Finding 3 above) | Human gate, then prototype calibration if a new constant is authorized |

## 14. Expected file areas

Final paths are implementation freedom within this design's contract; likely areas, matching Issue #151's own list:

- `prototype/src/decision/goals.ts` — `generateVoluntaryCandidates` extended for Comfort/Assist candidate generation (D1/D2/D3).
- `prototype/src/task/socialOffers.ts` — `SocialOfferAction` union widened; `isEligibleTargetState` (or equivalent) added, replacing/wrapping `isInterruptibleAmbientState`'s single call sites (D6).
- `prototype/src/simulation/tick.ts` — Phase 5's offer-creation branch widened; Phase 6's offer-lifecycle pass's target-state check generalized; Assist's step-6 skip (D5); Comfort/Assist consequence application in the execution-progress loop (D7); Comfort's responder stress-relief read (D7/D8).
- `prototype/src/colonist/stress.ts` — `evaluateStress` gains the new `isReceivingComfort`-style input and its relief channel (D7).
- `prototype/src/task/tasks.ts` — `candidateTaskIdsFor`'s `voluntary` case routes `relatedSocialTaskId === "comfort" | "assist"` to the respective task id (mirroring the existing `conversation`/`sharedDowntime` routing); Assist's eligibility reuse of `checkEligibility(taskDefinition("workAtWorkstation"), ...)` (D2).
- `prototype/src/config/tuning.ts` — new provisional constants (§13).
- `prototype/src/core/serialization.ts` — only if the ADR-21 revision's scope requires a save-version note; no field/shape change (D9).
- `prototype/src/replay/replay.ts` — no change expected (D9); listed defensively per Issue #151's own file-area note.
- `prototype/src/inspection/inspector.ts` — no change expected (D9); listed defensively.
- `ai-studio/adr/0021-social-offer-state-storage.md` — the required revision (D10), a separate reviewed artifact, not part of this design's own file list.
- Corresponding colocated `*.test.ts` files for every module above.

## 15. Test matrix

Grouped by this design's decisions; every row is a regression-class addition, none removes or weakens an existing test.

**Candidate generation (D1–D3)**
- Comfort candidate generated only for a nearby colonist observed `"stressed"`; absent for every other ambient state.
- Assist candidate generated only for `"working"`/`"blocked"`; absent otherwise, and absent when the initiator fails `checkEligibility`/`checkAvailability` against `workAtWorkstation`.
- Neither candidate is generated outside `currentPeriod === "free"`.
- No candidate with `source !== "voluntary"` ever carries `relatedSocialTaskId === "assist"` (property test over `generateCandidates`'s output for every source).
- `candidateTaskIdsFor("shiftAssignment", ...)` returns exactly `["workAtWorkstation"]` (regression pin).

**Eligibility and relationship gate (D2/D4)**
- Assist offer resolution re-checks `workAtWorkstation` eligibility/availability at Phase 6 (a target whose module became non-functional between generation and resolution declines with the existing availability-derived reason, not a silent success).
- Comfort/Assist both decline with `relationshipGate` for a Hostile-or-Fractured pair in either direction, before any draw/auto-accept.
- `isEligibleTargetState` returns `true` for Comfort exactly on `"stressed"`, for Assist exactly on `"working"`/`"blocked"`, and reproduces `isInterruptibleAmbientState`'s existing table unchanged for Conversation/Shared Downtime.

**Acceptance/decline semantics (D5)**
- Comfort: an accepted draw and a declined (`acceptanceDraw`) draw are both reachable and attributed (one `next(prng)` call, decomposable in the event trace).
- Assist: an eligible, non-hostile, non-expired, non-cancelled offer **always** resolves to `"accepted"` with **zero** PRNG draws consumed for that offer (a determinism-class test: two runs differing only in PRNG seed produce identical Assist outcomes whenever their eligibility/relationship/timing facts agree).
- Assist never reaches `declined` via `acceptanceDraw` (that reason is unreachable for `action: "assist"` — an explicit negative test).

**Consequences (D7)**
- Accepted Comfort: both directions gain affinity via `mutualSupportCrisis`; both parties' Social need is restored; the responder's stress shows a new, separately-attributed relief contribution in `stressEvaluated`; the initiator's stress is unaffected by this channel.
- Accepted Assist: both directions gain affinity via `sharedTaskCompletion`; only the initiator's Social need is restored; neither party's stress changes; neither party's Purpose changes.
- Declined/cancelled/expired Comfort and Assist: zero Social-need change, zero stress change, zero Purpose change; declines apply exactly the existing `forcedProximityMutualStress` friction and nothing else.
- Property test: no code path this design adds ever writes to a Purpose-related field (Purpose has no serving task per `tasks.ts`'s existing structure — this is a regression pin, not new mechanism).

**Determinism, phase order, replay (D8/D9)**
- A fixed-seed multi-colonist run including at least one accepted Comfort and one accepted Assist reproduces an identical event/decision trace on replay (extends the existing Slice 6b/6c replay-verification tests).
- Reordering two colonists' ids in the collection does not change a third colonist's Comfort/Assist candidate set or eligibility outcome (extends the existing non-observability regression test from `design/autonomous-three-colonist-runtime.md` D3).
- Save/load round-trip of a state holding a pending Comfort offer mid-delay, an accepted Assist offer, and a declined Comfort offer, each preserved bit-identically.
- Load rejects an `action` value outside the (now four-member) closed union — a mechanical extension of ADR-21's existing per-field load-rejection test.

**Regression (explicitly required by Issue #151's Shared Requirements)**
- Full existing Conversation, Shared Downtime, Shared Meal, and Slice 6c multi-colonist offer test suites remain green, unmodified in their assertions.

## 16. Required validation commands

Repository-defined, per Issue #151:

```powershell
npm --prefix prototype test
npm exec --prefix prototype -- tsc --noEmit -p prototype/tsconfig.json
node tools/ai-workflow/validate-workflow-pack.mjs .
node --test tools/ai-workflow/validate-workflow-pack.test.mjs
node --test tools/ai-workflow/validate-workflow-record.test.mjs
git diff --check
```

Workflow-pack validation applies once the ADR-21 revision (a governed workflow artifact) is drafted; targeted Vitest runs during TDD do not replace the full `npm --prefix prototype test` suite before review.

---

## 17. Options Considered

| Option | Summary | Rejected because |
|---|---|---|
| A second, Comfort/Assist-specific offer store or record shape | Keeps Conversation/Shared Downtime's store untouched | Duplicates ADR-21's entire mechanism for two actions that need no different shape — the closed `action` union extension point exists precisely to avoid this; violates the reuse Issue #151 requires |
| Skip the offer/response protocol entirely for Comfort/Assist (direct same-tick resolution) | Simpler — no response-delay, no PRNG draw for Comfort | Reopens exactly the unreachable-pending-state defect `design/social-offer-response-protocol.md` v0.1.0 was rejected for; also contradicts ADR-18 D5's "no colonist is commanded into an interaction... sought interactions are offers" for Comfort, which does need a genuine response |
| Give the responder of an accepted Comfort their own goal/execution (resolve DQ-2 now) | Would make "being comforted" a first-class adopted state for the responder, symmetric with the initiator | Explicitly out of scope — `design/autonomous-three-colonist-runtime.md` DQ-2 is deferred to its own Human-gated follow-up, not silently resolved by this slice; the direct-write pattern (mirroring Shared Meal) delivers the required consequences without it |
| Explicit weighted acceptance for Assist (reject the non-rejection reading of DQ-18.7) | Uniform mechanism across all four offer-backed actions | Requires inventing a responder-side "receptiveness to help" signal with no Tier-1-observable or relationship-gate-distinct basis; flagged as Finding 1 for the Human gate rather than silently chosen |
| Reuse `isInterruptibleAmbientState` unmodified for Comfort/Assist (require the target to also be resting/eating/socializing) | No new eligibility function | Directly contradicts ADR-18 D4.3 — Comfort's entire premise is targeting the Stressed state, which is never in that list; Assist's Working/Blocked targets are likewise never in it |
| New stress-relief mechanism reused generically for all Companionship/Support executions (not Comfort-specific) | More "complete" realization of decision-loop §7's four-relief list | Widens scope beyond Issue #151 (would retune Conversation/Shared Downtime's existing, already-calibrated stress behavior); flagged as Finding 4 instead of decided |

## 18. Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| Comfort/Assist generated as tier-5 voluntary candidates, free-period-gated, identically to Conversation/Shared Downtime | Matches ADR-18 D3/D4.1 exactly; zero new candidate-generation architecture | A new tier-4 Social-need-driven path for Comfort (not authorized — Social's tier-4 goal has no serving task per `tasks.ts`, unchanged by this design) |
| Assist eligibility reuses `checkEligibility`/`checkAvailability` against `workAtWorkstation`, not a new `assist`-specific requirement | ADR-18 D4.3 requires checking the *assisted* task's requirements; Stage 2 has exactly one work task, so this is closed-form and reuses existing pure functions verbatim | A separate `requiredSkill` on the `assist` `TaskDefinition` itself (checks the wrong task; would let an unskilled colonist "assist" work they could not do themselves) |
| Assist reachable only from `source === "voluntary"`; structural invariant pinned by test | Issue #151 Scope-In requirement; presently vacuous (no assignment-collaboration mechanism exists) but must hold as a standing guard for future slices | No explicit guard (relies on absence-of-mechanism alone, which a future slice could silently violate) |
| Two-sided non-hostile relationship gate, reused unmodified from Conversation/Shared Downtime's existing (stricter-than-ADR-18-text) convention | Codebase consistency; the two-sided check is already the established fix for a confirmed defect in the one-sided reading | A literal ADR-18 D4.4 one-sided gate for Comfort/Assist only (inconsistent with the rest of the codebase) |
| DQ-18.7 resolved as non-rejection: Assist skips the acceptance draw, resolving to `accepted` once gates 1–5 clear | Assist's voluntariness is the initiator's; no Tier-1-honest responder-receptiveness signal exists distinct from D4's gate; zero new mechanism (no new reason code, no new tuning table) | Explicit weighted acceptance (uniform mechanism, but requires an ungrounded probability table) — flagged as Finding 1 rather than foreclosed |
| Comfort's stress relief is a new, Comfort-specific input to `evaluateStress`, applied to the responder only | ADR-18 D8 names the recipient's relief explicitly; realizes decision-loop §7's third relief for the first time, scoped narrowly so Conversation/Shared Downtime's existing calibration is untouched | A generic "any companionship execution grants relief" mechanism (retunes existing, already-calibrated behavior — out of scope; Finding 4) |
| Responder-side consequences (Comfort's stress relief, both actions' Social/affinity credit to the non-initiator where specified) applied by direct write, mirroring Shared Meal's existing partner-write pattern — no goal/execution given to the responder | Keeps `design/autonomous-three-colonist-runtime.md` DQ-2 deferred, exactly as that design left it; reuses an existing, already-proven pattern rather than inventing responder-side goal commitment | Giving the responder their own Comfort/Assist goal (resolves DQ-2 silently, out of this slice's authority) |
| Extend `SOCIAL_OFFER_ACTIONS`/`SocialOfferAction` via an ADR-21 revision, not a new ADR | ADR-21 already owns this exact closed union and states in its own text that extending it is "a revision of this ADR"; no new record shape, status, or reason code is introduced | A new ADR-23-numbered-equivalent for offer-action storage (duplicates authority ADR-21 already holds; Slice 5/6's own precedent is revision, not proliferation) |
| `responderNotInterruptible` reused with a generalized meaning; no new `OfferResolutionReason` member | The closed reason union's members are already outcome-shaped, not action-specific; a new per-action reason code would fragment a union ADR-21 deliberately closed | A `comfortTargetNotStressed`/`assistTargetNotWorking`-style pair of new reason codes (unnecessary fragmentation of a closed, already-sufficient union) |

---

## 19. Kanban Update

**Card:** [Phase 3] Stage 2 Slice 7 — Comfort and Assist (Design)
**Status:** Review — design artifact complete, awaiting Codex design review and Human approval. No ADR revision drafted and no implementation until both gates pass and the ADR-21 revision (§11) is subsequently Accepted.
**Completed:** Produced `design/comfort-assist-protocol.md` — Comfort candidate generation from Tier-1 `Stressed` state (D1); Assist candidate generation from `Working`/`Blocked` state with skill × permission × requirement eligibility reused verbatim from `tasks.ts` (D2); the voluntary-assistance structural boundary and its testable invariant (D3); the reused two-sided relationship gate with Comfort's acceptance-only asymmetry (D4); acceptance/decline semantics including an explicit, rationale-backed resolution of ADR-18 DQ-18.7 as non-rejection for Assist, flagged for Human confirmation (D5); full reuse of the existing offer/response lifecycle with the minimal ADR-21-scoped extension points named precisely (D6); complete need/stress/relationship/relational-memory consequence tables for accepted and non-accepted outcomes, including one new narrowly-scoped stress-relief channel (D7); phase placement and PRNG-attribution confirmation with zero seven-phase or PRNG-architecture change (D8); save/load/replay/inspector impact, confirming no new persisted shape or surface beyond the closed-union widening (D9); an explicit ADR determination (revision of ADR-21, not a new ADR, with precise revision scope) (D10); four findings for the Human gate; five deferred tuning questions; expected file areas; a full test matrix; and required validation commands.
**Changed Files:**
  CREATED  design/comfort-assist-protocol.md
**Validation:** Grounded directly against the current implementation — read `prototype/src/task/socialOffers.ts`, `decision/goals.ts`, `task/tasks.ts`, `simulation/tick.ts`, `task/execution.ts`, `colonist/relationships.ts`, `colonist/stress.ts`, `decision/weights.ts`, `world/snapshot.ts`, `world/policy.ts`, and `config/tuning.ts` in full — every mechanism this design proposes reusing (the offer/response lifecycle, `checkEligibility`/`checkAvailability`, `applyInteraction`, `perspective`, the shared observation basis, `TASK_AMBIENT_STATE`'s existing Comfort/Assist entries, `mutualSupportCrisis`/`sharedTaskCompletion` change sources) was confirmed present and unused, not assumed. Cross-checked against ADR-17 D1/D6/D9, ADR-18 D1–D10 in full, ADR-20 D2/D3/D7, ADR-21 D1–D6 and its explicit revision-trigger language, ADR-22 D1–D6, and both prior Stage 2 design documents — no accepted decision reopened; the seven-phase order and PRNG architecture are unchanged; Social actions credit no Purpose through any path this design adds.
**Risks:** DQ-18.7's resolution (Finding 1) is this design's highest-leverage judgment call and is explicitly flagged rather than silently decided. The new stress-relief channel is the one place this design adds genuinely new mechanism (not pure reuse) — scoped narrowly to avoid retuning existing Conversation/Shared Downtime behavior, but it is new code in `stress.ts`'s core function and deserves focused review attention. The ADR-21 revision is a prerequisite gate this design cannot itself satisfy.
**Follow-up Tasks:** Draft the ADR-21 revision (§11) after design approval, through the architecture workflow, before any implementation begins. Resolve Finding 1 (and optionally 2–4) at the Human gate. No other follow-ups beyond what Issue #151 already tracks; Confrontation, `In Conflict`, Stage 2 Slice 8/9, and Stage 3 scaling remain untouched and out of scope.

**Not committed** per instruction — this is a design artifact only; no code in `prototype/src` is created or modified by this task.
