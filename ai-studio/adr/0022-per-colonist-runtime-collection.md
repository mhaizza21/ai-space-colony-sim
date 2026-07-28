# ADR-22 - Per-Colonist Runtime Collection

**Status:** Accepted (architecture review + Human acceptance 2026-07-17, issue #130)
**Amended by:** ADR-25 (D1, D6) — Conflict runtime state and save format v8 (Accepted 2026-07-29, issue #155)
**Date:** 2026-07-17
**Phase:** Phase 3 - Stage 2 Slice 6 architecture gate
**Deciders:** Project owner, Technical Architect
**Tracks:** GitHub issue #130 (parent #128)
**Governed by:** `design/autonomous-three-colonist-runtime.md` v0.1.0 (Human-approved 2026-07-17 - the behavioral design this ADR gives a storage home; D1/D4/D6 are this ADR's exact scope), `design/engineering-specification.md` v0.3.0 (EQ-1, EQ-2, EQ-3, §8), ADR-20 (Accepted - serialization discipline precedent), ADR-21 (Accepted - offer storage, unchanged by this ADR), `ai-studio/constitution/architecture-philosophy.md`

**This ADR does not contain:** behavioral rules. The seven-phase realization across the collection, the phase-boundary rule, the single-observation-basis snapshot discipline, and Slice 5 protocol integration are decided by the approved design (D2/D3/D5) and the engineering specification. This ADR decides only where per-colonist runtime state lives, how the collection is ordered and identified, the PRNG stream structure EQ-3 requires a stable record for, and how the collection is serialized, validated, replay-compared, and inspected - the Data model / Save format / Serialization trigger surface `ai-studio/workflows/kanban-update-protocol.md` requires an accepted ADR for.

---

## Context

Stage 2's target is three fully simulated colonists. The current `SimulationState` holds one colonist's runtime in five singular slots (`colonist`, `execution`, `suspendedExecution`, plus the memory-formation baselines) and represents everyone else as an identity-only `roster`. The reconciled engineering specification (EQ-1, Issue #99) classified the migration as an implementation expansion under the accepted architecture; the Human-approved Slice 6 design specifies it. Restructuring these `SimulationState` fields is a Data model, Save format, and Serialization change - the same trigger surface that produced ADR-21 - so this ADR records the storage decisions before implementation, as the design's §9 planned from the start.

The decision must preserve: single-owner state (architecture-philosophy), ADR-20/ADR-21's stores unchanged, deterministic canonical ordering (EQ-2), replay obligations (§8), and validate-never-repair loading.

## Decision

### D1 - One canonically ordered `SimulationState.colonists` collection of per-colonist runtime containers

```text
SimulationState.colonists: readonly ColonistRuntime[]   // canonically ordered by colonist id

ColonistRuntime {
  colonist: ColonistState                      // identity, needs, stress, memory, goals - shape unchanged
  execution: Execution | null
  suspendedExecution: Execution | null
  deprivationBaselines: Record<NeedId, number>
  stressBaseline: number
  relationshipAffinityBaselines: Record<string, number>
}
```

- The five singular per-colonist fields are removed from `SimulationState` and live only inside containers. Clock, world, policy, PRNG, event/decision logs, `relationships` (M10, ADR-20), and `socialOffers` (M12, ADR-21) remain top-level singletons with unchanged owners.
- **The `roster` field is retired.** The collection is the one authoritative colonist list; "known colonist ids" for M10/M12 validation is exactly the set of `colonists[i].colonist.identity.id`. Two lists describing colonists is the drift-by-synchronization shape architecture-philosophy forbids.
- Collection size is 1..N (Stage 2 target 3; size 1 supports the behavior-identical migration step). No entry is structurally privileged - "primary colonist" ceases to exist as a concept.
- Ordering is the documented ordinal string comparison over colonist ids (ADR-20 D5's comparator, EQ-2), enforced structurally: in memory, in serialization, and at load (D4 below rejects violations).
- Every existing per-colonist cross-field invariant (the suspended-pair rule, Slice 5's offer-backed suspension exception, goal/execution key agreement) applies per container, unchanged in content.

### D2 - EQ-3 resolved: one shared attributed PRNG stream with canonical draw order

`SimulationState.prng` remains the single mulberry32 stream (`PrngState { a, draws }`, shape and serialization unchanged). Draw order across colonists is fixed by the same canonical iteration that fixes everything else; every draw remains attributed (purpose + colonist context) in the retained records. Per-colonist streams are rejected: they multiply save/validation/replay surfaces for a benefit (mid-run colonist-set stability) that is out of scope until ADR-19 exists.

**Recorded cost and revisit trigger (per EQ-3's "documented and stable" requirement):** stream alignment is global - changing the colonist set changes every subsequent draw, so cross-run comparisons are valid only between runs with identical colonist sets. **Re-open this decision if ADR-19 introduces mid-run colonist arrival.**

### D3 - Save format v5

The save format replaces `colonist`, `execution`, `suspendedExecution`, `deprivationBaselines`, `stressBaseline`, `relationshipAffinityBaselines`, and `roster` with one `colonists` array serialized in canonical order, and increments `SAVE_FORMAT_VERSION` to 5. No migration framework; earlier versions are rejected by version check outright (ADR-20 D8 posture, unchanged since v1).

### D4 - Load validates, never repairs

Load rejects - never sorts, deduplicates, re-orders, or fills in:

- an empty `colonists` array (a simulation with no colonists is not a state this system produces);
- duplicate colonist ids, unsafe ids (the existing `assertSafeColonistId` rule), or entries out of canonical order;
- any per-container violation of the existing per-colonist rules, applied per entry exactly as they are applied to the single colonist today (needs bounds, memory-pool contracts, stress shape, goal/execution enums, the suspended-pair rule and its offer-backed exception, execution/goal key agreement);
- a `relationships` store or `socialOffers` store referencing any id outside the collection's id set (the stores' own validators, ADR-20 D8 / ADR-21 D5, now fed the collection-derived id set);
- any goal `relatedColonistId` naming a colonist outside the collection or the goal-owner itself (the existing roster-reference rule, retargeted to the collection).

Every rule that exists today survives; the only new rules are the collection-level ones (non-empty, unique, ordered). Nothing about the per-field validation of clock, world, policy, PRNG, logs, relationships, or offers changes.

### D5 - Replay comparison

Replay's `STATE_FIELDS` replaces the seven retired entries with one `colonists` entry, diffed generically like every other field; divergences path as `colonists[i].<field...>`. `prng`, `relationships`, `socialOffers`, and the record-by-record log comparison are unchanged. A save/load round-trip remains semantically identity, and the §8 replay guarantee (same seed + same initial state → identical traces and terminal state) is unchanged in meaning - the terminal state simply contains the collection.

### D6 - Inspection surface

The inspector exposes a per-colonist summary list (one entry per container, in collection order, detached per the existing rule: no inspection result may alias simulation state). Shared surfaces - relationship pair views, the offer list, recent records, replay summaries - are unchanged. The exact per-colonist summary shape is implementation freedom under the detachment rule (design DQ-1), not fixed by this ADR.

## Required Invariants

1. `colonists` is the only place per-colonist runtime state lives, and the only authoritative colonist list; no second list or singular slot reappears.
2. Collection ordering is canonical (ordinal id order), unique, non-empty - in memory, in every save, and enforced at load.
3. Every per-colonist invariant that held for the single colonist holds per container, unchanged in content.
4. M10 and M12 store shapes, owners, and validation rules are unchanged; their known-id universe is the collection's id set.
5. One PRNG stream; draw order is fixed by canonical iteration; every draw is attributed. No module holds a private chance source.
6. Save/load round-trips the collection bit-identically in order and content; load repairs nothing.
7. Replay compares the full collection generically; no colonist-specific comparison logic exists.
8. Inspection returns detached copies only.

## Options Considered

### Option A - Keep `roster` alongside a simulated-colonist collection

**Rejected because:** two lists describing colonists, one authoritative for identity and one for simulation - guaranteed drift; the roster's only purpose (known ids for pair validation) is served by the collection.

### Option B - Primary colonist + secondary collection

**Rejected because:** a structurally privileged first colonist the architecture never defined; every consumer grows two code paths; ordering bias becomes easy to reintroduce - the exact risk this migration must retire.

### Option C - One canonically ordered collection, roster retired (selected)

One authoritative list, no asymmetry, ordering structural, existing invariants carried per container, minimal new validation surface.

### Option D - Per-colonist PRNG streams (EQ-3 alternative)

**Rejected because:** multiplies the save/validation/replay surface now for a benefit that has no in-scope consumer; determinism is already delivered by canonical draw order; documented revisit trigger on ADR-19.

## Consequences

### Positive

- #128 implementation is unblocked on acceptance with the storage shape settled first.
- The single-colonist runtime becomes the size-1 case of one code path - no primary/secondary split to maintain.
- Save v5, replay, and inspection reuse existing generic mechanisms; the diff concentrates in shape, not in new machinery.

### Negative

- One more save-version bump during the prototype (accepted; established posture).
- Every existing test fixture that hand-builds `SimulationState` must be reshaped (mechanical; the behavior-identical 6a step of the design's staging plan proves the reshape changes nothing).

### Neutral / Deferred

- Per-colonist inspector summary shape: implementation freedom (design DQ-1).
- Responder-side goal commitment: deferred by Human decision (DQ-2, #128) - a future card, irrelevant to this storage surface.
- EQ-3 revisit on ADR-19 mid-run arrival (D2's recorded trigger).

## Validation Required Before Implementation

- Load-rejection tests: empty collection, duplicate ids, out-of-order entries, per-container invariant violations, store references to ids outside the collection.
- A behavior-identity test for the size-1 migration step: fixed-seed pre-migration and post-migration runs produce identical event/decision traces and equivalent terminal state.
- Multi-colonist replay verification (three colonists, fixed seed, `verifyReplay` match) and a divergence-path test showing `colonists[i].…` pathing.
- Save/load round-trip of a three-colonist state including suspended pairs, an offer-backed suspension, and materialized relationship pairs.
- A draw-attribution test showing the shared stream's draw order matches canonical colonist order within a phase.

## Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| One canonically ordered `colonists` collection; roster retired | One authoritative list; ordering structural (EQ-2); no privileged entry | Roster kept alongside; primary + secondary split |
| Per-colonist invariants carried per container, unchanged | The rules were never single-colonist rules, only single-colonist-applied; content change would reopen settled decisions | Weakening or re-deriving validation per entry |
| EQ-3: single shared attributed stream, canonical draw order | Zero save/replay change; S1 stays one choke point; determinism from ordering | Per-colonist streams (surface multiplication without in-scope benefit) |
| Save v5, reject-by-version, validate-never-repair | ADR-20 D8's accepted posture applied to the new shape | Migration framework (out of prototype scope); silent repair |
| Replay compares `colonists` generically | No colonist-specific comparison logic to drift | Bespoke per-colonist diffing |

---

## Kanban Update

**Card:** [Phase 3] ADR-22 - Per-Colonist Runtime Collection
**Status:** Done - architecture review passed and Human acceptance recorded on issue #130 (2026-07-17); status flipped to Accepted.
**Completed:** Drafted `ai-studio/adr/0022-per-colonist-runtime-collection.md` from the approved design's D1/D4/D6 exactly: the `ColonistRuntime` container and canonically ordered collection with roster retirement (D1), the EQ-3 single-stream decision with its recorded cost and revisit trigger (D2), save v5 (D3), the full validate-never-repair load-rejection list (D4), replay consolidation (D5), inspection surface (D6), eight required invariants, four options considered, and pre-implementation validation requirements.
**Changed Files:**
  CREATED  ai-studio/adr/0022-per-colonist-runtime-collection.md
**Validation:** Every decision traced to design v0.1.0 D1/D4/D6, engineering-specification v0.3.0 (EQ-1/EQ-2/EQ-3, §8), ADR-20, or ADR-21; confirmed no accepted ADR or locked freeze decision is reopened - the M10/M12 stores are untouched, and the behavioral rules (D2/D3/D5 of the design) are explicitly outside this ADR.
**Follow-up Tasks:** None. Upon acceptance: unblock #128 implementation per the Human approval condition recorded there.

**Not committed** per instruction - acceptance is the architecture review's decision, not this draft's.
