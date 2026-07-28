# ADR-24 - Comfort Offer Action and Save Format v7

**Status:** Accepted (architecture review + Human acceptance 2026-07-29, issue #151; Comfort-only implementation shipped on PR #153 before this status flip — acceptance records the storage contract already governing main)
**Date:** 2026-07-27
**Phase:** Phase 3 - Stage 2 Slice 7 architecture gate
**Deciders:** Project owner, Technical Architect
**Tracks:** GitHub issue #151 (parent #119), PR #152 (design), PR #153 (implementation)
**Amends:** **ADR-21 (Accepted) - D2 and D5 only.** ADR-21 D1, D3, D4, D6 and Invariants 1-8 continue to govern unchanged; this ADR is an amendment of two decisions, not a supersession of the record.
**Governed by:** ADR-18 (Accepted - the Social Action Space that names Comfort and authorizes its behavioral vocabulary), ADR-20 (Accepted - the storage/serialization discipline this ADR follows), ADR-21 (Accepted - the offer store this ADR amends), ADR-22 (Accepted - the per-colonist runtime collection and the v5 precedent for a bump without migration), `design/comfort-assist-protocol.md` v0.4.0 (the behavioral design this ADR gives a storage home; D6, D12, and D13 are this ADR's exact scope), `design/social-offer-response-protocol.md` v0.2.0, `design/engineering-specification.md` v0.3.0, `ai-studio/constitution/architecture-philosophy.md`

**This ADR does not contain:** behavioral rules. Comfort's candidate generation, its acceptance weighting, its relationship/need/stress consequences, the participation basis's derivation rule (including the v0.4.0 `claimedRecipients` set), and the phase placement of every read and write are decided by ADR-18 D4-D8 and `design/comfort-assist-protocol.md` v0.4.0. This ADR decides only what the offer store's `action` vocabulary admits, what the save format accepts, and what load / continuous state validation rejects - the Data model / Save format / Serialization trigger surface `ai-studio/workflows/kanban-update-protocol.md` requires an accepted ADR for.

**This ADR does not admit Assist.** By Human ruling recorded on PR #152 (2026-07-27), Assist is deferred and must not widen any runtime or persisted union in this slice. Admitting `"assist"` to the unions below is a separate architecture gate, blocked on the preconditions in `design/comfort-assist-protocol.md` §15.

---

## Context

Stage 2 Slice 7 wires **Comfort**, the first of ADR-18 D1's two Support actions. The Human-approved path (`design/comfort-assist-protocol.md` v0.4.0) reuses the existing offer/response mechanism (ADR-21) rather than inventing a second one: a Comfort goal committed in Phase 5 creates a pending offer, and Phase 6 resolves it through the same lifecycle Conversation and Shared Downtime already use.

That reuse requires extending exactly the closed vocabulary ADR-21 deliberately froze. ADR-21 D2 states the rule for itself: adding to the closed union "is a revision of this ADR, not a tuning or implementation choice," and D5's load-rejection list names `an action outside the closed two-member union` as a rejected shape. Slice 7 also adds one stress-relief channel id (ADR-18 D8's "positive social proximity," realized for the first time), which is persisted inside `stressEvaluated` events. Four persisted validation sites therefore change the set of documents the loader accepts, which is a Save format and Serialization change.

The slice was originally designed for Comfort **and** Assist. Codex design review (PR #152) required a real bounded Assist work effect; grounding that requirement established two facts that the Human ruling then acted on:

- Stage 2 has **no work-progress quantity at all** - `Execution` carries only `elapsedTicks`, and a tick of `workAtWorkstation` changes no need, world field, or colonist state - so Assist would transfer nothing.
- The colony-global shift period plus Phase 4's period-boundary completion of `workAtWorkstation` makes an observably `"working"` colonist **unreachable** during the free period in which tier-5 candidates are generated, so Assist could only ever target idle colonists.

Ruling: Assist is deferred; Slice 7 is Comfort-only; Assist must not widen runtime or persisted unions here. This ADR records exactly the narrowed surface.

The decision must preserve: ADR-21's store shape, ownership, identity, retention, and decision-input boundary; ADR-20's serialization discipline (bounded state, canonical ordering, validate-never-repair, version increment without a migration framework); and the determinism obligations of `design/engineering-specification.md` §8.

### Why a new ADR rather than an edit to ADR-21

`ai-studio/adr/README.md` states that ADRs "are immutable once accepted - superseded decisions get a new ADR that references the old one," and `ai-studio/SYSTEM_MAP.md` classifies `adr/` as append-only, "never edited after being written." ADR-21's own in-place revisions were made **during** its review, before acceptance, as its status line records. ADR-21's phrase "a revision of this ADR" therefore governs the *process gate* - architecture review plus Human acceptance - not the file mechanics.

Because ADR-21 D1 (store ownership and shape), D3 (persisted-counter identity and processing order), D4 (bounded retention and the decision-input boundary), and D6 (replay and inspection surfaces) are entirely untouched, a full supersession would be wrong: it would retire decisions that still govern. This ADR is an **amendment of D2 and D5**.

**Acceptance gate action:** ADR-21's header is flipped to `Amended by ADR-24 (D2, D5)` in the same acceptance change that sets this Status to Accepted.

**Numbering:** 0023 is claimed by the in-flight `origin/codex/issue-142-adr-23` (Mission Control projection and control boundary). README forbids reusing a number; skipping an in-flight one honors that rule.

## Decision

### D1 - `SocialOfferAction` widens to a closed **three**-member union

```text
SocialOfferAction = "conversation" | "sharedDowntime" | "comfort"
SOCIAL_OFFER_ACTIONS = ["conversation", "sharedDowntime", "comfort"]
```

This amends ADR-21 D2's `action: "conversation" | "sharedDowntime"` line and nothing else in the offer record. Every other field - `id`, `initiatorId`, `responderId`, `createdAtTick`, `respondableAtTick`, `expiresAtTick`, `status`, `resolvedAtTick`, `reason` - keeps its exact ADR-21 D2 shape and semantics. No new field, no new record type, no new status, no new reason code.

The union remains **closed**, and the closure discipline is unchanged and inherited: adding a fourth member is a further architecture gate, exactly as adding this third one is. In particular, **`"assist"` is not admitted by this ADR**, and a persisted `action: "assist"` remains a load rejection (D3).

The status machine stays closed at five states, and ADR-21 D2's status-field validity matrix is **unchanged** - it is action-agnostic. A Comfort offer's `(status, resolvedAtTick, reason)` triple is validated by exactly the same rows as a Conversation offer's. ADR-21 Invariant 9 continues to hold verbatim, now over a three-member action union.

### D2 - Responder eligibility becomes action-keyed; `responderNotInterruptible` generalizes; no new reason code

ADR-21 does not own responder eligibility (that is design D4.2 / ADR-18 D4.3), but it owns the closed `OfferResolutionReason` union the outcome is recorded in, so the generalization is recorded here.

`INTERRUPTIBLE_AMBIENT_STATES` is `["resting", "eating", "socializing"]`. `"stressed"` is not a member, so reusing that predicate unmodified for Comfort would make Comfort permanently ineligible - it would decline every offer - which inverts ADR-18 D4.3, whose entire premise is that Comfort targets the Stressed state. Eligibility therefore becomes keyed by `action`, with Conversation and Shared Downtime retaining `isInterruptibleAmbientState` unchanged and Comfort admitting exactly `"stressed"`.

**`responderNotInterruptible` is reused with a generalized meaning: "the responder's state does not admit this specific action right now."** This covers both the action-keyed ambient-state table and the design's participation guard (D4 below). No new reason code is added: the `OfferResolutionReason` members are already action-agnostic *outcome* codes rather than per-action codes, and fragmenting a deliberately closed union with `comfortTargetNotStressed`-style members would defeat the reason the union was closed. This is a wording clarification of ADR-21 D2's existing member, not a new member - the closed seven-member reason union is **unchanged in size and content**.

### D3 - Save format v7

`SAVE_FORMAT_VERSION` increments from 6 to 7. No migration framework; earlier versions are rejected by version check outright (ADR-20 D8 posture, unchanged since v1; ADR-22 D3's precedent).

Four persisted validation sites change the set of accepted documents, each gaining exactly one member:

| # | Site | Before | After | Persisted in |
|---|---|---|---|---|
| 1 | `SocialOfferAction` / `SOCIAL_OFFER_ACTIONS` | 2 members | 3 (`+ "comfort"`) | `socialOffers.offers[].action` |
| 2 | `Goal.relatedSocialTaskId` closed list | `["conversation","sharedDowntime"]` | 3 (`+ "comfort"`) | `colonists[].colonist.currentGoal`, `.suspendedGoal`; `decisionLog[].outcome`'s goal |
| 3 | `socialOfferCreated.action` closed list | `["conversation","sharedDowntime"]` | 3 (`+ "comfort"`) | `eventLog[].event` |
| 4 | `StressChannelId` | 5 members | 6 (`+ "positiveSocialProximity"`) | `eventLog[].event.contributions[].id` for `stressEvaluated` |

Site 1 is ADR-21 D5's own rule, amended here. Sites 2-4 live in `serialization.ts`'s mirrored closed lists and in M7's `StressChannelId`; no ADR owns them exclusively, and `design/comfort-assist-protocol.md` D13 governs them directly. They are enumerated here so the version bump has one complete, reviewable justification rather than three partial ones.

**Why bump when no field is added or removed.** The save format's compatibility contract is *the set of documents the loader accepts*, and all four sites change it. The version integer is the format's only compatibility signal - there is no capability negotiation, no feature flags, no per-field versioning - and loading is reject-only. Without a bump, a v6-labelled save written by the new build and containing `action: "comfort"` handed to an older build fails deep inside field validation with a message that says "your save is corrupt" when the truth is "your build is older than your save." The bump converts a misleading data-corruption error into the format's designed, single, diagnosable failure at the version gate.

**Compatibility behavior, all three cases:**

1. **New build (v7) loading a v6 save: rejected** at the version gate, before any field is read. No migration, no upgrade, no repair, no partial load. This holds *even though* the widenings are strictly additive and a v6 document would satisfy every v7 field rule - accepting it would be the first exception to reject-only loading and would create an implicit two-version compatibility contract nothing in the codebase maintains or tests. (See Neutral / Deferred.)
2. **Old build (v6) encountering a v7 save: rejected symmetrically**, from the same gate, with no change required to the old build and nothing partially consumed.
3. **Within v7: validate-never-repair, unchanged and reinforced** - see D4.

### D4 - Load rejects, never repairs: the amended rule list

ADR-21 D5's full rejection list continues to apply verbatim, with one rule amended and two added. Load rejects - never silently repairs, sorts, renumbers, drops, coerces, or deduplicates:

**Amended from ADR-21 D5:**

- an `action` outside the closed **three**-member union - which specifically includes rejecting `"assist"`, `"sharedMeal"`, and `"confrontation"`.

**Added by this ADR:**

- a persisted `relatedSocialTaskId` outside the closed three-member list, on any goal in `colonists[]` or `decisionLog[]` - including `"assist"`;
- a `socialOfferCreated` event whose `action` is outside the closed three-member list - including `"assist"`;
- a `stressEvaluated` contribution whose channel id is outside the closed six-member `StressChannelId` list;
- **more than one `comfort` execution naming the same colonist as its recipient, whether in-progress or suspended, in any combination** (the design's one-comforter-per-recipient invariant, checked as a continuous state-level assertion in `validateSimulationState` — not a load-only check). Rejected, never deduplicated, and never resolved by the design's lowest-id tie-break - that tie-break exists to keep the active-recipients basis builder a total function, not to repair a malformed save. Covering suspended executions is required because `resumeSuspended` can restore an interrupted Comfort without re-checking social eligibility (`design/comfort-assist-protocol.md` §0.5 / §5.3).

Every other ADR-21 D5 rule - duplicate ids, ids at or beyond `nextOfferSequence`, unknown or self-referential colonist ids, the closed status union, the closed reason union, the exhaustive validity matrix, the tick-ordering floors, `resolvedAtTick` bounds, the pending-per-responder store invariant, and ascending-`id` order - is untouched and continues to be enforced exactly as written.

Widening a closed list changes *what is valid*. It changes nothing about *what happens to the invalid*.

### D5 - What this ADR does not change in ADR-21

Stated explicitly so the amendment's blast radius is reviewable:

- **D1** - the top-level M12-owned `socialOffers` store and its two fields: unchanged.
- **D3** - persisted monotonic counter identity, no UUIDs, ascending-`id` processing order: unchanged. Comfort offers are appended to the same array and processed in the same single ascending-`id` loop, with no separate pass.
- **D4** - pending offers never evicted, resolved offers FIFO-bounded, and the store is never a decision input: unchanged. Comfort's Phase 6 resolution reads pending offers only, exactly as the existing actions do. **The design's participation guard reads the per-colonist runtime collection, not the offer store**, so it does not touch this boundary.
- **D6** - replay's generic `STATE_FIELDS` comparison and the inspector's detached copy: unchanged, with no Comfort-specific comparison or display logic.
- **Invariants 1-8**: unchanged. **Invariant 9**: unchanged in content, now read over the three-member action union.

## Required Invariants

Additional to ADR-21's nine, which all continue to hold.

10. `SocialOfferAction` is closed at exactly three members; `"assist"` is not one of them. Admitting a fourth member is an architecture gate, not a tuning or implementation choice.
11. No persisted document accepted by v7 contains `"assist"` in any action or social-task position. Load rejects such a document rather than ignoring the field.
12. At most one `comfort` execution — in-progress or suspended — names any given colonist as its recipient, in memory and in every loadable state; violations are rejections by `validateSimulationState` (tick input/exit and deserialize), never repairs.
13. The save version is the first and only compatibility signal consulted on load; no version other than the current one is read past the version gate, in either direction.
14. The `OfferResolutionReason` union remains closed at seven members; `responderNotInterruptible`'s generalized meaning adds no member.

## Options Considered

### Option A - Widen `SocialOfferAction` to four members now (Comfort and Assist), generate Assist candidates later

**Rejected because:** it persists a vocabulary with no owner, no behavioral design in force, and no gate. A save could then legitimately contain `action: "assist"` with nothing in the system able to produce or resolve it, and the union's closure - the property ADR-21 D2 exists to protect - would be documenting an intention rather than a decision. It also directly contradicts the Human ruling that Assist must not widen runtime or persisted unions in this slice.

### Option B - Widen to exactly three members, Comfort only (selected)

One new member, one architecture gate, one save-version bump, with `"assist"` remaining a load rejection until its own gate. The closed-union discipline keeps its meaning: every admitted member has a design in force and a producer in the code.

### Option C - Edit ADR-21 in place

**Rejected because:** `adr/README.md` and `SYSTEM_MAP.md` both state that accepted ADRs are immutable and append-only. ADR-21's own in-place edits happened during review, pre-acceptance. Editing an Accepted ADR would also destroy the record of what was accepted on 2026-07-17.

### Option D - Supersede ADR-21 entirely with a new offer-storage ADR

**Rejected because:** ADR-21 D1, D3, D4, and D6 are untouched and still govern. Superseding would retire live decisions and force a reader to diff two documents to learn that the store shape, identity scheme, retention policy, and decision-input boundary never changed. An amendment of D2/D5 states the change exactly.

### Option E - Skip the save-version bump, since the widenings are additive

**Rejected because:** three of the four sites still widen even in the narrowed Comfort-only scope, and site 4 follows directly from the new stress-relief channel. Under reject-only loading the version integer is the only compatibility signal, so an unbumped format reports a field-level corruption error for what is actually a version mismatch. See D3.

### Option F - Add a `comfortTargetNotStressed` reason code

**Rejected because:** the `OfferResolutionReason` members are outcome-shaped, not action-shaped. A per-action code for each new action would grow the union linearly with the action vocabulary and defeat the closure ADR-21 D2 established. `responderNotInterruptible` already means "this responder's state does not admit this action," and D2 records that reading.

## Consequences

### Positive

- Slice 7's Comfort implementation is unblocked on acceptance, with the persisted surface settled before code.
- The offer store, replay, and inspection paths absorb a third action with no new comparison, display, or storage logic - the closed-union extension point working as ADR-21 D2's "Consequences / Positive" anticipated ("the shape survives future slices ... only the closed unions widen, by ADR revision").
- The deferral of Assist is enforced at the persistence layer, not just in review: `"assist"` is a load rejection, so scope creep in a union-widening slice fails a test rather than passing unnoticed.
- The amendment's blast radius is explicit (D5), so a future reader knows ADR-21 still governs everything it is not listed as losing.

### Negative

- One more save-version bump during the prototype (accepted cost; ADR-20 and ADR-22 set the precedent and no migration framework is needed). Existing v6 saves become unloadable.
- Wiring Assist later requires a *second* widening of the same union and, with it, another version bump - two gates where one might have served. This is the deliberate cost of not persisting an unowned vocabulary (Option A), and it is bounded: one member, one bump.
- Comfort-only means ADR-18 D1's Support pair is half-realized until the Assist follow-up lands, so the "Support category" is a single action in the shipped vocabulary for now.

### Neutral / Deferred

- **Whether a v7 build should accept additive-subset v6 saves.** D3 rejects them, preserving reject-only loading. Subset acceptance would be technically safe for exactly these widenings but would establish a multi-version compatibility contract as a general precedent - a serialization-architecture decision. If it is wanted, it is its own ADR; this ADR stands unchanged in the meantime.
- Comfort's acceptance probabilities, affinity and Social-restore magnitudes, the stress-relief magnitude, and the decline-friction question: prototype tuning (`design/comfort-assist-protocol.md` §17), not architecture.
- Admitting `"assist"` to D1's union, extending the participation basis to Assist, and the further version bump those imply: deferred to the Assist follow-up (`design/comfort-assist-protocol.md` §15), blocked on a real work-progress model and/or per-colonist work scheduling. ADR-18 DQ-18.7 is already ruled (non-rejection) and does not reopen.

## Validation Required Before Implementation

- `SOCIAL_OFFER_ACTIONS` has exactly three members; a compile-time exhaustive `switch` over `SocialOfferAction` with a `never` default guards every action-keyed site, so a later widening cannot compile until it is handled.
- One load-rejection / state-rejection test per amended and added D4 rule: `action: "assist"` and other out-of-union actions; `relatedSocialTaskId: "assist"` on a persisted goal and on a decision-log outcome; `socialOfferCreated` with `action: "assist"`; an unknown `stressEvaluated` channel id; two Comfort executions naming one recipient in each combination of in-progress and suspended. Each must throw and construct no state.
- Version-gate tests in both directions: a v6 save rejected by a v7 build with the version-mismatch message (not a field error) and no partial state; and the symmetric v7-under-v6 rejection.
- Save/load round-trip of a state holding a pending Comfort offer mid-delay, an accepted Comfort offer, and a declined Comfort offer, each bit-identical, alongside the existing Conversation/Shared Downtime cases.
- A v7 save containing `positiveSocialProximity` contributions loads cleanly.
- Replay divergence test: two runs differing only in a Comfort offer field report that field's dotted path, with no offer-specific comparison logic added.
- Inspector detachment test continues to pass with Comfort offers present.
- ADR-21's own pre-implementation validation list continues to pass unchanged - counter monotonicity, pending-never-evicted, FIFO eviction determinism, status-machine terminality, and one test per original D5 rule.

## Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| Widen `SocialOfferAction` to exactly three members (`+ "comfort"`) | Comfort reuses ADR-21's store unchanged in shape; the closed union is the documented extension point, and one member is the whole change | Four members including `"assist"` (persists an unowned vocabulary; contradicts the Human ruling); a second Comfort-specific offer store (duplicates the mechanism for an action needing no different shape) |
| `"assist"` remains a load rejection under v7 | The Human ruling defers Assist and forbids widening runtime or persisted unions in this slice; making it a rejection gives the deferral persistence-layer teeth instead of relying on reviewer vigilance | Admitting it silently; admitting it and ignoring the field on load (a repair, forbidden by ADR-20/ADR-21 discipline) |
| Action-keyed responder eligibility; `responderNotInterruptible` generalized, no new reason code | `"stressed"` is not an interruptible state, so the existing predicate would make Comfort decline every offer, inverting ADR-18 D4.3. The reason union's members are outcome-shaped, so the existing code already covers the outcome | A `comfortTargetNotStressed` member (fragments a deliberately closed union, and grows linearly with the action vocabulary); adding `"stressed"` to `INTERRUPTIBLE_AMBIENT_STATES` (would silently make Conversation and Shared Downtime target stressed colonists too) |
| Save format v7, four sites enumerated in one place | The compatibility contract is the accepted-document set, and all four sites change it; the version integer is the only signal under reject-only loading | Skipping the bump (misleading corrupt-save error for a version problem); bumping for site 1 only and leaving sites 2-4 unrecorded (three partial justifications instead of one complete one) |
| v6 saves rejected outright by v7 builds, despite additive widenings | Preserves reject-only loading as the single accepted posture (ADR-20 D8, unchanged since v1); subset acceptance would create a two-version compatibility contract nothing maintains | Accepting v6 as a subset (first exception to a locked discipline) - raised in Neutral / Deferred for its own ADR rather than decided here; a v6-to-v7 migration path (no framework exists and this slice is not the place to introduce one) |
| One-comforter-per-recipient covers in-progress and suspended Comfort executions as a continuous state-level rejection, not a repair | Matches ADR-21 D5's validate-never-repair discipline; admission and assertion must prove the same predicate because `resumeSuspended` can restore an interrupted Comfort without social re-check (`design/comfort-assist-protocol.md` v0.4.0) | Deduplicating on load; resolving with the tie-break; scoping the invariant to in-progress only (leaves the resume path open) |
| A new ADR amending ADR-21 D2/D5, not an in-place edit and not a supersession | `adr/README.md` and `SYSTEM_MAP.md` make accepted ADRs immutable and append-only; ADR-21's in-place edits were pre-acceptance. D1/D3/D4/D6 are untouched, so supersession would retire live decisions | Editing 0021 (destroys the accepted record); full supersession (retires decisions that still govern and forces a two-document diff) |
| Numbered 0024, skipping the in-flight 0023 | `origin/codex/issue-142-adr-23` claims 0023; README forbids reusing a number, and skipping an in-flight one honors that | Reusing 0023 (collision on merge); renumbering the other branch's work |
| ADR-21's header flipped only at acceptance | Editing an Accepted append-only document is the acceptance gate's action, not a proposal's | Flipping it in the draft (pre-empts a decision this ADR does not own) |

---

## Kanban Update

**Card:** [Phase 3] ADR-24 - Comfort Offer Action and Save Format v7
**Status:** Done - architecture review + Human acceptance recorded 2026-07-29 (issue #151); Status flipped to Accepted; ADR-21 header amended.
**Completed:** Accepted `ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md` as the governing storage contract for Comfort-only Slice 7 (three-member `SocialOfferAction`, action-keyed eligibility, save format v7, `"assist"` rejection, one-comforter-per-recipient including suspended). Comfort implementation already on `main` via PR #153; this gate closes the document status to match.
**Changed Files:**
  MODIFIED ai-studio/adr/0024-comfort-offer-action-and-save-format-v7.md (Status → Accepted; Tracks; Kanban)
  MODIFIED ai-studio/adr/0021-social-offer-state-storage.md (header: Amended by ADR-24 (D2, D5))
  MODIFIED design/comfort-assist-protocol.md (companion ADR status → Accepted)
**Validation:** Acceptance records the contract already implemented and reviewed on PR #152 / #153. No runtime or union changes in this gate. Admitting `"assist"` remains a separate future architecture gate (`design/comfort-assist-protocol.md` §15).
**Follow-up Tasks:** None for Comfort storage. Assist admission to D1's union stays blocked on §15 preconditions.
