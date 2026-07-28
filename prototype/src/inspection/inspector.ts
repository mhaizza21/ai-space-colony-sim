// Build Step 10 — Inspector. Pure, read-only summaries of a SimulationState for headless
// inspection. This module never mutates state, never duplicates a simulation rule, and never
// recomputes a decision: goal/execution/PRNG summaries are reads of state the owning modules
// already produced; the need flags are read-only calls into needs.ts's own predicates (reuse,
// not re-derivation); recent-record queries slice the append-only logs without reordering
// them; the replay summary formats a ReplayResult replay.ts already computed.
//
// Detached snapshots (final review fix, 2026-07-11): every value this module returns is a
// DETACHED, JSON-safe copy — never a reference into the SimulationState or its logs. Mutating
// an inspection result therefore cannot alias back into the simulation. The input state itself
// is never mutated and never frozen (freezing a caller's state would be a mutation of its
// object semantics, not a read).

import { NEEDS, type NeedId } from "../config/constants.js";
import { dayOf, tickOfDay } from "../core/clock.js";
import type { PrngState } from "../core/prng.js";
import type { AmbientState } from "../config/constants.js";
import type { ColonistIdentity } from "../colonist/colonist.js";
import { isCritical, isLow, isSatisfied } from "../colonist/needs.js";
import { canonicalPairId, pairView, type PairView, type RelationshipStore } from "../colonist/relationships.js";
import type { Goal } from "../decision/goals.js";
import { ambientStateFor, type Execution } from "../task/execution.js";
import { periodAt, type ShiftPeriod } from "../world/policy.js";
import type { DecisionLog, EventLog } from "../records/logs.js";
import type { SocialOffer } from "../task/socialOffers.js";
import type { SimulationState } from "../simulation/tick.js";
import type { ReplayResult } from "../replay/replay.js";

/** One need's read-only inspection row: raw tracked values plus needs.ts's own threshold reads. */
export interface NeedInspection {
  readonly id: NeedId;
  readonly level: number;
  readonly ticksBelowLow: number;
  readonly low: boolean;
  readonly critical: boolean;
  readonly satisfied: boolean;
}

/** One colonist's read-only inspection summary (ADR-22 D6) — the per-colonist slice of what used to be top-level fields. */
export interface ColonistInspection {
  readonly identity: ColonistIdentity;
  readonly needs: readonly NeedInspection[];
  readonly stress: number;
  /** Tier-1 observable ambient state (ADR-05) — the seven-state registry, derived here rather than stored redundantly. */
  readonly ambientState: AmbientState;
  readonly currentGoal: Goal | null;
  readonly suspendedGoal: Goal | null;
  readonly execution: Execution | null;
  readonly suspendedExecution: Execution | null;
}

/** The full read-only snapshot of one SimulationState — everything Stage 2 inspection surfaces. */
export interface InspectionSummary {
  readonly tick: number;
  readonly day: number;
  readonly period: ShiftPeriod;
  /** One entry per collection colonist, in canonical (collection) order — detached copies (ADR-22 D6). */
  readonly colonists: readonly ColonistInspection[];
  readonly prng: PrngState;
  readonly foodStock: number;
  readonly recentEvents: EventLog;
  readonly recentDecisions: DecisionLog;
  /**
   * Both directional perspectives for every currently materialized pair (ADR-20 D2's
   * sanctioned inspector use of `pairView`), in canonical pair order. Named states are derived
   * fresh by `pairView` on every call — never stored here or anywhere else (ADR-20 Required
   * Invariant 4). Real single-colonist runs materialize nothing yet, so this is always `[]`
   * until a later, separately-approved slice wires candidate/decision consumption.
   */
  readonly relationships: readonly PairView[];
  /**
   * Stage 2 Slice 5 (ADR-21 D6): every offer in M12's store — pending and retained resolved —
   * as detached copies in stored (ascending-id) order. Read-only exposure for inspection only:
   * per ADR-21 Invariant 8, resolved offers are never a decision input, and this surface is
   * exactly the sanctioned non-decision read (inspection/replay/serialization).
   */
  readonly socialOffers: readonly SocialOffer[];
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`recent-record limit must be a non-negative integer, got ${limit}`);
  }
}

/**
 * Detaches a JSON-safe state slice into an independent deep copy. Every record, goal,
 * execution, and PRNG value in SimulationState is plain JSON data (Step 9's serialization
 * round-trip is the proof), so a JSON round-trip IS the snapshot — no per-type copy logic to
 * drift out of sync with the state shape.
 */
function detach<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Both directional perspectives for every materialized pair, in canonical pair order
 * (lexicographic by [min, max], matching ADR-20 D5's serialization order). Read-only: calls
 * only `pairView`, never a write path, and never touches the store beyond enumerating its keys.
 */
function allRelationshipPairViews(store: RelationshipStore, colonistIds: readonly string[]): readonly PairView[] {
  const minIds = Object.keys(store.pairs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const views: PairView[] = [];
  const seen = new Set<string>();
  for (const min of minIds) {
    const maxIds = Object.keys(store.pairs[min]!).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const max of maxIds) {
      seen.add(`${min}\0${max}`);
      views.push(pairView(store, min, max));
    }
  }
  // Absent pairs shown with the D4 default: every unordered pair of collection colonists not
  // yet materialized (ADR-22 D6 — the collection is the one colonist list to enumerate from).
  for (let i = 0; i < colonistIds.length; i++) {
    for (let j = i + 1; j < colonistIds.length; j++) {
      const [min, max] = canonicalPairId(colonistIds[i]!, colonistIds[j]!);
      if (!seen.has(`${min}\0${max}`)) views.push(pairView(store, min, max));
    }
  }
  return views;
}

/** The last `limit` event records as detached copies, in their original append order. Pure. */
export function recentEvents(state: SimulationState, limit: number): EventLog {
  assertLimit(limit);
  return limit === 0 ? [] : detach(state.eventLog.slice(-limit));
}

/** The last `limit` decision records as detached copies, in their original append order. Pure. */
export function recentDecisions(state: SimulationState, limit: number): DecisionLog {
  assertLimit(limit);
  return limit === 0 ? [] : detach(state.decisionLog.slice(-limit));
}

/**
 * Builds the full read-only summary. `recentLimit` bounds the two record slices (default 10).
 * Pure: reads `state`, never writes it. Every field of the returned summary is a detached
 * copy (see `detach`) — mutating the summary can never reach back into the state.
 */
export function inspect(state: SimulationState, recentLimit = 10): InspectionSummary {
  assertLimit(recentLimit);
  const colonists = state.colonists.map((runtime): ColonistInspection => {
    const traits = runtime.colonist.identity.baseTraits;
    const needs = NEEDS.map((id): NeedInspection => {
      const track = runtime.colonist.needs[id];
      return {
        id,
        level: track.level,
        ticksBelowLow: track.ticksBelowLow,
        low: isLow(id, track.level, traits),
        critical: isCritical(id, track.level),
        satisfied: isSatisfied(id, track.level),
      };
    });
    return {
      identity: detach(runtime.colonist.identity),
      needs,
      stress: runtime.colonist.stress.level,
      ambientState: ambientStateFor(
        runtime.execution,
        runtime.colonist.stress,
        runtime.inConflictUntilTick,
        state.clock.tick,
      ),
      currentGoal: detach(runtime.colonist.currentGoal),
      suspendedGoal: detach(runtime.colonist.suspendedGoal),
      execution: detach(runtime.execution),
      suspendedExecution: detach(runtime.suspendedExecution),
    };
  });

  return {
    tick: state.clock.tick,
    day: dayOf(state.clock),
    period: periodAt(state.policy, tickOfDay(state.clock)),
    colonists,
    prng: detach(state.prng),
    foodStock: state.world.foodStock,
    recentEvents: recentEvents(state, recentLimit),
    recentDecisions: recentDecisions(state, recentLimit),
    relationships: detach(allRelationshipPairViews(state.relationships, state.colonists.map((r) => r.colonist.identity.id))),
    socialOffers: detach(state.socialOffers.offers),
  };
}

/** One-line human-readable form of a ReplayResult — formatting only, never re-verification. */
export function summarizeReplay(result: ReplayResult): string {
  if (result.kind === "match") {
    return `replay match: ${result.eventRecordsCompared} event records, ${result.decisionRecordsCompared} decision records identical, terminal state identical`;
  }
  if (result.log === "state") {
    return `replay divergence: terminal state at "${result.path}" — expected ${JSON.stringify(result.expected)}, actual ${JSON.stringify(result.actual)}`;
  }
  const describeRecord = (record: unknown, absent: string): string =>
    record === null ? absent : `seq ${(record as { seq: number }).seq} @ tick ${(record as { tick: number }).tick}`;
  const expected = describeRecord(result.expected, "none (replay produced an extra record)");
  const actual = describeRecord(result.actual, "none (retained record never reproduced)");
  return `replay divergence: ${result.log} log index ${result.index} (${result.recordKind}) — expected ${expected}, actual ${actual}`;
}
