// Comfort participation basis (design/comfort-assist-protocol.md D12 / ADR-24 Invariant 12).
// Pure derivation from tick-start colonist runtimes — no world/clock/offer/PRNG reads.
// Built once before Phase 3; never rebuilt mid-tick.

import type { ColonistId } from "../colonist/relationships.js";
import type { Goal } from "../decision/goals.js";
import type { Execution } from "../task/execution.js";

/** Minimal runtime shape the basis builder reads (design D12 fixed-input list). */
export interface ComfortRuntimeView {
  readonly colonist: {
    readonly identity: { readonly id: ColonistId };
    readonly currentGoal: Goal | null;
    readonly suspendedGoal: Goal | null;
  };
  readonly execution: Execution | null;
  readonly suspendedExecution: Execution | null;
}

/** Immutable per-tick Comfort participation basis (design D12). */
export interface ComfortParticipationBasis {
  /** Active Comfort recipient → comforter (relief lookup only). */
  readonly recipients: ReadonlyMap<ColonistId, ColonistId>;
  /** Initiators of in-progress Comfort (no-Comfort-on-Comfort guard). */
  readonly participants: ReadonlySet<ColonistId>;
  /** Recipients of any held Comfort — active or suspended (admission guard). */
  readonly claimedRecipients: ReadonlySet<ColonistId>;
}

function activeComfortRecipient(runtime: ComfortRuntimeView): ColonistId | undefined {
  const { execution } = runtime;
  const goal = runtime.colonist.currentGoal;
  if (execution === null || execution.status !== "inProgress" || execution.taskId !== "comfort") {
    return undefined;
  }
  if (
    goal === null ||
    goal.status !== "active" ||
    goal.relatedSocialTaskId !== "comfort" ||
    goal.key !== execution.goalKey ||
    goal.relatedColonistId === undefined ||
    goal.relatedColonistId === runtime.colonist.identity.id
  ) {
    return undefined;
  }
  return goal.relatedColonistId;
}

function suspendedComfortRecipient(runtime: ComfortRuntimeView): ColonistId | undefined {
  const { suspendedExecution } = runtime;
  const goal = runtime.colonist.suspendedGoal;
  if (
    suspendedExecution === null ||
    suspendedExecution.status !== "interrupted" ||
    suspendedExecution.taskId !== "comfort"
  ) {
    return undefined;
  }
  if (
    goal === null ||
    goal.status !== "suspended" ||
    goal.relatedSocialTaskId !== "comfort" ||
    goal.key !== suspendedExecution.goalKey ||
    goal.relatedColonistId === undefined ||
    goal.relatedColonistId === runtime.colonist.identity.id
  ) {
    return undefined;
  }
  return goal.relatedColonistId;
}

/**
 * Builds the Comfort participation basis from tick-start runtimes (canonical order).
 * Fail-closed: mismatched goals contribute participants without recipients / no claims.
 * Tie-break for the relief map: lowest canonical comforter id wins (unreachable under the
 * state invariant; keeps the builder total).
 */
export function buildComfortParticipationBasis(colonists: readonly ComfortRuntimeView[]): ComfortParticipationBasis {
  const recipients = new Map<ColonistId, ColonistId>();
  const participants = new Set<ColonistId>();
  const claimedRecipients = new Set<ColonistId>();

  for (const runtime of colonists) {
    const comforterId = runtime.colonist.identity.id;
    const { execution } = runtime;
    if (execution !== null && execution.status === "inProgress" && execution.taskId === "comfort") {
      participants.add(comforterId);
      const recipient = activeComfortRecipient(runtime);
      if (recipient !== undefined) {
        claimedRecipients.add(recipient);
        const existing = recipients.get(recipient);
        if (existing === undefined || comforterId < existing) {
          recipients.set(recipient, comforterId);
        }
      }
    }

    const suspendedRecipient = suspendedComfortRecipient(runtime);
    if (suspendedRecipient !== undefined) {
      claimedRecipients.add(suspendedRecipient);
    }
  }

  return {
    recipients,
    participants,
    claimedRecipients,
  };
}

/**
 * Collects every Comfort claim (active or suspended) for state validation.
 * Returns recipient → comforter ids; duplicate recipients are reported by the caller.
 */
export function collectComfortClaims(
  colonists: readonly ComfortRuntimeView[],
): ReadonlyMap<ColonistId, readonly ColonistId[]> {
  const claims = new Map<ColonistId, ColonistId[]>();
  for (const runtime of colonists) {
    const comforterId = runtime.colonist.identity.id;
    const active = activeComfortRecipient(runtime);
    if (active !== undefined) {
      const list = claims.get(active) ?? [];
      list.push(comforterId);
      claims.set(active, list);
    }
    const suspended = suspendedComfortRecipient(runtime);
    if (suspended !== undefined && active === undefined) {
      const list = claims.get(suspended) ?? [];
      list.push(comforterId);
      claims.set(suspended, list);
    }
  }
  return claims;
}
