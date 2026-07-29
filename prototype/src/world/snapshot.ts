// M4 Snapshot Service — engineering spec §2 M4; decision-loop §1b. THE ONLY world-to-decision
// read path (locked #4, #21, #22). No decision module may read World, Policy, or Clock
// directly — every decision-relevant fact about the world arrives through a WorldSnapshot
// built here, fixed for the duration of one decision.
//
// Perception invariants enforced by construction, not by convention:
//   - fixed: buildSnapshot returns a plain immutable value; nothing in it can change after
//     the call returns. The policy and per-module slices are COPIED at build time (Copilot-
//     confirmed defect: they previously aliased the caller's objects, so the "fixed" claim
//     held only by the convention that World/Policy updates never mutate in place — a
//     mutation through any other reference would have retroactively changed an existing
//     snapshot). Copying makes the invariant hold at runtime regardless of what any caller
//     does (locked #4: "no mid-decision reads, no live cross-agent references").
//   - Tier-1-only, spatially bounded: nearbyColonists carries only observable ambient state,
//     never another colonist's internals (locked #21). Stage 2 build step 4 (ADR-20 D3):
//     buildSnapshot accepts an already-computed Tier-1 view of other colonists and carries it
//     through unchanged — the same assemble-don't-derive pattern as `modules`/`foodStock`. This
//     module never reads M10 (the relationship store) to decide who is nearby: candidate
//     enumeration is snapshot-driven, never relationship-store-driven, so a colonist the owner
//     has never interacted with is exactly as visible here as one they have a long history
//     with. Real single-colonist runs still pass nothing, so the field defaults to empty —
//     present, not populated, until a caller actually has other colonists to report.
//   - no crisis-stage labels: this module reads M2 conditions only; stage labels are S2's
//     player-signaling output and are never colonist input (locked #22). S2 does not exist
//     yet, so there is nothing to exclude in code — this is a standing constraint on future
//     additions to this file, not a runtime check today.

import type { ClockState } from "../core/clock.js";
import { dayOf, tickOfDay } from "../core/clock.js";
import { MODULE_IDS, type ModuleId } from "../config/constants.js";
import type { ModuleState, WorldState } from "./world.js";
import type { ShiftPeriod, ShiftPolicy } from "./policy.js";
import { periodAt } from "./policy.js";

/**
 * A nearby colonist's Tier-1-observable facts only (ADR-05's seven states) — "a colonist
 * knows what the player can see" (locked #21). No internals (needs, stress, goals, memory)
 * are representable in this type; that is the boundary, not an omission.
 * `moduleId` is a transient co-location proxy for Confrontation (design D1b) — derived from
 * the in-progress execution's task module, never persisted.
 */
export interface ObservableColonist {
  readonly id: string;
  readonly ambientState: string;
  readonly moduleId: ModuleId | null;
}

/** The fixed, per-decision world snapshot (decision-loop §1b). */
export interface WorldSnapshot {
  readonly tick: number;
  readonly day: number;
  readonly tickOfDay: number;
  readonly currentPeriod: ShiftPeriod;
  readonly effectivePolicy: ShiftPolicy;
  readonly modules: Readonly<Record<ModuleId, ModuleState>>;
  readonly foodStock: number;
  readonly nearbyColonists: readonly ObservableColonist[];
}

/**
 * Builds one fixed snapshot from the current world, policy, and clock state, plus an
 * already-computed Tier-1 view of nearby colonists (default empty — the real run has exactly
 * one colonist so far; Stage 2 candidate/decision wiring that would supply a real list remains
 * a later, separately-approved slice). Pure: the result is a new plain object, and the
 * policy/module slices are copied rather than aliased — no later mutation reachable through the
 * caller's references can change an existing snapshot. `nearbyColonists` is carried through
 * exactly as given — this module computes no colonist's ambient state and consults no other
 * module (in particular, never M10) to decide who is nearby.
 */
export function buildSnapshot(
  clock: ClockState,
  policy: ShiftPolicy,
  world: WorldState,
  nearbyColonists: readonly ObservableColonist[] = [],
): WorldSnapshot {
  const tod = tickOfDay(clock);
  const modules = {} as Record<ModuleId, ModuleState>;
  for (const id of MODULE_IDS) {
    modules[id] = { ...world.modules[id] };
  }
  return {
    tick: clock.tick,
    day: dayOf(clock),
    tickOfDay: tod,
    currentPeriod: periodAt(policy, tod),
    effectivePolicy: { ...policy },
    modules,
    foodStock: world.foodStock,
    nearbyColonists: [...nearbyColonists],
  };
}
