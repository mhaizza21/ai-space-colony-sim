# ADR-21 - Social Offer State Storage

**Status:** Accepted (architecture review + Human acceptance 2026-07-17, issue #125; revised once during review: closed `reason` vocabulary, exhaustive status-field validity matrix, decision-input boundary made internally consistent)
**Amended by:** ADR-24 (D2, D5) — Comfort offer action and save format v7 (Accepted 2026-07-29, issue #151)
**Date:** 2026-07-17
**Phase:** Phase 3 - Stage 2 Slice 5 architecture gate
**Deciders:** Project owner, Technical Architect
**Tracks:** GitHub issue #125 (parent #120)
**Governed by:** ADR-18 (Accepted - the offer/response participation architecture this storage serves), ADR-20 (Accepted - the storage/serialization discipline this ADR follows), `design/social-offer-response-protocol.md` v0.2.0 (Human-approved 2026-07-17 - the behavioral design this ADR gives a storage home), `design/engineering-specification.md` v0.3.0, `ai-studio/constitution/architecture-philosophy.md`

**This ADR does not contain:** behavioral rules. Responder eligibility, acceptance weighting, the response delay, and the hold/cancel/expire lifecycle are decided by ADR-18 D5 and the approved design document. This ADR decides only where offer state lives, what shape it has, how it is identified, bounded, serialized, and validated - the Data model / Save format / Serialization trigger surface that `ai-studio/workflows/kanban-update-protocol.md` requires an accepted ADR for.

---

## Context

The Human-approved design for Stage 2 Slice 5 (`design/social-offer-response-protocol.md` v0.2.0) makes Conversation and Shared Downtime explicit offers per ADR-18 D5: created at goal commitment, resolved deterministically no earlier than one tick later, with decline, cancellation, and expiry as first-class outcomes. Issue #120's acceptance criteria require pending and resolved offer state to survive save/load without semantic change and to be compared by replay.

That requires persistent state - a new top-level `SimulationState` slice, a save-version bump, and new load-validation rules. All three are architecture-review triggers (Data model, Save format, Serialization). ChatGPT design review 2026-07-17 correctly rejected the design's first draft for claiming no ADR was needed; this ADR is the required record.

The decision must preserve:

- Determinism obligations (`design/engineering-specification.md` §8): no wall-clock time, no random ids, stable ordering, replay-verifiable state.
- ADR-20's serialization discipline: bounded state, canonical ordering, validate-never-repair loading, save-version increment without a migration framework.
- The Stage 2 runtime boundary (Issue #99, reconciled): one fully simulated colonist plus an identity-only roster.
- M12's ownership of task/execution and the social offer/encounter protocol (engineering spec module table).

## Decision

### D1 - Offers live in one top-level `SimulationState.socialOffers` store owned by M12

```text
SocialOfferStore {
  offers: SocialOffer[]        // append-ordered; bounded per D4
  nextOfferSequence: number    // persisted counter, never derived
}
```

The store is a sibling of `relationships` and `roster` - the same additive top-level-slice pattern ADR-20 D8 established. No existing field is renamed, removed, or reinterpreted. M12 (Task & Execution System) owns the store: offers are created and resolved only in M12's phase slots (design D3), and no other module writes offer state.

An offer is **not** colonist-owned state: it is a fact about two colonists, the same reasoning that put pair records in a central M10 store (ADR-20 D1) rather than on each colonist. It has no home on `ColonistState` (the initiator holds only their ordinary committed goal) and none on a roster entry (identity-only, per Issue #99).

### D2 - One offer record, explicit status machine, all-tick fields stored

```text
SocialOffer {
  id: number                     // D3's persisted sequence
  initiatorId: string
  responderId: string
  action: "conversation" | "sharedDowntime"
  createdAtTick: number
  respondableAtTick: number      // stored at creation; never re-derived from tuning on load
  expiresAtTick: number          // stored at creation; never re-derived from tuning on load
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired"
  resolvedAtTick: number | null  // per the D2 validity matrix: null exactly when status is "pending"
  reason: OfferResolutionReason | null  // closed persisted union below; validity per status is the D2 matrix
}

OfferResolutionReason =
  | "responderNotInRoster"      // declined — design D4.1 eligibility failure
  | "responderNotInterruptible" // declined — design D4.2 eligibility failure
  | "relationshipGate"          // declined — design D4.3 two-sided non-hostile gate failure
  | "acceptanceDraw"            // declined — design D5 attributed PRNG draw fell above the acceptance probability
  | "initiatorUnavailable"      // cancelled — design D6: offer-creating goal abandoned or replaced
  | "responderUnavailable"      // cancelled — design D6: responder left roster / double-booking guard
  | "timeout"                   // expired — design D6: clock reached expiresAtTick
```

`reason` is a **closed persisted union** (review revision — `string | null` is not an acceptable persisted contract). Each member traces to exactly one resolution outcome in the approved design, as annotated above; there are no other producers, and no free-text reasons exist anywhere in the persisted state. Human-readable phrasing is a presentation concern derived from the code at display time, never stored. Adding a reason code is a revision of this ADR, exactly like adding a status.

**Status-field validity matrix (exhaustive — review revision).** Every persisted offer must match its status row *exactly*; there are no other legal shapes:

| `status` | `resolvedAtTick` | `reason` |
|---|---|---|
| `"pending"` | `null` | `null` |
| `"accepted"` | number | `null` |
| `"declined"` | number | one of `"responderNotInRoster"`, `"responderNotInterruptible"`, `"relationshipGate"`, `"acceptanceDraw"` |
| `"cancelled"` | number | one of `"initiatorUnavailable"`, `"responderUnavailable"` |
| `"expired"` | number | `"timeout"` |

The reason sets are disjoint by status: a `"declined"` offer carrying `"timeout"`, an `"accepted"` offer carrying any reason, or a `"cancelled"` offer carrying an eligibility code are all malformed, whatever their other fields say. D5's load rules enforce this matrix row by row.

`respondableAtTick` and `expiresAtTick` are **stored**, not derived: deriving them from tuning constants at read time would let a tuning change silently alter the semantics of already-saved pending offers, violating Issue #120's "save/load preserves offer state without semantic change." The tuning constants govern creation only.

The status machine is closed at five states. `"pending"` is the only non-terminal status; every transition out of it is final. Adding a status is a revision of this ADR, not a tuning or implementation choice (the closed-list discipline of ADR-17/ADR-18).

### D3 - Identity is a persisted monotonic counter, never derived, never a UUID

`id` is assigned from `nextOfferSequence` at creation; the counter increments by exactly one per creation and is serialized with the store. It is never recomputed by scanning existing offers: bounded retention (D4) evicts old resolved offers, and a scan-derived maximum would reuse an evicted offer's id. Random UUIDs and wall-clock components are prohibited (engineering spec §8; Issue #120 determinism constraints).

Processing order is ascending `id` wherever multiple offers are touched in one phase - which is append order, so iteration is the stored array in order, with no re-sort. This is the stable explicit processing order Issue #120 requires.

### D4 - Bounded retention: pending offers never evicted, resolved offers FIFO-bounded

Pending offers are never evicted - evicting one would silently destroy an in-flight interaction. Resolved offers (`accepted`/`declined`/`cancelled`/`expired`) beyond a bounded retention window are evicted oldest-first (lowest `id` first), the same deterministic FIFO shape as ADR-20's bounded pair history. The window size is a prototype tuning value; the boundedness itself is architecture (an unbounded log inside `SimulationState` would duplicate S2's event-log role and grow without limit).

Eviction never rolls back `nextOfferSequence` (D3) and never renumbers surviving offers.

The store is not a second event log: S2 remains the record-keeping owner. **Resolved offers are retained for read-only inspection and replay comparison only — they are never a decision input (review revision).** This is one boundary, stated once: no weight, filter, candidate source, eligibility check, or acceptance probability anywhere in the simulation may read a resolved offer. The only simulation-behavior reads of the store at all are the protocol's own Phase 6 resolution steps, and those read *pending* offers exclusively (plus the store-level pending-per-responder double-booking guard, which is also a pending-only read). A future decline-cooldown or similar mechanism that wants resolved offers to influence behavior is a **revision of this ADR** — it moves the store into decision-input territory, which changes this boundary, not just a tuning value. Anything needing long-horizon history belongs in S2 records, not here.

### D5 - Serialization: one new slice, save version incremented, validate-never-repair

The save format adds the `socialOffers` slice and increments the save version. No migration framework (ADR-20 D8's prototype posture). Offers serialize in stored (ascending-`id`) order.

Load rejects - never silently repairs, sorts, renumbers, or drops:

- duplicate offer ids;
- any offer id `>= nextOfferSequence` (the counter must exceed every id it has produced);
- `initiatorId` or `responderId` not present among known colonist ids (primary colonist + roster);
- `initiatorId === responderId` (self-offers invalid - same discipline as ADR-20 D5's self-pair rejection);
- an `action` outside the closed two-member union;
- a `status` outside the closed five-member union;
- a non-null `reason` outside the closed seven-member `OfferResolutionReason` union;
- **any offer whose (`status`, `resolvedAtTick`, `reason`) triple does not exactly match its row of the D2 validity matrix** — enforced per row, exhaustively:
  - `"pending"` with non-null `resolvedAtTick` or non-null `reason`;
  - `"accepted"` with null `resolvedAtTick` or **non-null `reason`**;
  - `"declined"` with null `resolvedAtTick`, null `reason`, or a `reason` outside its four-member declined set (`"responderNotInRoster"`, `"responderNotInterruptible"`, `"relationshipGate"`, `"acceptanceDraw"`);
  - `"cancelled"` with null `resolvedAtTick`, null `reason`, or a `reason` outside its two-member cancelled set (`"initiatorUnavailable"`, `"responderUnavailable"`);
  - `"expired"` with null `resolvedAtTick`, or a `reason` other than exactly `"timeout"`;
  - (these rows cover the full closed status union, so no status/reason/resolvedAtTick combination exists that is neither accepted by a row nor rejected);
- `respondableAtTick <= createdAtTick` (the design's structural one-tick response-delay floor);
- `expiresAtTick <= respondableAtTick` (an offer that expires before it is respondable is malformed);
- `resolvedAtTick` earlier than `createdAtTick`, or later than the loaded clock;
- more than one `"pending"` offer sharing the same `responderId` (the design's double-booking guard, checked as a store-level invariant);
- offers out of ascending-`id` order.

### D6 - Replay and inspection surfaces

`socialOffers` joins replay's compared terminal-state fields (`STATE_FIELDS`), diffed generically like `relationships` and `roster` - replay reports the first divergence by dotted path with no offer-specific comparison logic. The inspector exposes the offer list as a detached, JSON-safe copy, per the existing detachment rule (final review fix 2026-07-11): no inspection result may alias simulation state.

## Required Invariants

1. M12 is the only writer of offer state; offers are created and resolved only in the design's Phase 5/Phase 6 slots.
2. Every offer id is unique for the store's lifetime; `nextOfferSequence` strictly exceeds every id ever produced and never decreases.
3. `"pending"` is the only non-terminal status; a terminal offer never changes again.
4. Pending offers are never evicted; resolved-offer eviction is deterministic FIFO by id.
5. Tick fields (`respondableAtTick`, `expiresAtTick`) are fixed at creation; tuning changes never alter a stored offer's semantics.
6. Serialization preserves stored order; load validates every rule in D5 and repairs nothing.
7. Replay compares the full store; a save/load round-trip is semantically identity.
8. The store is never a decision input. The only simulation-behavior reads are the design's own Phase 6 resolution steps, and those read pending offers only (including the pending-per-responder guard). Resolved offers are read exclusively by serialization, replay comparison, and the inspector; the store is not a candidate-generation source (candidates come from the snapshot roster, mirroring ADR-20 D3). Any future read of a resolved offer by simulation behavior requires a revision of this ADR (D4).
9. Every persisted offer's (`status`, `resolvedAtTick`, `reason`) triple matches its D2 validity-matrix row exactly, and every `reason` is a member of the closed `OfferResolutionReason` union scoped to its status; load enforces this exhaustively (D5) and repairs nothing.

## Options Considered

### Option A - Offer state on the initiator's ColonistState

**Rejected because:** an offer is a two-party fact (ADR-20 D1's reasoning); the responder side has no home on an identity-only roster entry; save/load of a pending offer would be entangled with colonist serialization; and a future slice where roster colonists initiate offers would force a redesign.

### Option B - Top-level bounded store with persisted counter (selected)

One owner (M12), one atomic update surface, additive serialization following ADR-20's accepted pattern, trivially replay-comparable.

### Option C - Transient in-tick offers, never serialized

**Rejected because:** directly contradicts Issue #120's save/load and replay acceptance criteria and the design's one-tick-minimum response delay - a pending offer must survive a save taken between creation and resolution.

### Option D - Offers as S2 event-log entries only

**Rejected because:** S2 is append-only record-keeping, not queryable live state (locked #5's spirit: logs do not feed behavior); resolving an offer would require scanning the log for its latest status - a second source of truth pattern the architecture forbids.

## Consequences

### Positive

- #120 implementation is unblocked on acceptance, with the storage shape settled before code.
- Save/load, replay, and inspection of offers reuse existing generic mechanisms without new comparison logic.
- The shape survives future slices (roster colonists gaining real state, additional Sought actions) without structural change - only the closed unions widen, by ADR revision.

### Negative

- One more save-version bump during the prototype (accepted cost; ADR-20 set the precedent and no migration framework is needed).
- The store-level pending-per-responder invariant adds a load-validation rule with no Stage 2 traffic that can violate it (one initiator) - carried anyway so the invariant is pinned before multi-initiator slices exist.

### Neutral / Deferred

- Retention window size, response-delay magnitude, timeout magnitude, acceptance probabilities: prototype tuning (design DQ-1-DQ-4).
- Whether a decline-cooldown or similar mechanism should ever exist: future design territory — but if it reads resolved offers, it requires an ADR-21 revision first (D4/Invariant 8's boundary), not a design-only decision.

## Validation Required Before Implementation

- Unit tests: counter monotonicity across creation and eviction; pending-never-evicted; FIFO eviction determinism; status-machine terminality.
- One load-rejection test per D5 rule, including one per validity-matrix row violation (`"accepted"` with non-null `reason`, each terminal status with null `resolvedAtTick`, each status with an out-of-scope reason code, unknown reason codes).
- Save/load round-trip of a state holding a pending offer mid-delay, resolved offers of every terminal status, and an evicted-history counter (`nextOfferSequence` > every stored id).
- Replay divergence test: two runs differing only in one offer field report that field's dotted path.
- Inspector detachment test: mutating the returned offer list does not affect simulation state.

## Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| Top-level M12-owned `socialOffers` store | Two-party fact needs one owner and one atomic surface (ADR-20 D1 reasoning); additive slice follows ADR-20 D8 | Colonist-embedded state; S2-log-as-state; transient unserialized offers |
| Persisted monotonic counter id | Survives bounded eviction without reuse; deterministic; UUID/wall-clock prohibited by engineering spec §8 | Scan-derived max (reuses evicted ids); UUID (non-deterministic); composite string keys (collision- and eviction-fragile) |
| Tick fields stored at creation, never re-derived | Tuning changes must not mutate saved offers' semantics (Issue #120 acceptance criterion) | Deriving from tuning on load (silent semantic drift) |
| Closed five-status machine, pending sole non-terminal | Explicit lifecycle the design's D3/D6 steps map onto one-to-one; closed-list guard per ADR-17/ADR-18 discipline | Open status vocabulary; boolean resolved flag (loses decline/cancel/expire distinction the design and ADR-18 D5 require) |
| Pending never evicted; resolved FIFO-bounded | Eviction must never destroy an in-flight interaction; boundedness keeps the store state, not a log | Unbounded store (duplicates S2's role); evict-anything FIFO (can kill pending offers) |
| Validate-never-repair load with the full D5 rule list | ADR-20 D8's accepted discipline applied to the new slice | Silent sort/clamp/dedup/repair on load |
| *(Review revision)* `reason` is a closed seven-member persisted union, scoped per status by the D2 validity matrix | Architecture review 2026-07-17: `string \| null` is not a closed persisted contract; every member now traces to exactly one approved-design resolution outcome, and free text can drift, collide, and defeat load validation | Free-form `string \| null` (rejected by review); storing human-readable phrases (presentation concern, derivable from the code) |
| *(Review revision)* Exhaustive (`status`, `resolvedAtTick`, `reason`) validity matrix, enforced row by row on load | Review found the prior rules non-exhaustive (e.g. `"accepted"` with a non-null `reason` was not rejected); the matrix covers the full closed status union so every combination is either matched or rejected | Enumerating only the known-bad cases (leaves unlisted malformed shapes loadable) |
| *(Review revision)* Resolved offers are never a decision input; retention serves inspection/replay only; future cooldown-style reads require an ADR-21 revision | Review found D4's "decline-cooldown-class reads" implication contradicted Invariant 8; one boundary chosen and stated in both places — the conservative one, matching ADR-20 D2's "pairView is not a decision input" discipline | Allowing resolved-offer reads as pre-authorized future design space (would make the store a shadow decision input with no accepted record of that boundary change) |

---

## Kanban Update

**Card:** [Phase 3] ADR-21 - Social Offer State Storage
**Status:** Done - architecture review passed and Human acceptance recorded on issue #125 (2026-07-17); status flipped to Accepted.
**Completed:** Drafted and revised `ai-studio/adr/0021-social-offer-state-storage.md` covering exactly the Data model / Save format / Serialization trigger surface of the approved offer/response design: store ownership and shape (D1-D2, now with a closed seven-member `OfferResolutionReason` union and an exhaustive status-field validity matrix), persisted-counter identity and processing order (D3), bounded retention with the resolved-offers-never-a-decision-input boundary (D4), serialization and the full row-by-row load-rejection list (D5), replay/inspection surfaces (D6), nine required invariants, four options considered, and pre-implementation validation requirements.
**Changed Files:**
  CREATED  ai-studio/adr/0021-social-offer-state-storage.md
**Validation:** Every decision traced to `design/social-offer-response-protocol.md` v0.2.0, ADR-18, ADR-20, Issue #120's determinism constraints, or `design/engineering-specification.md` §8; each `OfferResolutionReason` member traced to exactly one resolution outcome in the approved design (D4.1/D4.2/D4.3 eligibility failures, D5 acceptance draw, D6 initiator/responder unavailability, D6 timeout); checked that no accepted ADR or locked freeze decision is reopened. All three architecture-review findings verified against the prior text and resolved: closed reason vocabulary (D2), exhaustive validity matrix on load (D2/D5/Invariant 9), and the D4-vs-Invariant-8 decision-input contradiction removed in favor of the strict boundary.
**Follow-up Tasks:** None. Upon acceptance: unblock #120 implementation per the Human approval condition recorded 2026-07-17.

**Not committed** per instruction - acceptance is the architecture review's decision, not this draft's.
