# Design — Comfort and Assist Protocol (Stage 2 Slice 7)

**Version:** 0.4.0 (review finding closed: the one-comforter invariant now covers suspended executions)
**Phase:** Phase 3 — Stage 2 Slice 7
**Implementation scope:** **Comfort only.** Assist is deferred by Human ruling and remains design vocabulary — see §15.
**Status:** Draft — awaiting re-review of the v0.4.0 resume-path fix, then Human approval (`docs/ai-workflow/operating-model.md` Design → Human Approval gate; `ai-studio/workflows/kanban-update-protocol.md`'s review pipeline)
**Author:** Claude (design task through v0.3.0); Cursor as design author for v0.4.0 (Human Owner role reassignment on PR #152)
**Tracks:** GitHub issue #151 (parent #119) · PR #152
**Authority (treated as authoritative):** ADR-17 (Need System — Accepted); ADR-18 D1–D10 (Social Action Space — Accepted); ADR-20 (Relationship Record Storage — Accepted); ADR-21 (Social Offer State Storage — Accepted); ADR-22 (Per-Colonist Runtime Collection — Accepted); `design/social-offer-response-protocol.md` v0.2.0; `design/autonomous-three-colonist-runtime.md` (including its still-deferred DQ-2); `design/engineering-specification.md` v0.3.0; `ai-studio/constitution/architecture-philosophy.md`
**Companion architecture artifact:** `ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md` (Proposed — revised with this v0.4.0 resume-path fix; §14)
**This document is NOT implementation:** no code is written here. It specifies the data shape, deterministic rules, phase placement, and validation Cursor implements exactly.

**Traceability rule:** every decision cites its authorizing source. Every mechanism reused from the current implementation is cited by file and line, verified by reading, not assumed.

---

## 0. Human ruling, revision history, and the scope split

### 0.1 The ruling (recorded 2026-07-27, PR #152)

1. **DQ-18.7 — Option A.** Assist uses **non-rejection**: no acceptance PRNG draw once the lifecycle gates pass.
2. **Assist implementation is deferred.** No Assist action ships that has zero work effect or can only target blocked/idle colonists. **Assist must not widen any runtime or persisted union in this slice.**
3. **Slice 7 continues as Comfort-only implementation scope.** A separate follow-up issue for Assist is to be proposed (§15), blocked on a real work-progress model and/or per-colonist work scheduling that makes observable working targets reachable. The GitHub issue is **not** created by this task.

Ruling 1 is recorded and binding, but has **no Slice 7 implementation effect**: the action it governs is deferred by ruling 2. Its practical consequences are that no `assistAcceptanceProbability` tuning table is ever needed, that the future Assist slice inherits non-rejection as settled rather than open, and that the ADR-21 amendment's contingent item (v0.2.0 §14 item 4) drops out of ADR-24's scope entirely and travels with the Assist follow-up.

### 0.2 What v0.3.0 changed

v0.2.0 resolved Codex's three blockers for a Comfort **and** Assist slice. The ruling narrows implementation to Comfort. This revision therefore:

- **Splits scope explicitly** (§0.3) instead of quietly dropping Assist, so a reviewer can see exactly what left the slice and what remains binding on the future one.
- **Narrows every widened union by one member.** `SocialOfferAction`, `Goal.relatedSocialTaskId`, and `socialOfferCreated.action` gain `"comfort"` **only** — not `"assist"`. `StressChannelId` gains `positiveSocialProximity` as before. D13 (§13) is updated; the save-version bump is still required.
- **Removes Assist from the implementation surface, the file areas, and the Slice 7 test matrix**, and replaces those rows with **negative tests that pin the deferral** (§19) — so "Assist is not in this slice" is enforced by the suite rather than by intent.
- **Retains the Assist analysis in full** as the *rationale* for deferral (§3, §5.2, §15) rather than deleting it, because that analysis is exactly what the follow-up issue must carry.
- **Drafts ADR-24** (§14), the Comfort-only amendment of ADR-21 D2/D5, which v0.2.0 was instructed to hold.
- **Adds §15** — the Assist follow-up issue proposal (title, scope, dependencies, acceptance criteria), not filed.

### 0.3 Scope split

| Item | Slice 7 (Comfort) | Deferred to the Assist follow-up |
|---|---|---|
| Candidate generation | Comfort from Tier-1 `"stressed"` (D1) | Assist from `"working"`/`"blocked"` (D2) |
| Offer action union | `+ "comfort"` → three members | `+ "assist"` → **must not happen in this slice** |
| Persisted `relatedSocialTaskId` | `+ "comfort"` → three members | `+ "assist"` |
| `isTaskComplete` | `comfort` gains the period-boundary criterion | `assist` stays `false` (unreachable vocabulary) |
| Acceptance semantics | Comfort's weighted draw (D5) | Assist non-rejection — **ruled Option A**, applied when Assist ships |
| Consequences | Relationship, Social need, new stress relief (D7) | `sharedTaskCompletion` emission rules (D11.4), carried forward intact |
| Participation basis | Comfort-only (D12) | Extended to Assist by the follow-up |
| Save format | v7 (D13) | No further bump unless the Assist slice widens the unions again |
| Voluntary-assistance boundary | No code; standing constraint (D3) | Inherited as a hard constraint |

### 0.4 Decision status after the ruling

| Decision | v0.2.0 | v0.3.0 |
|---|---|---|
| D1 Comfort candidate generation | In scope | **In scope, unchanged** |
| D2 Assist candidate generation | In scope | **Deferred** (§3, retained as rationale) |
| D3 Voluntary-assistance boundary | In scope | **Standing constraint, no Slice 7 code** |
| D4 Relationship gate | Both actions | **Comfort only** |
| D5 Acceptance semantics | DQ-18.7 open | **Ruled Option A; Comfort draw in scope, Assist deferred** |
| D6 Lifecycle reuse | Union → 4 members | **Union → 3 members** |
| D7 Consequences | Both actions | **Comfort only** |
| D8 Phase placement / PRNG | Both actions | **Comfort only** |
| D9 Replay / event log / inspector | Both actions | **Comfort only, otherwise unchanged** |
| D10 ADR determination | "Revision required, not drafted" | **Realized as ADR-24 (Proposed), Comfort-only scope** |
| D11 Bounded effect & emission | Assist-centred | **Recast: Comfort's bounds in scope (§5.1); Assist analysis retained as deferral rationale (§5.2)** |
| D12 Participation basis | Comfort + Assist | **Comfort only** |
| D13 Save version bump | 6 → 7, four unions × 2 members | **6 → 7, four sites, one new member each** |

**Decision index.** D1 §2 · D2 §3 *(deferred)* · D3 §4 · D11 §5 · D4 §6 · D5 §7 · D6 §8 · D7 §9 · D12 §10 · D8 §11 · D9 §12 · D13 §13 · D10 §14. Identifiers are stable across v0.1.0–v0.4.0 so review comments still resolve.

### 0.5 What v0.4.0 changes — the resume path

Review of v0.3.0 at head `c191eeb` found that the one-comforter-per-recipient invariant, as drafted, was **not maintainable by the guards the design specified**. The finding, and this revision's answer to it:

**The finding.** v0.3.0 scoped the invariant to *in-progress* `comfort` executions and enforced it at offer resolution, reading D12's basis. But offer acceptance is not the only producer of an in-progress `comfort` execution. When a goal is suspended its execution moves to `suspendedExecution` with status `"interrupted"` (`tick.ts:450–453`, `tick.ts:470`), which removes it from D12's basis entirely — the derivation reads only `r.execution` at status `"inProgress"`. A second comforter can then be admitted toward the same recipient. When the first comforter's suspension resolves, `resumeSuspended` restores the original execution via `resumeExecution` (`tick.ts:510–513`) — or, on its other branch, begins a fresh one (`tick.ts:523–526`) — consulting only skills and the snapshot, never the offer store, the basis, or any social rule. Two in-progress `comfort` executions then name one recipient, and because `validateSimulationState` runs at every tick boundary (§13.3), the result is a thrown error mid-run rather than the decline the design intends. Two *separately suspended* Comfort goals naming one recipient are invisible to a basis-only guard for the same reason.

**The answer: widen the claim, do not multiply the guards.** Scoping the invariant to in-progress executions requires a guard at every producer, and every producer added by a later slice becomes a fresh way to reintroduce this defect. Instead:

- The invariant is restated over `comfort` executions in **any** status — in-progress or suspended (§5.3(a), D13.3, ADR-24 D4 / Invariant 12).
- D12's basis gains one set, `claimedRecipients`, covering recipients named by a suspended Comfort as well as an active one (§10.2).
- Offer resolution step 5 tests that set (§5.3(a), §8). No guard is added at any producer, because a second Comfort toward a claimed recipient can no longer be admitted in the first place.
- `recipients` is **unchanged** — in-progress only — so a suspended Comfort grants no stress relief. This is why the claim is a separate set rather than a widening of `recipients`.

**What this buys.** The admission guard and the `validateSimulationState` assertion now enforce the same predicate; in v0.3.0 the guard proved something strictly weaker than the assertion demanded, which was the root cause. The two-suspended case is closed by construction rather than by a second rule. No new enforcement site, no ordering dependence, no PRNG use, no new iteration.

**The cost, accepted deliberately.** A suspended comforter reserves its recipient for the whole suspension, which can span a work period into the next free period; during that window the recipient receives no relief and other initiators' offers decline with `responderNotInterruptible`. The reservation is bounded — suspending another goal abandons the suspended pair (`tick.ts:457–465`) and releases the claim — and is preferable to a resume-time re-check, which would have to reason about same-tick ordering among several resuming colonists and would silently kill a committed goal. Recorded as a rejected option in §21 and as Finding 4 in §16.

---

## 1. Context — the gap this closes

ADR-18 D1 names Comfort and Assist as two of the six canonical social actions — both Sought, both category **Support** — and reserves their wiring for a future slice: "Comfort, Assist, Confrontation, `In Conflict` state — the offer/response protocol here is reachable only from `conversation`/`sharedDowntime`'s existing `relatedSocialTaskId` union; extending it to another `SocialTaskId` is explicitly a future slice's decision" (`design/social-offer-response-protocol.md` §12). Issue #151 is that future slice. After the Human ruling it delivers **Comfort**; Assist, Confrontation, and `In Conflict` all remain out of implementation scope.

Reading the current implementation directly:

- `prototype/src/task/tasks.ts:29,40–53` already lists `"comfort"` and `"assist"` in the closed `SocialTaskId` union and in the `TASKS` table (`taskClass: "social"`, `moduleId: null`), marked "vocabulary-only until their own wiring." `candidateTaskIdsFor` (`tasks.ts:67–91`) does not route to either.
- `prototype/src/decision/goals.ts:120–139`'s `generateVoluntaryCandidates` generates social candidates only for `"conversation"` and `"sharedDowntime"`, from `snapshot.nearbyColonists`, gated to `currentPeriod === "free"`.
- `prototype/src/task/socialOffers.ts:18–19` has a **closed** `SocialOfferAction = "conversation" | "sharedDowntime"` union and a closed seven-member `OfferResolutionReason` union (`socialOffers.ts:30–37`).
- `prototype/src/task/execution.ts:160–175`'s `TASK_AMBIENT_STATE` already maps `comfort → "socializing"` and `assist → "working"`, mirrored verbatim from ADR-18 D1, as inert unreachable data.
- `prototype/src/colonist/relationships.ts:68–75`'s `RELATIONSHIP_CHANGE_SOURCES` already includes `"mutualSupportCrisis"` — ADR-18 D6's Comfort row — unused today.
- `prototype/src/colonist/stress.ts:31` realizes only two of decision-loop §7's four reliefs (`restAdequacy`, `needsSatisfied`); "positive social proximity" — the mechanism ADR-18 D8 assigns an accepted Comfort to — does not exist.
- `prototype/src/simulation/tick.ts:988–999`'s Phase 6 offer-acceptance path begins execution for the **initiator only**; the responder receives no goal/execution (`design/autonomous-three-colonist-runtime.md` D5, DQ-2 — still deferred, not resolved here).

Three further facts, established in v0.2.0 and load-bearing for both the Comfort design and the Assist deferral:

- **There is no work-progress quantity anywhere in the simulation.** `Execution` (`execution.ts:35–41`) carries exactly `taskId`, `goalKey`, `status`, `startedAtTick`, `elapsedTicks`. `progressExecution` (`execution.ts:62–70`) only increments `elapsedTicks`. `applyProgressConsequences("workAtWorkstation", …)` returns `{}` (`execution.ts:141–143`).
- **`workAtWorkstation` completes on a clock boundary:** `isTaskComplete("workAtWorkstation")` is `snapshot.currentPeriod !== "work"` (`tasks.ts:240–241`), and `currentPeriod` is colony-global (`snapshot.ts:82`).
- **`isTaskComplete` returns `false` for `comfort` and `assist`** (`tasks.ts:247–253`). Wiring either without changing this creates executions that never terminate. Slice 7 fixes the `comfort` row and deliberately leaves the `assist` row alone (§5.1, §19).

---

## 2. D1 — Comfort candidate generation (Tier-1 `Stressed` state) — **in scope**

Comfort is generated exactly like Conversation/Shared Downtime — a tier-5 voluntary candidate from `generateVoluntaryCandidates` (`goals.ts:120–139`), gated to `snapshot.currentPeriod === "free"` (ADR-18 D4.1's opportunity condition for every tier-5 sought action, applied to a third action).

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

`ambientState === "stressed"` is exactly `isStressedState` (`stress.ts:128–130`) as published through `ambientStateFor` (`execution.ts:186–190`) into the tick's single shared observation basis (`design/autonomous-three-colonist-runtime.md` D3; built at `tick.ts:695–698`). No new perception path, no colonist-internal read: `ambientStateFor` checks `isStressedState(stress)` **before** consulting execution state (`execution.ts:187`), so a Stressed colonist reports `"stressed"` regardless of what task they were nominally executing.

**Comfort is fully reachable in the free period** — this is what distinguishes it from Assist and is why the ruling keeps it. Because the stress check precedes the execution check, `"stressed"` survives Phase 4's completion of the target's work execution; nothing in the free-period gate can suppress it. Contrast §3 and §15.

**`baseUrgency` is uniform, not distress-scaled.** Tier-1 exposes only the boolean crossing, not a magnitude (locked #21). "Distress must not force acceptance" (Issue #151 Scope-In) is satisfied structurally: generation never privileges a Comfort candidate over any other tier-5 candidate, and the accept/decline weighting (D5) is entirely the **responder's**.

## 3. D2 — Assist candidate generation — **deferred (retained as deferral rationale)**

> **Not implemented in Slice 7.** Retained because it is the analysis the Assist follow-up (§15) must carry, and because §19 pins its absence with negative tests.

Assist would follow the same tier-5 voluntary path for each `other` with `ambientState === "working"` or `"blocked"`, with eligibility checked against `workAtWorkstation` via the existing `checkEligibility`/`checkAvailability` (`tasks.ts:100–130`), per ADR-18 D4.3.

### 3.1 Why it cannot ship as designed — the ambient-state facts

v0.1.0 asserted that observing `"working"`/`"blocked"` *is* observing "doing `workAtWorkstation`." Reading `ambientStateFor` (`execution.ts:186–190`) shows that is false:

```text
if (isStressedState(stress)) return "stressed";
if (execution === null || execution.status !== "inProgress") return "blocked";
return TASK_AMBIENT_STATE[execution.taskId];
```

- `"blocked"` is produced by the **absence** of an in-progress execution — idle, between decisions, or goal blocked with execution aborted (`tick.ts:673–681`). It implies no work is happening, and Tier-1 cannot distinguish those cases (`execution.ts:183–184`: "motionless, not resting, not on task").
- `"working"` is produced by `workAtWorkstation` **and by `assist` itself** (`execution.ts:173`).

### 3.2 The reachability proof the ruling acted on

1. `generateVoluntaryCandidates` returns `[]` unless `currentPeriod === "free"` (`goals.ts:121`).
2. `currentPeriod` is colony-global — `periodAt(policy, tickOfDay(clock))` (`snapshot.ts:82`). There is no per-colonist shift.
3. `isTaskComplete("workAtWorkstation")` is `currentPeriod !== "work"` (`tasks.ts:240–241`), evaluated in Phase 4 (`tick.ts:665`) **before** the shared observation basis is built (`tick.ts:695`).
4. So on every tick where `currentPeriod === "free"`, every in-progress `workAtWorkstation` has already been completed in that same tick's Phase 4.
5. `ambientStateFor` returns `"blocked"` when there is no in-progress execution (`execution.ts:188`).
6. Therefore, in the only period an Assist candidate can be generated, **no colonist can be observed `"working"` on account of real work.** `"working"` is reachable only from an `assist` execution, which would itself have to be forbidden as a target to avoid chains.
7. A shift-boundary re-decision (`tick.ts:558–560`, `577`) interrupts any tier-5 goal at the free→work boundary, since tier 3 outranks tier 5 — so an Assist execution cannot span into the work period either.

**Conclusion:** Assist's eligible target set `{working, blocked}` collapses to `{blocked}` — a colonist with no in-progress execution at all. Combined with §5.2's zero-work-effect result, an Assist shipped now would target only idle colonists and do nothing for them. That is precisely what ruling 2 declines.

## 4. D3 — Voluntary-assistance boundary — **standing constraint, no Slice 7 code**

**Assist is reachable only from `source === "voluntary"`.** `candidateTaskIdsFor`'s `shiftAssignment` case (`tasks.ts:67–91`) returns exactly `["workAtWorkstation"]`, unchanged. Stage 2 has no collaborative-assignment or co-worker-pairing mechanism (`workAtWorkstation` is solo per colonist, unconditionally), so the boundary is satisfied vacuously by construction — and with Assist deferred, it is satisfied twice over: no `assist` task is reachable from *any* source in Slice 7.

The constraint stands anyway, because it binds two future slices. If a slice ever adds assignment-time collaboration, tier-3-sourced work is never Assist, never credits Social through D7, never emits `sharedTaskCompletion` through D11.4, and is not gated by this design's relationship/eligibility checks. **Policy-assigned collaboration is out of scope for Slice 7 and for the Assist follow-up alike** (§15).

**Invariants pinned by test in Slice 7** (§19): `candidateTaskIdsFor("shiftAssignment", …)` returns exactly `["workAtWorkstation"]`; and no `GoalCandidate` from any source ever carries `relatedSocialTaskId === "assist"` — which in Slice 7 is trivially true and is exactly the regression pin that keeps it true.

## 5. D11 — Bounded participation, completion ownership, and single emission

### 5.1 Comfort — **in scope**

**Comfort's execution is explicitly bounded (v0.1.0 defect fix, still required).** `isTaskComplete` returns `false` for `comfort` today (`tasks.ts:247–253`) because it is unreachable vocabulary. Wiring it reachable without changing this would leave an accepted Comfort satisfying no completion criterion on any tick, running until an unrelated interruption preempted it and applying its per-tick consequences the whole time. The `comfort` row joins the reachable social rows:

```text
case "conversation":
case "sharedDowntime":
case "comfort":
  return snapshot.currentPeriod !== "free";
case "sharedMeal":
case "assist":
case "confrontation":
  return false;   // unreachable vocabulary — assist stays here by the Human ruling
```

This requires no signature change to `isTaskComplete` (which receives `taskId`, `needSatisfied`, `snapshot` and has no access to `elapsedTicks`), reuses the criterion already accepted for the two reachable social tasks, and bounds the execution by the free period's remaining ticks. Every Comfort consequence in D7 is per-tick and therefore bounded by this same criterion.

**Completion ownership is exclusive.**

| Execution | Owner of progress | Owner of completion | Where decided |
|---|---|---|---|
| The initiator's `comfort` | The initiator, solely | The initiator, solely | Phase 4, from their own runtime (`tick.ts:663–672`) |
| Whatever the responder is doing | The responder, solely | The responder, solely | Phase 4, from their own runtime |

**Comfort never writes the responder's `execution` slot.** It does not advance, complete, abort, interrupt, resume, or re-key it. The two cross-colonist writes Comfort performs are the shared `relationships` store (both directions, `mutualSupportCrisis`) and the responder's `StressState` via D12's basis — never the responder's execution or goal. DQ-2 stays deferred: the responder runs their own decision loop, unaware at the goal-stack level that they are being comforted.

**Comfort's relationship credit is per-tick, deliberately.** Its change source is `mutualSupportCrisis` (`relationships.ts:68–75`), which names a *state*, not a completion, and ADR-18 D6 describes it as mutual support during distress. It therefore credits participation per tick via `comfortAffinityDeltaPerTick`, both directions, bounded by the completion criterion above — the same shape as `conversationAffinityDeltaPerTick` (`tick.ts:1060–1081`), which is already accepted.

**Required correction to the atrophy exclusion set.** `applyAtrophy`'s exclusion predicate (`tick.ts:619–624`) admits a pair only when `companionshipAffinityDeltaPerTick(taskId) > 0 || taskId === "eatAtFoodStation"`, and `companionshipAffinityDeltaPerTick` returns `0` for `comfort` (`tick.ts:391–398`, `default: return 0`). Left alone, an actively-comforting pair would be **atrophied while mid-interaction** — the exact defect Slice 6b's `excludedPairs` generalization was written to prevent (`relationships.ts:337–343`). The predicate must widen to "an in-progress execution whose `taskId` is a wired social task carrying a `relatedColonistId`." Pinned by test (§19).

### 5.2 Assist — **deferred (analysis retained; this is the substance of the deferral)**

Codex blocker 1 asked what progress or workload Assist shares or covers. The answer, forced by the data model:

**Assist would share, cover, and transfer exactly zero work progress, because Stage 2 has no work-progress quantity for it to act on.** `Execution` has no progress, workload, effort, remaining-work, or completion-fraction field (`execution.ts:35–41`); `progressExecution` only advances `elapsedTicks` (`execution.ts:62–70`); and a tick of `workAtWorkstation` changes no need, no world field, and no colonist state (`execution.ts:141–143`). The only trace work leaves anywhere is the `overwork` stress channel, driven by the *assisted colonist's own* `isWorking` flag in Phase 3 (`tick.ts:591–592`) — not a work product.

Any other answer requires **inventing** a work-progress model: a new M12 data-model decision that no ADR authorizes, that would change `workAtWorkstation`'s completion semantics for the solo case (violating Issue #151's no-regression requirement), and that would add a persisted field to `Execution`. This design declines to invent one, and the Human ruling declines to ship Assist without one. Together with §3.2's reachability collapse, that is the complete case for deferral.

**Rules carried forward to the Assist follow-up, intact and binding** (they are the reviewed answer to blocker 1 and must not be re-litigated from scratch):

- **Zero completion authority.** The assisted colonist owns their own task's progress and completion, solely; Assist never writes their `execution` slot. This holds whatever work-progress model arrives later.
- **`sharedTaskCompletion` is emitted exactly once**, at the `inProgress → completed` transition of the initiator's own `assist` execution (`completeExecution`, `execution.ts:73–75`), gated on a minimum-participation floor read from `execution.elapsedTicks`, as a **flat** delta — never a per-tick rate. The change source names a completion; a completion transition is its only correct trigger, and `transition()` (`execution.ts:54–59`) makes it once-only.
- **Never on** `interrupted`, `aborted`, `suspended`, resume, decline, cancel, or expiry; and never on the assisted colonist's own `workAtWorkstation` completion, which is their event, not the pair's.
- **`isTaskComplete("assist")` must gain an explicit bound** before Assist ships, exactly as `comfort` does in §5.1.
- **No Assist-on-Assist chains.** Because `TASK_AMBIENT_STATE.assist = "working"` (`execution.ts:173`), an assisting colonist is observed `"working"` and would otherwise be a valid Assist target, producing chains that each emit `sharedTaskCompletion` against one stretch of work. The guard belongs at **offer resolution**, not candidate generation: "this colonist's `"working"` is an `assist`" is not Tier-1-observable, and widening `ObservableColonist` to carry task identity would breach locked #21.
- **DQ-18.7 is settled as Option A** (non-rejection) by the Human ruling — the follow-up implements it rather than reopening it.

### 5.3 Double-application prevention — Comfort (in scope)

**(a) At most one `comfort` execution — in-progress *or* suspended — may name a given colonist as its `relatedColonistId`.** Without this, two comforters could each apply D7's stress relief and Social credit to the same responder in the same tick.

**The invariant is stated over executions in any status deliberately** (v0.4.0; §0.5). Offer acceptance is not the only producer of an in-progress `comfort` execution: `resumeSuspended` restores a suspended one via `resumeExecution` (`tick.ts:510–513`) and, on its other branch, begins a fresh execution for the resumed goal (`tick.ts:523–526`), re-resolving the task from skills and the snapshot alone — it consults no offer, no basis, and no social eligibility rule. Scoping the invariant to in-progress executions would therefore require a guard at every producer, and every producer a later slice adds becomes a fresh way to reintroduce the defect. Widening the *claim* rather than multiplying the *guards* makes the single admission check below sufficient for all of them.

Enforced at two points, neither of which is a live cross-runtime scan, plus one continuous state-level assertion:

- **Pending side — already exists, unchanged.** `validateSocialOfferStore` enforces at most one pending offer per `responderId` (`socialOffers.ts:242–327`), and Phase 6's ascending-id double-booking guard cancels the later of two same-responder pending offers with `responderUnavailable` (`tick.ts:935–942`). Both are action-agnostic and cover Comfort with no change.
- **Admission side — new.** Step 5's eligibility check declines with `responderNotInterruptible` when the responder is claimed in D12's participation basis — `basis.claimedRecipients`, which covers suspended comforters as well as active ones — or appears in `basis.participants` as a participant-initiator (rule (b)). Reading the frozen basis rather than any live runtime is what keeps this order-independent.
- **State-level assertion — new, and *not* a load-only check.** `validateSimulationState` rejects a state in which two `comfort` executions, in-progress or suspended in any combination, name the same recipient. Rejects, never dedupes (D13.3). That function runs at `tick()`'s input boundary (`tick.ts:550`) and at every tick exit (`tick.ts:366`), as well as at the end of `deserialize` (`serialization.ts:732`) — so it asserts the invariant continuously, not only on load. The admission guard is what keeps the assertion satisfiable: after v0.4.0 both enforce exactly the same predicate.

**(b) No Comfort-on-Comfort.** A colonist who is the initiator of an in-progress `comfort` is not an eligible Comfort responder. This is reachable, not theoretical: `ambientStateFor` checks stress **before** execution (`execution.ts:187`), so a comforter whose own stress crosses the threshold reports `"stressed"` and becomes a valid Comfort target — producing mutual or chained comfort with doubled relief. Same enforcement point as (a)'s admission side, same reason for placing it at resolution rather than perception.

`basis.participants` stays **in-progress only** for this rule, unlike (a)'s claim set. A colonist whose own Comfort goal is merely suspended is not comforting anyone, so comforting them doubles no relief; and after their resume the two executions name different recipients, which (a)'s invariant permits.

**(c) At most one relief application per responder per tick** is structural: D12's basis is a `Map` keyed by responder id, and Phase 3 performs one keyed lookup per colonist.

**(d) At most one `mutualSupportCrisis` credit per pair per tick** is structural: Phase 6's execution-progress loop runs once per colonist in canonical order, and only the initiator holds the `comfort` execution that triggers the credit.

**Why the tick-start basis is sufficient, proved rather than assumed.** The basis is built from tick-start state, so an execution begun in Phase 6 of tick *T* is not in tick *T*'s basis. The gap is closed by the response-delay floor: `createPendingOffer` rejects `responseDelayTicks < 1` (`socialOffers.ts:119–121`), so no offer created in Phase 5 of *T* can resolve before *T+1*. Any second offer toward a colonist who acquired a comforter during *T* therefore resolves at *T+1* or later, against a basis that already contains it. The only same-tick collision is two offers toward one responder, which the pre-existing double-booking guard cancels before either can accept.

## 6. D4 — Relationship compatibility gate — **Comfort**

Comfort reuses the **existing two-sided non-hostile check** already implemented in Phase 6's eligibility step (`isNonHostile` on both `perspective(relationships, initiatorId, responderId).state` and `perspective(relationships, responderId, initiatorId).state` — `tick.ts:968–976`). This is the codebase's actual convention — stricter than ADR-18 D4.4's literal "initiator's own relationship record," matching the Codex-confirmed defect fix already applied to `sharedMealPartnerId` (`tick.ts:402–414`): relationship drift is directional, so a one-sided check can pass on the initiator's stale, more-favorable view. Introducing a one-sided gate for Comfort alone would make the rule inconsistent across the three offer-backed actions for no specified reason.

A Hostile-or-Fractured pair, in either direction, declines immediately with `relationshipGate`, before any acceptance draw — identical to Conversation/Shared Downtime's existing step 5.

**Comfort's one specified asymmetry (ADR-18 D5) is in acceptance weighting, not in the gate.** "The distressed partner's acceptance gate is widened by their own state… but a Comfort offer from a colonist the distressed party holds at Hostile/Fractured is declined by the same weighting as anything else" — the hard gate is unchanged; what widens is the **acceptance-probability table** (D5).

## 7. D5 — Acceptance/decline semantics; DQ-18.7 ruled

### 7.1 Comfort — in scope

Comfort's acceptance draw is **mechanically identical** to Conversation/Shared Downtime's existing step 6 (`tick.ts:977–987`): one attributed `next(prng)` draw compared against a per-relationship-state probability table, modulated by the **responder's** directional perspective toward the initiator — the same responder-side-only modulation already used for the other two actions. Comfort gets its **own** `SOCIAL_OFFER_TUNING` table (`comfortAcceptanceProbability`), not a reuse of Conversation's, so D4's "widened" acceptance is expressible without disturbing existing calibration.

### 7.2 DQ-18.7 — ruled Option A, effect deferred

**ADR-18 DQ-18.7 ("does Assist require the assisted colonist's acceptance, or only non-rejection?") is resolved by Human ruling as Option A — non-rejection.** When Assist ships, it runs lifecycle steps 1–5 (expiry, cancellation, double-booking, hold, response delay, eligibility including the relationship gate and the participation guard) and then resolves directly to `"accepted"` with `reason: null`, **skipping the acceptance draw entirely**. No PRNG draw is attributed to Assist's acceptance.

**Slice 7 effect: none.** Assist is deferred, so:

- No `assistAcceptanceProbability` table is added to `SOCIAL_OFFER_TUNING`.
- `acceptanceDraw` remains reachable for exactly the three wired actions.
- Every offer resolving in Slice 7 consumes exactly one `next(prng)` call at step 6 — the draw-count statement in D8 is uniform again, with no per-action exception to reason about.
- ADR-24's scope loses v0.2.0's contingent item about `"accepted"` being reachable without a draw; that record travels with the Assist follow-up (§15).

The ruling is nonetheless recorded here because it is settled architecture-adjacent guidance: the Assist follow-up inherits it as decided, not open.

## 8. D6 — Reuse of the social-offer lifecycle — union widens to **three**

Comfort reuses `design/social-offer-response-protocol.md` v0.2.0's entire mechanism and `socialOffers.ts`'s storage (ADR-21) **unmodified in shape**, extended only at the places ADR-18/ADR-21 named as extension points:

- `SocialOfferAction` widens from `"conversation" | "sharedDowntime"` to `"conversation" | "sharedDowntime" | "comfort"` — **three members. `"assist"` is not added** (ruling 2).
- The target-ambient-state eligibility check generalizes from the single `isInterruptibleAmbientState` predicate to an **action-keyed** table (additive — Conversation/Shared Downtime's behavior is unchanged), with an exhaustive `switch` over the closed union and a `never` default so a later widening cannot compile until it is handled:

```text
function isEligibleTargetState(action: SocialOfferAction, ambientState: AmbientState): boolean {
  switch (action) {
    case "conversation":
    case "sharedDowntime":
      return isInterruptibleAmbientState(ambientState);   // unchanged — INTERRUPTIBLE_AMBIENT_STATES
    case "comfort":
      return ambientState === "stressed";
    default: {
      const unhandled: never = action;
      throw new Error(`unhandled social offer action: ${String(unhandled)}`);
    }
  }
}
```

`"stressed"` is not in `INTERRUPTIBLE_AMBIENT_STATES` (`socialOffers.ts:82`) — reusing that predicate unmodified for Comfort would make it permanently ineligible (declining every offer with `responderNotInterruptible`), the opposite of ADR-18 D4.3's intent, whose entire premise is targeting the Stressed state.

- Step 5 additionally declines with `responderNotInterruptible` when the responder appears in D12's `claimedRecipients` or `participants` — D11.5(a)/(b)'s enforcement point (v0.4.0: `claimedRecipients`, not `recipients`, so a suspended comforter still blocks a second Comfort). `responderNotInterruptible` is reused rather than adding a reason code: the union's members are already action-agnostic outcome codes, and "this responder's state does not admit this action right now" is exactly what it means.

**No other lifecycle step changes.** Expiry, both cancellation conditions, the double-booking guard, the suspension hold, the one-tick response-delay floor, ascending-`id` processing order, and bounded resolved-offer retention all apply to Comfort exactly as specified for Conversation/Shared Downtime.

**This requires an amendment of ADR-21**, per that ADR's own closure discipline (D2: adding to the closed vocabulary "is a revision of this ADR, not a tuning or implementation choice"; D5 lists `action outside the closed two-member union` as a rejected shape). Realized as **ADR-24** — see §14.

## 9. D7 — Need, stress, relationship, and relational-memory consequences — **Comfort**

All of the below apply **only** to an offer that resolves to `"accepted"`, per tick while the resulting execution is `"inProgress"`, in Phase 6's execution-progress loop (`tick.ts:1010–1084`) — the same loop and the same `relatedColonistId`-keyed pattern already used for Conversation/Shared Downtime — and bounded by §5.1's completion criterion. **Declined, cancelled, and expired attempts apply none of the positive effects.**

| Effect | Mechanism | Direction | Source |
|---|---|---|---|
| Relationship | `comfortAffinityDeltaPerTick` via `applyInteraction`, `changeSource: "mutualSupportCrisis"` | Both, positive | ADR-18 D6: "Comfort (accepted) → Mutual support… Positive, medium" |
| Social need | `comfortSocialRestorePerTick`, initiator and responder | Both | ADR-18 D7: "Participation credits…" |
| Stress relief | New `positiveSocialProximity` relief channel in `evaluateStress`, driven by D12's basis in Phase 3 | Responder only | ADR-18 D8: "an accepted Comfort is that relief in deliberate, directed form" |
| Purpose | None, ever | — | ADR-17 D6 / ADR-18 D7 distinctness constraint |

**The stress relief requires one new, narrowly-scoped input to `evaluateStress`** (`stress.ts:97–103`) and one new `StressChannelId` member, `positiveSocialProximity` (`stress.ts:31`). Decision-loop §7 names four reliefs; Stage 1/2 realized two. This is the third, and an accepted Comfort is its first concrete trigger. The input is a boolean (e.g. `isReceivingComfort`) whose value comes **exclusively from D12's immutable basis**. Magnitude is deferred (DQ-3). The channel is Comfort-specific by construction — its trigger is "named as recipient by an in-progress Comfort," not "in any companionship execution" — so no existing test's stress trajectory changes.

**The responder receives a direct need/stress write without a goal or execution of their own** — mirroring Shared Meal's existing partner-write pattern (`tick.ts:1036–1058`), not the responder-side goal commitment DQ-2 leaves deferred.

### Non-effects (declined, cancelled, expired)

- **No** Social-need restoration, either party.
- **No** positive relationship delta. Declines apply the existing `forcedProximityMutualStress` friction (`declineAffinityDelta`, both directions, `tick.ts:901–917`) exactly as Conversation/Shared Downtime's declines do. No new decline magnitude unless the Human gate directs otherwise (Finding 1).
- **No** stress relief.
- **No** memory formation beyond what ADR-16's existing significance criteria form from the relationship/stress movement actually applied.

## 10. D12 — The immutable Comfort-participation basis

### 10.1 What v0.1.0 got wrong

v0.1.0 determined whether a colonist is being comforted "via `runtimes` lookup" **inside** the per-colonist Phase 3 loop. That is a live cross-runtime read, and it is unsafe for a specific reason: Phase 3 writes each colonist's `StressState` as it goes (`tick.ts:590–600`), and stress is an input to `ambientStateFor` and to any downstream derivation of "who is doing what." A colonist's Phase 3 result would then depend on how many colonists preceded them in the loop — precisely the same-tick observability the shared-observation-basis discipline (`design/autonomous-three-colonist-runtime.md` D3, `tick.ts:687–698`) exists to prevent.

### 10.2 The basis (Comfort-only)

A single immutable value built **once per tick, before Phase 3's per-colonist loop begins**, and never rebuilt.

```text
interface ComfortParticipationBasis {
  readonly recipients:        ReadonlyMap<ColonistId, ColonistId>;  // responder id -> active comforter id
  readonly participants:      ReadonlySet<ColonistId>;              // every initiator of an in-progress comfort
  readonly claimedRecipients: ReadonlySet<ColonistId>;              // recipients of any held comfort (active or suspended)
}
```

Scoped to Comfort in Slice 7. The Assist follow-up widens it to carry `assistRecipients` / `assistClaimedRecipients` and merge `participants`; the shape is chosen so that widening is additive. **`recipients` stays in-progress only** so Phase 3's relief lookup never credits a suspended Comfort; the claim set is separate precisely so admission can see what relief must not.

**Fixed inputs — the complete list.** Built from `state.colonists` (the tick-start runtime collection, ADR-22 D3's canonical order) and nothing else. Per runtime `r`, exactly these fields are read:

1. `r.colonist.identity.id`
2. `r.execution?.taskId`
3. `r.execution?.status`
4. `r.execution?.goalKey`
5. `r.colonist.currentGoal?.status`, `?.relatedSocialTaskId`, `?.relatedColonistId`, `?.key`
6. `r.suspendedExecution?.taskId`, `?.status`, `?.goalKey` *(v0.4.0 — claim derivation only)*
7. `r.colonist.suspendedGoal?.status`, `?.relatedSocialTaskId`, `?.relatedColonistId`, `?.key` *(v0.4.0 — claim derivation only)*

It reads **no** world state, **no** clock, **no** policy, **no** relationship store, **no** offer store, **no** PRNG, and **not** the mutable `runtimes` working map. It is a pure function of `readonly ColonistRuntime[]`, callable and testable in complete isolation.

**Derivation rule (total, pure, order-independent).** `r` is a *participant* iff:

```text
r.execution !== null
  && r.execution.status === "inProgress"
  && r.execution.taskId === "comfort"
```

Its *recipient* (relief map) is contributed only if **all** of the following hold; otherwise the entry contributes a participant and **no** recipient:

```text
r.colonist.currentGoal !== null
  && r.colonist.currentGoal.status === "active"
  && r.colonist.currentGoal.relatedSocialTaskId === "comfort"
  && r.colonist.currentGoal.key === r.execution.goalKey
  && r.colonist.currentGoal.relatedColonistId !== undefined
  && r.colonist.currentGoal.relatedColonistId !== r.colonist.identity.id
```

**Claim derivation (v0.4.0).** A recipient id is added to `claimedRecipients` when either of the following holds (fail-closed in both branches):

- **Active claim** — the same conditions that contribute a `recipients` entry above.
- **Suspended claim** — all of:

```text
r.suspendedExecution !== null
  && r.suspendedExecution.status === "interrupted"
  && r.suspendedExecution.taskId === "comfort"
  && r.colonist.suspendedGoal !== null
  && r.colonist.suspendedGoal.status === "suspended"
  && r.colonist.suspendedGoal.relatedSocialTaskId === "comfort"
  && r.colonist.suspendedGoal.key === r.suspendedExecution.goalKey
  && r.colonist.suspendedGoal.relatedColonistId !== undefined
  && r.colonist.suspendedGoal.relatedColonistId !== r.colonist.identity.id
```

A mismatched or missing suspended pair contributes **no** claim — never a guessed pairing. ADR-22's paired-slot invariant (`suspendedGoal` null iff `suspendedExecution` null) is already enforced by `validateSimulationState`; this rule still fails closed if either half is incomplete.

**Fail-closed** — a mismatched or missing goal yields no relief and no guard entry, never a guessed pairing. This mirrors the accepted behavior pinned by "a companionship task without relatedColonistId fails safely with no social consequence" (`tick.test.ts:278–284`).

**Tie-break.** If two active comforters name the same recipient in the `recipients` map, the entry with the **lowest canonical colonist id** wins. D11.5(a) makes this unreachable at runtime and `validateSimulationState` rejects any state containing duplicate claims (active or suspended, any combination — D13.3), so the rule exists solely to keep the `recipients` builder a total function with one defined answer — testable directly, never observed in a real run. `claimedRecipients` is a set: presence is enough; no tie-break is needed for admission.

**Immutability.** Frozen at construction; nothing in Phases 3–7 writes to it, and no phase rebuilds it.

### 10.3 Readers

| Phase | Reader | Access | Purpose |
|---|---|---|---|
| 3 | Per-colonist continuous-state loop | `basis.recipients.get(id)` — keyed lookup for **this colonist only** | Supplies `evaluateStress`'s `isReceivingComfort` input (D7). **Never** reads `claimedRecipients`. |
| 6 | Offer lifecycle step 5 | `basis.participants.has(responderId)`, `basis.claimedRecipients.has(responderId)` | D11.5(a)/(b)'s eligibility guard (D6). Uses the claim set, not `recipients`. |

**Explicitly forbidden inside the Phase 3 loop:** any `runtimes.get(otherId)`, any iteration over `runtimes`, and any read of another colonist's execution, goal, needs, or stress. The loop's only cross-colonist input is the frozen basis, fixed before its first iteration.

**Candidate generation does not read the basis.** Perception stays Tier-1-only (`ObservableColonist` is `{ id, ambientState }`, `snapshot.ts:40–43`; locked #21). An initiator may offer to a colonist who already has a comforter and learns otherwise at resolution — the same shape as the relationship gate and the acceptance draw.

### 10.4 The one-tick lag, stated rather than hidden

Because the basis is tick-start, a Comfort accepted in Phase 6 of tick *T* first appears at *T+1*, so the responder's first relief tick is *T+1*'s Phase 3, not *T*'s. This is the same discipline Phase 4's completion detection already follows and documents (`tick.ts:653–657`). It is specified, tested (§19), and not to be "fixed" by rebuilding the basis mid-tick. §5.3 proves the gap it leaves is closed by the ≥1-tick response-delay floor.

The same lag applies to claims: a Comfort that becomes suspended in tick *T* remains in `claimedRecipients` through *T* (tick-start still held it as active until the next rebuild), and a claim released mid-tick lingers until *T+1*. That is conservative in the safe direction — an offer may decline one tick early — and adds no ordering dependence. A claim created mid-tick by resume was already present at tick start as a suspended claim, so admission never opens a window between suspend and resume.

## 11. D8 — Phase placement, deterministic ordering, PRNG attribution

**No change to the seven-phase order, no change to the PRNG architecture.**

- **Before Phase 3:** D12's basis is built, once, by one pure pass over `state.colonists`.
- **Phase 3:** the per-colonist loop gains one keyed basis lookup feeding `evaluateStress`'s new input. No cross-runtime read.
- **Phase 4:** `isTaskComplete`'s `comfort` row makes an accepted Comfort completable (§5.1). No new relationship write in Slice 7 — the completion-triggered emission was Assist's, and it is deferred with it.
- **Phase 5:** a committed `voluntary` goal with `relatedSocialTaskId === "comfort"` creates a pending offer instead of beginning execution, via the same `createPendingOffer` call already used for the other two actions — the conditional at `tick.ts:806–810` widens to three members, with no other change.
- **Phase 6, offer lifecycle pass:** processed in the same ascending-`id` loop, same steps, interleaved with Conversation/Shared Downtime offers in one shared array — `SocialOfferStore.offers` is a single append-ordered array regardless of `action`. Step 5 gains D11.5's basis guard.
- **Phase 6, execution-progress pass:** Comfort's per-tick affinity and both parties' Social credit join the existing `relatedColonistId`-keyed pattern (`tick.ts:1060–1081`). The atrophy exclusion predicate widens per §5.1.

**PRNG.** Comfort's acceptance draw consumes exactly one `next(prng)` call per resolving Comfort offer, in the same position in the fixed iteration Conversation/Shared Downtime's draws already occupy (offer resolution order = ascending `id` = creation order = canonical colonist iteration order within Phase 5). With Assist deferred, **every** offer-backed action in Slice 7 consumes exactly one draw at step 6 — there is no per-action draw-count exception. Differential draw counts remain possible only where they already are today: an offer failing an earlier gate consumes zero.

**D12's basis introduces no PRNG use, no ordering dependence, and no new iteration.** §19 pins its order-independence.

No new re-decision trigger kind, no new phase, no new PRNG stream, no change to canonical colonist iteration order.

## 12. D9 — Replay, event-log, and inspector impact

- **Replay:** no change. `socialOffers` and `colonists` are already in `replay.ts`'s `STATE_FIELDS`, diffed generically. D12's basis is derived state, never persisted, reconstructed identically from the same tick-start inputs on every run — which is exactly what makes it replay-safe.
- **Event log:** no new `TickEvent` variant. Comfort's stress relief surfaces through the **existing** `stressEvaluated` event as one more named `StressContribution` entry (`positiveSocialProximity`), which is what its `contributions` array exists for.
- **Inspector:** no new surface. A Comfort-in-progress is visible as the initiator's `currentGoal.relatedColonistId`/`relatedSocialTaskId`, the initiator's `execution.taskId === "comfort"`, the responder's stress with the new relief channel decomposed, and the offer's own record in the detached `socialOffers` list.

## 13. D13 — Save-format version bump and compatibility behavior

### 13.1 Four persisted validation sites, one new member each

| # | Site | Today | Widens to | Persisted in |
|---|---|---|---|---|
| 1 | `SocialOfferAction` / `SOCIAL_OFFER_ACTIONS` — `socialOffers.ts:18–19` | 2 members | **3** (`+ "comfort"`) | `socialOffers.offers[].action` |
| 2 | `Goal.relatedSocialTaskId` — `serialization.ts:245–248` | `["conversation","sharedDowntime"]` | **3** (`+ "comfort"`) | `colonists[].colonist.currentGoal`, `.suspendedGoal`; `decisionLog[].outcome`'s goal |
| 3 | `socialOfferCreated.action` — `serialization.ts:587` | `["conversation","sharedDowntime"]` | **3** (`+ "comfort"`) | `eventLog[].event` |
| 4 | `StressChannelId` — `stress.ts:31`, mirrored `serialization.ts:66–72` | 5 members | **6** (`+ "positiveSocialProximity"`) | `eventLog[].event.contributions[].id` for `stressEvaluated` |

**`"assist"` appears in none of them** (ruling 2), and §19 pins that with load-rejection tests.

### 13.2 Decision: bump `SAVE_FORMAT_VERSION` from 6 to 7

`serialization.ts:43–44` becomes `7`, with a `// v7: Stage 2 Slice 7 — Comfort widens the persisted action, social-task, and stress-channel unions (design/comfort-assist-protocol.md D13; ADR-24).` comment, matching the existing convention.

**Why bump when no field is added or removed.** The save format's compatibility contract is *the set of documents the loader accepts*, and all four sites change it. The version integer is the format's only compatibility signal — no capability negotiation, no feature flags, no per-field versioning — and `deserialize` is reject-only. Without a bump, a v6-labelled save written by the new build and containing `action: "comfort"` handed to an older build fails deep inside field validation with `Invalid save data: "socialOffers.offers[0].action" must be one of …`, which tells the operator "your save is corrupt" when the truth is "your build is older than your save." Bumping converts a misleading data-corruption message into the format's designed, single, diagnosable failure at the version gate.

Narrowing scope to Comfort does **not** remove the need for the bump: three of the four sites still widen, and site 4 follows directly from D7's new relief channel.

### 13.3 Compatibility behavior — all three cases

**Case 1 — new build (v7) loading an old save (v6): rejected.** `deserialize` throws `Unsupported save format version: 6 (expected 7)` at `serialization.ts:704–707`, before any field is read. **No migration, no upgrade path, no repair, no partial load.** This is the posture every prior bump took (`serialization.ts:3–5`: "No migration framework beyond outright version rejection"), and this design adds no migration framework.

Deliberate even though the widenings are strictly **additive**, so a v6 document would satisfy every v7 field rule: accepting it would make this the first exception to reject-only loading and create an implicit two-version compatibility contract nothing is set up to maintain or test. **If the Human gate prefers subset acceptance, that is a serialization-architecture decision needing its own ADR — Finding 3 (§16), not decided here.**

**Case 2 — old build (v6) encountering a new save (v7): rejected symmetrically.** `Unsupported save format version: 7 (expected 6)`, from the same gate, requiring no change to the old build. Nothing in a v7 save is partially consumed.

**Case 3 — validate-never-repair within v7: unchanged and reinforced.** Every widened union stays a closed list checked by `expectOneOf` or `SOCIAL_OFFER_ACTIONS` membership. A value outside the three-member `action` list, outside the widened `relatedSocialTaskId` list, or outside the six-member `StressChannelId` list **throws**. It is never coerced to a default, never dropped from its array, never renumbered, never repaired — `socialOffers.ts`'s stated discipline ("throws on every malformed shape, never sorts/clamps/renumbers/drops") applies verbatim. Widening changes *what is valid*; it changes nothing about *what happens to the invalid*.

Two additions in the same posture:

- `validateSimulationState` gains D11.5(a)'s invariant — at most one `comfort` execution naming a given recipient, whether that execution is in-progress or suspended (any combination) — as a **rejection**, never a deduplication, never resolved by D12's tie-break. This is a **state-level assertion**, not a load-only check: the same function runs at every tick boundary (`tick.ts:550`, `tick.ts:366`) as well as at the end of `deserialize`. After v0.4.0 the admission guard and this assertion enforce the same predicate.
- **`action: "assist"` and `relatedSocialTaskId: "assist"` are rejected on load in v7**, exactly as they are today, because Assist is not added to any union. This is the deferral's persistence-layer teeth.

### 13.4 Where the bump is recorded

In **ADR-24** (§14), because ADR-21 D5 owns the offer store's load rules and site 1. Sites 2–4 live in `serialization.ts`'s mirrored lists and `stress.ts`, which no ADR owns exclusively; ADR-24 records the version bump and its rationale once, and this design document governs the three non-ADR-21 sites directly — the division ADR-22 D6 used when recording save-v5's implications.

## 14. D10 — ADR determination, realized as ADR-24

**An ADR is required before implementation, and it is drafted with this revision:** `ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md`, status **Proposed**.

**Why a new ADR rather than editing ADR-21 in place.** ADR-21's own text calls this "a revision of this ADR," but that phrase governs the *process gate* (architecture review + Human acceptance), not the file mechanics. The file mechanics are settled elsewhere and unambiguously: `ai-studio/adr/README.md` — "ADRs are immutable once accepted — superseded decisions get a new ADR that references the old one" — and `ai-studio/SYSTEM_MAP.md` — "Append-only documents (`adr/`, …) … are never edited after being written." ADR-21's own in-place edits were made **during** its review, before acceptance, as its status line records. So the revision is realized as a new numbered ADR that **amends ADR-21 D2 and D5 only**; ADR-21 D1, D3, D4, D6 and Invariants 1–8 continue to govern unchanged, which is why this is an amendment rather than a supersession.

**Number 0024, not 0023.** `origin/codex/issue-142-adr-23` already claims `0023-mission-control-projection-and-control-boundary.md`. README's rule is "never reuse a number"; skipping an in-flight one honors it.

**Not performed by this task, deliberately:** flipping ADR-21's header to `Amended by ADR-24 (D2, D5)` is a one-line edit to an Accepted, append-only document and is an **acceptance-time action for the architecture/Human gate**, not something a draft may do. ADR-24 states this explicitly.

**ADR-24's scope** (full text in the file): the three-member `SocialOfferAction`; the action-keyed responder-eligibility rule and `responderNotInterruptible`'s generalized meaning with no new reason code; save format v7 with all four sites and the three compatibility cases; the one-comforter-per-recipient **state-level** invariant covering in-progress and suspended Comfort executions (v0.4.0); and the explicit record that `"assist"` is **not** admitted to any persisted union by this ADR, so wiring Assist later is its own architecture gate.

**Per the Architecture Review Required table** (`ai-studio/workflows/kanban-update-protocol.md`), the triggers are **Data model** and **Serialization**. Every other decision here (D1, D3, D5's Comfort draw, D7, D8, D11's Comfort bounds, D12) instantiates already-Accepted architecture and is governed by this design document directly.

**No revision of ADR-17, ADR-18, ADR-20, or ADR-22 is required.** ADR-18 fully authorizes Comfort's behavioral vocabulary (D1, D4, D5, D6, D7, D8). **No new stress-system ADR is required**: `positiveSocialProximity` is a value-level addition within M7's already-Accepted ownership of "the four reliefs" (decision-loop §7). **No ADR authorizes a work-progress model, which is why §5.2 declines to invent one and the ruling defers Assist.**

**Sequencing:** this design v0.4.0 + ADR-24 draft → re-review of the resume-path fix → Human design approval → ADR-24 architecture review and Human acceptance → only then does Cursor implementation begin. Implementation touching `socialOffers.ts`'s closed unions, `stress.ts`'s `evaluateStress` signature, `tasks.ts`'s `isTaskComplete`, or `serialization.ts`'s version and mirrored lists is blocked until ADR-24 is Accepted.

---

## 15. Assist follow-up — issue proposal (not filed)

Per ruling 3, prepared here for the Human to file. **No GitHub issue is created by this task.**

**Proposed title:** `[Phase 3] Assist action wiring — blocked on a work-progress model and observable working targets`

**Parent:** #119 · **Predecessor:** #151 (Slice 7, Comfort-only) · **Governing ADRs:** ADR-18 D1/D3/D4.3/D6/D7, ADR-21 + ADR-24

**Summary.** Slice 7 shipped Comfort and deferred Assist by Human ruling (PR #152, 2026-07-27) because, at Stage 2, Assist would have had zero work effect and could only have targeted idle colonists. This issue tracks wiring Assist once the two structural preconditions exist.

**Scope — in**
- Assist candidate generation from `"working"`/`"blocked"` with eligibility checked against the *assisted* task per ADR-18 D4.3 (design §3).
- DQ-18.7 **Option A, already ruled**: non-rejection — lifecycle steps 1–5, then `"accepted"` with `reason: null` and zero PRNG draws. Not to be reopened.
- A bounded Assist work effect defined against whatever work-progress model exists at that time, with the invariants design §5.2 already fixes: zero completion authority for the assistant; the assisted colonist retains sole ownership of their task's progress and completion.
- `sharedTaskCompletion` emitted **exactly once**, at the `inProgress → completed` transition of the assistant's own `assist` execution, above a minimum-participation floor, as a flat delta — never per tick.
- An explicit `isTaskComplete("assist")` criterion (it is `false` today and must not stay so once reachable).
- The no-Assist-on-Assist guard at **offer resolution** (not perception), since `TASK_AMBIENT_STATE.assist = "working"`.
- Extending `SocialOfferAction`, `Goal.relatedSocialTaskId`, and `socialOfferCreated.action` to admit `"assist"`, extending the participation basis with `assistRecipients`, and the accompanying save-format bump — each requiring its own ADR gate.

**Scope — out**
- Policy-assigned collaboration of any kind (design D3's standing constraint: tier-3-sourced work is never Assist).
- Confrontation, `In Conflict`, and any change to Comfort's shipped behavior.
- Resolving `design/autonomous-three-colonist-runtime.md` DQ-2 (responder-side goal commitment).

**Dependencies / blockers** — this issue cannot start until **at least one** of the following lands, and its acceptance criteria are unsatisfiable without them:
1. **A real work-progress model** — some persisted or derived quantity that `workAtWorkstation` accumulates or consumes, so there is something for Assist to cover. Today `Execution` has no progress field and `applyProgressConsequences("workAtWorkstation")` returns `{}`.
2. **Per-colonist or staggered work scheduling** — so that a colonist can be observed `"working"` while another is in their free period. Today `currentPeriod` is colony-global, which makes observable working targets unreachable (design §3.2's seven-step proof).

Either alone makes Assist meaningful; (2) is required for it to be *reachable* at all, (1) for it to have a *work* effect rather than a purely social one.

**Acceptance criteria**
1. An Assist offer is generated, accepted, executed, and completed toward a colonist observed `"working"` on real work, in a fixed-seed multi-colonist run — with a test that fails if the target set has silently collapsed to `"blocked"` again.
2. The bounded work effect is specified in an approved design revision and pinned: what is covered, its cap, and its interaction with the assisted colonist's own progress.
3. The assisted colonist's task completes on exactly the same tick with and without an accepted Assist, unless the approved work-effect specification says otherwise and pins the new tick explicitly.
4. Exactly one `sharedTaskCompletion` relationship write per accepted Assist across its whole lifetime; zero for declined, cancelled, expired, interrupted-and-never-resumed, or below-floor Assists; no re-emission on resume.
5. `isTaskComplete("assist")` has an explicit criterion and an accepted Assist provably terminates.
6. No Assist-on-Assist chain is reachable; no two in-progress Assists name the same recipient.
7. Assist consumes zero PRNG draws at acceptance (Option A), pinned by a two-seed determinism test.
8. An accepted ADR covers the union widenings and the save-format bump before implementation merges.
9. Slice 7's Comfort suite and the deferral pins in design §19 are updated deliberately, not deleted silently.

## 16. Findings still open for the Human gate

The two largest v0.2.0 findings (DQ-18.7; Assist's reachability) are **closed by the ruling**. The resume-path finding against v0.3.0 is **closed by v0.4.0** (§0.5). Three tuning-adjacent items remain, none blocking; Finding 4 records the accepted cost of the chosen fix:

1. **Decline-friction magnitude.** Should Comfort declines reuse `declineAffinityDelta` (`tuning.ts:163`) or get their own constant? This design defaults to reuse (§9); ADR-18 D6 specifies no per-action decline magnitude, so reuse is the traceable default. A reviewer may want Support-category declines tuned separately from Companionship-category ones.
2. **Comfort's stress relief: responder only, or a smaller relief for the initiator too?** ADR-18 D8 names the recipient's relief explicitly and is silent on the comforter's. This design grants none to the initiator (§9). Extending it generically would raise retrofitting Conversation/Shared Downtime — out of scope per Issue #151's "no existing regression."
3. **Should a v7 build accept additive-subset v6 saves?** D13.3 Case 1 rejects them, preserving reject-only loading. Subset acceptance would be technically safe here but would set a multi-version compatibility precedent — its own ADR, not this design's call.
4. **Suspended-comforter reservation window (accepted cost of v0.4.0).** A suspended Comfort reserves its recipient until the suspension ends or the suspended pair is abandoned (`tick.ts:457–465`). During that window the recipient receives no `positiveSocialProximity` relief and other initiators decline with `responderNotInterruptible`. This is deliberate, bounded, and preferred over a resume-time re-check (§0.5, §21). Not blocking; recorded so calibration and playtesting know the trade-off exists.

## 17. Deferred Questions (prototype tuning, not architecture)

| # | Question | Owner |
|---|---|---|
| DQ-1 | `comfortAcceptanceProbability` values per relationship state (must differ from, and per D4 generally exceed, Conversation's table at comparable bands) | Prototype calibration (ADR-18 DQ-18.1 discipline) |
| DQ-2 | `comfortAffinityDeltaPerTick` magnitude | Prototype calibration |
| DQ-3 | The `positiveSocialProximity` relief magnitude (`STRESS_TUNING`) | Prototype calibration, same discipline as `restReliefPerTick`/`satisfiedReliefPerTick` |
| DQ-4 | `comfortSocialRestorePerTick` magnitude | Prototype calibration |
| DQ-5 | Whether Comfort's decline friction reuses `declineAffinityDelta` or gets its own constant (Finding 1) | Human gate, then calibration |

*Withdrawn with the Assist deferral:* v0.2.0's `assistAffinityDeltaOnCompletion`, `assistMinimumParticipationTicks`, and `assistSocialRestorePerTick` — they return with the follow-up (§15).

## 18. Expected file areas — **Comfort only**

Final paths are implementation freedom within this design's contract:

- `prototype/src/decision/goals.ts` — `generateVoluntaryCandidates` extended for Comfort candidates; `GoalCandidate.relatedSocialTaskId` widened to three members (D1).
- `prototype/src/task/socialOffers.ts` — `SocialOfferAction`/`SOCIAL_OFFER_ACTIONS` widened to three; `isEligibleTargetState` added with a `never` default (D6).
- `prototype/src/task/tasks.ts` — `candidateTaskIdsFor`'s `voluntary` case routes `"comfort"`; `isTaskComplete` gains the `comfort` row and **keeps `assist` at `false`** (D6/§5.1).
- `prototype/src/simulation/tick.ts` — the participation basis built pre-Phase-3 (D12, including `claimedRecipients`); Phase 3's basis lookup feeding `evaluateStress` (reads `recipients` only); Phase 5's offer-creation branch widened; Phase 6's action-keyed target-state check and participation guard (reads `claimedRecipients` + `participants`); Comfort consequence application; the atrophy exclusion predicate widened (§5.1). `validateSimulationState` gains the strengthened one-comforter assertion.
- `prototype/src/colonist/stress.ts` — `evaluateStress` gains the `isReceivingComfort`-style input; `StressChannelId` gains `positiveSocialProximity` (D7).
- `prototype/src/config/tuning.ts` — new provisional constants (§17).
- `prototype/src/core/serialization.ts` — `SAVE_FORMAT_VERSION` 6 → 7; the three mirrored closed lists widened (D13).
- `prototype/src/replay/replay.ts`, `prototype/src/inspection/inspector.ts` — no change expected (D9); listed defensively.
- `ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md` — the required ADR (D10), drafted with this revision, reviewed on its own gate.
- Corresponding colocated `*.test.ts` files for every module above.

**Not touched:** no Assist candidate generation, no Assist offer action, no Assist completion criterion, no Assist tuning constants.

## 19. Test matrix — **Comfort in scope, plus deferral pins**

Every row is a regression-class addition; none removes or weakens an existing test.

**Deferral pins (Assist is not in this slice) — new, and the enforcement of ruling 2**
- `SOCIAL_OFFER_ACTIONS` has exactly three members and does not contain `"assist"`.
- Load **rejects** a save containing `socialOffers.offers[].action === "assist"`.
- Load **rejects** a save containing `relatedSocialTaskId === "assist"` on any persisted goal.
- Load **rejects** a save containing `socialOfferCreated` with `action: "assist"`.
- `generateCandidates` never produces a candidate with `relatedSocialTaskId === "assist"`, for any source, on any snapshot (property test).
- `candidateTaskIdsFor` never returns `"assist"`, for any source (property test), and returns exactly `["workAtWorkstation"]` for `shiftAssignment` (D3 regression pin).
- `isTaskComplete("assist", …)` remains `false` for every snapshot — the unreachable-vocabulary pin.
- No `assist*` key exists in `SOCIAL_OFFER_TUNING` or `TASK_TUNING`.

**Candidate generation (D1)**
- Comfort candidate generated only for a nearby colonist observed `"stressed"`; absent for every other ambient state.
- Not generated outside `currentPeriod === "free"`.
- `baseUrgency` equals `WEIGHT_TUNING.voluntaryBaseWeight` regardless of anything about the target — the "distress must not force acceptance" structural pin.

**Bounded execution and completion ownership (§5.1)**
- `isTaskComplete("comfort", …)` is `false` in a free-period snapshot and `true` in work- and rest-period snapshots — mirroring the existing Conversation/Shared Downtime assertions (`tasks.test.ts:204–209`).
- An accepted Comfort terminates at the free-period boundary in a full run, with bounded total relationship, Social-need, and stress movement.
- Comfort never writes the responder's `execution` slot: the responder's execution across an accepted Comfort is identical to a no-Comfort control run in `taskId`, `goalKey`, `status`, `startedAtTick`, and completion tick.
- **Atrophy exclusion:** an actively-comforting pair is excluded from `applyAtrophy` for every tick its execution is in progress — a direct regression pin against the `companionshipAffinityDeltaPerTick(taskId) > 0` predicate silently dropping it.

**Double-application prevention (§5.3)**
- Two simultaneous Comfort offers toward the same responder resolve to exactly one acceptance; the second declines with `responderNotInterruptible` or cancels with `responderUnavailable` via the pre-existing double-booking guard.
- **No Comfort-on-Comfort:** an offer whose responder is the initiator of an in-progress Comfort declines with `responderNotInterruptible` — constructed with a comforter whose own stress has crossed the threshold, so the responder genuinely reads `"stressed"`.
- A responder never receives two `positiveSocialProximity` contributions in one tick.
- A comforting pair never receives two `mutualSupportCrisis` writes in one tick.
- **Suspended claim blocks admission (v0.4.0):** an offer whose responder is claimed only by a *suspended* Comfort declines with `responderNotInterruptible`.
- **End-to-end resume pin (v0.4.0):** Comfort accepted → suspended → a second initiator's offer declines → first Comfort resumes — `validateSimulationState` passes at every tick boundary throughout; never two in-progress Comforts naming one recipient.

**Eligibility and relationship gate (D4/D6)**
- Comfort declines with `relationshipGate` for a Hostile-or-Fractured pair in either direction, before any draw.
- `isEligibleTargetState` returns `true` for Comfort exactly on `"stressed"`, and reproduces `isInterruptibleAmbientState`'s existing table unchanged for Conversation/Shared Downtime.

**Acceptance/decline semantics (D5)**
- Comfort: an accepted draw and a declined (`acceptanceDraw`) draw are both reachable and attributed — exactly one `next(prng)` call per resolving Comfort offer, decomposable in the event trace.
- Every offer-backed action in Slice 7 consumes exactly one draw at step 6 (the uniform draw-count pin from §11).

**Participation basis (D12)**
- **Order independence:** permuting `state.colonists` produces an identical basis (same entry set, same tie-break outcome, same `claimedRecipients`).
- **Tick-start purity:** the basis computed from `state.colonists` equals the basis computed from a deep copy taken before Phase 3.
- **No cross-runtime read in Phase 3:** colonist X's Phase 3 stress result is bit-identical regardless of any mutation Phase 3 applies to any colonist W ≠ X — realized as a permutation test plus a directly-seeded divergence in W's tick-start stress.
- **Fail-closed derivation:** an in-progress `comfort` execution whose `currentGoal` is absent, non-active, mismatched in `relatedSocialTaskId`, mismatched in `key`, self-referential, or missing `relatedColonistId` contributes a participant and **no** recipient — no relief, no active claim, no throw.
- **Suspended claim derivation (v0.4.0):** a suspended Comfort (interrupted execution + paired `suspendedGoal`) contributes a `claimedRecipient`, **no** `recipient`, and **no** `participant`.
- **Fail-closed suspended claim:** a suspended pair whose goal mismatches in `key`, `status`, `relatedSocialTaskId`, or `relatedColonistId` contributes no claim.
- **No relief while only claimed:** a responder whose only comforter is suspended receives no `positiveSocialProximity` contribution that tick.
- **Tie-break totality:** a hand-constructed collection with two active comforters naming one recipient yields the lowest-id comforter in `recipients`, and `validateSimulationState` rejects that same collection as a state.
- **One-tick lag:** a Comfort accepted in Phase 6 of tick *T* produces the responder's first `positiveSocialProximity` contribution in *T+1*, and none in *T*.

**Consequences (D7)**
- Accepted Comfort: both directions gain affinity via `mutualSupportCrisis`; both parties' Social need is restored; the responder's stress shows a separately-attributed `positiveSocialProximity` relief in `stressEvaluated`; the initiator's stress is unaffected by this channel.
- Declined/cancelled/expired Comfort: zero Social-need change, zero stress change, zero Purpose change; declines apply exactly the existing `forcedProximityMutualStress` friction and nothing else.
- Property test: no code path this design adds ever writes a Purpose-related field.

**Save/load, version, compatibility (D13)**
- `SAVE_FORMAT_VERSION === 7`.
- A v6 save is rejected by a v7 build with `Unsupported save format version: 6 (expected 7)` — the version gate, not a field error — and **no** partial state is constructed.
- A v7 save round-trips a state holding a pending Comfort offer mid-delay, an accepted Comfort offer, and a declined Comfort offer, each bit-identical.
- Load rejects an `action` outside the three-member union; a `relatedSocialTaskId` outside the widened union; a `stressEvaluated` contribution id outside the six-member list — each with a throw and no constructed state.
- `validateSimulationState` rejects a state with two Comfort executions naming the same recipient in any combination of in-progress and suspended — rejects, does not deduplicate.
- A v7 save containing `positiveSocialProximity` contributions loads cleanly.

**Determinism, phase order, replay (D8/D9)**
- A fixed-seed multi-colonist run including at least one accepted Comfort reproduces an identical event/decision trace on replay (extends the Slice 6b/6c replay-verification tests).
- Reordering two colonists' ids in the collection does not change a third colonist's Comfort candidate set or eligibility outcome.

**Regression (Issue #151's Shared Requirements)**
- Full existing Conversation, Shared Downtime, Shared Meal, and Slice 6c multi-colonist offer suites remain green, unmodified in their assertions; no existing stress trajectory moves.

## 20. Required validation commands

Repository-defined, verified present:

```powershell
npm --prefix prototype test
npm exec --prefix prototype -- tsc --noEmit -p prototype/tsconfig.json
node tools/ai-workflow/validate-workflow-pack.mjs .
node --test tools/ai-workflow/validate-workflow-pack.test.mjs
git diff --check
```

`tools/ai-workflow/` contains exactly `validate-workflow-pack.mjs` and `validate-workflow-pack.test.mjs`; v0.1.0's `validate-workflow-record.test.mjs` line was removed in v0.2.0 as a non-existent file. Targeted Vitest runs during TDD do not replace the full `npm --prefix prototype test` suite before review.

---

## 21. Options Considered

| Option | Summary | Rejected because |
|---|---|---|
| **Ship Assist anyway with zero work effect** | Completes ADR-18's Support pair in one slice | **Rejected by Human ruling 2.** §3.2 proves it could only target idle colonists and §5.2 proves it would do nothing for them — an action whose entire content is a relationship delta, presented to the player as "assistance" |
| **Ship Assist narrowed to `"blocked"` targets only** | Honest about what is reachable | Diverges from ADR-18 D4.3's text, would need re-widening later, and still has no work effect — the ruling declined both halves |
| Invent a work-progress quantity so Assist can transfer some of it | Makes "cover behavior" literal | A new M12 data-model decision no ADR authorizes; changes `workAtWorkstation`'s solo completion semantics (violating Issue #151's no-regression requirement); adds a persisted `Execution` field. Deferred to the follow-up's blocker 1 |
| Delete the Assist analysis from this document | Shorter, Comfort-focused | Discards the reviewed answer to Codex blocker 1, which the follow-up issue needs verbatim. Retained under explicit "deferred" markers instead |
| Rely on intent alone to keep Assist out of Slice 7 | No extra tests | Scope creep in a widened-union slice is exactly the kind of drift that is invisible in review. §19's eight deferral pins make the boundary enforceable |
| Skip the save-version bump now that only Comfort ships | One less bump | Three of the four persisted sites still widen, and site 4 follows from D7's relief channel. The reasoning in D13.2 is unchanged by narrowing |
| Edit ADR-21 in place | Matches ADR-21's own "revision of this ADR" phrasing | `adr/README.md` ("immutable once accepted") and `SYSTEM_MAP.md` ("never edited after being written") settle the file mechanics; ADR-21's in-place edits happened during its review, pre-acceptance. Realized as ADR-24 amending D2/D5 |
| Number the new ADR 0023 | Next sequential number in the main tree | `origin/codex/issue-142-adr-23` already claims 0023; README forbids reuse |
| A second, Comfort-specific offer store | Keeps ADR-21's store untouched | Duplicates the mechanism for an action needing no different shape — the closed `action` union extension point exists to avoid this |
| Skip the offer protocol for Comfort (direct same-tick resolution) | Simpler | Reopens the unreachable-pending-state defect `social-offer-response-protocol.md` v0.1.0 was rejected for; contradicts ADR-18 D5's "no colonist is commanded into an interaction"; and breaks §5.3's proof, which depends on the ≥1-tick response-delay floor |
| Give the responder of an accepted Comfort their own goal/execution | Symmetric with the initiator | Out of scope — `autonomous-three-colonist-runtime.md` DQ-2 is deferred to its own gate; the direct-write pattern delivers the consequences without it |
| Derive Comfort participation by scanning `runtimes` inside Phase 3 (v0.1.0) | No new structure | Order-dependent: Phase 3 writes stress as it iterates. Replaced by D12's pre-Phase-3 immutable basis |
| Build the basis after Phase 4, reusing the observation basis's slot | Same-tick acceptances visible sooner | The relief is consumed in Phase 3, which runs *before* Phase 4 — the basis would not exist when needed. Pre-Phase-3 costs one tick of latency (D12.4) and buys a provably fixed input |
| Enforce the one-comforter guard at candidate generation | Prevents the offer being made at all | Requires exposing another colonist's task identity through `ObservableColonist`, breaching locked #21. Enforced at resolution instead |
| Reuse `isInterruptibleAmbientState` unmodified for Comfort | No new eligibility function | Contradicts ADR-18 D4.3 — `"stressed"` is never in that list, so Comfort would decline every offer |
| A generic relief for all Companionship/Support executions | Fuller realization of decision-loop §7 | Retunes Conversation/Shared Downtime's calibrated behavior — out of scope; Finding 2 |
| Keep the one-comforter invariant scoped to in-progress only; add a guard at `resumeSuspended` | Closes the v0.3.0 finding at the producer that was missed | Multiplies guards: every future producer of an in-progress Comfort must remember the same check; the two-suspended case still needs a second rule; admission and `validateSimulationState` keep proving different predicates |
| Demote the invariant to a load-only check; tolerate one-tick double relief on resume race | Cheapest text change | Gives up ADR-24 Invariant 12's "in memory" clause and ships a silent double-application window the design's own §5.3 exists to prevent |
| Re-check at resume and abandon the Comfort goal if the recipient is already claimed | Avoids the reservation window | Same-tick ordering among several resuming colonists becomes load-bearing; silently kills a committed goal; still needs a claim set (or live scan) to know the recipient is taken |

## 22. Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| **Slice 7 narrowed to Comfort-only implementation; Assist deferred** *(Human ruling 2/3, 2026-07-27)* | Assist would ship with zero work effect toward idle-only targets — §3.2's reachability proof and §5.2's zero-transfer result. Comfort is fully reachable and has a specified, bounded effect | Shipping Assist anyway; narrowing Assist to `"blocked"` targets; inventing a work-progress model to justify it |
| **DQ-18.7 ruled Option A (non-rejection), recorded with no Slice 7 effect** *(Human ruling 1)* | Assist's voluntariness is the initiator's; no Tier-1-honest responder-receptiveness signal exists distinct from the relationship gate. Settling it now means the follow-up inherits it decided | Option B (weighted acceptance — would need an ungrounded probability table); leaving it open (would leave the follow-up re-litigating a settled call) |
| **The deferral is enforced by eight negative tests, not by intent** | Scope creep in a union-widening slice is invisible in review; load-rejection and property tests make "Assist is not here" a suite-level fact | Relying on reviewer vigilance; deleting the Assist material entirely (loses the follow-up's substance) |
| **Every widened union gains exactly one member (`"comfort"`), never `"assist"`** | Direct realization of ruling 2's "must not widen runtime/persisted unions in this slice" | Widening to four members and simply not generating Assist candidates (leaves an accepted persisted vocabulary with no owner and no gate) |
| Comfort generated as a tier-5 voluntary candidate, free-period-gated, identically to Conversation/Shared Downtime | Matches ADR-18 D3/D4.1; zero new candidate-generation architecture; reachable because `ambientStateFor` checks stress before execution | A tier-4 Social-need-driven path (unauthorized — Social's tier-4 goal has no serving task) |
| **`isTaskComplete` gains the `comfort` row; `assist` deliberately stays `false`** | Without it an accepted Comfort never terminates and its consequences are unbounded (a v0.1.0 defect). Leaving `assist` at `false` is the deferral's task-layer teeth | A duration-constant cap (needs a fourth argument at four call sites); wiring both rows (out of scope by ruling) |
| Comfort's relationship credit stays per-tick via `mutualSupportCrisis`, bounded by the completion criterion | The change source names a state, not a completion — unlike Assist's `sharedTaskCompletion`. Same shape as the accepted `conversationAffinityDeltaPerTick` | Completion-gated Comfort credit (would misname the change source) |
| **Assist's single-emission rule, zero completion authority, and no-chain guard retained verbatim as follow-up constraints** | They are the reviewed answer to Codex blocker 1; discarding them would force a re-litigation the review already settled | Deleting them with the deferral |
| **Atrophy exclusion predicate widened for Comfort** | `companionshipAffinityDeltaPerTick` returns 0 for `comfort`, so the existing predicate would atrophy an actively-comforting pair — the exact defect `excludedPairs` was generalized to prevent | Leaving it (silent relationship decay during the interaction that should build it) |
| **No-Comfort-on-Comfort guard added** | Genuinely reachable, not theoretical: a comforter whose own stress crosses the threshold reads `"stressed"` and becomes a valid Comfort target, doubling relief | Omitting it as an edge case (the stress-before-execution ordering in `ambientStateFor` makes it ordinary) |
| **D12 basis scoped to Comfort, with `claimedRecipients` additive to `recipients`/`participants`** | Slice 7 needs relief (`recipients`), no-Comfort-on-Comfort (`participants`), and admission claims (`claimedRecipients`); Assist follow-up widens additively | Keeping v0.2.0's two-map shape; widening `recipients` to include suspended (would grant false relief) |
| D12 built once before Phase 3 from tick-start state only, fail-closed, lowest-id tie-break, one-tick lag | Phase 3 writes stress as it iterates, so any live cross-runtime derivation is order-dependent; the fixed basis restores the "one shared basis, fixed before the loop" discipline D3 established | v0.1.0's `runtimes` scan; building it after Phase 4; rebuilding mid-tick |
| The one-comforter and no-chain guards live at offer resolution, not candidate generation | Another colonist's task identity is not Tier-1-observable; putting the guard in perception would breach locked #21 | Widening `ObservableColonist` with task identity |
| Two-sided non-hostile relationship gate, reused unmodified | Codebase consistency; the two-sided check is the established fix for a confirmed defect in the one-sided reading | A literal ADR-18 D4.4 one-sided gate for Comfort alone |
| **Save v7 retained despite the narrowed scope** | Three of four persisted sites still widen and site 4 follows from the new relief channel; the version integer is the only compatibility signal under reject-only loading | Skipping the bump (misleading corrupt-save error when an old build meets a new save) |
| v6 saves rejected outright by v7 builds despite the widenings being additive | Preserves reject-only loading as the single accepted posture; subset acceptance would set a multi-version-compatibility precedent nothing maintains | Silently accepting v6 — raised as Finding 3 instead |
| Validate-never-repair reinforced; `"assist"` values rejected on load; the one-comforter invariant is a continuous state-level assertion covering in-progress and suspended executions | Matches `socialOffers.ts`'s stated discipline, gives the deferral persistence-layer teeth, and keeps admission and `validateSimulationState` on the same predicate (v0.4.0) | Coercing unknown members to a default; dropping them; deduplicating a two-comforter save; scoping the invariant to in-progress only |
| **The ADR-21 revision is realized as a new ADR-24 amending D2/D5, not an in-place edit** | `adr/README.md` and `SYSTEM_MAP.md` both state ADRs are immutable/append-only once accepted; ADR-21's in-place edits were pre-acceptance | Editing 0021 in place; a full supersession (ADR-21 D1/D3/D4/D6 are untouched and still govern) |
| **ADR-24 numbered 0024, skipping the in-flight 0023** | `origin/codex/issue-142-adr-23` claims 0023; README forbids number reuse | Reusing 0023; renumbering the other branch's work |
| **Flipping ADR-21's status header is left to the acceptance gate** | Editing an Accepted append-only document is not a draft's prerogative | Doing it now (pre-empts a decision the gate owns) |
| `responderNotInterruptible` reused with a generalized meaning covering both the action-keyed state table and the participation guard | The union's members are outcome-shaped, not action-specific; a per-action code would fragment a deliberately closed union | `comfortTargetNotStressed` / `responderAlreadyComforted` (unnecessary fragmentation) |
| **Widen the one-comforter claim to cover suspended executions; add `claimedRecipients` to D12; leave `recipients` in-progress-only** *(v0.4.0)* | Offer acceptance is not the only producer of an in-progress Comfort (`resumeSuspended` at `tick.ts:510–526`); scoping the invariant to in-progress forces a guard per producer. Widening the claim makes the single admission check sufficient, aligns it with `validateSimulationState`, and closes the two-suspended case by construction | Guard at resume only; demote the invariant to load-only; re-check at resume and abandon (all §21) |

---

## 23. Kanban Update

**Card:** [Phase 3] Stage 2 Slice 7 — Comfort and Assist (Design)
**Status:** Review — v0.4.0 pushed to PR #152 closing the resume-path finding against v0.3.0 (`claimedRecipients` + strengthened state-level invariant). Awaiting re-review and Human design approval; ADR-24 then goes through its own architecture review and Human acceptance before any implementation.
**Completed (this revision):** Closed the PR #152 review finding that a suspended Comfort dropped out of D12's basis and `resumeSuspended` could restore a second in-progress Comfort naming the same recipient (§0.5). Restated D11.5(a) over Comfort executions in any status; added `claimedRecipients` to D12 with fail-closed suspended derivation and separate relief map (§10.2–§10.4); switched step 5 to read the claim set (§8); corrected the "load rejection" mislabel to a continuous state-level assertion (§5.3, §13.3); recorded Finding 4 as the accepted reservation cost (§16); extended §19 with suspended-claim, fail-closed, no-relief-while-claimed, and end-to-end resume pins; rejected resume-guard / demotion / resume-abandon options in §21; updated ADR-24 D4 / Invariant 12 / validation / Decision Log in lockstep.
**Changed Files:**
  MODIFIED  design/comfort-assist-protocol.md (v0.3.0 → v0.4.0)
  MODIFIED  ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md (Proposed — invariant widened)
**Validation:** Resume-path claim grounded against `tick.ts:450–526`, `tick.ts:550`, `tick.ts:366`, `serialization.ts:732`. Document/workflow validation run: `node tools/ai-workflow/validate-workflow-pack.mjs .`, `node --test tools/ai-workflow/validate-workflow-pack.test.mjs`, `git diff --check`. No production code touched.
**Risks:** Reviewers should confirm that the suspended reservation window (Finding 4) is acceptable playtest behavior, and that `participants` remaining in-progress-only for rule (b) is intentional. D12's one-tick claim lag remains deliberate (§10.4).
**Follow-up Tasks:** Human ruling on Findings 1–3 (tuning-adjacent) and acknowledgement of Finding 4. ADR-24 through architecture review and Human acceptance before implementation. File the Assist follow-up issue from §15 when the Human is ready.

**Not committed as implementation** — design and architecture artifacts only; no code in `prototype/src` is created or modified by this task.
