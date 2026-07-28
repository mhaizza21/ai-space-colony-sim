// M7 Stress System — decision-loop §7 (stress ownership per the card scope inherited by the
// engineering specification). Emergent, not a need (needs-system P7): no satisfaction action,
// accumulates from sources, dissipates through reliefs, always source-attributed. Pure.
//
// Stage 1 sources/reliefs realized here — a subset of decision-loop §7's full six-source,
// four-relief list:
//   sources: sustained unmet psychological needs; sustained biological strain (any need below
//     its low threshold, including critical — priority override and stress accumulation are
//     separate concerns, per architecture review correction 2026-07-10); overwork (the
//     colonist is currently executing the shift-assignment task — M12's execution status,
//     threaded in as `isWorking` by tick.ts, the only caller with that information)
//   reliefs: rest adequacy; needs satisfied across the board
// Stable-conditions relief remains unbuilt: it needs a "how long has this module/environment
// been stable" duration signal M2 does not track in Stage 1's static station (module health is
// a binary functional/not flag with no history) — a genuine scope boundary, not an omission to
// silently paper over. Hostile/positive-proximity sources belong to M10 (relationships),
// explicitly out of Stage 1 (AQ-2 blocks M10 entirely).
//
// `traits` (ADR-17 D7) is threaded through every isLow call here for the same reason M6/M11
// thread it: a trait-shifted low threshold must be honored consistently everywhere a need's
// "low" status is read, or a need can register as low for stress purposes while decision
// generation (which does thread traits) reads the same level as not-low — an inconsistency
// Copilot's review caught directly.

import { PSYCHOLOGICAL_NEEDS, type NeedId } from "../config/constants.js";
import { STRESS_TUNING } from "../config/tuning.js";
import { isBiological, isLow, isSatisfied, type NeedsState } from "./needs.js";
import type { TraitId } from "./traits.js";

/** Stress sources and reliefs realized at this build step — a subset of decision-loop §7's full list. */
export type StressChannelId =
  | "psychNeedDeprivation"
  | "biologicalStrain"
  | "overwork"
  | "restAdequacy"
  | "needsSatisfied"
  | "positiveSocialProximity"
  | "hostileProximityConflict";

/** Stress level only — 0 (none) to 1 (maximal). Attribution is returned per call, not stored (S2 owns retention). */
export interface StressState {
  readonly level: number;
}

/** One channel's contribution to a single evaluateStress call: positive = accumulation, negative = dissipation. */
export interface StressContribution {
  readonly id: StressChannelId;
  readonly rawDelta: number;
}

/** Result of one stress evaluation: the new state and the full per-channel decomposition (traceability requirement). */
export interface StressUpdateResult {
  readonly state: StressState;
  readonly contributions: readonly StressContribution[];
}

/** Creates stress state for a newly arrived colonist: unstressed. */
export function createStress(): StressState {
  return { level: 0 };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function countLowPsychological(needs: NeedsState, traits: readonly TraitId[]): number {
  // Prototype Stage 1 provisional aggregation strategy: scaling linearly with the count of
  // low psychological needs is one way to represent "sustained unmet psychological needs"
  // (decision-loop §7) as a single source, not an architectural commitment to linear scaling.
  // Any aggregation that keeps the source traceable and additive is equally valid; this one
  // is the simplest that could be built first and is free to change without an ADR.
  let count = 0;
  for (const id of PSYCHOLOGICAL_NEEDS) {
    if (isLow(id, needs[id].level, traits)) count++;
  }
  return count;
}

function countBiologicalStrain(needs: NeedsState, traits: readonly TraitId[]): number {
  // "Strain" per decision-loop §7: any biological need below its low threshold contributes —
  // low and critical are NOT mutually exclusive stress inputs. Priority override (ADR-01
  // tier 2 — the colonist abandons their post) and stress accumulation (this module) are
  // separate concerns operating on the same underlying deficit; crossing into critical must
  // not make the stress contribution disappear. Whether critical contributes more than low
  // is intentionally not decided here — both are counted identically at the same per-tick
  // rate (STRESS_TUNING.bioStrainPerTick), which is itself provisional and free to diverge by
  // severity later without changing this module's structure.
  let count = 0;
  for (const id of Object.keys(needs) as NeedId[]) {
    if (isBiological(id) && isLow(id, needs[id].level, traits)) count++;
  }
  return count;
}

/**
 * Hook-only Stress Response multiplier for the `hostileProximityConflict` channel
 * (design/confrontation-conflict-protocol.md D5 Finding 1). Every currently-defined TraitId
 * returns exactly 1 — this slice does not deliver ADR-18 D8 Resilient/Volatile scaling and
 * invents no `"volatile"` trait. Future trait content may supply a real value through this hook.
 */
export function stressResponseConflictMultiplier(_traits: readonly TraitId[]): number {
  return 1;
}

/**
 * Evaluates stress for one tick span from need state, plus whether the colonist is currently
 * executing the shift-assignment task (overwork's only local signal — tick.ts is the only
 * caller with M12 execution status, so it is the only caller that can supply this) and whether
 * they are named as a Comfort recipient this tick (`isReceivingComfort` — from D12's immutable
 * basis, never a live cross-runtime read). `conflictSpike` is the one-shot Confrontation
 * magnitude (0 when not firing); the hostileProximityConflict channel uses it directly, not
 * rate×ticks. Pure: same inputs, same result. `ticks` must be a non-negative integer count of
 * elapsed in-game ticks. Every channel is always represented in `contributions`, zero-valued
 * when inactive, so a caller can show "no rest relief this tick" as explicitly as
 * "rest relief: -0.0008" — decomposability is a property of the return shape, not something
 * callers must reconstruct.
 */
export function evaluateStress(
  state: StressState,
  needs: NeedsState,
  ticks: number,
  traits: readonly TraitId[] = [],
  isWorking = false,
  isReceivingComfort = false,
  conflictSpike = 0,
): StressUpdateResult {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`evaluateStress ticks must be a non-negative integer, got ${ticks}`);
  }

  const psychLowCount = countLowPsychological(needs, traits);
  const bioStrainCount = countBiologicalStrain(needs, traits);
  const restAdequate = isSatisfied("rest", needs.rest.level);
  const allSatisfied = (Object.keys(needs) as NeedId[]).every((id) => isSatisfied(id, needs[id].level));

  const contributions: StressContribution[] = [
    { id: "psychNeedDeprivation", rawDelta: STRESS_TUNING.psychNeedPerTick * ticks * psychLowCount },
    { id: "biologicalStrain", rawDelta: STRESS_TUNING.bioStrainPerTick * ticks * bioStrainCount },
    { id: "overwork", rawDelta: isWorking ? STRESS_TUNING.overworkPerTick * ticks : 0 },
    { id: "restAdequacy", rawDelta: restAdequate ? -STRESS_TUNING.restReliefPerTick * ticks : 0 },
    { id: "needsSatisfied", rawDelta: allSatisfied ? -STRESS_TUNING.satisfiedReliefPerTick * ticks : 0 },
    {
      id: "positiveSocialProximity",
      rawDelta: isReceivingComfort ? -STRESS_TUNING.positiveSocialProximityReliefPerTick * ticks : 0,
    },
    {
      id: "hostileProximityConflict",
      rawDelta: conflictSpike * stressResponseConflictMultiplier(traits),
    },
  ];

  const totalDelta = contributions.reduce((sum, c) => sum + c.rawDelta, 0);
  const level = clamp01(state.level + totalDelta);

  return { state: { level }, contributions };
}

/** True when stress has crossed the Stressed ambient-state behavioral threshold (ADR-05). */
export function isStressedState(state: StressState): boolean {
  return state.level >= STRESS_TUNING.stressedStateThreshold;
}

/** True when stress is high enough to suppress acceptance of demanding candidates (decision-loop §7). */
export function exceedsTaskAcceptanceThreshold(state: StressState): boolean {
  return state.level >= STRESS_TUNING.taskAcceptanceThreshold;
}
