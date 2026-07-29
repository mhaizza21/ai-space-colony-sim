// Confrontation condition detection (design/confrontation-conflict-protocol.md D1–D4 / D10).
// Pure helper — mirrors comfortParticipation.ts: conjunction evaluation, canonical pair order,
// and one attributed PRNG draw per eligible pair only. No goal/offer/execution creation.

import type { ModuleId } from "../config/constants.js";
import { CONFLICT_TUNING, STRESS_TUNING } from "../config/tuning.js";
import { perspective, type RelationshipStore } from "../colonist/relationships.js";
import { next, type PrngState } from "../core/prng.js";

/** Severity keyed to the applicable combined-stress threshold (design D2). */
export type ConflictSeverity = "hostile" | "fractured";

/** Fixed shared-observation facts conflict detection reads (design D1 / D8). */
export interface ConflictObservation {
  readonly id: string;
  readonly moduleId: ModuleId | null;
  readonly stressLevel: number;
}

/** A pair that satisfied the three-conjunct conjunction (before the fire draw). */
export interface EligibleConflictPair {
  readonly colonistAId: string;
  readonly colonistBId: string;
  readonly sharedModuleId: ModuleId;
  readonly combinedStress: number;
  readonly severity: ConflictSeverity;
}

/** An eligible pair whose attributed draw fired Confrontation this tick. */
export interface FiredConfrontation extends EligibleConflictPair {
  readonly drawValue: number;
}

export interface ConflictDetectionResult {
  readonly eligible: readonly EligibleConflictPair[];
  readonly fired: readonly FiredConfrontation[];
  readonly prng: PrngState;
}

function isHostileOrFractured(state: string): state is "hostile" | "fractured" {
  return state === "hostile" || state === "fractured";
}

/**
 * Resolves the severity-keyed threshold for a pair when at least one direction is
 * Hostile or Fractured (design D1a / D2). Fractured in either direction wins the lower bar;
 * otherwise Hostile uses the higher bar. Returns null when neither direction qualifies.
 */
export function conflictSeverityForPair(
  relationships: RelationshipStore,
  colonistAId: string,
  colonistBId: string,
): ConflictSeverity | null {
  const aTowardB = perspective(relationships, colonistAId, colonistBId).state;
  const bTowardA = perspective(relationships, colonistBId, colonistAId).state;
  const aQualifies = isHostileOrFractured(aTowardB);
  const bQualifies = isHostileOrFractured(bTowardA);
  if (!aQualifies && !bQualifies) return null;
  if (aTowardB === "fractured" || bTowardA === "fractured") return "fractured";
  return "hostile";
}

function thresholdFor(severity: ConflictSeverity): number {
  return severity === "fractured"
    ? STRESS_TUNING.fracturedConflictStressThreshold
    : STRESS_TUNING.hostileConflictStressThreshold;
}

/**
 * Evaluates the three-conjunct conjunction for one canonical (min, max) pair (design D1).
 * Returns null when any conjunct fails — including moduleId null (Finding 2 / shared-module
 * proxy narrowness).
 */
export function evaluateConflictConjunction(
  a: ConflictObservation,
  b: ConflictObservation,
  relationships: RelationshipStore,
): EligibleConflictPair | null {
  if (a.id === b.id) return null;
  const [colonistAId, colonistBId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const left = a.id < b.id ? a : b;
  const right = a.id < b.id ? b : a;

  const severity = conflictSeverityForPair(relationships, colonistAId, colonistBId);
  if (severity === null) return null;

  if (left.moduleId === null || right.moduleId === null || left.moduleId !== right.moduleId) {
    return null;
  }

  const combinedStress = left.stressLevel + right.stressLevel;
  if (combinedStress < thresholdFor(severity)) return null;

  return {
    colonistAId,
    colonistBId,
    sharedModuleId: left.moduleId,
    combinedStress,
    severity,
  };
}

/**
 * Enumerates every conjunction-eligible pair in canonical ascending (min, max) order
 * (design D10 / ADR-20 D5), draws one `confrontationTrigger` value per eligible pair only
 * (design D4), and returns the firing set. Observations must already be in canonical id order.
 */
export function detectConfrontations(
  observations: readonly ConflictObservation[],
  relationships: RelationshipStore,
  prng: PrngState,
  fireProbability: number = CONFLICT_TUNING.conflictFireProbability,
): ConflictDetectionResult {
  const eligible: EligibleConflictPair[] = [];
  const fired: FiredConfrontation[] = [];
  let state = prng;

  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const pair = evaluateConflictConjunction(observations[i]!, observations[j]!, relationships);
      if (pair === null) continue;
      eligible.push(pair);
      const draw = next(state);
      state = draw.state;
      if (draw.value < fireProbability) {
        fired.push({ ...pair, drawValue: draw.value });
      }
    }
  }

  return { eligible, fired, prng: state };
}
