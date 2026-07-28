// PROVISIONAL calibration values — rates, thresholds, weights (plan: Configuration split).
// Rule: every entry is annotated with the deferred question it provisionally answers.
// NOTHING here is calibrated or binding: stage 1–3 values do not count against the
// deferred-question ledger (engineering spec §10); changing these is free during prototyping.
// Structural constants NEVER live here — they belong in constants.ts.

import type { NeedId } from "./constants.js";

/** Per-need calibration block. Levels are on a 0..1 scale (1 = fully satisfied, 0 = fully deprived). */
export interface NeedTuning {
  /** provisional — DQ-17.5: decay per tick at baseline (level units/tick). */
  readonly decayPerTick: number;
  /** provisional — DQ-17.1: low threshold position (tier-4 urgency begins below this). */
  readonly lowThreshold: number;
  /** provisional — DQ-17.1: critical threshold position; null for psychological needs (ADR-17 D3 — structural, not tuning). */
  readonly criticalThreshold: number | null;
  /** provisional — DQ-17.1: satisfaction point (need-goal completion); strictly above lowThreshold (ADR-17 D3 ordering is structural). */
  readonly satisfactionPoint: number;
  /** provisional — DQ-17.4: restoration per tick while satisfaction conditions hold. */
  readonly restorePerTick: number;
}

/** provisional — DQ-17.1/17.2/17.4/17.5: per-need calibration. Day-scaled intuitions, uncalibrated. */
export const NEED_TUNING: Readonly<Record<NeedId, NeedTuning>> = {
  // Hunger: crosses low roughly twice a day at this rate.
  hunger: { decayPerTick: 0.0011, lowThreshold: 0.4, criticalThreshold: 0.12, satisfactionPoint: 0.85, restorePerTick: 0.02 },
  // Rest: one main sleep period per day.
  rest: { decayPerTick: 0.0008, lowThreshold: 0.35, criticalThreshold: 0.1, satisfactionPoint: 0.9, restorePerTick: 0.004 },
  // Psychological needs: slower, no critical threshold (ADR-17 D3).
  safety: { decayPerTick: 0.0002, lowThreshold: 0.4, criticalThreshold: null, satisfactionPoint: 0.7, restorePerTick: 0.001 },
  social: { decayPerTick: 0.0004, lowThreshold: 0.4, criticalThreshold: null, satisfactionPoint: 0.75, restorePerTick: 0.003 },
  purpose: { decayPerTick: 0.0003, lowThreshold: 0.4, criticalThreshold: null, satisfactionPoint: 0.75, restorePerTick: 0.002 },
};

/** provisional — DQ-17.2: urgency growth exponent over threshold depth (1 = linear). */
export const URGENCY_GROWTH_EXPONENT = 1;

/** provisional — DQ-17.3: Rest-amplifier scale on other needs' EXISTING urgency (ADR-17 D6: never creates urgency). */
export const REST_AMPLIFIER_MAX_MULTIPLIER = 1.5;

/** provisional — DQ-17.3: Rest deprivation must persist this long (ticks) before the amplifier engages ("sustained"). */
export const REST_AMPLIFIER_SUSTAIN_TICKS = 180;

/** Stress calibration (all provisional — DQ-D1 stress portion). Level on a 0..1 scale. */
export const STRESS_TUNING = {
  /** provisional — accumulation per tick per unmet psychological need past low. */
  psychNeedPerTick: 0.0003,
  /** provisional — accumulation per tick under sustained biological strain (low, not critical). */
  bioStrainPerTick: 0.0002,
  /** provisional — accumulation per tick of overwork (working beyond rest adequacy). */
  overworkPerTick: 0.0002,
  /** provisional — dissipation per tick while resting adequately. */
  restReliefPerTick: 0.0008,
  /** provisional — dissipation per tick while all needs are satisfied. */
  satisfiedReliefPerTick: 0.0003,
  /** provisional — design DQ-3: dissipation per tick while receiving Comfort (positiveSocialProximity). */
  positiveSocialProximityReliefPerTick: 0.0005,
  /** provisional — dissipation per tick under sustained stable conditions. */
  stableReliefPerTick: 0.0001,
  /** provisional — stress level at which the Stressed ambient state shows (ADR-05 behavioral threshold). */
  stressedStateThreshold: 0.6,
  /** provisional — stress level past which demanding-candidate weights are suppressed. */
  taskAcceptanceThreshold: 0.7,
} as const;

/** Weight-composition calibration (all provisional — DQ-D1 weight portion; bounds enforce bound-never-veto, locked #25). */
export const WEIGHT_TUNING = {
  /** provisional — scale of the base urgency term. */
  baseScale: 1.0,
  /** provisional — max multiplicative tilt any single modifier family may apply (>1 = never a veto, never a guarantee). */
  familyTiltCap: 1.75,
  /** provisional — min multiplicative tilt (mirror of the cap; must stay > 0 so nothing zeroes a candidate). */
  familyTiltFloor: 0.57,
  /** provisional — weight of a tier-5 idle/rest voluntary candidate before tilts. */
  voluntaryBaseWeight: 0.2,
  /** provisional — weight of the tier-3 shift-assignment candidate before tilts ("presence of an active assignment" — decision-loop §6 base). */
  assignmentBaseWeight: 0.5,
  /** provisional — stress family: tilt applied to relief-serving candidates (lowNeed, voluntary) once the Stressed threshold is crossed. Clamped to [familyTiltFloor, familyTiltCap] regardless. */
  stressReliefBoostTilt: 1.4,
  /** provisional — stress family: tilt applied to demanding candidates (shiftAssignment) once the task-acceptance threshold is crossed. */
  stressDemandSuppressTilt: 0.65,
  /** provisional — memory family: scale applied to summed matching-memory influence before it becomes a weight tilt (1 + influence*scale, then clamped). */
  memoryWeightTiltScale: 0.5,
  /** provisional — relationship family: scale applied to summed affinity/100 before it becomes a weight tilt (1 + (affinity/100)*scale, then clamped). */
  relationshipWeightTiltScale: 0.75,
} as const;

/**
 * Trait calibration (all provisional — DQ-T1: canonical trait list and magnitudes remain
 * prototype scope; these values exist only to exercise the Stage 1 provisional traits' two
 * approved surfaces — ADR-17 D7 rate/threshold modifiers, decision-loop §6 weight tilts — one
 * trait per personality-traits.md category (Work Disposition, Stress Response, Social
 * Disposition, Need Disposition), per the linked #103 acceptance criterion. The floor/ceiling/
 * bound entries are the bounds every trait modifier is clamped within — bounded, never
 * structural (ADR-17 D7); bound-never-veto (locked #25).
 */
export const TRAIT_TUNING = {
  /** provisional — "driven" (Work Disposition) Rest decay multiplier (< 1 = decays slower; resists tiredness). */
  drivenRestDecayMultiplier: 0.85,
  /** provisional — "driven" Rest low-threshold shift (negative = tolerates more deprivation before feeling low). */
  drivenRestLowThresholdShift: -0.05,
  /** provisional — "driven" tilt toward shift-assignment (tier 3) candidates. */
  drivenAssignmentTilt: 1.3,
  /** provisional — "driven" tilt away from voluntary/idle (tier 5) candidates. */
  drivenVoluntaryTilt: 0.75,
  /**
   * provisional — "resilient" (Stress Response) Safety low-threshold shift (positive = tolerates
   * more psychological strain before it registers as low). ADR-17 D7 exposes no direct stress-
   * rate surface to traits — this expresses stress resilience through the mechanism that IS
   * sanctioned: a colonist who registers deprivation later accumulates less
   * psychNeedDeprivation stress (stress.ts), since both read the same trait-shifted threshold.
   */
  resilientSafetyLowThresholdShift: 0.05,
  /** provisional — "gregarious" (Social Disposition) Social decay multiplier (> 1 = decays faster; craves contact sooner). */
  gregariousSocialDecayMultiplier: 1.2,
  /** provisional — "gregarious" tilt toward voluntary/idle (tier 5) candidates — free time is when Social gets served. */
  gregariousVoluntaryTilt: 1.3,
  /** provisional — "wary" (Need Disposition) Safety decay multiplier (> 1 = decays faster; more easily unsettled). */
  warySafetyDecayMultiplier: 1.2,
  /** provisional — "wary" Safety low-threshold shift (negative = registers deprivation earlier — the opposite lean from "resilient"). */
  warySafetyLowThresholdShift: -0.05,
  /** provisional — bound: minimum multiplier any trait need-rate modifier may apply (never zero a rate — ADR-17 D7). */
  needRateModifierFloor: 0.5,
  /** provisional — bound: maximum multiplier any trait need-rate modifier may apply. */
  needRateModifierCeiling: 1.5,
  /** provisional — bound: max absolute threshold shift any trait may apply, in level units. */
  thresholdShiftBound: 0.1,
} as const;

/** Task execution calibration (all provisional — DQ-D4's Stage 1 portion: concrete task content). */
export const TASK_TUNING = {
  /** provisional — food stock units consumed per tick of eatAtFoodStation progress. */
  foodConsumptionPerTick: 0.05,
  /** provisional — Social need restored per tick of active Conversation participation (ADR-18 D1/D6). */
  conversationSocialRestorePerTick: 0.003,
  /** provisional — Social need restored per tick of active Shared Downtime participation (ADR-18 D1/D6). */
  sharedDowntimeSocialRestorePerTick: 0.002,
  /** provisional — directional affinity drift per tick from Conversation participation (ADR-18 D6: positive low). */
  conversationAffinityDeltaPerTick: 0.05,
  /** provisional — directional affinity drift per tick from Shared Downtime; intentionally no stronger than Conversation. */
  sharedDowntimeAffinityDeltaPerTick: 0.03,
  /** provisional — Social need restored per tick when eating with non-hostile company (ADR-18 D3). */
  sharedMealSocialRestorePerTick: 0.002,
  /** provisional — directional affinity drift per tick from Shared Meal; intentionally low positive. */
  sharedMealAffinityDeltaPerTick: 0.03,
  /** provisional — design DQ-4: Social need restored per tick of accepted Comfort (both parties). */
  comfortSocialRestorePerTick: 0.003,
  /** provisional — design DQ-2: directional affinity drift per tick from Comfort (both directions, mutualSupportCrisis). */
  comfortAffinityDeltaPerTick: 0.04,
} as const;

/** Social offer/response calibration (all provisional — design DQ-1–DQ-4, ADR-18 DQ-18.1/18.2). Structural floors (delay >= 1, timeout > delay) are enforced by socialOffers.ts at creation, not here. */
export const SOCIAL_OFFER_TUNING = {
  /** provisional — DQ-1: acceptance probability per responder relationship state (hostile/fractured never reach the draw — design D4's gate). */
  acceptanceProbability: {
    tense: 0.35,
    acquainted: 0.55,
    neutral: 0.6,
    positive: 0.75,
    bonded: 0.9,
  } as Readonly<Record<string, number>>,
  /**
   * provisional — design DQ-1: Comfort's own acceptance table (must generally exceed Conversation
   * at comparable bands; Hostile/Fractured never reach the draw — design D4).
   */
  comfortAcceptanceProbability: {
    tense: 0.45,
    acquainted: 0.65,
    neutral: 0.7,
    positive: 0.85,
    bonded: 0.95,
  } as Readonly<Record<string, number>>,
  /** provisional — DQ-2: ticks between offer creation and earliest resolution (design D3; structural floor of 1 is architecture, this magnitude is pacing). */
  responseDelayTicks: 1,
  /** provisional — DQ-3: ticks from creation to expiry (design D6; must exceed responseDelayTicks). */
  offerTimeoutTicks: 4,
  /** provisional — DQ-4: bounded resolved-offer retention window (ADR-21 D4; pending offers are never evicted). */
  resolvedOfferRetention: 16,
  /** provisional — DQ-1: decline friction magnitude, applied per direction via the forcedProximityMutualStress change source (ADR-18 D6's decline row; negative, low). */
  declineAffinityDelta: -0.5,
} as const;

/** Memory calibration (all provisional — DQ-M1). */
export const MEMORY_TUNING = {
  /** provisional — DQ-M1: bounded pool size per colonist. */
  poolSize: 12,
  /** provisional — DQ-M1: influence recency decay per tick (multiplier applied to recency term). */
  recencyDecayPerTick: 0.0005,
  /** provisional — formation significance: minimum need-level change in one event to form a memory. */
  needChangeSignificance: 0.25,
  /** provisional — formation significance: minimum stress change in one event to form a memory. */
  stressChangeSignificance: 0.2,
  /** provisional — formation significance: minimum |affinity delta| (ADR-12 scale, -100..100) in one relationship consequence to form a memory. */
  relationshipChangeSignificance: 15,
} as const;

/** Shift policy defaults (provisional — prototype scenario values, not policy design). */
export const SHIFT_TUNING = {
  /** provisional — work period length in ticks. */
  workTicks: 480,
  /** provisional — rest period length in ticks. */
  restTicks: 480,
  /** provisional — free period length in ticks (work+rest+free should equal TICKS_PER_DAY). */
  freeTicks: 480,
} as const;

/** Goal stack calibration (provisional — DQ-D8). */
export const GOAL_STACK_DEPTH = 4;
