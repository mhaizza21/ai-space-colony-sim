# ADR-25 - Conflict Runtime State and Save Format v8

**Status:** Proposed
**Date:** 2026-07-29
**Phase:** Phase 3 - Stage 2 Slice 8 architecture gate
**Deciders:** Project owner, Technical Architect
**Tracks:** GitHub issue #155 (parent #119), design PR (Confrontation/`In Conflict` design)
**Amends:** **ADR-22 (Accepted) - D1 and D6 only.** ADR-22 D2, D3, D4, D5 and its Required Invariants continue to govern unchanged; this ADR is an amendment of two decisions, not a supersession of the record.
**Governed by:** ADR-18 (Accepted - the Social Action Space that names Confrontation and `In Conflict` and authorizes their behavioral vocabulary), ADR-20 (Accepted - `directConflict`, already an accepted, unused `RelationshipChangeSource` member; unchanged by this ADR), ADR-22 (Accepted - the per-colonist runtime collection this ADR amends), ADR-24 (Accepted - the direct structural precedent this ADR follows for amending rather than superseding), `design/confrontation-conflict-protocol.md` v0.1.0 (the behavioral design this ADR gives a storage home; D6, D8, D9 are this ADR's exact scope), `design/engineering-specification.md` v0.3.0, `ai-studio/constitution/architecture-philosophy.md`

**This ADR does not contain:** behavioral rules. The condition conjunction, the DQ-18.3 threshold/probability structure, the encounter-only mechanics, the stress-spike consequence and its trait-multiplier hook, and the `In Conflict` enter/exit precedence rule are decided by ADR-18 D3/D4/D6/D7/D8/D9 and `design/confrontation-conflict-protocol.md` v0.1.0. This ADR decides only what the per-colonist runtime container's field list admits, what the save format accepts, and what load / continuous-state validation rejects for those two new persisted surfaces - the Data model / Save format / Serialization trigger surface `ai-studio/workflows/kanban-update-protocol.md` requires an accepted ADR for.

**This ADR does not touch the social-offer store.** Confrontation is encounter-only (ADR-18 D3) and never uses `SocialOfferStore` - no member is added to `SocialOfferAction`, no `OfferResolutionReason` is consumed, and ADR-21/ADR-24's closed unions are unmodified by this ADR. A reader who expects Slice 8 to repeat Slice 7's amendment shape (widen `SocialOfferAction`) should instead read D1 below: the trigger this time is entirely inside `ColonistRuntime`.

---

## Context

Stage 2 Slice 8 wires **Confrontation** and a reachable **`In Conflict`** ambient state, the last two members of ADR-18 D1's six-action vocabulary to leave the "vocabulary-only, unreachable" state Slice 5-7 already retired for the other four. The Human-approved path (`design/confrontation-conflict-protocol.md` v0.1.0) detects and resolves Confrontation entirely inside the existing Phase 4 (condition & trigger detection) - it is condition-triggered, never a goal, and never routed through the offer/response mechanism ADR-21/ADR-24 govern.

That design requires exactly two new pieces of persisted state:

- One new field on `ColonistRuntime` (ADR-22 D1's exact territory): `inConflictUntilTick: number | null`, the time-bounded signal that makes `In Conflict` reachable as an ambient-state override independent of `Execution`/`Goal`.
- One new member on the closed `StressChannelId` union (already amended once, by ADR-24 D3 site 4, for Comfort's `positiveSocialProximity` relief): `hostileProximityConflict`, the acute stress-spike channel ADR-18 D8 names ("an acute instance of the hostile-proximity accumulation source").

Both are Data model / Save format / Serialization changes under `ai-studio/workflows/kanban-update-protocol.md`'s trigger table. Neither touches the social-offer store, the relationship store's shape (`directConflict` is already an accepted, unused `RelationshipChangeSource` member - ADR-20 needs no change), or the seven-phase order / PRNG architecture (ADR-22 D2/D4 - unchanged).

The decision must preserve: ADR-22's container shape, phase realization, snapshot discipline, and single-PRNG-stream decision (D2-D5, all untouched); ADR-20's serialization discipline as it applies to the (unchanged) relationship store; and the determinism obligations of `design/engineering-specification.md` §8.

### Why a new ADR amending ADR-22, rather than editing ADR-22 or amending ADR-21/ADR-24

Identical reasoning to ADR-24's own, applied to the correct owner this time. `ai-studio/adr/README.md` states ADRs "are immutable once accepted - superseded decisions get a new ADR that references the old one," and `ai-studio/SYSTEM_MAP.md` classifies `adr/` as append-only. ADR-22 D1 (the `ColonistRuntime` container shape) and D6 (save/replay/inspector surfaces) are exactly what changes; D2 (phase realization), D3 (snapshot discipline), D4 (the single-PRNG-stream decision), and D5 (social-protocol integration notes) are entirely untouched, so a full supersession would retire decisions that still govern - the same over-reach ADR-24 rejected (its own Option D) when the analogous question arose for ADR-21.

**This is not an amendment of ADR-21/ADR-24.** Those govern the social-offer store exclusively; Confrontation never touches it (ADR-18 D3). Filing this as an ADR-21/ADR-24 amendment would misattribute the trigger to the wrong owning decision.

**Acceptance gate action:** ADR-22's header is flipped to `Amended by ADR-25 (D1, D6)` in the same acceptance change that sets this Status to Accepted - mirroring exactly how ADR-24's acceptance flipped ADR-21's header.

**Numbering:** 0025 is the next free number after 0024 (Accepted 2026-07-29); no in-flight branch claims it as of this writing.

## Decision

### D1 - `ColonistRuntime` gains one new field: `inConflictUntilTick`

```text
ColonistRuntime {
  colonist: ColonistState
  execution: Execution | null
  suspendedExecution: Execution | null
  deprivationBaselines: Record<NeedId, number>
  stressBaseline: number
  relationshipAffinityBaselines: Record<string, number>
  inConflictUntilTick: number | null          // NEW - this ADR
}
```

This amends ADR-22 D1's container shape by exactly one field. Every existing field keeps its exact ADR-22 D1 shape and semantics - no field is renamed, removed, or reinterpreted, and no other container-level invariant changes. `inConflictUntilTick` is set to `clock.tick + IN_CONFLICT_DISPLAY_TICKS` for both participants the instant a Confrontation fires (`design/confrontation-conflict-protocol.md` D6/D7) and is otherwise `null`. It has no cross-reference to any other colonist's state and no pairing invariant analogous to ADR-24's one-comforter-per-recipient rule - it is single-colonist-scoped, read-only-by-itself state.

**Semantics fixed here, behavior fixed by the design:** this ADR fixes only that the field exists, is nullable, and is a non-negative integer tick reference when present. The precedence rule that makes it override `ambientStateFor`'s output (`In Conflict` outranking `stressed` while active) is `design/confrontation-conflict-protocol.md` D6's behavioral decision, not this ADR's.

### D2 - `StressChannelId` widens to a closed **six**-member union

```text
StressChannelId =
  | "psychNeedDeprivation"
  | "biologicalStrain"
  | "overwork"
  | "restAdequacy"
  | "needsSatisfied"
  | "positiveSocialProximity"      // added by ADR-24 D3 site 4
  | "hostileProximityConflict"     // added by this ADR
```

Widens to seven members total (six were already accepted by ADR-24's amendment site). No ADR owns this union exclusively - ADR-24 D3 states this explicitly ("Sites 2-4 live in `serialization.ts`'s mirrored closed lists and in M7's `StressChannelId`; no ADR owns them exclusively") - so recording this second widening belongs wherever the currently-changing persisted shape's owning ADR is. Because this ADR is already amending `ColonistRuntime`'s persisted shape for D1, and `hostileProximityConflict`'s contributions are persisted inside `eventLog[].event.contributions[]` for `stressEvaluated` events exactly as `positiveSocialProximity`'s are, this ADR records both changes in one complete, reviewable version bump rather than two partial ones - the same rationale ADR-24 D3 gave for enumerating all four of its own sites together.

### D3 - Save format v8

`SAVE_FORMAT_VERSION` increments from 7 to 8. No migration framework; earlier versions are rejected by version check outright (ADR-20 D8's posture, unchanged since v1; ADR-22 D3's precedent; ADR-24 D3's precedent, repeated once more).

Two persisted validation sites change the set of accepted documents:

| # | Site | Before | After | Persisted in |
|---|---|---|---|---|
| 1 | `ColonistRuntime` field list | 6 fields | 7 (`+ inConflictUntilTick`) | `colonists[]` |
| 2 | `StressChannelId` | 6 members | 7 (`+ "hostileProximityConflict"`) | `eventLog[].event.contributions[].id` for `stressEvaluated` |

**Compatibility behavior, identical in kind to ADR-24 D3:**

1. **New build (v8) loading a v7 save: rejected** at the version gate, before any field is read - even though a v7 document (which never has `inConflictUntilTick` or a `hostileProximityConflict` contribution) would satisfy every v8 field rule if the missing field were treated as implicitly `null`. Accepting it would be the first exception to reject-only loading, exactly the exception ADR-24 D3 already declined to make once; this ADR does not make it a second time.
2. **Old build (v7) encountering a v8 save: rejected symmetrically**, from the same gate.
3. **Within v8: validate-never-repair, unchanged and reinforced** - see D4.

### D4 - Load rejects, never repairs: the amended rule list

ADR-22's existing per-container validation rules continue to apply verbatim (non-empty collection, unique safe canonically-ordered ids, the suspended-pair rule, the offer-backed-suspension exception, the one-comforter-per-recipient rule from ADR-24, goal/execution key agreement). **Added by this ADR:**

- a `colonists[]` entry whose `inConflictUntilTick` is present but is not a non-negative integer - rejected;
- a `stressEvaluated` event contribution whose channel id is outside the closed seven-member `StressChannelId` list - rejected (this is the same rule ADR-24 D4 already added for the six-member list, re-verified against the now-seven-member list; it does not change in kind, only in the set it checks against).

No new cross-field or cross-colonist invariant is introduced: unlike Comfort's one-comforter-per-recipient rule (ADR-24 D4, D5, D9's own explicit reason it was needed - `resumeSuspended` could silently restore an interrupted Comfort claim without a social re-check), `inConflictUntilTick` has no analogous multi-colonist claim to protect. It is set once, by the same code path, for exactly the two colonists a firing Confrontation names, and decays to irrelevance (D6's exit rule) without ever being resumed, suspended, or re-derived from another colonist's state. There is therefore no "resume path" this field can leak through the way a suspended Comfort execution could - a load rejects a malformed *value* (D4 above) but needs no rejection rule for a malformed *relationship between two colonists'* `inConflictUntilTick` values, because none exists.

Every ADR-22 rule not named above, and every ADR-24 rule (unchanged - Comfort's storage is entirely untouched by this ADR), continues to be enforced exactly as written.

### D5 - What this ADR does not change in ADR-22

Stated explicitly so the amendment's blast radius is reviewable, mirroring ADR-24 D5's own structure:

- **D2** (phase realization: the seven-phase order runs each per-colonist phase across the collection) - unchanged. Confrontation detection is a new sub-step inside the *existing* Phase 4, not a new phase.
- **D3** (snapshot discipline: one observation basis, same-tick non-observability) - unchanged. The one addition to the shared basis (`ObservableColonist.moduleId`, `design/confrontation-conflict-protocol.md` D1b) is a `world/snapshot.ts` type change, not a `SimulationState`/`ColonistRuntime` persisted-shape change, and is not part of this ADR's scope - it is transient, per-decision data (`WorldSnapshot`'s own contract, ADR-22's own D3 language: "snapshots remain fixed plain values... never persisted state").
- **D4** (EQ-3: one shared attributed PRNG stream, canonical draw order) - unchanged. This design's one new attributed draw site (`confrontationTrigger`) is one more consumer of the same stream, in the same canonical iteration order, not a new stream and not a new ordering rule.
- **D5** (social protocol integration: unchanged rules, real participants) - unchanged; Confrontation does not use the social-offer protocol this decision governs.
- **D6**'s mechanism (replay's generic `STATE_FIELDS` comparison; the inspector's detached copy) - unchanged. The new field is covered automatically by the existing generic per-field diff, exactly as D6 already anticipated for "any future `ColonistRuntime` field" (ADR-22's own Decision Log entry for D6 makes this explicit).
- ADR-22's Required Invariants 1-13: unchanged in content. Invariant 3 (per-container invariants) now additionally covers `inConflictUntilTick`'s single-field validity rule (D4 above), stated as new Invariant 14 below rather than a silent extension.

## Required Invariants

Additional to ADR-22's thirteen (as amended by ADR-24), which all continue to hold.

15. `ColonistRuntime.inConflictUntilTick` is `null` or a non-negative integer tick reference; a persisted value failing this is a load rejection, never a repair.
16. `StressChannelId` is closed at exactly seven members (six existing plus `hostileProximityConflict`); a `stressEvaluated` contribution outside this set is a load rejection.
17. The save version is the first and only compatibility signal consulted on load; no version other than the current one is read past the version gate, in either direction (restated from ADR-24 Invariant 13, applying identically to the v7→v8 boundary).
18. `inConflictUntilTick` carries no cross-colonist or cross-field invariant beyond D4's single-value validity rule - it is never a target of a resume, suspend, or claim-uniqueness check, and no future extension may introduce one without revising this ADR (a structural note, not a behavioral one - the behavioral guarantee that no such claim exists lives in `design/confrontation-conflict-protocol.md` D6).

## Options Considered

### Option A - Amend ADR-21/ADR-24 instead of ADR-22

**Rejected because:** Confrontation never touches the social-offer store; ADR-21/ADR-24 govern `SocialOfferStore`/`SocialOfferAction` exclusively, and this ADR's entire trigger is a `ColonistRuntime` field plus a `StressChannelId` member - both squarely ADR-22's territory (D1, D6) and the same site ADR-24 already used once for the sibling stress-channel widening. Filing here would misattribute authority.

### Option B - A new field on `ColonistState` (inside the colonist's own identity/long-term/short-term container) instead of on `ColonistRuntime`

**Rejected because:** `inConflictUntilTick` is not colonist identity, need, stress, memory, or goal-stack state (`ColonistState`'s own scope per `design/autonomous-three-colonist-runtime.md` D1) - it is runtime-lifecycle state analogous to `execution`/`suspendedExecution`, which already live one level up, on `ColonistRuntime`. Placing it on `ColonistState` would mix a transient-by-design display signal into the container ADR-17/ADR-18's behavioral rules already own, for no benefit.

### Option C - Widen to seven members, Confrontation and a placeholder for future Friction-category channels, now

**Rejected because:** matches ADR-24's own Option A rejection reasoning exactly - it would persist a vocabulary with no owner and no producer, the precise failure mode a closed-union discipline exists to prevent. One member, one design in force, one producer in the code.

### Option D - Skip the save-version bump, since the widening is additive (a v7 save simply never contains the new field/channel)

**Rejected because:** identical reasoning to ADR-24's own Option E rejection. Under reject-only loading the version integer is the only compatibility signal; without a bump, a v8-labelled document handed to a v7 build (or vice versa) fails deep inside field validation with a misleading "corrupt save" message instead of the format's designed, single, diagnosable version-gate failure.

### Option E - Edit ADR-22 in place, or supersede it entirely

**Rejected because:** `adr/README.md` and `SYSTEM_MAP.md` make accepted ADRs immutable and append-only (in-place edit rejected); D2-D5 are untouched and still govern (full supersession rejected) - identical reasoning to ADR-24's own Options C/D for ADR-21.

## Consequences

### Positive

- Slice 8's Confrontation/`In Conflict` implementation is unblocked on acceptance, with the persisted surface settled before code.
- Replay and inspection absorb the new field/channel with no new comparison, display, or storage logic - ADR-22 D6's "any future field" anticipation and ADR-21 D2's "the shape survives future slices... only the closed unions widen, by ADR revision" both hold again, for a second sibling ADR in a row.
- The amendment's blast radius is explicit (D5), so a future reader knows ADR-22 still governs everything it is not listed as losing - the same transparency ADR-24 established for ADR-21.
- Confrontation's deferral-with-teeth pattern is not needed here (unlike Assist's `"assist"` load-rejection in ADR-24) - there is no partially-designed sibling action being deliberately excluded this time; both of ADR-18's remaining unreached actions (Confrontation, and `In Conflict` as its ambient consequence) are admitted together, completely, by this one ADR.

### Negative

- One more save-version bump during the prototype (accepted cost; ADR-20, ADR-22, and ADR-24 set the precedent, and no migration framework is needed). Existing v7 saves become unloadable.
- A second closed-union widening for `StressChannelId` in consecutive slices establishes that this union will keep growing by one member per new stress-consequence-bearing action - an accepted, bounded cost (each widening is one member, one ADR site, following the fixed pattern ADR-24 D3 established).

### Neutral / Deferred

- Whether a v8 build should accept additive-subset v7 saves: deferred identically to ADR-24's own Neutral/Deferred entry - its own reasoning stands unchanged and is not re-litigated here.
- DQ-1 through DQ-5 (`design/confrontation-conflict-protocol.md` §13): threshold, probability, display-duration, and affinity/stress magnitude values remain prototype tuning, not architecture.
- The trait-multiplier hook (`stressResponseConflictMultiplier`) returning `1` for every currently-defined trait, and whether `"volatile"` should ever become a canonical trait: deferred to DQ-T1's own authority, per `design/confrontation-conflict-protocol.md` Finding 1 - not decided by this ADR.

## Validation Required Before Implementation

- `ColonistRuntime`'s field count and `StressChannelId`'s member count are each pinned by a compile-time exhaustive check (a `never`-default `switch` over `StressChannelId` at every consuming site), so a later widening cannot compile until handled - mirroring ADR-24's own validation requirement for `SocialOfferAction`.
- One load-rejection / state-rejection test per D4 rule: a negative or non-integer `inConflictUntilTick`; a `stressEvaluated` contribution with an unknown channel id. Each must throw and construct no state.
- Version-gate tests in both directions: a v7 save rejected by a v8 build with the version-mismatch message (not a field error) and no partial state; the symmetric v8-under-v7 rejection.
- Save/load round-trip of a state holding one colonist mid-`In Conflict` window (`inConflictUntilTick` in the future relative to the loaded clock) and one colonist with `inConflictUntilTick: null`, both bit-identical.
- A v8 save containing `hostileProximityConflict` contributions loads cleanly.
- Replay divergence test: two runs differing only in `inConflictUntilTick` or a `hostileProximityConflict` contribution report that field's dotted path, with no Confrontation-specific comparison logic added.
- Inspector detachment test continues to pass with a colonist carrying a non-null `inConflictUntilTick`.
- ADR-22's own pre-implementation validation list, and ADR-24's, continue to pass unchanged.

## Decision Log

| Decision | Rationale | Alternatives rejected |
|---|---|---|
| `ColonistRuntime` gains exactly one new field, `inConflictUntilTick: number \| null` | The design's `In Conflict` enter/exit signal is runtime-lifecycle state, the same shape as the existing `execution`/`suspendedExecution` fields already on this container | Placing it on `ColonistState` (wrong container - not identity/need/stress/memory/goal-stack state) |
| `StressChannelId` widens to seven members (`+ "hostileProximityConflict"`) | Realizes ADR-18 D8's acute hostile-proximity stress spike; recorded at the same site ADR-24 D3 already amended once for the sibling `positiveSocialProximity` channel | A placeholder/generic Friction-channel member added speculatively now (persists unowned vocabulary, ADR-24's own rejected Option A pattern) |
| This ADR amends ADR-22 D1/D6, not ADR-21/ADR-24 | Confrontation never touches the social-offer store (ADR-18 D3: encounter-only); the entire trigger is a `ColonistRuntime`/`StressChannelId` change, squarely ADR-22's territory | Amending ADR-21/ADR-24 (wrong owner - no offer-store change exists) |
| Save format v8, two sites enumerated in one place | The compatibility contract is the accepted-document set; both sites change it in the same slice, so one complete justification serves better than two partial ones | Separate ADRs/bumps for the field and the channel (splits one slice's trigger across two gates for no benefit) |
| No new cross-colonist invariant for `inConflictUntilTick` (unlike Comfort's one-comforter-per-recipient rule) | The field is single-colonist-scoped, set once by the firing code path, never resumed or re-derived - it has no analogous "leak through the resume path" the way a suspended Comfort execution did | Adding a defensive cross-check anyway (protects against a failure mode this field's own lifecycle cannot produce - unjustified complexity) |
| v7 saves rejected outright by v8 builds, despite additive widenings | Preserves reject-only loading as the single accepted posture, unchanged since ADR-20 D8 and reaffirmed by ADR-22/ADR-24 | Accepting v7 as a subset (first exception to a locked discipline - raised in Neutral/Deferred for its own ADR, not decided here) |
| A new ADR amending ADR-22, not an in-place edit and not a supersession | `adr/README.md`/`SYSTEM_MAP.md` immutability/append-only rule; D2-D5 are untouched and still govern | Editing 0022 (destroys the accepted record); full supersession (retires decisions that still govern) |
| Numbered 0025, the next free number after 0024 | Sequential, no in-flight branch collision as of drafting | None considered - straightforward continuation |

---

## Kanban Update

**Card:** [Phase 3] ADR-25 - Conflict Runtime State and Save Format v8
**Status:** Review - drafted alongside `design/confrontation-conflict-protocol.md` v0.1.0, per Issue #155's own sequencing ("draft ADR if triggered"). Awaiting Codex architecture review and Human acceptance; not yet Accepted, and ADR-22's header is not yet flipped (that is the acceptance gate's own action, per D5's precedent from ADR-24).
**Completed:** Drafted `ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md` - the `ColonistRuntime` field addition (D1), the `StressChannelId` widening to seven members (D2), save format v8 with both sites enumerated together (D3), the amended load-rejection list including the explicit non-need for a cross-colonist invariant (D4), an explicit statement of what remains unchanged in ADR-22 (D5), five required invariants additional to ADR-22's thirteen, five options considered, and pre-implementation validation requirements - following ADR-24's amendment shape precisely, scoped to the correct owning ADR (22, not 21/24) for this slice's actual trigger.
**Changed Files:**
  CREATED  ai-studio/adr/0025-conflict-runtime-state-and-save-format-v8.md
**Validation:** Every decision traced to `design/confrontation-conflict-protocol.md` v0.1.0 D6/D7/D8/D9, ADR-18 D3/D8, ADR-22 D1-D6, and ADR-24's own amendment precedent (structure, header convention, "what this ADR does not change" section, and the reasoning for amendment-over-edit-or-supersession, reused in kind, not copied verbatim without re-derivation); confirmed no accepted decision in ADR-22 D2-D5 or ADR-20/ADR-21/ADR-24 is reopened; confirmed the social-offer store is untouched.
**Follow-up Tasks:** None beyond Issue #155's own tracked sequence - Codex architecture review, then Human acceptance, before any implementation begins.

**Not committed** per instruction - acceptance is the architecture review's decision, not this draft's.
