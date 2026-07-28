// Tick assembly — engineering spec §5's fixed seven-phase update order, realized across every
// colonist in the collection (Stage 2 Slice 6b; design D2/D3). This module owns ORCHESTRATION
// ONLY: it calls the already-built modules in a fixed sequence and threads state between them.
// It contains no need/stress/trait/memory/decision/task/execution rule of its own — the one
// piece of genuinely new logic here is re-decision TRIGGER DETECTION (comparing before/after
// state across one tick), which no other module owns (decide.ts is explicitly "invoked only at
// re-decision trigger points"; this is the file that finds those points).
//
// Phase-boundary rule (design D2, binding): a later phase never runs for any colonist before an
// earlier phase has completed for every colonist. tick() is organized as a sequence of full
// per-colonist passes over the canonically-ordered collection, never an interleaved per-colonist
// mini-tick — each pass below IS one phase (or phase group), completed for everyone before the
// next pass begins.
//
// Same-tick non-observability (design D3): decision-time perception never reads another
// colonist's same-tick commitment. This is structural, not conventional — every colonist's
// decision-phase WorldSnapshot is built from ONE shared observation basis (real Tier-1
// ambientStateFor reads, computed once, after every colonist's Phase-3/4 mutations have
// settled and before any Phase-5 decision runs), never rebuilt mid-decision-phase.
//
// Perception discipline carried forward: every task/decision read of the world goes through
// a WorldSnapshot (§4's "no direct world reads outside Snapshot"). Execution's consequence
// application is the documented exception (Build Step 7): it writes live NeedsState/WorldState
// as an *outcome*, a different pipeline stage from decision-time perception, not a violation.
//
// Single PRNG stream (EQ-3, ADR-22 D2): `SimulationState.prng` is the only chance source across
// every colonist. Every draw threads through and returns the successor state — never re-seeded
// mid-run — and draw order is fixed by canonical (id-ordered) colonist iteration, so replay
// reproduces the exact same draw sequence regardless of which colonist happens to draw.
//
// Fixed-step rule (review fix 2, 2026-07-10): tick() advances by EXACTLY BASE_TICKS_PER_STEP
// and rejects anything else. Every fixed simulation step must be evaluated — a caller passing
// a larger delta could skip an intermediate need-threshold crossing or shift boundary that a
// step-by-step advance would have caught. Larger timeline advancement is run()'s job, calling
// tick() once per step (run.ts).

import { BASE_TICKS_PER_STEP, NEEDS, type NeedId, type PriorityTier } from "../config/constants.js";
import { TASK_TUNING } from "../config/tuning.js";
import type { ClockState } from "../core/clock.js";
import { advance, tickOfDay } from "../core/clock.js";
import type { PrngState } from "../core/prng.js";
import type { ColonistIdentity, ColonistState } from "../colonist/colonist.js";
import { withCurrentGoal, withMemory, withNeeds, withStress, withSuspendedGoal } from "../colonist/colonist.js";
import { decayNeeds, isCritical, isLow, isSatisfied, restoreNeedByAmount } from "../colonist/needs.js";
import { considerConditionFormation, considerDeprivationFormation, considerRelationalFormation } from "../colonist/memory.js";
import {
  applyAtrophy,
  applyInteraction,
  assertSafeColonistId,
  canonicalPairId,
  perspective,
  type PairKey,
  type RelationshipConsequence,
  type RelationshipStore,
} from "../colonist/relationships.js";
import { evaluateStress, type StressContribution } from "../colonist/stress.js";
import type { TraitId } from "../colonist/traits.js";
import type { ShiftPeriod, ShiftPolicy } from "../world/policy.js";
import { periodAt } from "../world/policy.js";
import type { WorldState } from "../world/world.js";
import { buildSnapshot, type ObservableColonist, type WorldSnapshot } from "../world/snapshot.js";
import {
  abandonGoal,
  completeGoal,
  generateCandidates,
  resumeGoal,
  suspendGoal,
  type Goal,
} from "../decision/goals.js";
import { decideFromCandidates, type DecisionOutcome } from "../decision/decide.js";
import { isTaskComplete, resolveTask, type TaskId, type TaskResolution } from "../task/tasks.js";
import {
  createPendingOffer,
  evictResolvedOffers,
  isEligibleTargetState,
  offerGoalKey,
  resolveOffer,
  type OfferResolutionReason,
  type SocialOfferAction,
  type SocialOfferStatus,
  type SocialOfferStore,
} from "../task/socialOffers.js";
import { SOCIAL_OFFER_TUNING } from "../config/tuning.js";
import { next } from "../core/prng.js";
import { buildComfortParticipationBasis, collectComfortClaims } from "./comfortParticipation.js";
import {
  abortExecution,
  ambientStateFor,
  applyProgressConsequences,
  beginExecution,
  completeExecution,
  interruptExecution,
  progressExecution,
  resumeExecution,
  type Execution,
} from "../task/execution.js";
import { appendTickRecords, type DecisionLog, type EventLog } from "../records/logs.js";

/**
 * The complete, explicit simulation state — everything tick() reads or writes across calls.
 * `execution` is the currently-running task, if any. `suspendedExecution` is the paired
 * counterpart to `colonist.suspendedGoal` (review fix 1, 2026-07-10): when a goal is
 * suspended, its interrupted Execution is retained here — never dropped — so resuming the
 * goal resumes the SAME Execution, with `elapsedTicks` intact, instead of restarting from
 * zero. The invariant `colonist.suspendedGoal !== null` iff `suspendedExecution !== null`
 * is maintained by every function in this module that touches either slot, and checked
 * explicitly by `validateSimulationState` at tick()'s input and every exit point (review fix
 * 2, 2026-07-10) — malformed state is rejected rather than allowed to silently corrupt.
 */
/**
 * One colonist's complete runtime container (ADR-22 D1): the colonist's own state plus the
 * execution slots and memory-formation baselines that used to live as singular SimulationState
 * fields. Everything per-colonist lives here; everything shared (clock, world, policy, PRNG,
 * logs, M10/M12 stores) stays top-level.
 */
export interface ColonistRuntime {
  readonly colonist: ColonistState;
  readonly execution: Execution | null;
  readonly suspendedExecution: Execution | null;
  /** See the field docs below — per-colonist memory-formation trigger-detection baselines. */
  readonly deprivationBaselines: Readonly<Record<NeedId, number>>;
  readonly stressBaseline: number;
  readonly relationshipAffinityBaselines: Readonly<Record<string, number>>;
}

export interface SimulationState {
  readonly clock: ClockState;
  readonly world: WorldState;
  readonly policy: ShiftPolicy;
  /**
   * ADR-22 D1: the one authoritative colonist list — a canonically ordered (ordinal id order)
   * collection of per-colonist runtime containers, replacing the former singular
   * `colonist`/`execution`/`suspendedExecution`/baseline slots AND the identity-only `roster`.
   * Stage 2 Slice 6b (design D2/D3): every entry is fully simulated each tick, in this
   * canonical order, under the phase-boundary rule (each phase completes for all colonists
   * before the next begins) — there is no privileged or "active" entry anymore.
   */
  readonly colonists: readonly ColonistRuntime[];
  readonly prng: PrngState;
  /**
   * Whether tick() has ever run for this state before (review fix, cross-referenced Copilot
   * finding). Starts `false` only in a genuinely fresh `createInitialState` result; every call
   * to tick() sets it `true` in its output, permanently. Gates the one-time "bootstrap"
   * TickEvent (the trigger that kicks off the very first decision) so it fires exactly once,
   * never on every subsequent tick a colonist merely happens to have no execution — which
   * previously included every tick after a goal became blocked.
   */
  readonly hasBootstrapped: boolean;
  /**
   * Append-only behavior trace (Build Step 9). Record SEMANTICS (types, append rules, trace
   * reconstruction) belong entirely to records/logs.ts — this module only calls into it with
   * events it already produced (finish()'s job below), never constructs a record itself.
   */
  readonly eventLog: EventLog;
  readonly decisionLog: DecisionLog;
  /**
   * M10 relationship store (ADR-20 D1/D8) — centralized sparse pair records. Written once per
   * tick by the atrophy phase (build step 8) and read by candidate/decision-weight composition
   * (build step 6); tick.ts never reads the store's materialized records or their past-
   * interaction log directly beyond threading the store and atrophy's own fact-only
   * consequences through — M10 remains the sole owner of the store's shape and rules.
   */
  readonly relationships: RelationshipStore;
  /**
   * Stage 2 Slice 5 — M12's social offer store (ADR-21 D1): the ADR-18 D5 offer/response
   * protocol's persisted state for Conversation and Shared Downtime. Offers are created at
   * social goal commitment (design D3, Phase 5) and resolved by the Phase 6 lifecycle pass
   * below — never on their creating tick (the one-tick response-delay floor). Resolved offers
   * are never a decision input (ADR-21 Invariant 8): the lifecycle pass reads pending offers
   * only, and everything else that touches this slice is serialization/replay/inspection.
   */
  readonly socialOffers: SocialOfferStore;
}

/** One tick's trace — the "stable replay log": what was detected, decided, resolved, executed. */
export type TickEvent =
  | { readonly kind: "bootstrap" }
  | { readonly kind: "needThresholdCrossing"; readonly needId: NeedId; readonly severity: "low" | "critical" }
  | { readonly kind: "shiftBoundary"; readonly from: ShiftPeriod; readonly to: ShiftPeriod }
  | { readonly kind: "completion"; readonly goalKey: string; readonly taskId: TaskId }
  | { readonly kind: "blockage"; readonly goalKey: string; readonly reasons: readonly string[] }
  | { readonly kind: "higherPriorityCondition"; readonly interruptedGoalKey: string; readonly interruptedTier: PriorityTier }
  | { readonly kind: "suspensionResolved"; readonly goalKey: string }
  | { readonly kind: "suspensionOverflow"; readonly abandonedGoalKey: string; readonly abandonedExecutionTaskId: TaskId | null }
  | { readonly kind: "executionInterrupted"; readonly taskId: TaskId; readonly goalKey: string }
  | { readonly kind: "executionAborted"; readonly taskId: TaskId; readonly goalKey: string }
  | { readonly kind: "executionProgressed"; readonly taskId: TaskId; readonly elapsedTicks: number }
  | { readonly kind: "executionBegun"; readonly taskId: TaskId; readonly goalKey: string }
  | { readonly kind: "executionResumed"; readonly taskId: TaskId; readonly goalKey: string; readonly elapsedTicks: number }
  | { readonly kind: "decision"; readonly outcome: DecisionOutcome }
  | { readonly kind: "taskResolution"; readonly resolution: TaskResolution }
  | {
      readonly kind: "memoryFormed";
      readonly memoryType: "deprivation" | "condition" | "relational";
      readonly needId?: NeedId;
      readonly otherId?: string;
    }
  | { readonly kind: "stressEvaluated"; readonly contributions: readonly StressContribution[] }
  | {
      readonly kind: "socialOfferCreated";
      readonly offerId: number;
      readonly initiatorId: string;
      readonly responderId: string;
      readonly action: SocialOfferAction;
      readonly respondableAtTick: number;
      readonly expiresAtTick: number;
    }
  | {
      readonly kind: "socialOfferResolved";
      readonly offerId: number;
      readonly status: Exclude<SocialOfferStatus, "pending">;
      readonly reason: OfferResolutionReason | null;
    };

export interface TickResult {
  readonly state: SimulationState;
  readonly events: readonly TickEvent[];
}

/**
 * Validates the cross-field goal/execution invariants. Suspended pair (review fix 2,
 * 2026-07-10): `colonist.suspendedGoal` is null iff `suspendedExecution` is null — the pair is
 * retained or cleared together, never one without the other. When both are present, checks
 * their association as far as Stage 1 data permits: the execution's `goalKey` must name the
 * suspended goal, and a genuinely suspended execution can only be in the "interrupted" status
 * (never "inProgress", "completed", or "aborted" while parked in this slot). Active pair
 * (Copilot-confirmed defect — only the suspended pair was checked before): a non-null
 * `execution` must be "inProgress" and must serve the current ACTIVE goal by key; otherwise
 * the next tick would apply that task's consequences for a goal that never resolved to it.
 * Every tick() exit point leaves the active slot in exactly this shape — completion, blockage,
 * and suspension all replace or clear goal and execution together (adoptAndResolve,
 * resumeSuspended, suspendCurrentGoal), and interrupted executions live only in the suspended
 * slot — so anything else cannot describe a state this simulation produced. Throws on
 * violation — malformed state is rejected explicitly here rather than allowed to silently
 * corrupt downstream logic.
 */
export function validateSimulationState(state: SimulationState): void {
  // Collection invariants (ADR-22 D1/D4): non-empty, safe unique ids, canonical ascending
  // (ordinal) id order. The collection is the one authoritative colonist list — the same
  // "known colonist" rules the retired roster carried now live here.
  if (state.colonists.length === 0) {
    throw new Error("Invalid SimulationState: colonists must be non-empty — a simulation with no colonists is not a state this system produces.");
  }
  let previousId: string | null = null;
  for (const runtime of state.colonists) {
    const id = runtime.colonist.identity.id;
    assertSafeColonistId(id, "colonists[].colonist.identity.id");
    if (previousId !== null && !(previousId < id)) {
      throw new Error(
        `Invalid SimulationState: colonists must be in canonical ascending id order with unique ids — got "${id}" after "${previousId}".`,
      );
    }
    previousId = id;
  }
  const knownIds = new Set(state.colonists.map((r) => r.colonist.identity.id));

  for (const runtime of state.colonists) {
    validateColonistRuntime(runtime, knownIds, state.socialOffers);
  }

  // ADR-24 Invariant 12 / design D11.5(a): at most one Comfort claim (active or suspended)
  // per recipient — continuous state-level assertion, not load-only.
  for (const [recipientId, comforters] of collectComfortClaims(state.colonists)) {
    if (comforters.length > 1) {
      throw new Error(
        `Invalid SimulationState: more than one comfort execution names recipient "${recipientId}" ` +
          `(comforters: ${comforters.join(", ")}) — ADR-24 Invariant 12.`,
      );
    }
  }
}

/** Per-container invariants (ADR-22 Invariant 3) — the exact rules that governed the singular slots, applied per entry. */
function validateColonistRuntime(
  runtime: ColonistRuntime,
  knownIds: ReadonlySet<string>,
  socialOffers: SocialOfferStore,
): void {
  const ownId = runtime.colonist.identity.id;
  const { suspendedGoal, currentGoal } = runtime.colonist;
  const { suspendedExecution, execution } = runtime;

  if (execution !== null) {
    if (execution.status !== "inProgress") {
      throw new Error(
        `Invalid SimulationState: an active execution must have status "inProgress", got "${execution.status}" — ` +
          `interrupted executions belong in suspendedExecution; completed/aborted ones are never retained.`,
      );
    }
    if (currentGoal === null) {
      throw new Error(
        `Invalid SimulationState: execution ("${execution.taskId}" for goal "${execution.goalKey}") is present ` +
          `but currentGoal is null.`,
      );
    }
    if (currentGoal.status !== "active") {
      throw new Error(
        `Invalid SimulationState: execution ("${execution.taskId}") is in progress but currentGoal ` +
          `("${currentGoal.key}") has status "${currentGoal.status}" — only an active goal can be executing.`,
      );
    }
    if (execution.goalKey !== currentGoal.key) {
      throw new Error(
        `Invalid SimulationState: execution.goalKey ("${execution.goalKey}") does not match currentGoal.key ` +
          `("${currentGoal.key}").`,
      );
    }
  }

  if ((suspendedGoal === null) !== (suspendedExecution === null)) {
    // Stage 2 Slice 5 exception (design D3 step 3's hold): a suspended OFFER-BACKED goal has
    // no execution to park — its execution never began (it begins only on acceptance) — so
    // suspendedGoal non-null with suspendedExecution null is exactly the shape a survivable
    // interruption during the response-delay window produces. Recognized strictly: the goal
    // must be matched by a pending offer's derived goal key; any other one-sided pair is
    // still the malformed state this check has always rejected.
    const offerBackedSuspension =
      suspendedGoal !== null &&
      suspendedExecution === null &&
      socialOffers.offers.some((o) => o.status === "pending" && offerGoalKey(o) === suspendedGoal.key);
    if (!offerBackedSuspension) {
      throw new Error(
        "Invalid SimulationState: suspendedGoal and suspendedExecution must both be null or both be " +
          `present — got suspendedGoal=${suspendedGoal === null ? "null" : `"${suspendedGoal.key}"`}, ` +
          `suspendedExecution=${suspendedExecution === null ? "null" : `"${suspendedExecution.taskId}"`} ` +
          `(the only sanctioned exception is a suspended offer-backed social goal with a matching pending offer).`,
      );
    }
  }

  if (suspendedGoal !== null && suspendedExecution !== null) {
    if (suspendedExecution.goalKey !== suspendedGoal.key) {
      throw new Error(
        `Invalid SimulationState: suspendedExecution.goalKey ("${suspendedExecution.goalKey}") does not ` +
          `match suspendedGoal.key ("${suspendedGoal.key}").`,
      );
    }
    if (suspendedExecution.status !== "interrupted") {
      throw new Error(
        `Invalid SimulationState: a suspended execution must have status "interrupted", got ` +
          `"${suspendedExecution.status}".`,
      );
    }
  }

  // Social-goal target invariant (formerly the roster-reference rule, retargeted to the
  // collection per ADR-22 D4): a goal's relatedColonistId must name a DIFFERENT colonist that
  // exists in the collection.
  for (const [field, goal] of [
    ["currentGoal", currentGoal],
    ["suspendedGoal", suspendedGoal],
  ] as const) {
    const targetId = goal?.relatedColonistId;
    if (targetId === undefined) continue;
    assertSafeColonistId(targetId, `${field}.relatedColonistId`);
    if (targetId === ownId) {
      throw new Error(`Invalid SimulationState: ${field}.relatedColonistId must not target the goal owner's own id.`);
    }
    if (!knownIds.has(targetId)) {
      throw new Error(`Invalid SimulationState: ${field}.relatedColonistId "${targetId}" is not present in the colonist collection.`);
    }
  }
}

/**
 * Validates the outgoing state before returning it — every tick() exit point goes through here.
 * Also the one place this tick's events are committed to the append-only logs (Build Step 9):
 * `state.eventLog`/`state.decisionLog` passed in are the PRIOR logs, unappended — this appends
 * `events` on top via logs.ts (which owns what a record is), keyed to `state.clock.tick`.
 */
function finish(state: SimulationState, events: readonly TickEvent[]): TickResult {
  const { eventLog, decisionLog } = appendTickRecords(state.eventLog, state.decisionLog, state.clock.tick, events);
  const withLogs: SimulationState = {
    ...state,
    eventLog,
    decisionLog,
  };
  validateSimulationState(withLogs);
  return { state: withLogs, events };
}

/** Fresh memory-formation baselines for a newly arrived colonist: needs at 1 (matches createNeeds), stress at 0 (matches createStress), no relationship partners observed yet. */
export function createFreshMemoryBaselines(): Pick<
  ColonistRuntime,
  "deprivationBaselines" | "stressBaseline" | "relationshipAffinityBaselines"
> {
  const deprivationBaselines = {} as Record<NeedId, number>;
  for (const id of NEEDS) deprivationBaselines[id] = 1;
  return { deprivationBaselines, stressBaseline: 0, relationshipAffinityBaselines: {} };
}

function socialNeedRestorePerTick(taskId: TaskId): number {
  switch (taskId) {
    case "conversation":
      return TASK_TUNING.conversationSocialRestorePerTick;
    case "sharedDowntime":
      return TASK_TUNING.sharedDowntimeSocialRestorePerTick;
    case "comfort":
      return TASK_TUNING.comfortSocialRestorePerTick;
    default:
      return 0;
  }
}

function companionshipAffinityDeltaPerTick(taskId: TaskId): number {
  switch (taskId) {
    case "conversation":
      return TASK_TUNING.conversationAffinityDeltaPerTick;
    case "sharedDowntime":
      return TASK_TUNING.sharedDowntimeAffinityDeltaPerTick;
    default:
      return 0;
  }
}

function sharedMealPartnerId(others: readonly ColonistIdentity[], ownerId: string, relationships: RelationshipStore): string | undefined {
  const isNonHostile = (state: string) => state !== "hostile" && state !== "fractured";
  return others.find((identity) => {
    if (identity.id === ownerId) return false;
    // Codex-confirmed defect: gate on BOTH directions — relationship drift is one-way, so
    // checking only ownerId's perspective let a partner who has drifted Hostile toward the
    // owner (while the owner's own view is still neutral) still count as eligible company.
    return (
      isNonHostile(perspective(relationships, ownerId, identity.id).state) &&
      isNonHostile(perspective(relationships, identity.id, ownerId).state)
    );
  })?.id;
}

function detectNeedThresholdCrossings(
  before: ColonistState["needs"],
  after: ColonistState["needs"],
  traits: readonly TraitId[],
): TickEvent[] {
  const events: TickEvent[] = [];
  for (const id of NEEDS) {
    const wasCritical = isCritical(id, before[id].level);
    const isNowCritical = isCritical(id, after[id].level);
    const wasLow = isLow(id, before[id].level, traits);
    const isNowLow = isLow(id, after[id].level, traits);
    if (!wasCritical && isNowCritical) {
      events.push({ kind: "needThresholdCrossing", needId: id, severity: "critical" });
    } else if (!wasLow && isNowLow) {
      events.push({ kind: "needThresholdCrossing", needId: id, severity: "low" });
    }
  }
  return events;
}

/**
 * Suspends the colonist's current active goal, interrupting its execution and retaining BOTH
 * as a paired unit (`suspendedGoal` / `suspendedExecution`) — never interrupting the execution
 * and then dropping it. Single-slot Stage 1 model: an already-occupied suspended pair is
 * explicitly abandoned/aborted first (never silently overwritten) — a documented limitation
 * of not yet having the full goal stack (DQ-D8), made explicit via the suspensionOverflow
 * event rather than lost silently.
 */
function suspendCurrentGoal(
  colonist: ColonistState,
  execution: Execution | null,
  suspendedExecution: Execution | null,
  events: TickEvent[],
): { colonist: ColonistState; execution: Execution | null; suspendedExecution: Execution | null } {
  let interrupted = execution;
  if (interrupted !== null && interrupted.status === "inProgress") {
    interrupted = interruptExecution(interrupted);
    events.push({ kind: "executionInterrupted", taskId: interrupted.taskId, goalKey: interrupted.goalKey });
  }

  let nextColonist = colonist;
  if (nextColonist.suspendedGoal !== null) {
    const abandoned = abandonGoal(nextColonist.suspendedGoal);
    let abandonedExecutionTaskId: TaskId | null = null;
    if (suspendedExecution !== null) {
      abandonedExecutionTaskId = abortExecution(suspendedExecution).taskId;
    }
    events.push({ kind: "suspensionOverflow", abandonedGoalKey: abandoned.key, abandonedExecutionTaskId });
    nextColonist = withSuspendedGoal(nextColonist, null);
  }

  const suspendedGoal = suspendGoal(nextColonist.currentGoal!);
  nextColonist = withSuspendedGoal(withCurrentGoal(nextColonist, null), suspendedGoal);

  return { colonist: nextColonist, execution: null, suspendedExecution: interrupted };
}

/** Adopts a goal (freshly committed) and resolves it to an executable task, beginning a NEW execution, or blocks it. */
function adoptAndResolve(
  colonist: ColonistState,
  goal: Goal,
  snapshot: WorldSnapshot,
  currentTick: number,
  events: TickEvent[],
): { colonist: ColonistState; execution: Execution | null } {
  const resolution = resolveTask(goal, colonist.identity.skills, snapshot);
  events.push({ kind: "taskResolution", resolution });
  if (resolution.kind === "executable") {
    const execution = beginExecution(resolution.task, goal, currentTick);
    events.push({ kind: "executionBegun", taskId: execution.taskId, goalKey: execution.goalKey });
    return { colonist: withCurrentGoal(colonist, goal), execution };
  }
  return { colonist: withCurrentGoal(colonist, resolution.goal), execution: null };
}

/**
 * Resumes a previously suspended goal + execution pair. Re-checks eligibility/availability
 * FIRST (through the current snapshot) — if the task the suspended execution was running is
 * no longer eligible or available, this reports blockage explicitly and discards the stale
 * execution via an explicit abort, rather than silently starting a fresh execution from zero.
 * Only when the original task is still executable does it call resumeExecution on the SAME
 * Execution object, preserving `elapsedTicks`.
 */
function resumeSuspended(
  colonist: ColonistState,
  suspendedExecution: Execution,
  snapshot: WorldSnapshot,
  events: TickEvent[],
): { colonist: ColonistState; execution: Execution | null } {
  const resumedGoal = resumeGoal(colonist.suspendedGoal!);
  const nextColonist = withSuspendedGoal(colonist, null);
  const resolution = resolveTask(resumedGoal, nextColonist.identity.skills, snapshot);
  events.push({ kind: "taskResolution", resolution });

  if (resolution.kind === "executable" && resolution.task.id === suspendedExecution.taskId) {
    const resumed = resumeExecution(suspendedExecution);
    events.push({ kind: "executionResumed", taskId: resumed.taskId, goalKey: resumed.goalKey, elapsedTicks: resumed.elapsedTicks });
    return { colonist: withCurrentGoal(nextColonist, resumedGoal), execution: resumed };
  }

  // The originally-suspended task no longer serves this goal (blocked), or — defensively,
  // though Stage 1's goal→task mapping is deterministic so this branch is not currently
  // reachable — a different task now serves it. Either way: report explicitly, never
  // silently restart the stale execution from zero.
  const aborted = abortExecution(suspendedExecution);
  events.push({ kind: "executionAborted", taskId: aborted.taskId, goalKey: aborted.goalKey });

  if (resolution.kind === "executable") {
    const fresh = beginExecution(resolution.task, resumedGoal, snapshot.tick);
    events.push({ kind: "executionBegun", taskId: fresh.taskId, goalKey: fresh.goalKey });
    return { colonist: withCurrentGoal(nextColonist, resumedGoal), execution: fresh };
  }

  events.push({ kind: "blockage", goalKey: resolution.goal.key, reasons: resolution.reasons });
  return { colonist: withCurrentGoal(nextColonist, resolution.goal), execution: null };
}

/**
 * Advances the simulation by exactly BASE_TICKS_PER_STEP. Pure: returns new state and this
 * tick's event trace; never mutates `state`. Implements the fixed phase order (engineering
 * spec §5) across every colonist in the collection (design D2/D3), under the binding
 * phase-boundary rule: this function is organized as a sequence of full per-colonist passes,
 * each completed for every colonist before the next begins — never an interleaved per-colonist
 * mini-tick. "World evolution" (phase 2) is a no-op in Stage 1/2: nothing in the minimal
 * station changes on its own — only execution consequences change it.
 */
export function tick(state: SimulationState, deltaTicks: number): TickResult {
  if (deltaTicks !== BASE_TICKS_PER_STEP) {
    throw new Error(
      `tick() only accepts deltaTicks === BASE_TICKS_PER_STEP (${BASE_TICKS_PER_STEP}); got ${deltaTicks}. ` +
        `Larger timeline advancement must be performed by run() calling tick() repeatedly, so every ` +
        `fixed simulation step is evaluated and no intermediate trigger can be skipped.`,
    );
  }
  validateSimulationState(state); // input boundary — reject malformed state before processing it

  const events: TickEvent[] = [];

  // --- Phase: time advance (global) ---
  const periodBefore = periodAt(state.policy, tickOfDay(state.clock));
  const clock = advance(state.clock, deltaTicks);
  const periodAfter = periodAt(state.policy, tickOfDay(clock));
  const shiftBoundaryFired = periodBefore !== periodAfter;
  if (shiftBoundaryFired) {
    events.push({ kind: "shiftBoundary", from: periodBefore, to: periodAfter });
  }

  const ids = state.colonists.map((r) => r.colonist.identity.id); // canonical order — fixed for this tick
  const allIdentities = state.colonists.map((r) => r.colonist.identity);
  const runtimes = new Map<string, ColonistRuntime>(state.colonists.map((r) => [r.colonist.identity.id, r]));

  let world = state.world;
  let relationships = state.relationships;
  let socialOffers = state.socialOffers;
  let prng = state.prng;
  const relationshipConsequences: RelationshipConsequence[] = [];

  // Per-colonist re-decision trigger accumulator (design D2: computed directly per colonist,
  // never by scanning the shared `events` array — with multiple colonists writing events in
  // one tick, "did a needThresholdCrossing happen" would otherwise cross-contaminate triggers
  // between colonists who have nothing to do with each other's need movement).
  const triggered = new Map<string, boolean>(ids.map((id) => [id, shiftBoundaryFired]));
  const setTriggered = (id: string): void => void triggered.set(id, true);

  // Design D12: immutable Comfort participation basis — built once from tick-start state
  // before Phase 3; never rebuilt. Relief reads `recipients`; admission reads `claimedRecipients`.
  const comfortBasis = buildComfortParticipationBasis(state.colonists);

  // --- Phase: colonist continuous state (needs, stress) — per colonist, canonical order ---
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    const traits = rt.colonist.identity.baseTraits;
    const needsBefore = rt.colonist.needs;
    const decayedNeeds = decayNeeds(needsBefore, deltaTicks, traits);
    const crossings = detectNeedThresholdCrossings(needsBefore, decayedNeeds, traits);
    events.push(...crossings);
    if (crossings.length > 0) setTriggered(id);

    const stressBefore = rt.colonist.stress;
    const isWorking = rt.execution !== null && rt.execution.status === "inProgress" && rt.execution.taskId === "workAtWorkstation";
    const isReceivingComfort = comfortBasis.recipients.has(id);
    const stressResult = evaluateStress(stressBefore, decayedNeeds, deltaTicks, traits, isWorking, isReceivingComfort);
    const colonist = withStress(withNeeds(rt.colonist, decayedNeeds), stressResult.state);
    // Retained, not discarded (Copilot-confirmed defect): decision-loop.md:192's hard
    // traceability requirement is "every stress movement must be decomposable into its sources
    // in the inspector". Logged only when something actually moved, per colonist.
    if (stressResult.contributions.some((c) => c.rawDelta !== 0)) {
      events.push({ kind: "stressEvaluated", contributions: stressResult.contributions });
    }
    runtimes.set(id, { ...rt, colonist });
  }

  // --- Atrophy (M10 continuous-state phase) — global, once, with the UNION of every colonist's
  // currently active social pair excluded (Stage 2 Slice 6b generalizes this from one pair to a
  // set — relationships.ts's applyAtrophy already accepts one; promoting every colonist to full
  // simulation means more than one pair can be simultaneously mid-interaction in the same tick).
  // Copilot-confirmed defect (carried over): gated on world.foodStock > 0 too — an in-progress
  // eating execution with depleted stock consumes nothing this tick, so it must not exempt the
  // pair from atrophy as if a shared meal occurred.
  const excludedPairs: PairKey[] = [];
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    const others = allIdentities.filter((i) => i.id !== id);
    const activeSharedMealPartner =
      rt.execution?.status === "inProgress" && rt.execution.taskId === "eatAtFoodStation" && world.foodStock > 0
        ? sharedMealPartnerId(others, id, relationships)
        : undefined;
    const activeSocialPartner = rt.execution?.status === "inProgress" ? (rt.colonist.currentGoal?.relatedColonistId ?? activeSharedMealPartner) : undefined;
    if (
      activeSocialPartner !== undefined &&
      (companionshipAffinityDeltaPerTick(rt.execution!.taskId) > 0 ||
        rt.execution!.taskId === "eatAtFoodStation" ||
        rt.execution!.taskId === "comfort")
    ) {
      excludedPairs.push(canonicalPairId(id, activeSocialPartner));
    }
  }
  const atrophyResult = applyAtrophy(relationships, deltaTicks, excludedPairs);
  relationships = atrophyResult.store;
  relationshipConsequences.push(...atrophyResult.consequences);

  // Bootstrap (review-fix carried over from Stage 1, now per colonist): fires once per colonist,
  // ONLY on the simulation's genuine first tick (state.hasBootstrapped === false) — every
  // colonist whose execution is null AT THE START of this tick gets the one-time kick into its
  // first decision. Computed from tick-start execution — independent of when execution progress
  // runs later (design D2 phase 6). Gating on "no execution" alone would fire every tick a
  // colonist has none for ANY reason (e.g. a blocked goal); blocked-goal retry has its own
  // trigger below.
  if (!state.hasBootstrapped) {
    for (const id of ids) {
      if (runtimes.get(id)!.execution === null) {
        events.push({ kind: "bootstrap" });
        setTriggered(id);
      }
    }
  }
  // Set unconditionally: after this tick has run at all, the state is no longer "genuinely
  // fresh" — regardless of whether any colonist's bootstrap actually fired.
  const hasBootstrapped = true;

  // --- Phase: completion & blockage detection (design D2 phase 4) — per colonist, canonical
  // order. Uses a STRUCTURAL-ONLY snapshot: resolveTask/isTaskComplete/checkEligibility/
  // checkAvailability never read `nearbyColonists` (only currentPeriod/modules/foodStock), so
  // this can safely run before the real observation basis exists — and it must, per D2, since
  // the basis is built from this phase's outputs (below). Review fix: checked against needs as
  // decayed in Phase 3 only — this tick's own execution consequences apply later, in Phase 6
  // (design D2's phase 6: decisions before execution/consequences), so a task whose completion
  // depends on THIS tick's own progress is detected on the FOLLOWING tick — the literal fixed
  // seven-phase order (engineering spec §5), not collapsed for same-tick convenience.
  const structuralSnapshot = buildSnapshot(clock, state.policy, world, []);
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    let colonist = rt.colonist;
    let execution = rt.execution;
    if (execution !== null && execution.status === "inProgress") {
      const needSatisfied = (needId: NeedId): boolean => isSatisfied(needId, colonist.needs[needId].level);
      if (isTaskComplete(execution.taskId, needSatisfied, structuralSnapshot)) {
        const completed = completeExecution(execution);
        events.push({ kind: "completion", goalKey: completed.goalKey, taskId: completed.taskId });
        execution = completed;
        if (colonist.currentGoal !== null && colonist.currentGoal.status === "active") {
          colonist = withCurrentGoal(colonist, completeGoal(colonist.currentGoal));
        }
        setTriggered(id);
      } else if (colonist.currentGoal !== null && colonist.currentGoal.status === "active") {
        const resolution = resolveTask(colonist.currentGoal, colonist.identity.skills, structuralSnapshot);
        if (resolution.kind === "blocked") {
          events.push({ kind: "blockage", goalKey: resolution.goal.key, reasons: resolution.reasons });
          execution = abortExecution(execution);
          events.push({ kind: "executionAborted", taskId: execution.taskId, goalKey: execution.goalKey });
          colonist = withCurrentGoal(colonist, resolution.goal);
          setTriggered(id);
        }
      }
      runtimes.set(id, { ...runtimes.get(id)!, colonist, execution });
    }
  }

  // --- The single shared observation basis (design D3) — built here, exactly once, from every
  // colonist's real Tier-1 ambient state AS OF THE END OF PHASE 4 (post completion/blockage,
  // pre any Phase 5 decision), via the same `ambientStateFor` registry the inspector already
  // uses — retiring the hardcoded "resting" placeholder. Every deciding colonist's snapshot,
  // AND Phase 6's offer-eligibility reads below, are built from this SAME fixed array (self
  // excluded where applicable): the structural mechanism that makes same-tick non-observability
  // hold — no colonist's Phase 5 commitment or Phase 6 execution-begin can appear in it, because
  // it is fixed before Phase 5 begins for anyone and never rebuilt afterward this tick.
  const sharedObservations: ObservableColonist[] = ids.map((id) => {
    const rt = runtimes.get(id)!;
    return { id, ambientState: ambientStateFor(rt.execution, rt.colonist.stress) };
  });
  const snapshotFor = (ownId: string): WorldSnapshot =>
    buildSnapshot(clock, state.policy, world, sharedObservations.filter((o) => o.id !== ownId));

  // --- Phase: interruption / suspension-resolved detection (design D2 phase 4, continued) —
  // per colonist, canonical order. Candidate generation here is TIER-CHECK ONLY, via the
  // STRUCTURAL-only snapshot: every social (voluntary, tier-5) candidate is the lowest priority
  // tier that exists, so it can never satisfy `tier < currentGoal.tier` — `nearbyColonists`
  // content is therefore provably irrelevant to whether an interruption or suspension-resolution
  // fires. The REAL candidates (content-accurate, from the shared basis) are generated
  // separately in Phase 5 for the actual decision — this phase does not cache/reuse them.
  // Unconditional per colonist — it must run even when another trigger already fired, because it
  // determines whether the current goal needs to be *properly suspended* (goal-system's suspend
  // model) rather than silently overwritten by whatever the decision phase adopts next.
  const wasInterruption = new Map<string, boolean>();
  const resumeFromSuspension = new Map<string, boolean>();
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    const tierCandidates = generateCandidates(structuralSnapshot, rt.colonist.needs, rt.colonist.identity.baseTraits);

    let interrupted = false;
    if (rt.colonist.currentGoal !== null && rt.colonist.currentGoal.status === "active") {
      const outranksCurrent = tierCandidates.some((c) => c.tier < rt.colonist.currentGoal!.tier);
      if (outranksCurrent) {
        events.push({
          kind: "higherPriorityCondition",
          interruptedGoalKey: rt.colonist.currentGoal.key,
          interruptedTier: rt.colonist.currentGoal.tier,
        });
        setTriggered(id);
        interrupted = true;
      }
    }
    wasInterruption.set(id, interrupted);

    // Suspension-resolved is gated behind "no interruption just happened" (Stage 1
    // simplification): an interruption occurring the same tick a suspension might otherwise
    // resolve is resolved in favor of the new interruption.
    let resumed = false;
    if (!interrupted && rt.colonist.suspendedGoal !== null) {
      const outranksSuspended = tierCandidates.some((c) => c.tier < rt.colonist.suspendedGoal!.tier);
      if (!outranksSuspended) {
        events.push({ kind: "suspensionResolved", goalKey: rt.colonist.suspendedGoal.key });
        setTriggered(id);
        resumed = true;
      }
    }
    resumeFromSuspension.set(id, resumed);
  }

  // --- Phase: decisions (design D2 phase 5) — per colonist, canonical order (EQ-3 / ADR-22 D2:
  // PRNG draw order is fixed by this same canonical iteration, so replay reproduces the exact
  // draw sequence regardless of which colonist happens to draw). Gating: skip re-deciding if
  // nothing triggered this colonist this tick, or if a trigger fired but same-tier commitment
  // stickiness applies (decision-loop §2 — "a colonist does not re-litigate their commitment
  // every tick; they re-decide when something happens" — the *something* has to actually bear
  // on the commitment). Candidates here are REAL (content-accurate, from the shared observation
  // basis) — generated fresh per deciding colonist, since Phase 4's tier-check candidates above
  // deliberately used a structural-only snapshot and are not reused.
  for (const id of ids) {
    if (!triggered.get(id)) continue;

    const rt = runtimes.get(id)!;
    let colonist = rt.colonist;
    let execution = rt.execution;
    let suspendedExecution = rt.suspendedExecution;

    const interrupted = wasInterruption.get(id)!;
    const resumed = resumeFromSuspension.get(id)!;

    if (!resumed && !interrupted && colonist.currentGoal !== null && colonist.currentGoal.status === "active") {
      continue; // commitment stickiness — this trigger doesn't bear on this colonist's goal
    }

    const snapshot = snapshotFor(id);

    if (resumed && colonist.suspendedGoal !== null && suspendedExecution !== null) {
      const result = resumeSuspended(colonist, suspendedExecution, snapshot, events);
      colonist = result.colonist;
      execution = result.execution;
      suspendedExecution = null; // the pair is resolved either way (resumed, replaced, or blocked)
    } else if (resumed && colonist.suspendedGoal !== null) {
      // Offer-backed suspended goal (Stage 2 Slice 5): no execution was ever parked — the goal
      // resumes to the active slot with no execution, and its still-pending offer picks back up
      // at the next tick's lifecycle pass (design D3 step 3's hold ending).
      const resumedGoal = resumeGoal(colonist.suspendedGoal);
      colonist = withCurrentGoal(withSuspendedGoal(colonist, null), resumedGoal);
      execution = null;
    } else {
      if (interrupted && colonist.currentGoal !== null && colonist.currentGoal.status === "active") {
        const suspended = suspendCurrentGoal(colonist, execution, suspendedExecution, events);
        colonist = suspended.colonist;
        execution = suspended.execution;
        suspendedExecution = suspended.suspendedExecution;
      }

      const candidates = generateCandidates(snapshot, colonist.needs, colonist.identity.baseTraits);
      const decision = decideFromCandidates(candidates, colonist, prng, clock.tick, snapshot, relationships);
      events.push({ kind: "decision", outcome: decision });
      // Every higher-tier candidate the filter found non-actionable and fell through — retained
      // in decision.blockedCandidates (decisionLog persists the full outcome already), and ALSO
      // surfaced as its own "blockage" event so the flat trace shows it without unpacking a
      // decision payload, matching the existing post-commit blockage event's visibility.
      for (const blocked of decision.blockedCandidates) {
        events.push({ kind: "blockage", goalKey: blocked.key, reasons: blocked.reasons });
      }
      prng = decision.prngState;

      if (
        decision.kind === "commit" &&
        decision.goal.relatedColonistId !== undefined &&
        (decision.goal.relatedSocialTaskId === "conversation" ||
          decision.goal.relatedSocialTaskId === "sharedDowntime" ||
          decision.goal.relatedSocialTaskId === "comfort")
      ) {
        // Stage 2 Slice 5/7 (design D3/D6, Phase 5): committing an offer-backed social goal
        // creates a pending offer instead of beginning execution — the responder answers in a
        // later tick's lifecycle pass (never this tick: the one-tick response-delay floor).
        // Re-committing an identical intent while its offer is still pending reuses that offer.
        const goal = decision.goal;
        const responderId = decision.goal.relatedColonistId;
        const action = decision.goal.relatedSocialTaskId;
        const existing = socialOffers.offers.find(
          (o) => o.status === "pending" && o.initiatorId === colonist.identity.id && offerGoalKey(o) === goal.key,
        );
        if (existing === undefined) {
          const created = createPendingOffer({
            store: socialOffers,
            initiatorId: colonist.identity.id,
            responderId,
            action,
            createdAtTick: clock.tick,
            responseDelayTicks: SOCIAL_OFFER_TUNING.responseDelayTicks,
            offerTimeoutTicks: SOCIAL_OFFER_TUNING.offerTimeoutTicks,
          });
          socialOffers = created.store;
          events.push({
            kind: "socialOfferCreated",
            offerId: created.offer.id,
            initiatorId: created.offer.initiatorId,
            responderId: created.offer.responderId,
            action: created.offer.action,
            respondableAtTick: created.offer.respondableAtTick,
            expiresAtTick: created.offer.expiresAtTick,
          });
        }
        colonist = withCurrentGoal(colonist, goal);
        execution = null;
      } else if (decision.kind === "commit") {
        const adopted = adoptAndResolve(colonist, decision.goal, snapshot, clock.tick, events);
        colonist = adopted.colonist;
        execution = adopted.execution;
      } else {
        colonist = withCurrentGoal(colonist, null);
        execution = null;
      }
    }

    runtimes.set(id, { ...rt, colonist, execution, suspendedExecution });
  }

  // --- Phase: execution & consequences (design D2 phase 6) — the offer lifecycle pass FIRST
  // (ascending offer id, unchanged from Slice 5), THEN each colonist's execution progress and
  // consequence fan-out in canonical order (design D2's own ordering within phase 6). Both use
  // the SAME pre-Phase-5 shared observation basis built above — Phase 6 must never feed back
  // into any same-tick Phase 5 input, and reusing the fixed basis here (rather than rebuilding
  // it post-decision) is what guarantees that.
  //
  // Stage 2 Slice 5 — design D3's Phase 6 steps, ADR-21; Stage 2 Slice 6b — design D5: any
  // colonist may initiate or respond. Every pending offer is examined in ascending id order:
  // expiry → cancellation → hold → response delay → eligibility → acceptance draw. Reads
  // pending offers only (ADR-21 Invariant 8) and the shared observation basis for eligibility.
  // Freeze the post-Phase-5 offer order for this pass. This includes offers created by any
  // colonist's decision this tick, allowing the ascending-id double-booking guard to cancel
  // later offers before an invalid multi-pending state can escape tick(). Mutations below
  // replace `socialOffers`, but do not alter this deterministic iteration basis.
  const offersAtPhase6Start = socialOffers.offers;
  for (const offer of offersAtPhase6Start) {
    if (offer.status !== "pending") continue;
    const goalKey = offerGoalKey(offer);
    const initiatorRt = runtimes.get(offer.initiatorId);
    if (initiatorRt === undefined) {
      // Defensive: colonists are seeded once and never removed (ADR-19 out of scope) — not
      // reachable today, specified anyway, matching the responder-absence guard's own posture.
      socialOffers = resolveOffer(socialOffers, offer.id, "cancelled", clock.tick, "initiatorUnavailable");
      events.push({ kind: "socialOfferResolved", offerId: offer.id, status: "cancelled", reason: "initiatorUnavailable" });
      continue;
    }
    let colonist = initiatorRt.colonist;
    let execution = initiatorRt.execution;
    const writeBack = (): void => void runtimes.set(offer.initiatorId, { ...runtimes.get(offer.initiatorId)!, colonist, execution });

    const resolved = (status: Exclude<SocialOfferStatus, "pending">, reason: OfferResolutionReason | null): void => {
      socialOffers = resolveOffer(socialOffers, offer.id, status, clock.tick, reason);
      events.push({ kind: "socialOfferResolved", offerId: offer.id, status, reason });
    };
    const abandonInitiatorGoal = (): void => {
      if (colonist.currentGoal?.key === goalKey) {
        abandonGoal(colonist.currentGoal); // legality check — active/blocked → abandoned
        colonist = withCurrentGoal(colonist, null);
      } else if (colonist.suspendedGoal?.key === goalKey) {
        abandonGoal(colonist.suspendedGoal);
        colonist = withSuspendedGoal(colonist, null); // offer-backed suspension has no parked execution
      }
    };
    const declineWithFriction = (reason: OfferResolutionReason): void => {
      resolved("declined", reason);
      // ADR-18 D6's decline row: forced-proximity friction, negative, low, both directions.
      const interaction = applyInteraction(relationships, {
        colonistAId: offer.initiatorId,
        colonistBId: offer.responderId,
        tick: clock.tick,
        changeSource: "forcedProximityMutualStress",
        initiatorId: offer.initiatorId,
        responderId: offer.responderId,
        aTowardBDelta: SOCIAL_OFFER_TUNING.declineAffinityDelta,
        bTowardADelta: SOCIAL_OFFER_TUNING.declineAffinityDelta,
      });
      relationships = interaction.store;
      relationshipConsequences.push(...interaction.consequences);
      abandonInitiatorGoal();
    };

    // 1 — expiry (design D6: reachable when a suspension outlasts the timeout).
    if (clock.tick >= offer.expiresAtTick) {
      resolved("expired", "timeout");
      abandonInitiatorGoal(); // a goal whose offer expired must not later resume into direct execution
      writeBack();
      continue;
    }
    // 2 — cancellation: the offer-creating goal was abandoned or replaced (design D6). Runs
    // after Phase 5 (review fix), so a same-tick interruption/replacement of the initiator's
    // goal is correctly observed here.
    const initiatorHoldsGoal = colonist.currentGoal?.key === goalKey || colonist.suspendedGoal?.key === goalKey;
    if (!initiatorHoldsGoal) {
      resolved("cancelled", "initiatorUnavailable");
      writeBack();
      continue;
    }
    // 2b — double-booking guard (design D6): a lower-id pending offer for the same responder
    // wins; the later-created one cancels. Reachable now that multiple initiators exist.
    if (socialOffers.offers.some((o) => o.status === "pending" && o.responderId === offer.responderId && o.id < offer.id)) {
      resolved("cancelled", "responderUnavailable");
      abandonInitiatorGoal();
      writeBack();
      continue;
    }
    // 3 — hold: a suspended offer-creating goal keeps the offer pending (design D3 step 3).
    if (colonist.suspendedGoal?.key === goalKey) {
      writeBack();
      continue;
    }
    // 4 — not yet respondable: the one-tick-minimum response delay (design D3).
    if (clock.tick < offer.respondableAtTick) {
      writeBack();
      continue;
    }
    // 5 — responder eligibility (design D4: snapshot facts and directional perspectives only).
    const responderRt = runtimes.get(offer.responderId);
    if (responderRt === undefined) {
      // No friction: an absent responder is not a known colonist to hold a pair with.
      resolved("declined", "responderNotInRoster");
      abandonInitiatorGoal();
      writeBack();
      continue;
    }
    const observed = sharedObservations.find((o) => o.id === offer.responderId);
    if (observed === undefined || !isEligibleTargetState(offer.action, observed.ambientState)) {
      declineWithFriction("responderNotInterruptible");
      writeBack();
      continue;
    }
    // Design D11.5(a)/(b): claimed recipients (active or suspended Comfort) and in-progress
    // Comfort initiators are not eligible Comfort responders / targets.
    if (
      offer.action === "comfort" &&
      (comfortBasis.claimedRecipients.has(offer.responderId) || comfortBasis.participants.has(offer.responderId))
    ) {
      declineWithFriction("responderNotInterruptible");
      writeBack();
      continue;
    }
    const isNonHostile = (s: string) => s !== "hostile" && s !== "fractured";
    if (
      !isNonHostile(perspective(relationships, offer.initiatorId, offer.responderId).state) ||
      !isNonHostile(perspective(relationships, offer.responderId, offer.initiatorId).state)
    ) {
      declineWithFriction("relationshipGate");
      writeBack();
      continue;
    }
    // 6 — acceptance draw (design D5): one attributed S1 draw, modulated by the RESPONDER's
    // directional relationship state toward the initiator. Comfort uses its own probability table.
    const responderState = perspective(relationships, offer.responderId, offer.initiatorId).state;
    const acceptanceTable =
      offer.action === "comfort"
        ? SOCIAL_OFFER_TUNING.comfortAcceptanceProbability
        : SOCIAL_OFFER_TUNING.acceptanceProbability;
    const acceptanceProbability = acceptanceTable[responderState] ?? 0;
    const draw = next(prng);
    prng = draw.state;
    if (draw.value >= acceptanceProbability) {
      declineWithFriction("acceptanceDraw");
      writeBack();
      continue;
    }
    resolved("accepted", null);
    const acceptedGoal = colonist.currentGoal!; // step 3 ruled out suspension; step 2 ruled out absence
    const resolution = resolveTask(acceptedGoal, colonist.identity.skills, snapshotFor(offer.initiatorId));
    events.push({ kind: "taskResolution", resolution });
    if (resolution.kind === "executable") {
      execution = beginExecution(resolution.task, acceptedGoal, clock.tick);
      events.push({ kind: "executionBegun", taskId: execution.taskId, goalKey: execution.goalKey });
    } else {
      events.push({ kind: "blockage", goalKey: resolution.goal.key, reasons: resolution.reasons });
      colonist = withCurrentGoal(colonist, resolution.goal);
    }
    writeBack();
  }
  socialOffers = evictResolvedOffers(socialOffers, SOCIAL_OFFER_TUNING.resolvedOfferRetention);

  // Execution progress and its owned consequences (design D2 phase 6, second half) — per
  // colonist, canonical order, for whatever execution now exists (continuing from tick start, OR
  // freshly begun this same tick by decisions/offer-acceptance above — a newly-begun execution
  // DOES receive its first tick of progress in this same pass, per phase 6's ordering after
  // phase 5). `world` and `relationships` thread SEQUENTIALLY across colonists in canonical
  // order, so shared contention (e.g. two colonists eating the same tick) resolves
  // deterministically.
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    let colonist = rt.colonist;
    const execution = rt.execution;
    if (execution === null || execution.status !== "inProgress") continue;

    const traits = colonist.identity.baseTraits;
    const others = allIdentities.filter((i) => i.id !== id);
    // Copilot-confirmed defect (carried over): gated on world.foodStock > 0 too — an in-progress
    // eating execution with depleted stock consumes nothing this tick, so it must not exempt the
    // pair from atrophy as if a shared meal occurred. (Atrophy's own exclusion set was computed
    // earlier from tick-start executions, per design D2's phase-3 placement of atrophy — unaffected
    // by this pass running later in phase 6.)
    const activeSharedMealPartner =
      execution.taskId === "eatAtFoodStation" && world.foodStock > 0 ? sharedMealPartnerId(others, id, relationships) : undefined;

    const progressed = progressExecution(execution, deltaTicks);
    events.push({ kind: "executionProgressed", taskId: progressed.taskId, elapsedTicks: progressed.elapsedTicks });

    const worldBeforeProgress = world;
    const consequences = applyProgressConsequences(progressed.taskId, colonist.needs, world, deltaTicks, traits);
    if (consequences.needs !== undefined) colonist = withNeeds(colonist, consequences.needs);
    if (consequences.world !== undefined) world = consequences.world;

    const consumedFood =
      progressed.taskId === "eatAtFoodStation" && consequences.world !== undefined ? worldBeforeProgress.foodStock - consequences.world.foodStock : 0;
    if (activeSharedMealPartner !== undefined && consumedFood > 0) {
      // Copilot-confirmed defect: scale by the same restorationFraction the Hunger consequence
      // uses (execution.ts:125-136) — a final tick that consumes only a fraction of
      // foodConsumptionPerTick must not grant the full per-tick Social/affinity credit.
      const fullFoodConsumption = TASK_TUNING.foodConsumptionPerTick * deltaTicks;
      const sharedMealFraction = fullFoodConsumption > 0 ? consumedFood / fullFoodConsumption : 0;
      colonist = withNeeds(
        colonist,
        restoreNeedByAmount(colonist.needs, "social", TASK_TUNING.sharedMealSocialRestorePerTick * deltaTicks * sharedMealFraction, traits),
      );
      const interaction = applyInteraction(relationships, {
        colonistAId: colonist.identity.id,
        colonistBId: activeSharedMealPartner,
        tick: clock.tick,
        changeSource: "sharedTaskCompletion",
        initiatorId: colonist.identity.id,
        responderId: activeSharedMealPartner,
        aTowardBDelta: TASK_TUNING.sharedMealAffinityDeltaPerTick * deltaTicks * sharedMealFraction,
        bTowardADelta: 0,
      });
      relationships = interaction.store;
      relationshipConsequences.push(...interaction.consequences);
    }

    const relatedColonistId = colonist.currentGoal?.relatedColonistId;
    if (progressed.taskId === "comfort" && relatedColonistId !== undefined) {
      const comfortRestore = TASK_TUNING.comfortSocialRestorePerTick * deltaTicks;
      const comfortAffinity = TASK_TUNING.comfortAffinityDeltaPerTick * deltaTicks;
      colonist = withNeeds(colonist, restoreNeedByAmount(colonist.needs, "social", comfortRestore, traits));
      const responderRt = runtimes.get(relatedColonistId);
      if (responderRt !== undefined) {
        const responderTraits = responderRt.colonist.identity.baseTraits;
        runtimes.set(relatedColonistId, {
          ...responderRt,
          colonist: withNeeds(
            responderRt.colonist,
            restoreNeedByAmount(responderRt.colonist.needs, "social", comfortRestore, responderTraits),
          ),
        });
      }
      const interaction = applyInteraction(relationships, {
        colonistAId: colonist.identity.id,
        colonistBId: relatedColonistId,
        tick: clock.tick,
        changeSource: "mutualSupportCrisis",
        initiatorId: colonist.identity.id,
        responderId: relatedColonistId,
        aTowardBDelta: comfortAffinity,
        bTowardADelta: comfortAffinity,
      });
      relationships = interaction.store;
      relationshipConsequences.push(...interaction.consequences);
    } else {
      const socialRestorePerTick = socialNeedRestorePerTick(progressed.taskId);
      const affinityDeltaPerTick = companionshipAffinityDeltaPerTick(progressed.taskId);
      if (relatedColonistId !== undefined && (socialRestorePerTick > 0 || affinityDeltaPerTick > 0)) {
        if (socialRestorePerTick > 0) {
          colonist = withNeeds(colonist, restoreNeedByAmount(colonist.needs, "social", socialRestorePerTick * deltaTicks, traits));
        }
        if (affinityDeltaPerTick > 0) {
          const interaction = applyInteraction(relationships, {
            colonistAId: colonist.identity.id,
            colonistBId: relatedColonistId,
            tick: clock.tick,
            changeSource: "sharedTaskCompletion",
            initiatorId: colonist.identity.id,
            responderId: relatedColonistId,
            aTowardBDelta: affinityDeltaPerTick * deltaTicks,
            bTowardADelta: 0,
          });
          relationships = interaction.store;
          relationshipConsequences.push(...interaction.consequences);
        }
      }
    }

    runtimes.set(id, { ...runtimes.get(id)!, colonist, execution: progressed });
  }

  // --- Phase: memory formation (M9) — involuntary, per colonist, from cumulative need/stress
  // movement since each baseline (see ColonistRuntime doc). Runs after Phase 6 so it sees the
  // FULL tick's need/stress movement, including this tick's own execution consequences.
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    let memory = rt.colonist.memory;
    let deprivationBaselines = rt.deprivationBaselines;
    for (const needId of NEEDS) {
      const level = rt.colonist.needs[needId].level;
      if (isSatisfied(needId, level) || level > deprivationBaselines[needId]) {
        deprivationBaselines = { ...deprivationBaselines, [needId]: level };
        continue;
      }
      const formed = considerDeprivationFormation(memory, clock.tick, needId, deprivationBaselines[needId], level);
      if (formed !== memory) {
        memory = formed;
        deprivationBaselines = { ...deprivationBaselines, [needId]: level };
        events.push({ kind: "memoryFormed", memoryType: "deprivation", needId });
      }
    }

    let stressBaseline = rt.stressBaseline;
    const conditionFormed = considerConditionFormation(memory, clock.tick, stressBaseline, rt.colonist.stress.level);
    if (conditionFormed !== memory) {
      memory = conditionFormed;
      stressBaseline = rt.colonist.stress.level;
      events.push({ kind: "memoryFormed", memoryType: "condition" });
    }

    runtimes.set(id, {
      ...rt,
      colonist: memory !== rt.colonist.memory ? withMemory(rt.colonist, memory) : rt.colonist,
      deprivationBaselines,
      stressBaseline,
    });
  }

  // --- Phase: relationship consequences (M10) + Relational memory formation (M9) — per colonist,
  // filtered to pairs that colonist is party to. `relationshipConsequences` is now complete
  // (atrophy + Phase 6 execution-progress interactions + offer-decline friction). Fact-only
  // (ADR-20 D7); reads only each consequence's own delta/resulting-affinity fields, never the
  // store's materialized records. Baselines track cumulative movement per partner.
  for (const id of ids) {
    const rt = runtimes.get(id)!;
    let memory = rt.colonist.memory;
    let relationshipAffinityBaselines = rt.relationshipAffinityBaselines;
    for (const consequence of relationshipConsequences) {
      const [min, max] = consequence.pair;
      const ownerIsMin = min === id;
      const ownerIsMax = max === id;
      if (!ownerIsMin && !ownerIsMax) continue; // this colonist is not party to the pair
      const otherId = ownerIsMin ? max : min;
      const ownAffinityDelta = ownerIsMin ? consequence.minTowardMaxDelta : consequence.maxTowardMinDelta;
      const currentAffinity = ownerIsMin ? consequence.resultingMinTowardMaxAffinity : consequence.resultingMaxTowardMinAffinity;
      // First sighting of this partner: seed the baseline as of just before this tick's own
      // movement, so cumulative drift is measured from there onward, not lost.
      const baseline = relationshipAffinityBaselines[otherId] ?? currentAffinity - ownAffinityDelta;
      const relationalFormed = considerRelationalFormation(memory, clock.tick, otherId, currentAffinity - baseline);
      if (relationalFormed !== memory) {
        memory = relationalFormed;
        relationshipAffinityBaselines = { ...relationshipAffinityBaselines, [otherId]: currentAffinity };
        events.push({ kind: "memoryFormed", memoryType: "relational", otherId });
      } else {
        relationshipAffinityBaselines = { ...relationshipAffinityBaselines, [otherId]: baseline };
      }
    }
    runtimes.set(id, {
      ...runtimes.get(id)!,
      colonist: memory !== runtimes.get(id)!.colonist.memory ? withMemory(runtimes.get(id)!.colonist, memory) : runtimes.get(id)!.colonist,
      relationshipAffinityBaselines,
    });
  }

  return finish(
    {
      clock,
      world,
      policy: state.policy,
      colonists: ids.map((id) => runtimes.get(id)!),
      prng,
      hasBootstrapped,
      eventLog: state.eventLog,
      decisionLog: state.decisionLog,
      relationships,
      socialOffers,
    },
    events,
  );
}
