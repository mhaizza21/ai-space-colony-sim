# Design — Comfort and Assist Protocol (Stage 2 Slice 7)

**Version:** 0.2.0 (revised after Codex design review — Revisions Required)
**Phase:** Phase 3 — Stage 2 Slice 7
**Status:** Draft — awaiting Codex re-review and Human approval (`docs/ai-workflow/operating-model.md` Design → Human Approval gate; `ai-studio/workflows/kanban-update-protocol.md`'s review pipeline)
**Author:** Claude (design task)
**Tracks:** GitHub issue #151 (parent #119) · PR #152
**Authority (treated as authoritative):** ADR-17 (Need System — Accepted); ADR-18 D1–D10 (Social Action Space — Accepted; Comfort/Assist's own governing decisions); ADR-20 (Relationship Record Storage — Accepted); ADR-21 (Social Offer State Storage — Accepted); ADR-22 (Per-Colonist Runtime Collection — Accepted); `design/social-offer-response-protocol.md` v0.2.0 (the offer/response mechanism this design reuses); `design/autonomous-three-colonist-runtime.md` (the multi-colonist phase realization this design plugs into, including its still-deferred DQ-2); `design/engineering-specification.md` v0.3.0 (seven-phase order, determinism obligations); `ai-studio/constitution/architecture-philosophy.md`
**This document is NOT implementation:** no code is written here. It specifies the data shape, deterministic rules, phase placement, and validation Cursor implements exactly, and the ADR revision this shape requires before implementation.

**Traceability rule:** every decision below cites its authorizing source. Every mechanism reused from the current implementation is cited by file and line, verified by reading, not assumed.

---

## 0. Revision history — what v0.2.0 changes and why

v0.1.0 was returned **Revisions Required** by Codex design review with three blockers. This revision resolves all three, and in the course of grounding them corrected three factual errors in v0.1.0 that the blockers exposed.

| Blocker | Resolved by | Summary of the change |
|---|---|---|
| **1.** Assist had no real, bounded work effect — no statement of what is shared or covered, who owns completion, when `sharedTaskCompletion` is emitted, or how double progress/completion is prevented | **New D11** (§5) | The shareable quantity is proven empty (Stage 2 has no work-progress model at all); Assist transfers **zero** progress and holds **zero** completion authority; `sharedTaskCompletion` is emitted **exactly once**, at the `inProgress → completed` transition of the initiator's own `assist` execution, gated on a minimum-participation floor; four structural rules prevent double progress and double completion. Policy-assigned collaboration remains out of scope (D3, unchanged). |
| **2.** D7's Comfort stress relief performed a live cross-runtime scan inside the per-colonist Phase 3 loop | **New D12** (§10), replacing v0.1.0 §8's `runtimes`-lookup text | An immutable `SocialParticipationBasis` is built **once per tick, before Phase 3 begins**, from tick-start state only. Phase 3 does a keyed lookup into that frozen value and performs **no** cross-runtime read. Fixed inputs, derivation rule, tie-break, one-tick lag, and five determinism tests are specified. |
| **3.** The widened persisted unions carried "no save-version bump" and no compatibility statement | **New D13** (§13), replacing v0.1.0 §10's bullet | `SAVE_FORMAT_VERSION` bumps **6 → 7**. Four persisted closed unions widen (not one). All three compatibility cases are stated explicitly, and validate-never-repair is reinforced rather than weakened. |

**Factual corrections carried in this revision** (each was a wrong statement in v0.1.0, not a change of intent):

1. v0.1.0 §3 claimed "`workAtWorkstation` is the only task producing `working`/`blocked` ambient state." **False.** `ambientStateFor` returns `"blocked"` for *any* colonist with no in-progress execution (`prototype/src/task/execution.ts:188`), and returns `"working"` for an `assist` execution too (`execution.ts:173`). Corrected in D2 (§3), with the consequences worked through in D11 (§5) and Finding 2 (§15).
2. v0.1.0 left `isTaskComplete("comfort")`/`("assist")` at their current `false` (`prototype/src/task/tasks.ts:247–253`), which would make an accepted Comfort/Assist execution **never complete** and apply its per-tick consequences without bound. Corrected in D11.3 (§5).
3. v0.1.0 §16 listed `node --test tools/ai-workflow/validate-workflow-record.test.mjs` as a repository validation. **That file does not exist.** Corrected in §17.

**DQ-18.7 remains an open Human decision** (Finding 1, §15) — unchanged in status from v0.1.0. Everything in D11 is deliberately independent of how it resolves; §7 states the dependency explicitly.

**Decision index.** D1 §2 · D2 §3 · D3 §4 · **D11 §5** · D4 §6 · D5 §7 · D6 §8 · D7 §9 · **D12 §10** · D8 §11 · D9 §12 · **D13 §13** · D10 §14. D1–D10 keep the identifiers they had in v0.1.0 so review comments on those decisions still resolve; D11–D13 are this revision's additions, placed where they read best rather than appended.

---

## 1. Context — the gap this closes

ADR-18 D1 names Comfort and Assist as two of the six canonical social actions — both Sought, both category **Support** — and reserves their wiring for a future slice: "Comfort, Assist, Confrontation, `In Conflict` state — the offer/response protocol here is reachable only from `conversation`/`sharedDowntime`'s existing `relatedSocialTaskId` union; extending it to another `SocialTaskId` is explicitly a future slice's decision" (`design/social-offer-response-protocol.md` §12). Slice 6c closed out the three-colonist offer-hardening work for Conversation and Shared Downtime only. Issue #151 is that future slice for exactly Comfort and Assist — Confrontation and `In Conflict` remain out of scope.

Reading the current implementation directly:

- `prototype/src/task/tasks.ts:29,40–53` already lists `"comfort"` and `"assist"` in the closed `SocialTaskId` union and in the `TASKS` table (`taskClass: "social"`, `moduleId: null`), marked "vocabulary-only until their own wiring." `candidateTaskIdsFor`'s `voluntary` case (`tasks.ts:67–91`) does not route to them.
- `prototype/src/decision/goals.ts:120–139`'s `generateVoluntaryCandidates` generates social candidates only for `"conversation"` and `"sharedDowntime"`, from `snapshot.nearbyColonists`, gated to `currentPeriod === "free"`.
- `prototype/src/task/socialOffers.ts:18–19` has a **closed** `SocialOfferAction = "conversation" | "sharedDowntime"` union and a closed seven-member `OfferResolutionReason` union (`socialOffers.ts:30–37`) — both documented as requiring an ADR-21 revision to extend.
- `prototype/src/task/execution.ts:160–175`'s `TASK_AMBIENT_STATE` already maps `comfort → "socializing"` and `assist → "working"`, mirrored verbatim from ADR-18 D1's ambient-expression column, as inert unreachable data.
- `prototype/src/colonist/relationships.ts:68–75`'s `RELATIONSHIP_CHANGE_SOURCES` already includes `"mutualSupportCrisis"` — ADR-18 D6's Comfort row — unused today.
- `prototype/src/colonist/stress.ts:31` realizes only two of decision-loop §7's four reliefs (`restAdequacy`, `needsSatisfied`); "positive social proximity" — the mechanism ADR-18 D8 assigns an accepted Comfort to — does not exist.
- `prototype/src/simulation/tick.ts:988–999`'s Phase 6 offer-acceptance path begins execution for the **initiator only**; the responder receives no goal/execution of their own (`design/autonomous-three-colonist-runtime.md` D5, DQ-2 — still deferred, not resolved here).

Three further facts, established while resolving this revision's blockers, govern everything below and were **not** correctly stated in v0.1.0:

- **There is no work-progress quantity anywhere in the simulation.** `Execution` (`execution.ts:35–41`) carries exactly `taskId`, `goalKey`, `status`, `startedAtTick`, `elapsedTicks`. `progressExecution` (`execution.ts:62–70`) only increments `elapsedTicks`. `applyProgressConsequences` returns `{}` for `workAtWorkstation` (`execution.ts:141–143`). Work produces no output, consumes no resource, and accumulates no completion fraction.
- **`workAtWorkstation` completes on a clock boundary, not on progress:** `isTaskComplete("workAtWorkstation")` is `snapshot.currentPeriod !== "work"` (`tasks.ts:240–241`), and `currentPeriod` is colony-global (`snapshot.ts:82` — `periodAt(policy, tickOfDay)`; there is no per-colonist shift).
- **`isTaskComplete` returns `false` for `comfort` and `assist`** (`tasks.ts:247–253`). Wiring them without changing this would create executions that never terminate.

Every piece of scaffolding ADR-18 anticipated is present and unused. This design specifies exactly how to reach it — reusing the existing offer/response mechanism (ADR-21) rather than inventing a second one, and extending exactly the closed unions ADR-18/ADR-21 already flagged as the extension points.

---

## 2. D1 — Comfort candidate generation (Tier-1 `Stressed` state)

Comfort is generated exactly like Conversation/Shared Downtime — a tier-5 voluntary candidate from `generateVoluntaryCandidates` (`goals.ts:120–139`), gated to `snapshot.currentPeriod === "free"` (ADR-18 D4.1: "free period for tier 5" is the opportunity condition for every tier-5 sought action; this is the existing gate applied to a third action, not a new rule).

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

`ambientState === "stressed"` is exactly `isStressedState` (`stress.ts:128–130`) as published through `ambientStateFor` (`execution.ts:186–190`) into the tick's single shared observation basis (`design/autonomous-three-colonist-runtime.md` D3; built at `tick.ts:695–698`) — the same Tier-1 registry every other candidate and the inspector already read. No new perception path, no colonist-internal read: `ambientStateFor` checks `isStressedState(stress)` **before** consulting execution state at all (`execution.ts:187`), so a Stressed colonist is reported as `"stressed"` regardless of what task they were nominally executing. This is existing behavior, not something this design changes.

**Comfort is reachable in the free period**, unlike Assist (D2/Finding 2): `"stressed"` is produced by the stress check that precedes the execution check, so it survives Phase 4's completion of the target's work execution.

**`baseUrgency` is uniform, not distress-scaled.** The candidate's base weight does not encode how stressed the target is (Tier-1 exposes only the boolean crossing, not a magnitude — locked #21's spirit: no internals). "Distress must not force acceptance" (Issue #151 Scope-In) is satisfied structurally: generation never privileges a Comfort candidate over any other tier-5 candidate, and the accept/decline weighting (D5) is entirely the **responder's**, not a function of how the candidate was generated.

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

### 3.1 What `"working"` and `"blocked"` actually mean (v0.1.0 correction)

v0.1.0 asserted that observing `"working"`/`"blocked"` *is* observing "doing `workAtWorkstation`." Reading `ambientStateFor` (`execution.ts:186–190`) shows that is false:

```text
if (isStressedState(stress)) return "stressed";
if (execution === null || execution.status !== "inProgress") return "blocked";
return TASK_AMBIENT_STATE[execution.taskId];
```

- `"blocked"` is produced by the **absence** of an in-progress execution — a colonist who is idle, between decisions, or whose goal was blocked and execution aborted (`tick.ts:673–681`). It carries no implication that any work is happening, and Tier-1 offers no way to tell those cases apart. This is deliberate (`execution.ts:183–184`: "motionless, not resting, not on task").
- `"working"` is produced by `workAtWorkstation` **and by `assist` itself** (`TASK_AMBIENT_STATE.assist = "working"`, `execution.ts:173`).

Both corrections have consequences: the first is the basis of Finding 2's reachability proof (§15); the second is why D11.5(d) forbids Assist-on-Assist.

### 3.2 Eligibility

**Eligibility (ADR-18 D4.3: "skill ∩ permission ∩ requirement applies to the assisted task — Assist never bypasses the frozen eligibility model") is checked against `workAtWorkstation`, the single work task Stage 2's vocabulary contains** (`TASKS`, `tasks.ts:40–53`) — not against a separate `assist` requirement. This is a closed-vocabulary fact about Stage 2's task table, **not** an inference from the target's observed ambient state (§3.1 shows that inference does not hold). Reusing the exact existing functions:

```text
checkEligibility(taskDefinition("workAtWorkstation"), initiator.identity.skills, snapshot)
checkAvailability(taskDefinition("workAtWorkstation"), snapshot)
```

Both are pure and already shared by `resolveTask` and `candidateActionability` (`tasks.ts:100–130`) — this design adds no new eligibility logic, only a new caller. `checkEligibility`'s `requiredSkill` check and `checkAvailability`'s module-functional/food-stock checks are Stage 2's entire "requirement" surface; `workAtWorkstation` declares no `requiredSkill`, so the check is presently a no-op beyond `isPermitted` (itself a stub returning `true` — `world/policy.ts`). This design does not change that; it wires Assist through the same gate so a future tightening of either function automatically governs Assist too, with no Assist-specific code to keep in sync.

An initiator who fails this eligibility/availability check produces **no** Assist candidate for that target (mirroring `generateVoluntaryCandidates`'s all-or-nothing per-candidate shape — an ineligible candidate is simply absent, not generated-then-rejected). This is stricter than Conversation/Shared Downtime, which generate unconditionally and let the Phase-6 eligibility pass reject; Assist's eligibility is closed-form and snapshot-computable at generation time, so filtering earlier avoids spending a response-delay tick on an offer that structurally could never succeed. Availability can still change between generation and Phase 6 — D6 re-verifies it there.

## 4. D3 — Voluntary-assistance boundary (policy-assigned collaboration stays out of scope)

**Assist is reachable only from `source === "voluntary"`.** `candidateTaskIdsFor`'s `shiftAssignment` case (`tasks.ts:67–91`) continues to return exactly `["workAtWorkstation"]`, unchanged — no code path from tier-3 assignment generation, task resolution, or execution ever produces an `assist` task. Stage 2 has no collaborative-assignment or co-worker-pairing mechanism at all (`workAtWorkstation` is solo per colonist, unconditionally), so this boundary is presently satisfied vacuously by construction: there is no existing code that could be mistaken for policy-assigned collaboration.

This design adds no such mechanism, and this boundary is the reason it must not. If a future slice ever adds assignment-time collaboration, that slice inherits this invariant as a hard constraint: tier-3-sourced work is never Assist, never credits Social through D7, never emits `sharedTaskCompletion` through D11.4, and is not gated by this design's relationship/eligibility checks — it is a different tier, a different source, and this design's candidate generator never runs for it.

**Required invariant (testable today):** no `GoalCandidate` with `source !== "voluntary"` ever carries `relatedSocialTaskId === "assist"`.
**Required invariant (testable today):** `candidateTaskIdsFor("shiftAssignment", ...)` returns exactly `["workAtWorkstation"]` for every input.

## 5. D11 — Assist's bounded work effect, completion ownership, and single-emission rule

*(New in v0.2.0 — resolves Codex blocker 1. Independent of DQ-18.7's resolution; see §7.4.)*

### 5.1 D11.1 — The shareable quantity is empty, and that is a derived result, not a deferral

Codex asked what progress or workload Assist shares or covers. The answer, forced by the data model:

**Assist shares, covers, and transfers exactly zero work progress, because Stage 2 has no work-progress quantity for it to act on.**

The proof is three lines of existing code:

1. `Execution` (`execution.ts:35–41`) has no progress, workload, effort, remaining-work, or completion-fraction field. Its only monotonic quantity is `elapsedTicks`, which is wall-clock participation, not work done.
2. `progressExecution` (`execution.ts:62–70`) does nothing but `elapsedTicks + deltaTicks`.
3. `applyProgressConsequences("workAtWorkstation", ...)` returns `{}` (`execution.ts:141–143`) — a tick of work changes no need, no world field, and no colonist state. The only trace work leaves anywhere is the `overwork` stress channel, which is driven by the *assisted colonist's own* `isWorking` flag in Phase 3 (`tick.ts:591–592`) and is not a work product.

There is therefore nothing to divide, nothing to hand over, and nothing to double-count. Any other answer would require **inventing** a work-progress model — a new M12 data-model decision. ADR-18 authorizes Assist's *social* vocabulary (D1, D3, D6, D7); it does not authorize a work-output model, and this slice has no authority to add one. Introducing one here would also silently change `workAtWorkstation`'s completion semantics for the solo case, which Issue #151's "no existing regression" requirement forbids.

**What ADR-18 D6's "cover behavior" therefore means at Stage 2:** the social fact that the initiator spent their own free period alongside a colleague rather than on themselves. It is credited as a relationship fact (D11.4) and an initiator-side Social-need fact (D7), and as nothing else. When a future slice introduces a real work-output model, that slice — not this one — decides whether Assist contributes to it, and inherits D11.2's completion-ownership invariant unchanged.

### 5.2 D11.2 — Completion ownership is exclusive, and Assist holds none of it

| Execution | Owner of its progress | Owner of its completion | Where completion is decided |
|---|---|---|---|
| The assisted colonist's `workAtWorkstation` | The assisted colonist, solely | The assisted colonist, solely | Phase 4, from *their own* `runtimes` entry against `structuralSnapshot.currentPeriod` (`tick.ts:663–672`; `tasks.ts:240–241`) |
| The initiator's `assist` | The initiator, solely | The initiator, solely | Phase 4, from *their own* runtime entry (D11.3's criterion) |

**Assist never writes to the assisted colonist's `execution` slot.** It does not advance, complete, abort, interrupt, resume, or re-key it, and it does not influence `isTaskComplete`'s inputs for it. The two executions are independent records in two different `ColonistRuntime` entries, each completed by its own owner in the same Phase-4 pass, in canonical colonist order.

The one cross-colonist write Assist performs is the relationship delta of D11.4, which is applied to the shared `relationships` store — never to the other colonist's runtime. This is deliberately narrower than Comfort, which does write the responder's `StressState` (D7/D12); the difference is stated so a reviewer can see it is a decision, not an oversight: ADR-18 D8 names a recipient-side relief for Comfort and names nothing for Assist.

### 5.3 D11.3 — Both Comfort and Assist executions are explicitly bounded (v0.1.0 defect fix)

`isTaskComplete` returns `false` for `comfort` and `assist` today (`tasks.ts:247–253`) because they are unreachable vocabulary. v0.1.0 wired them reachable without changing this — an accepted Comfort or Assist execution would then have **satisfied no completion criterion on any tick**, running until an unrelated interruption happened to preempt it, and applying its per-tick consequences the whole time. That is the unbounded effect this revision removes.

Both rows change to reuse the Conversation/Shared Downtime criterion verbatim:

```text
case "conversation":
case "sharedDowntime":
case "comfort":
case "assist":
  return snapshot.currentPeriod !== "free";
```

**Why this bound and not a duration constant:** it requires no signature change to `isTaskComplete` (which receives `taskId`, `needSatisfied`, `snapshot` and has no access to `elapsedTicks`), it is the criterion already accepted for the two reachable social tasks, and the free period is finite by construction (`policy.ts`), so the execution is bounded by the period's remaining ticks. A duration cap is available as tuning later; it is not needed to make the effect bounded, and adding a fourth argument to a function four call sites depend on is a wider change than the bound requires.

`sharedMeal` and `confrontation` keep `false` — still unreachable, still out of scope.

### 5.4 D11.4 — Exactly when `sharedTaskCompletion` is emitted

**Emission point, stated as a single rule:** exactly once per accepted Assist, on the Phase-4 tick at which that initiator's own `assist` execution transitions `inProgress → completed` (`completeExecution`, `execution.ts:73–75`, invoked at `tick.ts:666`), and only if `execution.elapsedTicks >= SOCIAL_OFFER_TUNING.assistMinimumParticipationTicks` at that moment.

Never per tick. Never on `interrupted`, `aborted`, or `suspended`. Never on resume. Never on the assisted colonist's `workAtWorkstation` completion — that is their event, not the pair's (D11.2).

The delta is a **single flat `assistAffinityDeltaOnCompletion`**, applied in both directions via `applyInteraction` with `changeSource: "sharedTaskCompletion"` — not the per-tick rate v0.1.0 specified. v0.1.0's `assistAffinityDeltaPerTick` is withdrawn.

**Why per-tick was wrong and completion-gated is right.** `sharedTaskCompletion` is the change source ADR-18 D6 assigns to Assist, and it names a completion. Applying it on every tick of an in-progress execution asserts a completion that has not happened, N times; combined with D11.3's previously-missing bound it would have accumulated without limit. The existing per-tick companionship credit (`tick.ts:1060–1081`) is not a counter-example: `conversationAffinityDeltaPerTick` credits *participation*, which is what Conversation is, and it is bounded by that task's own period-boundary completion.

**Why a minimum-participation floor.** Because the completion criterion is the period boundary (D11.3), an Assist accepted one tick before free time ends would otherwise collect the full completion credit for one tick of presence. The floor is read from `execution.elapsedTicks`, which Phase 4 already has in hand at the completion branch — no new field, no signature change. Below the floor the execution still completes normally; it simply emits nothing. Magnitude is deferred tuning (DQ-6).

**Phase placement.** The write happens in Phase 4, immediately after the existing `completion` event is pushed (`tick.ts:667`), threading `relationships` sequentially across colonists in canonical order exactly as Phase 6's writes already do. This is not a change to the seven-phase order and not a new phase: relationship writes already occur in Phase 3 (atrophy, `tick.ts:626`) and twice in Phase 6 (decline friction `tick.ts:904`, companionship credit `tick.ts:1068`). Phase 4 is where the completion transition happens, and a completion-triggered fact has no other correct trigger point. The consequence — that the delta is visible to this same tick's Phase 5 weighting — is intended and is the same ordering Phase 3's atrophy already has.

**Required correction to the atrophy exclusion set.** `applyAtrophy`'s exclusion predicate (`tick.ts:619–624`) admits a pair only when `companionshipAffinityDeltaPerTick(taskId) > 0 || taskId === "eatAtFoodStation"`, and `companionshipAffinityDeltaPerTick` returns `0` for `comfort` and `assist` (`tick.ts:391–398`, `default: return 0`). Left alone, an actively-comforting or actively-assisting pair would be **atrophied while mid-interaction** — the exact defect Slice 6b's `excludedPairs` generalization was written to prevent (`relationships.ts:337–343`). The predicate must widen to "an in-progress execution whose `taskId` is a social task carrying a `relatedColonistId`," which covers Comfort and Assist regardless of whether their credit is per-tick or completion-gated. Pinned by a test (§16).

**Comfort's relationship credit is deliberately different, and stays per-tick.** Comfort's change source is `mutualSupportCrisis` (`relationships.ts:68–75`), which names a state, not a completion, and ADR-18 D6 describes it as mutual support during distress. It therefore credits participation per tick via `comfortAffinityDeltaPerTick`, both directions, bounded by D11.3's completion criterion. The asymmetry between the two actions is traced to the two change-source names, not invented here.

### 5.5 D11.5 — How double progress and double completion are prevented

Four rules. (a) and (b) are structural; (c) and (d) are stated invariants with named enforcement points.

**(a) Double progress is unrepresentable.** By D11.1 no progress quantity is transferred, so there is no value that could be applied twice. Pinned by a test asserting that across an accepted Assist's entire lifetime, the assisted colonist's `execution` differs from the no-Assist control run only in its own `elapsedTicks` advance — same `taskId`, `goalKey`, `status`, `startedAtTick`, and the same tick of completion.

**(b) Double completion is prevented by the transition guard that already exists.** Emission (D11.4) is keyed to the `inProgress → completed` transition, and `transition()` (`execution.ts:54–59`) throws if the source status is not `inProgress`. Phase 4 enters the completion branch only for `status === "inProgress"` (`tick.ts:663`). A given `assist` execution can therefore reach `completed` at most once, and emits at most once. An interrupted-then-resumed Assist still holds one execution record with one completion, so resume cannot re-emit; `elapsedTicks` is preserved across interrupt/resume (`execution.ts:34`, `82–85`), so the participation floor measures total participation, not the last uninterrupted stretch.

**(c) At most one in-progress `comfort`/`assist` execution may name a given colonist as its `relatedColonistId`.** Without this, two initiators could each complete an Assist naming the same colonist and each emit `sharedTaskCompletion` for the same stretch of that colonist's time, and two comforters could each apply the D7 stress relief to the same responder in the same Phase 3.

Enforced at three points, none of which is a live cross-runtime scan:

- **Offer creation, pending side — already exists, unchanged.** `validateSocialOfferStore` enforces at most one pending offer per `responderId` (`socialOffers.ts:242–327`), and Phase 6's ascending-id double-booking guard cancels the later of two same-responder pending offers with `responderUnavailable` (`tick.ts:935–942`). Both are action-agnostic and cover Comfort/Assist with no change.
- **Offer resolution, accepted side — new.** Step 5's eligibility check declines with `responderNotInterruptible` when the responder appears in the participation basis (D12) as either a recipient or a participant-initiator. Reading the frozen basis rather than the responder's live runtime is what keeps this order-independent.
- **Load — new.** `validateSimulationState` rejects a state holding two in-progress `comfort`/`assist` executions naming the same recipient. Rejects, never dedupes (D13.3).

**Why the tick-start basis is sufficient here, proved rather than assumed.** The basis is built from tick-start state, so an execution begun in Phase 6 of tick *T* is not in tick *T*'s basis. The gap is closed by the response-delay floor: `createPendingOffer` rejects `responseDelayTicks < 1` (`socialOffers.ts:119–121`), so no offer created in Phase 5 of *T* can resolve before *T+1*. Therefore any second offer toward a colonist who acquired a comforter/assistant during *T* resolves at *T+1* or later, against a basis that already contains it. The only same-tick collision is two offers toward one responder, which the pre-existing double-booking guard cancels before either can accept.

**(d) No Assist-on-Assist chains.** Because `TASK_AMBIENT_STATE.assist = "working"` (`execution.ts:173`), a colonist executing `assist` is observed `"working"` and would otherwise be a valid Assist target — producing chains in which several colonists each emit `sharedTaskCompletion` against one underlying stretch of work. Forbidden by (c)'s participant-initiator arm: a colonist who is the initiator of an in-progress `comfort`/`assist` is not an eligible responder.

This guard lives at **offer resolution**, not at candidate generation, and that placement is deliberate. "This colonist's `"working"` is an `assist`, not real work" is not Tier-1-observable — `ObservableColonist` carries `{ id, ambientState }` and nothing else (`snapshot.ts:40–43`), and locked #21 forbids widening it with another colonist's task identity. So the initiator may legitimately *offer*, and finds out at resolution, exactly as they do for the relationship gate and the acceptance draw. Perception stays Tier-1; resolution-time eligibility reads simulation state, as it already does for the roster and double-booking checks.

## 6. D4 — Relationship compatibility gate

Both actions reuse the **existing two-sided non-hostile check** already implemented in Phase 6's eligibility step for Conversation/Shared Downtime (`isNonHostile` on both `perspective(relationships, initiatorId, responderId).state` and `perspective(relationships, responderId, initiatorId).state` — `tick.ts:968–976`). This is the codebase's actual convention — stricter than ADR-18 D4.4's literal "initiator's own relationship record," matching the same Codex-confirmed defect fix already applied to `sharedMealPartnerId` (`tick.ts:402–414`): relationship drift is directional, so a one-sided check can pass on the initiator's stale, more-favorable view. Comfort and Assist inherit this convention; introducing a one-sided gate for only these two actions would make the codebase's relationship-gate rule inconsistent across the four offer-backed actions for no specified reason.

A Hostile-or-Fractured pair, in either direction, declines immediately with `relationshipGate`, before any acceptance draw (or, under a non-rejection resolution of DQ-18.7, before auto-acceptance) — identical to Conversation/Shared Downtime's existing step 5.

**Comfort's one specified asymmetry (ADR-18 D5) is in acceptance weighting, not in the gate.** "The distressed partner's acceptance gate is widened by their own state… but a Comfort offer from a colonist the distressed party holds at Hostile/Fractured is declined by the same weighting as anything else" — the hard relationship gate is unchanged; what widens is the **acceptance-probability table** (D5), which may set Comfort's probability higher than Conversation's at the same relationship band, expressing "a Stressed colonist is more receptive to being comforted than to ordinary conversation" entirely through tuning.

## 7. D5 — Acceptance/decline semantics; DQ-18.7 remains a Human decision

### 7.1 Comfort

Comfort's acceptance draw is **mechanically identical** to Conversation/Shared Downtime's existing step 6 (`tick.ts:977–987`): one attributed `next(prng)` draw compared against a per-relationship-state probability table, modulated by the **responder's** directional perspective toward the initiator — the same responder-side-only modulation already used for the other two actions. Comfort gets its **own** `SOCIAL_OFFER_TUNING` table (`comfortAcceptanceProbability`), not a reuse of Conversation's, so D4's "widened" acceptance is expressible without disturbing Conversation/Shared Downtime's existing calibration.

### 7.2 Assist — DQ-18.7 is **not resolved by this design**

**ADR-18 DQ-18.7: does Assist require the assisted colonist's acceptance, or only non-rejection?**

This remains an **open Human decision** (Finding 1, §15). ADR-18's own framing is that "both are within D5's weighting architecture; the difference is feel," and this design has found no accepted source that settles it. Both options are specified here in enough detail to be implemented directly once the gate rules, and this design **recommends** Option A without adopting it.

**Option A — non-rejection (recommended).** Assist runs the identical steps 1–5 every offer already runs (expiry, cancellation, double-booking, hold, response-delay, eligibility — including D4's relationship gate, D2's requirement reuse, and D11.5(c)/(d)'s participation guard), then resolves directly to `"accepted"` with `reason: null`, **skipping step 6 entirely**. No PRNG draw is attributed to Assist's acceptance. In `resolveOffer` terms: a well-formed `("accepted", null)` transition reached without calling `next(prng)`.

Arguments for A: Assist's voluntariness is entirely the initiator's (ADR-18 D3 — "Assist exists only as a tier-4/5 *choice*… The voluntariness is the social content"); the responder is not being asked to change their own behavior (D11.2: their execution is untouched), so there is no responder-side commitment to weigh; and it adds zero new architecture — no acceptance table, no PRNG attribution site, no new `OfferResolutionReason` (an `"accepted"` resolution already carries `reason: null` under ADR-21 D2's existing matrix). It is also the minimal reading of "non-rejection": rejection remains fully possible through steps 1–5, but given those clear, nothing further stands between the initiator's choice and its effect.

**Option B — explicit weighted acceptance.** Assist gets its own `assistAcceptanceProbability` table and one attributed draw at step 6, exactly mirroring Comfort. Uniform mechanism across all four offer-backed actions; `acceptanceDraw` becomes a reachable decline reason for `assist`.

Argument against B, stated so the gate can weigh it: it requires a responder-side "receptiveness to being helped" signal that Stage 2 cannot compute honestly. Unlike Comfort — whose distinction is grounded in the Tier-1-observable Stressed state — an Assist target's receptiveness has no Tier-1-observable basis distinct from what D4's relationship gate already captures, so the table would have no principled reason to differ from a flat constant.

### 7.3 What changes if the gate picks B

Contained, and listed so the choice is cheap to reverse: add `assistAcceptanceProbability` to `SOCIAL_OFFER_TUNING` (DQ-1's sibling); make step 6 run for `action === "assist"`; delete the §16 test asserting `acceptanceDraw` is unreachable for Assist and replace it with the reachability test Comfort has; add one PRNG draw per resolving Assist offer to D8's draw-count statement; and note in the ADR-21 revision that `acceptanceDraw` is reachable for all four actions. **No other decision in this document changes.**

### 7.4 D11 is independent of this choice

Deliberately: D11 governs what happens **after** an Assist is accepted, and every one of its rules is keyed to the accepted execution, not to how acceptance was reached. D11.1's zero-transfer, D11.2's ownership table, D11.3's completion criterion, D11.4's single emission at the completion transition, and all four of D11.5's prevention rules read identically under A and B. The only D11 sentence that mentions the difference is D8's PRNG draw count (§11), which is already written to cover both.

## 8. D6 — Reuse of the social-offer lifecycle (ADR-21 revision required)

Comfort and Assist reuse `design/social-offer-response-protocol.md` v0.2.0's entire mechanism (its D1–D9) and `socialOffers.ts`'s storage (ADR-21) **unmodified in shape**, extended only at the places ADR-18/ADR-21 already named as extension points:

- `SocialOfferAction` widens from `"conversation" | "sharedDowntime"` to `"conversation" | "sharedDowntime" | "comfort" | "assist"` (`socialOffers.ts:18–19`).
- The target-ambient-state eligibility check generalizes from the single `isInterruptibleAmbientState` predicate to an **action-keyed** table (new, but additive — Conversation/Shared Downtime's behavior is unchanged):

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

Neither `"stressed"` nor `"working"`/`"blocked"` is in `INTERRUPTIBLE_AMBIENT_STATES` (`socialOffers.ts:82`) — reusing that predicate unmodified for Comfort/Assist would make them permanently ineligible (declining every offer with `responderNotInterruptible`), the opposite of ADR-18 D4.3's intent.

- **New in v0.2.0:** step 5 additionally declines with `responderNotInterruptible` when the responder appears in the participation basis (D12) as a recipient or a participant-initiator — D11.5(c)/(d)'s enforcement point. `responderNotInterruptible` is reused rather than adding a reason code: the union's members are already action-agnostic outcome codes, and "this responder's state does not admit this action right now" is exactly what it means.

**No other lifecycle step changes.** Expiry, both cancellation conditions, the double-booking guard, the suspension hold, the one-tick response-delay floor, ascending-`id` processing order, and bounded resolved-offer retention all apply to Comfort/Assist exactly as specified for Conversation/Shared Downtime, with no new code beyond widening the closed `action` union those functions already switch on.

**This requires a revision of ADR-21**, per that ADR's own closure discipline: "Adding a status is a revision of this ADR, not a tuning or implementation choice" (D2) applies identically to the `action` union in the same decision, and D5's load-rejection list enumerates `action outside the closed two-member union` as a rejected shape. See §14.

## 9. D7 — Need, stress, relationship, and relational-memory consequences

All of the below apply **only** to an offer that resolves to `"accepted"`. Per-tick effects are applied while the resulting execution is `"inProgress"`, in Phase 6's execution-progress loop (`tick.ts:1010–1084`) — the same loop and the same `relatedColonistId`-keyed pattern already used for Conversation/Shared Downtime. Completion-gated effects are applied at the Phase-4 completion transition (D11.4). **Declined, cancelled, and expired attempts apply none of the positive effects** — the existing unmodified rule (`declineWithFriction` for eligibility-failure/draw-decline; no interaction call at all for cancellation/expiry).

### Comfort (accepted)

| Effect | Mechanism | Timing | Direction | Source |
|---|---|---|---|---|
| Relationship | `comfortAffinityDeltaPerTick` via `applyInteraction`, `changeSource: "mutualSupportCrisis"` | Per tick, in progress | Both, positive | ADR-18 D6: "Comfort (accepted) → Mutual support… Positive, medium" |
| Social need | `comfortSocialRestorePerTick`, initiator and responder | Per tick, in progress | Both | ADR-18 D7: "Participation credits…" |
| Stress relief | New `positiveSocialProximity` relief channel in `evaluateStress` | Per tick, in Phase 3, driven by D12's basis | Responder only | ADR-18 D8: "an accepted Comfort is that relief in deliberate, directed form" |
| Purpose | None, ever | — | — | ADR-17 D6 / ADR-18 D7 distinctness constraint |

**The stress relief requires one new, narrowly-scoped input to `evaluateStress`** (`stress.ts:97–103`) and one new `StressChannelId` member, `positiveSocialProximity` (`stress.ts:31`). Decision-loop §7 names four reliefs; Stage 1/2 realized two. This is the third, and an accepted Comfort is its first concrete trigger. The input is a boolean (e.g. `isReceivingComfort`) whose value comes **exclusively from D12's immutable basis** — v0.1.0's live `runtimes` scan is withdrawn. Magnitude is deferred (DQ-3). The channel is Comfort-specific by construction (its trigger is "named as recipient by an in-progress Comfort," not "in any companionship execution"), so no existing test's stress trajectory changes.

**The responder receives a direct need/stress write without a goal or execution of their own** — mirroring Shared Meal's existing partner-write pattern (`tick.ts:1036–1058`), not the responder-side goal commitment `design/autonomous-three-colonist-runtime.md` DQ-2 leaves deferred. This design does **not** resolve DQ-2: the responder still runs their own independent decision loop, unaware at the goal-stack level that they are being comforted; only their `NeedsState`/`StressState` moves.

### Assist (accepted)

| Effect | Mechanism | Timing | Direction | Source |
|---|---|---|---|---|
| Work progress | **None** — zero transfer | — | — | D11.1 |
| Completion authority | **None** | — | — | D11.2 |
| Relationship | `assistAffinityDeltaOnCompletion` via `applyInteraction`, `changeSource: "sharedTaskCompletion"` | **Once**, at the `assist` execution's completion transition, above the participation floor | Both, positive-low-to-medium | ADR-18 D6: "Assist (accepted) → Shared task completion + cover behavior → Positive, low–medium"; D11.4 |
| Social need (initiator only) | `assistSocialRestorePerTick` | Per tick, in progress | Initiator only | ADR-18 D7: Assist "serves… the initiator's Social/relationship surfaces" — the assisted colonist's Social need is not named as credited |
| Stress | None, either party | — | — | Not named in ADR-18 D8 for Assist; no relief channel is added |
| Purpose (initiator) | None through this action | — | — | ADR-18 D7 verbatim: "the initiator's Purpose is credited only if the assisted task itself is skill-matched completed work for them, through ADR-17 D9's ordinary inputs, not through a social bonus" |
| Purpose (assisted) | None, ever | — | — | Same distinctness constraint |

The split between the completion-gated relationship credit and the per-tick Social credit is D11.4's: `sharedTaskCompletion` names a completion and is emitted once; Social-need credit is participation and accrues per tick, bounded by D11.3's completion criterion. `sharedTaskCompletion` is reused rather than introducing a new change source — ADR-18 D6 maps Assist to it explicitly, and no new source is authorized.

### Non-effects (declined, cancelled, expired) — both actions

- **No** Social-need restoration, either party.
- **No** positive relationship delta, and specifically **no** `sharedTaskCompletion` emission — a declined, cancelled, expired, interrupted, or aborted Assist never reaches D11.4's transition.
- Declines apply the existing `forcedProximityMutualStress` friction (`declineAffinityDelta`, both directions, `tick.ts:901–917`) exactly as Conversation/Shared Downtime's declines do. No new decline magnitude unless the Human gate directs otherwise (Finding 3).
- **No** stress relief (Comfort) and no stress change of any kind (Assist).
- **No** memory formation beyond what ADR-16's existing significance criteria form from the relationship/stress movement actually applied — a decline with zero relationship and zero stress movement forms nothing, exactly as today.

## 10. D12 — The immutable social-participation basis

*(New in v0.2.0 — resolves Codex blocker 2. Replaces v0.1.0 §8's live `runtimes` lookup in Phase 3.)*

### 10.1 What v0.1.0 got wrong

v0.1.0 specified that Phase 3 would determine whether a colonist is being comforted "via `runtimes` lookup against the initiator's `execution.taskId === 'comfort'` and `currentGoal.relatedColonistId === thisColonistId`." That is a live cross-runtime read performed **inside** the per-colonist Phase 3 loop, and it is unsafe for a specific reason: Phase 3 writes each colonist's `StressState` as it goes (`tick.ts:590–600`), and stress is an input to `ambientStateFor` and to any downstream derivation of "who is doing what." A colonist's Phase 3 result would then depend on how many colonists preceded them in the loop — precisely the same-tick observability the shared-observation-basis discipline (`design/autonomous-three-colonist-runtime.md` D3, `tick.ts:687–698`) exists to prevent. It would also be the first live cross-runtime read in the codebase's per-colonist continuous-state phase.

### 10.2 The basis

A single immutable value, `SocialParticipationBasis`, built **once per tick, before Phase 3's per-colonist loop begins**, and never rebuilt.

```text
interface SocialParticipationBasis {
  readonly comfortRecipients: ReadonlyMap<ColonistId, ColonistId>;  // responder id -> comforter id
  readonly assistRecipients:  ReadonlyMap<ColonistId, ColonistId>;  // assisted id  -> assistant id
  readonly participants:      ReadonlySet<ColonistId>;              // every initiator of an in-progress comfort/assist
}
```

**Fixed inputs — the complete list.** Built from `state.colonists` (the tick-start runtime collection, ADR-22 D3's canonical order) and nothing else. Per runtime `r`, exactly these five fields are read:

1. `r.colonist.identity.id`
2. `r.execution?.taskId`
3. `r.execution?.status`
4. `r.colonist.currentGoal?.status`, `?.relatedSocialTaskId`, `?.relatedColonistId`, `?.key`
5. `r.execution?.goalKey`

It reads **no** world state, **no** clock, **no** policy, **no** relationship store, **no** offer store, **no** PRNG, and **not** the mutable `runtimes` working map. It is a pure function of `readonly ColonistRuntime[]`, callable and testable in complete isolation.

**Derivation rule (total, pure, order-independent).** `r` is a *participant-initiator* iff:

```text
r.execution !== null
  && r.execution.status === "inProgress"
  && (r.execution.taskId === "comfort" || r.execution.taskId === "assist")
```

Its *recipient* is `r.colonist.currentGoal.relatedColonistId`, contributed to the corresponding map only if **all** of the following hold; otherwise the entry contributes a participant but **no** recipient:

```text
r.colonist.currentGoal !== null
  && r.colonist.currentGoal.status === "active"
  && r.colonist.currentGoal.relatedSocialTaskId === r.execution.taskId
  && r.colonist.currentGoal.key === r.execution.goalKey
  && r.colonist.currentGoal.relatedColonistId !== undefined
  && r.colonist.currentGoal.relatedColonistId !== r.colonist.identity.id
```

**Fail-closed** — a mismatched or missing goal yields no relief and no guard entry, never a guessed pairing. This mirrors the accepted behavior pinned by "a companionship task without relatedColonistId fails safely with no social consequence" (`tick.test.ts:278–284`).

**Tie-break.** If two initiators name the same recipient, the entry with the **lowest canonical colonist id** wins. D11.5(c) makes this unreachable at runtime and `validateSimulationState` rejects a loaded state that contains it (D13.3), so the rule exists solely to keep the builder a total function with one defined answer — testable directly, never observed in a real run.

**Immutability.** Frozen at construction. Nothing in Phases 3–7 writes to it, and no phase rebuilds it. It is passed by value to the readers below.

### 10.3 Readers, and what each is allowed to do

| Phase | Reader | Access | Purpose |
|---|---|---|---|
| 3 | Per-colonist continuous-state loop | `basis.comfortRecipients.get(id)` — keyed lookup for **this colonist only** | Supplies `evaluateStress`'s new `isReceivingComfort` input (D7) |
| 6 | Offer lifecycle step 5 | `basis.participants.has(responderId)`, `basis.comfortRecipients.has(...)`, `basis.assistRecipients.has(...)` | D11.5(c)/(d)'s eligibility guard (D6) |

**Explicitly forbidden inside the Phase 3 loop**, and pinned by review and by the tests below: any `runtimes.get(otherId)`, any iteration over `runtimes`, and any read of another colonist's execution, goal, needs, or stress. The loop's only cross-colonist input is the frozen basis, whose contents were fixed before the loop's first iteration.

**Candidate generation does not read the basis.** Perception stays Tier-1-only (`ObservableColonist` is `{ id, ambientState }`, `snapshot.ts:40–43`; locked #21). An initiator may offer to a colonist who already has a comforter or assistant and learns otherwise at resolution — the same shape as the relationship gate and the acceptance draw.

### 10.4 The one-tick lag, stated rather than hidden

Because the basis is tick-start, a Comfort accepted in Phase 6 of tick *T* first appears in the basis at *T+1*, so the responder's first relief tick is *T+1*'s Phase 3, not *T*'s. This is the same discipline Phase 4's completion detection already follows and documents (`tick.ts:653–657`: "a task whose completion depends on THIS tick's own progress is detected on the FOLLOWING tick — the literal fixed seven-phase order, not collapsed for same-tick convenience"). It is specified, tested (§16), and not to be "fixed" by rebuilding the basis mid-tick.

The same lag is what makes D11.5(c)'s guard sound, and §5.5 proves the gap it leaves is closed by the ≥1-tick response-delay floor.

## 11. D8 — Phase placement, deterministic ordering, PRNG attribution

**No change to the seven-phase order, no change to the PRNG architecture.** Comfort and Assist plug into the phase slots `design/social-offer-response-protocol.md` D3 and `design/autonomous-three-colonist-runtime.md` D2 already fixed:

- **Before Phase 3:** D12's participation basis is built, once. No colonist state is read or written beyond the pure derivation above.
- **Phase 3:** the per-colonist loop gains one keyed basis lookup feeding `evaluateStress`'s new input (D7/D12). No cross-runtime read.
- **Phase 4:** the existing completion branch gains D11.4's single `sharedTaskCompletion` emission for a completing `assist` execution, and D11.3's widened `isTaskComplete` rows make `comfort`/`assist` completable at all.
- **Phase 5:** a committed `voluntary` goal with `relatedSocialTaskId` of `"comfort"`/`"assist"` creates a pending offer instead of beginning execution, via the same `createPendingOffer` call already used for the other two actions — the conditional at `tick.ts:806–810` widens to four members, with no other change to that branch.
- **Phase 6, offer lifecycle pass:** processed in the same ascending-`id` loop, same steps, interleaved with Conversation/Shared Downtime offers in one shared array — there is no separate Comfort/Assist pass, because `SocialOfferStore.offers` is a single append-ordered array regardless of `action`. Step 5 gains D11.5's basis guard.
- **Phase 6, execution-progress pass:** Comfort's per-tick affinity and both parties' Social credit, and Assist's initiator-side Social credit, join the existing `relatedColonistId`-keyed pattern (`tick.ts:1060–1081`). The atrophy exclusion predicate widens per D11.4.

**PRNG.** Comfort's acceptance draw consumes exactly one `next(prng)` call per resolving Comfort offer, in the same position in the fixed iteration Conversation/Shared Downtime's draws already occupy (offer resolution order = ascending `id` = creation order = canonical colonist iteration order within Phase 5). Assist consumes **zero** draws under DQ-18.7's Option A and exactly one under Option B (§7.3). Either way, draw consumption remains a pure function of already-recorded state — which offers exist, their fields, and the shared relationship/observation state — so replay determinism is unaffected. Differential draw counts by action are already true today in a smaller way: an offer failing the eligibility or relationship gate before step 6 also consumes zero draws.

**D12's basis introduces no PRNG use, no ordering dependence, and no new iteration.** It is built by one pass over `state.colonists` in canonical order and produces an order-independent value (§16 pins this).

No new re-decision trigger kind, no new phase, no new PRNG stream, no change to canonical colonist iteration order.

## 12. D9 — Replay, event-log, and inspector impact

- **Replay:** no change. `socialOffers` and `colonists` are already in `replay.ts`'s `STATE_FIELDS`, diffed generically; a divergence in a Comfort/Assist-derived field (an offer's `action`, a colonist's `needs.social`, `stress`, or a relationship pair's affinity) is covered by the existing field-by-field comparison with no new logic. D12's basis is derived state, never persisted, so it is not a replay field — it is reconstructed identically from the same tick-start inputs on every run, which is exactly what makes it replay-safe.
- **Event log:** no new `TickEvent` variant. `socialOfferCreated`/`socialOfferResolved`/`stressEvaluated`/`memoryFormed` already carry `action: SocialOfferAction` and generic contribution/reason fields. Comfort's stress relief surfaces through the **existing** `stressEvaluated` event as one more named `StressContribution` entry (`positiveSocialProximity`), which is what its `contributions` array exists for. Assist's single `sharedTaskCompletion` emission surfaces through the existing `completion` event plus the relationship consequence stream, exactly as Shared Meal's credit does today.
- **Inspector:** no new surface. `inspect()`'s per-colonist summary (needs, stress with source breakdown, current goal, relationship perspectives) and the detached `socialOffers` list already expose everything: a Comfort-in-progress is visible as the initiator's `currentGoal.relatedColonistId`/`relatedSocialTaskId`, the initiator's `execution.taskId === "comfort"`, the responder's stress with the new relief channel decomposed, and the offer's own record.

Save/load is D13.

## 13. D13 — Save-format version bump and compatibility behavior

*(New in v0.2.0 — resolves Codex blocker 3. Replaces v0.1.0 §10's "no save-version bump" bullet, which was wrong on both the count of affected unions and the conclusion.)*

### 13.1 Four persisted closed unions widen, not one

v0.1.0 identified only `SocialOfferAction`. Reading `serialization.ts` end to end shows four persisted validation sites:

| # | Site | Today | Widens to | Persisted in |
|---|---|---|---|---|
| 1 | `SocialOfferAction` / `SOCIAL_OFFER_ACTIONS` — `socialOffers.ts:18–19` | 2 members | 4 | `socialOffers.offers[].action` |
| 2 | `Goal.relatedSocialTaskId` — `serialization.ts:245–248` | `["conversation","sharedDowntime"]` | + `"comfort"`, `"assist"` | `colonists[].colonist.currentGoal`, `.suspendedGoal`; `decisionLog[].outcome`'s goal |
| 3 | `socialOfferCreated.action` — `serialization.ts:587` | `["conversation","sharedDowntime"]` | + `"comfort"`, `"assist"` | `eventLog[].event` |
| 4 | `StressChannelId` — `stress.ts:31`, mirrored `serialization.ts:66–72` | 5 members | + `"positiveSocialProximity"` (D7) | `eventLog[].event.contributions[].id` for `stressEvaluated` |

Sites 2–4 were entirely unaccounted for in v0.1.0. Site 4 in particular is a direct consequence of D7's new relief channel, which v0.1.0 asserted needed "no save-version bump" while also adding a channel id that every persisted `stressEvaluated` event validates against.

### 13.2 Decision: bump `SAVE_FORMAT_VERSION` from 6 to 7

`serialization.ts:43–44` today:

```text
/** The current save format version — bump on any incompatible SimulationState shape change. */
export const SAVE_FORMAT_VERSION = 6; // v6: Stage 2 Slice 6b — activeColonistId ... is retired ...
```

becomes `7`, with a `// v7: Stage 2 Slice 7 — Comfort/Assist widen the persisted action, social-task, and stress-channel unions (design/comfort-assist-protocol.md D13).` comment, matching the existing convention.

**Why bump when no field is added or removed.** The save format's compatibility contract is *the set of documents the loader accepts*, and all four sites change it. The version integer is the format's only compatibility signal — there is no capability negotiation, no feature flags, no per-field versioning — and `deserialize` is reject-only. Without a bump, a v6-labelled save written by the new build and containing `action: "comfort"` handed to an older build fails deep inside field validation with `Invalid save data: "socialOffers.offers[0].action" must be one of ...`, which tells the operator "your save is corrupt" when the truth is "your build is older than your save." Bumping converts a misleading data-corruption message into the format's designed, single, diagnosable failure at the version gate.

### 13.3 Compatibility behavior — all three cases, explicit

**Case 1 — new build (v7) loading an old save (v6): rejected.** `deserialize` throws `Unsupported save format version: 6 (expected 7)` at `serialization.ts:704–707`, before any field is read. **No migration, no upgrade path, no repair, no partial load.** v6 saves are not readable by the new build and are not converted. This is the posture every prior bump took, and this design adds no migration framework.

This is deliberate even though the widened unions are strictly **additive**, so a v6 document would in fact satisfy every v7 field rule. Accepting it anyway would make this the first exception to reject-only loading (`serialization.ts:3–5`: "No migration framework beyond outright version rejection") and would create an implicit two-version compatibility contract that nothing in the codebase is set up to maintain or test. **If the Human gate prefers subset acceptance, that is a serialization-architecture decision needing its own ADR — recorded as Finding 5 (§15), not decided here.**

**Case 2 — old build (v6) encountering a new save (v7): rejected symmetrically.** `Unsupported save format version: 7 (expected 6)`, from the same gate. This requires no change to the old build; the bump is what makes the version mismatch the *first* thing it reports rather than a downstream field error. Nothing in a v7 save is partially consumed by a v6 build.

**Case 3 — validate-never-repair within v7: unchanged and reinforced.** Every widened union stays a closed list checked by `expectOneOf` or `SOCIAL_OFFER_ACTIONS` membership. A value outside the four-member `action` list, outside the widened `relatedSocialTaskId` list, or outside the widened `StressChannelId` list **throws**. It is never coerced to a default, never dropped from its array, never renumbered, never repaired — `socialOffers.ts`'s stated discipline ("throws on every malformed shape, never sorts/clamps/renumbers/drops") applies verbatim to the widened lists. Widening changes *what is valid*; it changes nothing about *what happens to the invalid*.

Two additions in the same posture:

- `validateSimulationState` gains D11.5(c)'s invariant — at most one in-progress `comfort`/`assist` execution naming a given recipient — as a **rejection**. A save holding two comforters for one colonist is rejected, never deduplicated, never silently resolved by D12's tie-break.
- A v7 save whose `stressEvaluated` contributions carry `positiveSocialProximity` is valid; one carrying any unlisted channel id is rejected, exactly as today.

### 13.4 Where the bump is recorded

In the ADR-21 revision (§14), because ADR-21 D5 owns the offer store's load rules and site 1. Sites 2–4 live in `serialization.ts`'s own mirrored lists and `stress.ts`, which no ADR owns exclusively; the revision records the version bump and its rationale once, and this design document governs the three non-ADR-21 sites directly — the same division ADR-22 D6 used when recording save-v5's implications without ADR-20/ADR-21 needing their own revisions.

## 14. D10 — ADR determination

**An ADR revision is required before implementation — a revision of ADR-21, not a new ADR.**

Per `ai-studio/workflows/kanban-update-protocol.md`'s Architecture Review Required table, this design's triggers are **Data model** and **Serialization**: widening `SocialOfferAction` (ADR-21 D2), the action-keyed target-state eligibility rule, and D13's save-version bump. Every other decision (D1–D3, D11, D5's two options, D7's consequence wiring, D8's phase placement, D12's basis) instantiates already-Accepted architecture (ADR-17, ADR-18, ADR-20, ADR-22, and the un-revised parts of ADR-21) and is governed by this design document and those ADRs directly — exactly as `design/social-offer-response-protocol.md` D3–D7 and `design/autonomous-three-colonist-runtime.md` D2–D6 were governed by design documents alone once their own ADR gates were satisfied.

**Why a revision, not a new ADR:** ADR-21 already owns the entire "what shape is a social offer, what closed unions does it carry, how is it validated" surface. `SocialOfferAction` is ADR-21's own D2 decision, and D2 states explicitly that adding to its closed vocabulary "is a revision of this ADR, not a tuning or implementation choice." A new ADR would duplicate authority over a store whose shape is otherwise unchanged — no new field, no new record type, no new status, no new reason code (D6/D9).

**The revision's scope, precisely:**

1. Widen `SocialOfferAction` / `SOCIAL_OFFER_ACTIONS` (ADR-21 D2) from two members to the four-member closed union including `"comfort"` and `"assist"`.
2. Record that `responderNotInterruptible` now denotes "the responder's state does not admit this specific action right now" generically — covering both the action-keyed ambient-state table (D6) and D11.5's participation guard — rather than only "not in `INTERRUPTIBLE_AMBIENT_STATES`". A wording clarification, not a new reason code.
3. Record **D13's `SAVE_FORMAT_VERSION` 6 → 7 bump**, its rationale, and its three compatibility cases, under ADR-21 D5's load-rules ownership.
4. Record that, if the Human gate resolves DQ-18.7 as Option A, `"accepted"` may be reached for an `"assist"` offer without a PRNG draw — a clarification of D2's existing rule (`accepted` → `resolvedAtTick` number, `reason` null), not a new validity-matrix row. A loaded `"accepted"` `"assist"` offer is indistinguishable in shape from a loaded `"accepted"` `"conversation"` offer, by design. **This item is contingent on Finding 1 and cannot be drafted before the gate rules.**
5. Carry the Decision Log entries for D4, D11, D12, and D13 into ADR-21's own Decision Log where they bear on the offer store.

**No revision of ADR-17, ADR-18, ADR-20, or ADR-22 is required.** ADR-18 fully authorizes Comfort/Assist's behavioral vocabulary (D1, D3, D4, D5, D6, D7, D8); this design instantiates it and adds nothing it did not name. **No new stress-system ADR is required**: the `positiveSocialProximity` channel is a value-level addition within M7's already-Accepted ownership of "the four reliefs" (decision-loop §7) — Stage 2 realizing a relief the frozen design already enumerated, not a new stress architecture. **No ADR authorizes a work-progress model, which is exactly why D11.1 declines to invent one.**

**Sequencing:** this design document → Codex re-review → Human design approval **including Findings 1, 2, and 5** → the ADR-21 revision drafted from D6/D13/D10 → the revision's own architecture review and Human acceptance → only then does Cursor implementation begin. Implementation touching `socialOffers.ts`'s closed unions, `stress.ts`'s `evaluateStress` signature, `tasks.ts`'s `isTaskComplete`, or `serialization.ts`'s version and mirrored lists is blocked until the revision is Accepted.

---

## 15. Findings and ambiguities requiring Human decision

Items this design could not resolve by tracing to an existing accepted source, or where more than one traceable resolution exists.

**1. DQ-18.7's resolution (§7) — unresolved, and the most consequential open call.** Does Assist require the assisted colonist's acceptance, or only non-rejection? This design specifies both options fully and **recommends Option A (non-rejection)** without adopting it. **Requires an explicit Human ruling before the ADR-21 revision is drafted**, since revision item 4 and the presence of an `assistAcceptanceProbability` table both depend on it. §7.3 lists everything that changes if the gate picks B (five bounded items); §7.4 confirms D11 is unaffected either way.

**2. Assist's target set collapses to `"blocked"` at Stage 2 — now a proof, not a caveat.** v0.1.0 flagged the free-period gate as "narrowing practical reachability." Grounding D11 turned that into a hard result:

1. `generateVoluntaryCandidates` returns `[]` unless `currentPeriod === "free"` (`goals.ts:121`).
2. `currentPeriod` is colony-global — `periodAt(policy, tickOfDay(clock))` (`snapshot.ts:82`). There is no per-colonist shift.
3. `isTaskComplete("workAtWorkstation")` is `currentPeriod !== "work"` (`tasks.ts:240–241`), evaluated in Phase 4 (`tick.ts:665`) **before** the shared observation basis is built (`tick.ts:695`).
4. So on every tick where `currentPeriod === "free"`, every in-progress `workAtWorkstation` has already been completed in that same tick's Phase 4.
5. `ambientStateFor` returns `"blocked"` when there is no in-progress execution (`execution.ts:188`).
6. Therefore, in the only period an Assist candidate can be generated, **no colonist can be observed `"working"` on account of real work.** `"working"` is reachable only from an `assist` execution (`execution.ts:173`), which D11.5(d) forbids as a target.
7. And a shift-boundary re-decision (`tick.ts:558–560`, `577`) interrupts any tier-5 goal at the free→work boundary, since tier 3 outranks tier 5 — so an Assist execution cannot span into the work period either.

**Conclusion: Assist is reachable, but only toward a colonist who is `"blocked"` — i.e. has no in-progress execution at all. Assist can never, at Stage 2, be offered toward observable work.** This is consistent with D11.1 (there is no work effect to have) but it means ADR-18's `Working` half of Assist's target set is currently unreachable vocabulary.

Options for the gate, with this design's recommendation first:

- **(a) Recommended — keep the ADR-18-faithful `{working, blocked}` table, document `"working"` as provably unreachable at Stage 2, and pin the proof with a test.** Assist ships as a Stage-2 support gesture toward an idle-or-blocked colleague with zero work effect. When per-colonist or staggered shifts arrive, Assist becomes reachable toward real work with no rule change. Matches how the codebase already handles named-inert data (`TASK_AMBIENT_STATE`'s unreachable rows, `execution.ts:165–168`).
- **(b) Narrow Assist's eligible target set to `"blocked"` only** and rename its semantics accordingly. More honest about today, but diverges from ADR-18 D4.3's text and would need re-widening later.
- **(c) Ship Comfort alone in Slice 7** (Comfort is fully reachable — §2) and defer Assist to the slice that introduces staggered shifts.

**3. Decline-friction magnitude.** Should Comfort/Assist declines reuse `declineAffinityDelta` (`tuning.ts:163`) or get their own constant? This design defaults to reuse (§9) for minimal surface; ADR-18 D6 specifies no per-action decline magnitude, so reuse is the traceable default. A reviewer may want Support-category declines tuned separately from Companionship-category ones.

**4. Comfort's stress relief: responder only, or a smaller relief for the initiator too?** ADR-18 D8 names the recipient's relief explicitly and is silent on the comforter's. This design grants none to the initiator (§9). Extending it generically to "whoever is present in a Companionship/Support execution" would be larger and more symmetric, and would raise retrofitting Conversation/Shared Downtime — explicitly out of scope per Issue #151's "no existing regression."

**5. NEW — should a v7 build accept additive-subset v6 saves?** D13.3 Case 1 rejects them, preserving reject-only loading. Because this slice's union widenings are strictly additive, subset acceptance would be technically safe *here* — but adopting it would establish a multi-version compatibility contract as a general precedent, which is a serialization-architecture decision beyond this design's authority. Flagged so the gate can rule; if it wants subset acceptance, that is its own ADR and this design's D13 stands unchanged in the meantime.

## 16. Test matrix

Grouped by decision. Every row is a regression-class addition; none removes or weakens an existing test.

**Candidate generation (D1–D3)**
- Comfort candidate generated only for a nearby colonist observed `"stressed"`; absent for every other ambient state.
- Assist candidate generated only for `"working"`/`"blocked"`; absent otherwise, and absent when the initiator fails `checkEligibility`/`checkAvailability` against `workAtWorkstation`.
- Neither candidate is generated outside `currentPeriod === "free"`.
- No candidate with `source !== "voluntary"` ever carries `relatedSocialTaskId === "assist"` (property test over `generateCandidates`'s output for every source).
- `candidateTaskIdsFor("shiftAssignment", ...)` returns exactly `["workAtWorkstation"]` (regression pin, D3).
- **Finding 2's reachability proof, pinned:** in a full multi-colonist run, no colonist is ever observed `"working"` in the shared observation basis on a tick where `currentPeriod === "free"` — asserted directly against `ambientStateFor` outputs, so the day per-colonist shifts land, this test fails and forces the reachability statement to be revisited deliberately.

**Assist's work effect, completion ownership, emission (D11)**
- **Zero progress transfer:** across an accepted Assist's whole lifetime, the assisted colonist's `execution` is identical to a no-Assist control run in `taskId`, `goalKey`, `status`, `startedAtTick`, and completion tick — differing only by its own `elapsedTicks` advance.
- **No completion authority:** the assisted colonist's `workAtWorkstation` completes on exactly the same tick with and without an accepted Assist; Assist never writes the assisted colonist's `execution` slot.
- **Bounded execution (D11.3):** `isTaskComplete("comfort", …)` and `isTaskComplete("assist", …)` are `false` in a free-period snapshot and `true` in work- and rest-period snapshots — mirroring the existing Conversation/Shared Downtime assertions (`tasks.test.ts:204–209`). An accepted Comfort and an accepted Assist each terminate at the free-period boundary in a full run, with bounded total consequence.
- **Single emission (D11.4):** exactly one `sharedTaskCompletion` relationship write per accepted Assist across its entire lifetime, at the completion tick — asserted by counting relationship consequences with that change source, not by sampling one tick.
- **Participation floor:** an Assist accepted fewer than `assistMinimumParticipationTicks` before the period boundary completes normally and emits **zero** `sharedTaskCompletion` writes.
- **No emission on non-completion:** an Assist that is declined, cancelled, expired, interrupted-and-never-resumed, or aborted emits zero `sharedTaskCompletion` writes.
- **No re-emission on resume:** an Assist interrupted and later resumed emits exactly one write at its eventual completion, and its participation floor is measured against total `elapsedTicks` across the interruption.
- **No double completion:** `completeExecution` on an already-completed execution throws (existing `transition` guard) — pinned as the structural reason (b) holds.
- **One assist/comfort per recipient (D11.5(c)):** with three colonists, two simultaneous offers toward the same responder resolve to exactly one acceptance; the second declines with `responderNotInterruptible` (or cancels with `responderUnavailable` via the pre-existing double-booking guard when both are pending in the same tick).
- **No Assist-on-Assist (D11.5(d)):** an offer whose responder is the initiator of an in-progress `assist` declines with `responderNotInterruptible`; no chain of two Assists over one work stretch is reachable.
- **Atrophy exclusion widened (D11.4):** an actively-comforting and an actively-assisting pair are both excluded from `applyAtrophy` for every tick their execution is in progress — a direct regression pin against the `companionshipAffinityDeltaPerTick(taskId) > 0` predicate silently dropping them.

**Eligibility and relationship gate (D2/D4/D6)**
- Assist offer resolution re-checks `workAtWorkstation` eligibility/availability at Phase 6 (a target whose module became non-functional between generation and resolution declines, not a silent success).
- Comfort/Assist both decline with `relationshipGate` for a Hostile-or-Fractured pair in either direction, before any draw or auto-accept.
- `isEligibleTargetState` returns `true` for Comfort exactly on `"stressed"`, for Assist exactly on `"working"`/`"blocked"`, and reproduces `isInterruptibleAmbientState`'s existing table unchanged for Conversation/Shared Downtime.

**Acceptance/decline semantics (D5)** — as specified for the recommended Option A; §7.3 lists the substitutions if the gate picks B.
- Comfort: an accepted draw and a declined (`acceptanceDraw`) draw are both reachable and attributed — exactly one `next(prng)` call per resolving Comfort offer, decomposable in the event trace.
- Assist: an eligible, non-hostile, non-expired, non-cancelled, guard-clear offer **always** resolves to `"accepted"` with **zero** PRNG draws consumed — a determinism-class test: two runs differing only in seed produce identical Assist outcomes whenever their eligibility/relationship/timing facts agree.
- Assist never reaches `declined` via `acceptanceDraw` (explicit negative test).

**Participation basis (D12)**
- **Order independence:** permuting `state.colonists` produces an identical basis (same entry set, same tie-break outcome).
- **Tick-start purity:** the basis computed from `state.colonists` equals the basis computed from a deep copy taken before Phase 3 — i.e. it depends on nothing any phase mutates.
- **No cross-runtime read in Phase 3:** colonist X's Phase 3 stress result is bit-identical regardless of any mutation Phase 3 applies to any colonist W ≠ X — the property v0.1.0's live scan would have broken. Realized as a permutation test over canonical order plus a directly-seeded divergence in W's tick-start stress.
- **Fail-closed derivation:** an in-progress `comfort` execution whose `currentGoal` is absent, non-active, mismatched in `relatedSocialTaskId`, mismatched in `key`, self-referential, or missing `relatedColonistId` contributes a participant and **no** recipient — no relief applied, no guard entry, no throw.
- **Tie-break totality:** a hand-constructed runtime collection with two comforters naming one recipient yields the lowest-id comforter, and `validateSimulationState` rejects that same collection as a loaded state.
- **One-tick lag:** a Comfort accepted in Phase 6 of tick *T* produces the responder's first `positiveSocialProximity` contribution in tick *T+1*, and none in *T*.

**Consequences (D7)**
- Accepted Comfort: both directions gain affinity via `mutualSupportCrisis`; both parties' Social need is restored; the responder's stress shows a separately-attributed `positiveSocialProximity` relief in `stressEvaluated`; the initiator's stress is unaffected by this channel.
- Accepted Assist: both directions gain affinity via `sharedTaskCompletion` **once**; only the initiator's Social need is restored; neither party's stress changes; neither party's Purpose changes.
- Declined/cancelled/expired Comfort and Assist: zero Social-need change, zero stress change, zero Purpose change; declines apply exactly the existing `forcedProximityMutualStress` friction and nothing else.
- Property test: no code path this design adds ever writes a Purpose-related field.

**Save/load, version, compatibility (D13)**
- `SAVE_FORMAT_VERSION === 7`.
- A v6 save is rejected by a v7 build with `Unsupported save format version: 6 (expected 7)` — the version gate, not a field error — and **no** partial state is constructed.
- A v7 save round-trips a state holding a pending Comfort offer mid-delay, an accepted Assist offer, and a declined Comfort offer, each bit-identical.
- Load rejects an `action` outside the four-member union; a `relatedSocialTaskId` outside the widened union; a `stressEvaluated` contribution id outside the widened `StressChannelId` list — each with a throw, and in each case the loader constructs no state (validate-never-repair).
- `validateSimulationState` rejects a state with two in-progress `comfort`/`assist` executions naming the same recipient — rejects, does not deduplicate.
- A v7 save containing `positiveSocialProximity` contributions loads cleanly.

**Determinism, phase order, replay (D8/D9)**
- A fixed-seed multi-colonist run including at least one accepted Comfort and one accepted Assist reproduces an identical event/decision trace on replay (extends the Slice 6b/6c replay-verification tests).
- Reordering two colonists' ids in the collection does not change a third colonist's Comfort/Assist candidate set or eligibility outcome (extends the existing non-observability regression test).

**Regression (Issue #151's Shared Requirements)**
- Full existing Conversation, Shared Downtime, Shared Meal, and Slice 6c multi-colonist offer suites remain green, unmodified in their assertions. In particular, `conversation`/`sharedDowntime` per-tick affinity and Social credit are unchanged by D11.4's completion-gated Assist credit, and no existing stress trajectory moves.

## 17. Required validation commands

Repository-defined, verified present:

```powershell
npm --prefix prototype test
npm exec --prefix prototype -- tsc --noEmit -p prototype/tsconfig.json
node tools/ai-workflow/validate-workflow-pack.mjs .
node --test tools/ai-workflow/validate-workflow-pack.test.mjs
git diff --check
```

v0.1.0 also listed `node --test tools/ai-workflow/validate-workflow-record.test.mjs`; **that file does not exist** in this repository (`tools/ai-workflow/` contains exactly `validate-workflow-pack.mjs` and `validate-workflow-pack.test.mjs`) and the line is removed.

Workflow-pack validation applies once the ADR-21 revision is drafted; targeted Vitest runs during TDD do not replace the full `npm --prefix prototype test` suite before review.

---

## 18. Options Considered

| Option | Summary | Rejected because |
|---|---|---|
| A second, Comfort/Assist-specific offer store or record shape | Keeps Conversation/Shared Downtime's store untouched | Duplicates ADR-21's mechanism for two actions needing no different shape — the closed `action` union extension point exists precisely to avoid this |
| Skip the offer/response protocol entirely (direct same-tick resolution) | Simpler — no response delay, no draw | Reopens the unreachable-pending-state defect `design/social-offer-response-protocol.md` v0.1.0 was rejected for; contradicts ADR-18 D5's "no colonist is commanded into an interaction" for Comfort. It would also break D11.5's proof, which depends on the ≥1-tick response-delay floor |
| Give the responder of an accepted Comfort their own goal/execution (resolve DQ-2 now) | Symmetric with the initiator | Explicitly out of scope — `design/autonomous-three-colonist-runtime.md` DQ-2 is deferred to its own Human-gated follow-up; the direct-write pattern delivers the required consequences without it |
| **Invent a work-progress/workload quantity so Assist can transfer some of it** | Would make "cover behavior" literal and give Assist a measurable work effect | **A new M12 data-model decision no ADR authorizes.** It would change `workAtWorkstation`'s completion semantics for the solo case (violating Issue #151's no-regression requirement) and add a persisted field to `Execution`. D11.1 declines it; a future slice that adds a work-output model inherits D11.2's ownership invariant |
| **Emit `sharedTaskCompletion` per tick of Assist progress (v0.1.0's rule)** | Mirrors Conversation's per-tick companionship credit | Asserts a completion that has not happened, once per tick, and — combined with v0.1.0's missing completion criterion — without bound. `sharedTaskCompletion` names a completion; D11.4 emits it at one |
| **Leave `isTaskComplete("comfort"/"assist")` at `false` (v0.1.0)** | No change to `tasks.ts` | Produces executions that never terminate and consequences that never stop. Corrected in D11.3 |
| **Derive Comfort participation by scanning `runtimes` inside Phase 3 (v0.1.0)** | No new structure | Order-dependent: Phase 3 writes stress as it iterates, so a colonist's result would depend on their position in the loop. Replaced by D12's pre-Phase-3 immutable basis |
| Build the participation basis after Phase 4, reusing the shared observation basis's slot | Same tick's acceptances would be visible sooner | The Comfort relief is consumed in Phase 3, which runs *before* Phase 4 — a Phase-4 basis is unavailable when it is needed. Building it pre-Phase-3 costs one tick of latency (D12.4) and buys a single, provably fixed input |
| Enforce the one-comforter/one-assistant guard at candidate generation | Prevents the offer from ever being made | Requires exposing another colonist's task identity through `ObservableColonist`, violating locked #21's Tier-1-only perception boundary. Enforced at resolution instead (D11.5(d)) |
| **No save-version bump (v0.1.0)** | Existing saves keep loading | Wrong on the facts — four persisted unions widen, not one — and produces a misleading corrupt-save error when an old build meets a new save. D13 bumps to 7 |
| Add a migration path from v6 to v7 | Old saves keep working | No migration framework exists (`serialization.ts:3–5`) and this slice is not the place to introduce one; reject-only is the accepted architecture. Subset acceptance is raised as Finding 5 rather than adopted |
| Explicit weighted acceptance for Assist | Uniform mechanism across all four actions | Not rejected — carried as DQ-18.7 Option B (§7.2) for the Human gate |
| Reuse `isInterruptibleAmbientState` unmodified for Comfort/Assist | No new eligibility function | Contradicts ADR-18 D4.3 — `"stressed"`, `"working"`, `"blocked"` are never in that list, so both actions would decline every offer |
| A generic relief for all Companionship/Support executions | Fuller realization of decision-loop §7 | Retunes Conversation/Shared Downtime's calibrated behavior — out of scope; Finding 4 |

## 19. Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| Comfort/Assist generated as tier-5 voluntary candidates, free-period-gated, identically to Conversation/Shared Downtime | Matches ADR-18 D3/D4.1; zero new candidate-generation architecture | A tier-4 Social-need-driven path for Comfort (unauthorized — Social's tier-4 goal has no serving task) |
| **`"working"`/`"blocked"` correctly characterized: `"blocked"` is the absence of an in-progress execution, `"working"` also covers `assist`** *(v0.2.0 correction)* | `ambientStateFor` (`execution.ts:186–190`) read directly; v0.1.0's "these mean `workAtWorkstation`" was false and two decisions rested on it | Keeping v0.1.0's inference (would have hidden both Finding 2's reachability result and the Assist-on-Assist chain) |
| Assist eligibility reuses `checkEligibility`/`checkAvailability` against `workAtWorkstation`, justified by Stage 2's single-work-task vocabulary rather than by ambient-state inference | ADR-18 D4.3 requires checking the *assisted* task's requirements; `TASKS` makes the target task a closed fact | A `requiredSkill` on the `assist` definition itself (checks the wrong task); inferring the task from ambient state (unsound — see above) |
| Assist reachable only from `source === "voluntary"`; invariant pinned by test; policy-assigned collaboration explicitly out of scope | Issue #151 Scope-In; presently vacuous but must stand as a guard for future slices | No explicit guard (relies on absence-of-mechanism, which a future slice could silently violate) |
| **D11.1 — Assist transfers zero work progress, as a derived result** *(new)* | `Execution` has no progress quantity, `progressExecution` only advances `elapsedTicks`, and `applyProgressConsequences("workAtWorkstation")` returns `{}`. There is nothing to share | Inventing a workload model (unauthorized M12 data-model change; would alter solo `workAtWorkstation` semantics) |
| **D11.2 — completion ownership is exclusive; Assist writes no other colonist's `execution`** *(new)* | Removes double-completion at the root: two executions, two owners, two independent Phase-4 completions | Letting Assist accelerate or trigger the assisted task's completion (needs a progress model; changes solo semantics) |
| **D11.3 — `isTaskComplete` gains `comfort`/`assist`, reusing the period-boundary criterion** *(new; fixes a v0.1.0 defect)* | Without it both executions never terminate and their consequences are unbounded. Reuses the accepted Conversation/Shared Downtime row verbatim, so no signature change | A duration-constant cap (needs a fourth argument to `isTaskComplete` at four call sites; unnecessary for boundedness) |
| **D11.4 — `sharedTaskCompletion` emitted exactly once, at the `assist` execution's `inProgress → completed` transition, above a participation floor, as a flat delta in Phase 4** *(new; replaces v0.1.0's per-tick rate)* | The change source names a completion; a completion transition is its only correct trigger, and `transition()` makes it once-only. The floor stops a one-tick Assist at the period boundary collecting full credit | Per-tick emission (asserts a completion N times, unbounded); emitting on the assisted colonist's completion (that is their event, D11.2); emitting in Phase 6 (the completed execution never reaches that loop) |
| **Atrophy exclusion predicate widened to cover Comfort/Assist** *(new)* | `companionshipAffinityDeltaPerTick` returns 0 for both, so the existing predicate would atrophy an actively-interacting pair — the exact defect `excludedPairs` was generalized to prevent | Leaving it (silent relationship decay during the interaction that should build it) |
| Comfort's relationship credit stays per-tick via `mutualSupportCrisis`; Assist's is completion-gated via `sharedTaskCompletion` | The asymmetry is traced to the two change-source names, not invented: one names a state, the other a completion | Forcing both to the same timing (would misname one of them) |
| **D12 — an immutable `SocialParticipationBasis` built once, before Phase 3, from tick-start state only** *(new; replaces v0.1.0's live scan)* | Phase 3 writes stress as it iterates, so any live cross-runtime derivation is order-dependent; the fixed basis restores the same "one shared basis, fixed before the loop" discipline D3 established for observation | v0.1.0's `runtimes` scan (order-dependent); building it after Phase 4 (unavailable when Phase 3 needs it); rebuilding mid-tick (reintroduces the hazard) |
| **D12 — fail-closed derivation, lowest-id tie-break, one-tick lag, all specified and tested** *(new)* | A total pure function with one defined answer for every input, including inputs the runtime invariant makes unreachable | Fail-open pairing (guesses a comforter); throwing on ambiguity (a hand-edited save should be rejected at load, not crash mid-tick) |
| **D11.5 — the one-recipient and no-chain guards live at offer resolution, not candidate generation** *(new)* | "This colonist's `"working"` is an `assist`" is not Tier-1-observable; putting the guard in perception would breach locked #21. Resolution-time eligibility already reads simulation state | Widening `ObservableColonist` with task identity (breaks the perception boundary) |
| Two-sided non-hostile relationship gate, reused unmodified | Codebase consistency; the two-sided check is the established fix for a confirmed defect in the one-sided reading | A literal ADR-18 D4.4 one-sided gate for these two actions only (inconsistent with the other two) |
| **DQ-18.7 left open as a Human decision, with both options fully specified and Option A recommended** | ADR-18 frames both as valid; no accepted source settles it, and the ADR-21 revision's scope depends on the ruling | Adopting either unilaterally; deferring without specifying both (would block the revision on further design work) |
| Responder-side consequences applied by direct write, mirroring Shared Meal's partner-write pattern — no goal/execution for the responder | Keeps `autonomous-three-colonist-runtime.md` DQ-2 deferred exactly as that design left it; reuses a proven pattern | Giving the responder their own goal (resolves DQ-2 silently, out of authority) |
| **D13 — `SAVE_FORMAT_VERSION` bumps 6 → 7; four persisted unions widen, not one** *(new; reverses v0.1.0)* | The compatibility contract is the accepted-document set, and all four sites change it. Reject-only loading makes the version integer the only signal; without a bump an old build reports a corrupt-save error for a version problem | v0.1.0's no-bump (factually wrong and diagnostically misleading); a v6→v7 migration path (no framework exists; not this slice's job) |
| **D13 — v6 saves rejected outright by v7 builds, despite the widenings being additive** *(new)* | Preserves reject-only loading as the single accepted posture; subset acceptance would set a multi-version-compatibility precedent nothing is set up to maintain | Silently accepting v6 (first exception to a locked discipline) — raised as Finding 5 for the gate instead |
| **D13 — validate-never-repair reinforced: widened lists change what is valid, never what happens to the invalid; the one-recipient invariant is a load rejection** *(new)* | Matches `socialOffers.ts`'s stated discipline verbatim | Coercing unknown members to a default, dropping them, or deduplicating a two-comforter save |
| Extend `SOCIAL_OFFER_ACTIONS`/`SocialOfferAction` via an ADR-21 revision, not a new ADR | ADR-21 owns this closed union and says extending it is "a revision of this ADR"; no new record shape, status, or reason code | A new ADR for offer-action storage (duplicates authority; Slice 5/6 precedent is revision, not proliferation) |
| `responderNotInterruptible` reused with a generalized meaning covering both the action-keyed state table and D11.5's participation guard; no new `OfferResolutionReason` member | The union's members are outcome-shaped, not action-specific; a per-action code would fragment a deliberately closed union | `comfortTargetNotStressed`/`assistTargetNotWorking`/`responderAlreadyAssisted` (unnecessary fragmentation) |
| **Assist's Stage-2 reachability collapse surfaced as Finding 2 with a proof and a pinned test, recommending option (a)** *(new)* | The gap is real and load-bearing on whether Assist ships now; hiding it behind "narrows reachability" (v0.1.0) understated it | Silently shipping the unreachable `"working"` arm; unilaterally narrowing the target set or deferring Assist (both are gate calls) |

---

## 20. Kanban Update

**Card:** [Phase 3] Stage 2 Slice 7 — Comfort and Assist (Design)
**Status:** Review — v0.2.0 revision pushed to PR #152 addressing all three Codex blockers. Awaiting Codex re-review and Human approval. No ADR revision drafted and no implementation until both gates pass and the ADR-21 revision (§14) is subsequently Accepted.
**Completed (this revision):** Resolved Codex blocker 1 with **D11** — Assist's work effect proven empty from the data model, exclusive completion ownership, explicit completion criteria for `comfort`/`assist` (fixing a v0.1.0 never-terminating-execution defect), a single `sharedTaskCompletion` emission at the completion transition with a participation floor (replacing v0.1.0's unbounded per-tick rate), four double-progress/double-completion prevention rules, and the required atrophy-exclusion widening. Resolved blocker 2 with **D12** — an immutable `SocialParticipationBasis` built once before Phase 3 from tick-start state only, with its complete fixed-input list, fail-closed derivation, tie-break, one-tick lag, and six determinism tests, replacing v0.1.0's live cross-runtime scan. Resolved blocker 3 with **D13** — `SAVE_FORMAT_VERSION` 6 → 7, four widened persisted unions identified (v0.1.0 found one), all three compatibility cases stated, validate-never-repair reinforced. Kept **DQ-18.7 as an open Human decision** with both options fully specified, Option A recommended, and the exact five-item delta if the gate picks B. Corrected three factual errors from v0.1.0 (ambient-state semantics, never-completing executions, a non-existent validation command). Upgraded Finding 2 from a caveat to a seven-step proof that Assist's target set collapses to `"blocked"` at Stage 2, with three options for the gate. Added Finding 5 (save subset acceptance). Test matrix and Decision Log updated throughout.
**Changed Files:**
  MODIFIED  design/comfort-assist-protocol.md (v0.1.0 → v0.2.0)
**Validation:** Every claim re-grounded by reading the current implementation: `prototype/src/task/execution.ts`, `task/tasks.ts`, `task/socialOffers.ts`, `simulation/tick.ts`, `world/snapshot.ts`, `colonist/stress.ts`, `colonist/relationships.ts`, `decision/goals.ts`, `core/serialization.ts`, and `config/tuning.ts`, with file:line citations throughout. The four persisted-union sites, the absence of any work-progress quantity, the `isTaskComplete` gap for `comfort`/`assist`, the global-period reachability chain, and the atrophy-exclusion gap were each confirmed by direct reading, not inferred. `tools/ai-workflow/` enumerated to correct §17.
**Risks:** Finding 2's reachability proof is the highest-leverage new information — it may change whether Assist ships in this slice at all, which is a gate call, not a design call. D11.4's Phase-4 relationship write is the one genuinely new phase-placement decision and deserves focused review. D12's basis is new structure (not pure reuse) and its one-tick lag is a deliberate, specified behavior that a reviewer should confirm is acceptable. The ADR-21 revision remains a prerequisite gate this design cannot itself satisfy, and its item 4 is blocked on Finding 1.
**Follow-up Tasks:** Human ruling on Findings 1, 2, and 5 (Findings 3 and 4 are optional tuning calls). Then draft the ADR-21 revision (§14) through the architecture workflow before any implementation. Confrontation, `In Conflict`, Stage 2 Slice 8/9, and Stage 3 scaling remain untouched and out of scope.

**Not committed as implementation** — this is a design artifact only; no code in `prototype/src` is created or modified by this task.
