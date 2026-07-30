# Plan — Stage 2 Validation (Slice 9)

**Version:** 0.1.0 (draft for Codex plan review and Human approval)
**Phase:** Phase 3 — Stage 2 Slice 9
**Status:** Draft — awaiting Codex plan review, then Human approval (`docs/ai-workflow/operating-model.md` Design → Human Approval gate)
**Author:** Claude (plan task)
**Tracks:** GitHub issue #160 (parent #119)
**Authority (treated as authoritative):** `design/social-offer-response-protocol.md`; `design/autonomous-three-colonist-runtime.md`; `design/comfort-assist-protocol.md` v0.4.0 (§15's Assist deferral, still in force); `design/confrontation-conflict-protocol.md` v0.2.0; ADR-17, ADR-18 D1–D10, ADR-20, ADR-21, ADR-22, ADR-24, ADR-25 (all Accepted); `design/engineering-specification.md` v0.3.0 (seven-phase order, §7's determinism/speed-invariance obligations); `design/ai-behavior-specification.md` (citing ADR-16, Colonist Memory Architecture — a pre-repository decision, no file under `ai-studio/adr/`, same status as ADR-08/12 in the Confrontation design); `docs/ai-workflow/operating-model.md`, `docs/ai-workflow/prompt-pack.md`

**This document is NOT implementation.** It is a test/validation plan: which scenarios must exist, why, and where. No `prototype/src` file is created or modified by this task. Cursor implements exactly the matrix below in T4, after this plan is reviewed and Human-approved (per Issue #160's own T1–T6 sequence).

**Traceability rule:** every claim about current test coverage below was verified by reading the actual test files listed (describe-block names, fixture bodies, assertions), not assumed from a slice's own design-doc claims. Where a design doc's test matrix (§14 of the Comfort/Assist or Confrontation protocols) already specifies a test, this plan cites it rather than re-deriving it, and states only what is *actually present in the test suite today* versus what §14 merely *specified*.

---

## 1. Context — what Slice 9 closes

Issue #119 (the Stage 2 epic) lists nine acceptance criteria, none yet checked off — its own Kanban Update record explicitly reserves them for this slice's "cross-slice validation sweep," not per-merge ticking. Slices 5–8 each shipped their own scoped test matrix (visible in `prototype/src/**/*.test.ts`) and each passed in isolation. What has never been demonstrated is the **cross-slice, real-run picture**: that the accepted actions work end-to-end together, that relationship/memory consequences from one action measurably reach a *later* decision, and that save/load/replay hold across the full action set, not just per-slice.

This plan's job (Issue #160's own words) is to produce the **exact trace matrix**, not to invent new gameplay. Two ground rules carried over from every prior Stage 2 slice:

- **Assist stays out.** Parent #119's acceptance criteria list Assist inside "Conversation, Shared Downtime, Shared Meal, Comfort, Assist, and Confrontation work end-to-end" — this plan does **not** check that box for Assist. §8 (D8) below states exactly how that checkbox is handled instead.
- **No new gameplay, no recalibration.** Confrontation's provisional tuning (DQ-1–DQ-5, `design/confrontation-conflict-protocol.md` §13) and Comfort's own deferred tuning are not reopened here — only pinned as documented, known values under test.

## 2. D1 — Exact trace matrix: what exists today vs. what this slice must add

Verified by reading `prototype/src/**/*.test.ts` directly (file names, `describe` block titles, fixture bodies) — not inferred from a slice's own design doc.

| Action | Accepted/fire path — tick()-level | Declined/no-fire path — tick()-level | Consequence assertions (need/stress/relationship/memory) |
|---|---|---|---|
| Conversation | ✅ `tick.test.ts` "social offer/response protocol" (Slice 5) — uses conversation as its example action | ✅ same block ("declines... no execution, no Social restore, decline friction") | ✅ present in the same block |
| Shared Downtime | ✅ `tick.test.ts` "companionship execution effects" (`sharedDowntime` fixture, drift/restore-rate comparisons vs. conversation) | Shares the generic offer-decline path above (action-agnostic mechanism) | ✅ present |
| Shared Meal | ✅ `tick.test.ts` "shared meal overlay" (Slice 4) | N/A — Shared Meal is an overlay, not an offer/response action (no decline path exists to test) | ✅ present |
| Comfort | ⚠️ **Gap.** Offer *lifecycle* (creation eligibility, accept/decline draw, relationship gate) is exercised generically via the conversation fixture and is action-agnostic per ADR-21/24's closed-union discipline — so the mechanism itself is covered. **But no `tick()` test exists anywhere that runs an accepted Comfort execution to completion and asserts its own claimed consequences** (`positiveSocialProximity` stress relief, the one-comforter-per-recipient claim actually held across a real tick, relational memory formed). `simulation/comfortParticipation.test.ts` (157 lines) tests only the pure basis-building/claim-collection functions in isolation; `task/socialOffers.test.ts` tests only store-level eligibility. Candidate generation is unit-tested (`decision/goals.test.ts`). | Shares the generic offer-decline path (mechanism covered); Comfort-specific decline consequence (none beyond the generic offer decline friction) is not separately asserted, but ADR-18 D6 does not claim one exists either. | ❌ **Gap** — no real-run assertion of stress relief, no-Social-credit, or relational memory for an actual accepted Comfort |
| Confrontation | ✅ `tick.test.ts` "Stage 2 Slice 8 — Confrontation / In Conflict" (seed-hunt pattern, `confrontationOccurred` event, relationship/stress/`inConflictUntilTick` assertions, no-goal/execution-change assertion) | ✅ same block ("moduleId null colonists are never Confrontation participants") | ✅ present (including the fixed-seed replay-reproduction test) |
| Assist | N/A — deferred (§8/D8 below) | N/A | N/A — only negative (rejection) pins exist and must stay green: `core/serialization.test.ts` rejects `assist` in three persisted surfaces (offer action, goal `relatedSocialTaskId`, `socialOfferCreated` event); `task/tasks.test.ts` confirms `assist` stays unreachable vocabulary |

**Cross-cutting gaps, not specific to one action:**

- **Relationship-affects-later-decision:** the mechanism exists and is unit-tested in isolation (`decision/weights.test.ts`'s "relationships family" — `applyRelationshipContributions` composes correctly), but **no test runs a real multi-tick scenario where a relationship shift from one action (e.g., a Confrontation's negative delta, or Shared Downtime's positive drift) measurably changes which candidate a *later*, independent decision selects.** This is Issue #160's own acceptance criterion #6 ("in at least one pinned scenario") and does not exist today.
- **Relational-memory-affects-later-decision:** same structure. `decision/weights.test.ts`'s "memory family" tests `applyMemoryContributions` in isolation; `tick.test.ts`'s "relational memory formation via real ticks" confirms a `memoryFormed` event fires, but nothing threads that formed memory forward into a later `generateCandidates`/weight-composition call in the same test. Issue #160's acceptance criterion #7 is unmet today, and its own escape hatch applies for one sub-case: **Confrontation's provisional `directConflictAffinityDelta` may not clear ADR-16's significance threshold** (a documented DQ, `design/confrontation-conflict-protocol.md` §13 DQ-4) — this plan must either pick a scenario where significance is clearly met (e.g., via Shared Downtime/Conversation's repeated positive drift, or a hand-built high-magnitude interaction) or document the shortfall per Issue #160's own permitted phrasing ("or document why the provisional delta does not form memory yet").
- **Save/load continuation is generic, not per-action-in-flight.** `main.test.ts`'s "load serialized state and continue identically" proves continuation for *whatever state exists* at an arbitrary tick — it does not specifically pin a save taken mid-pending-offer, mid-accepted-Comfort-execution, or mid-`In Conflict`-window. Each *field's own* round-trip is separately proven at the serialization layer (per Comfort/Confrontation's own §14 matrices), but a live `continueRun` scenario interrupted mid-action, across the full action set, has never been demonstrated together.
- **Replay/terminal-state:** `replay.test.ts`'s "terminal-state verification" and "multi-colonist replay determinism" use the generic `STATE_FIELDS` diff mechanism, which — per ADR-22 D6's own design intent — automatically covers any current or future field, Comfort's and Confrontation's included. This is a real, verified guarantee (not a gap), but this plan should add one explicit multi-action fixed-seed run so the claim is demonstrated for the actual current action set, not only inferred from the mechanism's generality.

## 3. D2 — Relationship/memory-influences-later-decision: the required scenario

One pinned scenario, reusing existing mechanisms only (no new weight math, no new candidate source):

1. Build a two-colonist state where colonist A has two roughly-equal-weight voluntary candidates available at the same tier: a `conversation` candidate toward colonist B, and one unrelated candidate with no relationship tie (e.g., an idle/self-serving candidate).
2. Drive several real ticks of `run()` (not hand-constructed state) that produce a large, unambiguous relationship shift toward B in one direction — the simplest, already-existing lever is repeated Shared Downtime/Conversation ticks (positive drift) or one hand-authored `applyInteraction` call with a large magnitude before the decision tick (matching the existing hand-built-fixture pattern `tick.test.ts` already uses for Confrontation's `workstationPairState`).
3. Assert that `decide()`'s chosen candidate for A changes between the "before" and "after" relationship states, all else held equal — i.e., the relationship-toward-B tilt was large enough to flip the selected candidate, not merely to nudge its weight. This is the acceptance criterion's own bar ("demonstrably affect later candidate weights / decisions"), not a mere unit-level weight-composition check (already covered).
4. Repeat the same shape for memory: force a `memoryFormed` (relational) event via a real tick, then run a later decision tick and assert the same before/after candidate-selection change, citing `influence()`'s fade curve so the test picks a "later" tick still within the memory's non-negligible influence window (per `memory-system.md`/ADR-16's fade model).

## 4. D3 — Save/load continuation, mid-action

Four save points, each taken mid-action, each continued and compared against an uninterrupted run of the same total length (reusing `continueRun`'s existing contract, `main.test.ts`'s own pattern):

1. Mid-pending social offer (any offer-backed action, respondable but not yet resolved).
2. Mid-accepted-Comfort execution (comforter and recipient both mid-execution).
3. Mid-`In Conflict` window (`inConflictUntilTick` in the future relative to the save's own clock).
4. Mid-suspended-goal (an existing Slice 6 scenario, included for completeness against the full current field set — not new).

Each must satisfy exactly `main.test.ts`'s existing assertion shape: `continued.save === uninterrupted.save` and `continued.summary === uninterrupted.summary`. No new save/format field, no new invariant — this is exercising the existing contract against a fuller set of starting states than today's generic pick.

## 5. D4 — Replay: event log, decision log, terminal-state match

One fixed-seed, multi-colonist run long enough to plausibly exercise Conversation, Shared Downtime, Shared Meal, Comfort (accepted at least once), and Confrontation (fired at least once — reusing the existing seed-hunt pattern from `tick.test.ts`'s Confrontation block) in a single trace. Assert:

- `verifySaveReplay`'s existing match/mismatch contract returns `"match"` for this run (reusing `main.test.ts`'s own `demoRun(...).replay.kind === "match"` pattern, not inventing a new verification path).
- The event log and decision log reproduce byte-identically across two independent `tick()`/`run()` invocations from the same initial state and seed (the same double-run-and-compare pattern `tick.test.ts`'s Confrontation "replay determinism" test already uses).
- Terminal state matches via the existing generic `STATE_FIELDS` diff (`replay.ts`), asserting zero divergent fields.

This does not require a new replay mechanism — it is one integration-scale exercise of mechanisms already proven generically, run across the actual current action set together for the first time.

## 6. D5 — Simulation-speed invariance: N/A, with rationale

Verified directly: `design/engineering-specification.md` §7 states the *obligation* ("Speed-scaling invariance... behavior at 2x/4x must be the same simulation faster"), attributing it to M1 (the simulation clock) and ADR-06. But `prototype/src/simulation/run.ts` has **no speed-multiplier parameter at all** — `run()` accepts only a tick count and steps by the fixed `BASE_TICKS_PER_STEP`; there is no Pause/1x/2x/4x concept anywhere in the prototype's runtime. M1's full speed-control surface is not yet built at Stage 2 (matching the same pattern as `stress.ts`'s own documented Stage-1 scope boundary elsewhere in this codebase — a real, load-bearing absence, not an oversight to paper over).

**This plan records the criterion as N/A for the prototype as it exists today**, per Issue #160's own explicit permission ("plan records N/A with rationale if the prototype has no speed multiplier"). No test is added for it. If a future slice adds a speed-multiplier parameter to `run()`, this criterion becomes live and this plan's N/A finding is the trigger to revisit it — flagged as Finding 2 below, not silently dropped.

## 7. D6 — Inspector detachment / exposure checklist

No new inspector field is required (`design/comfort-assist-protocol.md` and `design/confrontation-conflict-protocol.md` both already concluded this, and `inspector.ts`'s existing per-colonist/relationship/offer summaries already expose everything the acceptance criteria ask for — ambient state including `inConflict`, stress with source breakdown, relationship pairs, offers). This plan's job is a **coverage checklist run against `inspector.test.ts`**, not new mechanism:

- Per-colonist summary detachment already tested generically (`"detached snapshots"` describe block) — confirm it holds for a colonist mid-Comfort and mid-`inConflict` (currently untested combination, cheap to add as parametrized cases, not new mechanism).
- Relationship pair inspection already tested (`"relationship pair inspection"`) — confirm a Confrontation-shifted pair's perspective reads correctly (reuses existing test, new fixture only).
- Social offer inspection already tested (`"social offer inspection"`) — confirm a Comfort offer's full lifecycle (created → accepted → resolved) is visible, not just Conversation's (the existing tests' example action).

## 8. D7 — ADR / save-format trigger check

**No ADR is triggered. No save-format bump.** This slice adds no new field, no new closed-union member, no new event kind, and no new persisted surface of any kind — every scenario above exercises save/load/replay/inspector contracts that already exist, against inputs (mid-action states) that are already valid, already-accepted shapes. Per `ai-studio/workflows/kanban-update-protocol.md`'s trigger table, a pure test-and-validation slice with zero data-model/serialization/replay-contract changes does not cross the architecture gate. This matches Issue #160's own default expectation verbatim ("default expectation: none").

## 9. D8 — Parent #119's Assist checkbox: explicit handling

Issue #119's acceptance criterion reads "Conversation, Shared Downtime, Shared Meal, Comfort, Assist, and Confrontation work end-to-end." This plan's own test matrix (§2/§10) **does not cover Assist** and does not check that box. Per Issue #160's own required handling (one of two explicit options):

**Chosen: Assist is treated as an explicit, named deferral, not a silent omission.** This plan's own Kanban Update (§17) and any closing summary for Issue #119 must state plainly that the "Assist" clause of that acceptance criterion is **not met and not being met by this slice** — Assist remains exactly as deferred as it has been since `design/comfort-assist-protocol.md` §15's own Human ruling on PR #152. Closing Issue #119 (or checking that box) requires either a Human ruling that the criterion's wording is satisfied by "5 of 6 actions plus a deliberate, recorded deferral," or a follow-up Assist implementation issue opened first. This plan does not make that call — it surfaces it for the Human gate, per Issue #160's own T3.

## 10. Test matrix (concrete additions this plan specifies)

**Comfort — real-run consequences (closes the headline gap, §2)**
- An accepted Comfort execution (comforter + recipient both committed and executing) run to completion via real `tick()`/`run()` calls applies the `positiveSocialProximity` stress relief to the recipient, decomposable in a `stressEvaluated` event.
- The same run credits **no** Social-need restoration to either participant (ADR-18 D7's non-crediting confirmed by a real trace, not just design-doc assertion).
- The same run forms a relational memory for at least one participant when ADR-16's significance criteria are met (or documents, per §2 above, why a smaller-magnitude interaction did not — this test must use a magnitude clearly above the threshold, not rely on Comfort's smallest possible tuning).
- A second Comfort claim naming the same recipient while the first is still active is rejected by `validateSimulationState`'s existing one-comforter invariant, exercised through a real tick rather than only the direct unit call already in `comfortParticipation.test.ts`.

**Relationship/memory → later decision (§3)**
- Two tests: one relationship-driven candidate-selection flip, one memory-driven candidate-selection flip, both per §3's exact scenario shape.

**Save/load, mid-action (§4)**
- Four tests, one per save point listed in §4, each asserting `continueRun` parity with an uninterrupted run.

**Replay, multi-action (§5)**
- One fixed-seed multi-action integration run asserting `"match"` replay verification, byte-identical double-run event/decision logs, and zero `STATE_FIELDS` divergence.

**Inspector (§6)**
- Three parametrized additions to existing `inspector.test.ts` describe blocks (mid-Comfort/mid-inConflict detachment, Confrontation-shifted pair, Comfort offer lifecycle) — no new inspector code.

**Regression (unmodified, must stay green)**
- Every existing Slice 5–8 test file listed in §2's table, full `prototype/src` suite, strict TypeScript.

## 11. Findings and ambiguities requiring Human decision

1. **Assist checkbox wording (§9/D8).** Flagged for Human ruling before Issue #119 can close, or before this slice's own acceptance criteria can be marked fully met.
2. **Simulation-speed invariance is N/A today (§6/D5)** because the prototype has no speed-multiplier runtime concept at all. Flagged so a future slice that adds one knows to revisit this criterion, rather than assuming it was silently satisfied.
3. **The relationship/memory-driven "candidate selection flips" scenarios (§3) require picking specific magnitudes/tick counts** to guarantee a flip deterministically rather than merely probabilistically nudging a weight. Like Confrontation's own seed-hunt pattern, this may need either a large hand-authored magnitude (preferred — deterministic, no seed-hunting) or an accepted seed-search fallback if hand-authoring proves brittle against the real weight-composition formula. This plan prefers hand-authored magnitudes and flags the seed-hunt fallback as a lower-preference option for Cursor to justify if hand-authoring cannot be made to work.
4. **Whether Confrontation's provisional `directConflictAffinityDelta` clears ADR-16 significance** is a real open question (DQ-4) this plan's own memory-flip scenario may surface concretely for the first time — if it does not, this is calibration feedback for Confrontation's own deferred tuning, not a defect in this plan.

## 12. Expected file areas

- No new `prototype/src` production modules. All additions are test-only, in existing files:
  - `prototype/src/simulation/tick.test.ts` — Comfort real-run consequences; save/load-mid-action is likely better placed in `main.test.ts` per its own existing pattern.
  - `prototype/src/main.test.ts` — four mid-action save/continue scenarios; one multi-action replay integration test.
  - `prototype/src/decision/decide.test.ts` or `goals.test.ts` — the two candidate-selection-flip scenarios (exact file TBD by Cursor at implementation time, matching whichever file already hosts comparable "which candidate wins" assertions).
  - `prototype/src/inspection/inspector.test.ts` — three parametrized additions to existing describe blocks.
- No changes to `prototype/src/core/serialization.ts`, `replay/replay.ts`, or `inspection/inspector.ts` themselves (D6/D7).

## 13. Required validation commands

```powershell
npm --prefix prototype test
npm exec --prefix prototype -- tsc --noEmit -p prototype/tsconfig.json
node tools/ai-workflow/validate-workflow-pack.mjs .
node --test tools/ai-workflow/validate-workflow-pack.test.mjs
node --test tools/ai-workflow/validate-workflow-record.test.mjs
git diff --check
```

## 14. Options Considered

| Option | Summary | Rejected because |
|---|---|---|
| Implement Assist now, inside this slice, to satisfy #119's literal checkbox wording | Makes the parent epic's acceptance criteria technically true | Directly contradicts Issue #160's own explicit instruction ("Assist is deferred and must not be silently required here") and the Human ruling on PR #152; would silently reopen scope this card explicitly forbids |
| Add a synthetic speed-multiplier to `run()` just to give the speed-invariance criterion something to test | Makes acceptance criterion #8 checkable | Inventing new runtime mechanism inside a validation-only slice; not requested, and Issue #160 explicitly permits recording N/A instead |
| Rely on seed-hunting (like Confrontation's own pattern) for the candidate-selection-flip scenarios, rather than hand-authored magnitudes | Reuses an already-precedented pattern | Preferred alternative (hand-authored magnitude) is more deterministic and avoids compounding Confrontation's own review-noted brittleness (nit #3 on PR #159) into a second area of the suite; kept as a documented fallback only |
| Treat save/load continuation as already fully covered by `main.test.ts`'s generic test, add nothing | Less work | Issue #160's own acceptance criterion asks for continuation "for approved scenarios" (plural, implying the actual action set), and the generic test's fixture does not specifically exercise any mid-action state — a real gap, not a redundant addition |

## 15. Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| Comfort gets a dedicated real-run consequence test suite | The single largest, most concrete gap found by direct code/test reading — every other action already has one | Leaving it uncovered (already-shipped code with a real, demonstrated test gap) |
| Relationship/memory-influences-decision scenarios use hand-authored large magnitudes, not seed-hunting, as the primary approach | Deterministic, avoids compounding an already-flagged brittleness pattern | Pure seed-hunt (kept as documented fallback only) |
| Simulation-speed invariance recorded N/A with rationale | Verified directly: no speed-multiplier concept exists in `run.ts` today | Inventing a speed multiplier just to satisfy the criterion (scope creep into new mechanism) |
| No ADR triggered | Zero new persisted fields/unions/events; every scenario exercises existing, already-accepted contracts | Treating the multi-action integration test as a "new surface" requiring architecture review (it is not — no schema changes) |
| Assist checkbox handling: explicit named deferral, not silent omission | Matches Issue #160's own instruction and the standing Human ruling from PR #152 | Implementing Assist now (out of scope, forbidden by this card); silently checking the box anyway (dishonest) |

---

## 16. Kanban Update

**Card:** [Phase 3] Stage 2 Slice 9 — Stage 2 Validation (Plan)
**Status:** Review — plan artifact complete, awaiting Codex plan review, then Human approval (including a ruling on Finding 1, the Assist checkbox). No implementation until both gates pass.
**Completed:** Produced `design/stage-2-validation-plan.md` — an exact trace matrix distinguishing what is already tested (Conversation, Shared Downtime, Shared Meal, Confrontation — all real-run tested with accept/decline or fire/no-fire coverage) from what is not (Comfort's own real-run consequences; relationship/memory measurably flipping a later decision; mid-action save/load continuation; one multi-action replay integration run) — every claim verified by reading the actual test files, not assumed from a slice's own design-doc claims (§2); the exact scenario shape for relationship- and memory-driven decision flips (§3); four mid-action save/continue scenarios (§4); one multi-action replay integration test (§5); simulation-speed invariance recorded N/A with a verified rationale, not silently dropped (§6); an inspector coverage checklist requiring no new mechanism (§7); an explicit ADR/save-format non-trigger determination (§8); explicit handling of parent #119's Assist checkbox as a named deferral requiring Human ruling, not a silent omission (§9); a concrete test matrix; findings; expected file areas; and validation commands.
**Changed Files:**
  CREATED  design/stage-2-validation-plan.md
**Validation:** Grounded directly against the current test suite — read every `describe` block in `simulation/tick.test.ts` (1702 lines), `simulation/run.test.ts`, `simulation/comfortParticipation.test.ts`, `simulation/conflictDetection.test.ts`, `task/socialOffers.test.ts`, `task/tasks.test.ts`, `decision/goals.test.ts`, `decision/weights.test.ts`, `replay/replay.test.ts`, `inspection/inspector.test.ts`, `core/serialization.test.ts`, and `main.test.ts` in full, plus `simulation/run.ts` and `design/engineering-specification.md` §7 directly for the speed-invariance finding — every "gap" and every "already covered" claim above is sourced from an actual file read, not inferred. `git diff --check` clean; `node tools/ai-workflow/validate-workflow-pack.mjs .` run and passing (see PR).
**Risks:** The relationship/memory candidate-flip scenarios (§3) are the least mechanically specified part of this plan — Cursor may need to iterate on exact magnitudes to get a deterministic flip rather than a probabilistic nudge; flagged as Finding 3, not treated as a solved detail. The Assist-checkbox question (Finding 1) blocks Issue #119's own full closure regardless of how well this slice's own scope is executed — that is a Human decision, not an engineering risk.
**Follow-up Tasks:** Human ruling on Finding 1 (Assist checkbox wording) before or alongside plan approval. Codex plan review against Issue #160's own required decisions and this repository's determinism/save-format obligations. No implementation, no Assist work, no Confrontation/Comfort recalibration until the plan is Approved and Human-approved.

**Not committed** per instruction — this is a plan artifact only; no code in `prototype/src` is created or modified by this task.
