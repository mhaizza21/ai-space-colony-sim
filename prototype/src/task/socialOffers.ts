// M12 Social Offer State Storage — ADR-21 (Accepted 2026-07-17); behavior rules live in
// design/social-offer-response-protocol.md v0.2.0 and are wired in simulation/tick.ts. This
// module owns ONLY the storage surface ADR-21 decided: the store shape (D1), the offer record
// and its closed status/reason vocabulary with the exhaustive validity matrix (D2), the
// persisted-counter identity (D3), bounded retention (D4), and validate-never-repair load
// rules (D5). No PRNG, no snapshot reads, no goal-stack reads — pure state transforms only.
//
// Decision-input boundary (ADR-21 D4 / Invariant 8): resolved offers are read exclusively by
// serialization, replay comparison, and the inspector. The only simulation-behavior reads are
// tick.ts's Phase 6 resolution steps, and those read PENDING offers only (including the
// pending-per-responder guard, also a pending-only read). Nothing here exposes a resolved
// offer to decision code; adding such a read is an ADR-21 revision, not a code change.

import type { AmbientState } from "../config/constants.js";
import { assertSafeColonistId, type ColonistId } from "../colonist/relationships.js";

/** The closed offer-backed social actions (ADR-21 D2 as amended by ADR-24 D1 — Comfort-only Slice 7). */
export type SocialOfferAction = "conversation" | "sharedDowntime" | "comfort";
export const SOCIAL_OFFER_ACTIONS: readonly SocialOfferAction[] = ["conversation", "sharedDowntime", "comfort"];

/** The closed five-status machine (ADR-21 D2). "pending" is the only non-terminal status. */
export type SocialOfferStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";
export const SOCIAL_OFFER_STATUSES: readonly SocialOfferStatus[] = ["pending", "accepted", "declined", "cancelled", "expired"];

/**
 * The closed persisted reason union (ADR-21 D2) — each member traces to exactly one resolution
 * outcome in the approved design. No free text is ever persisted; display phrasing derives
 * from these codes. Adding a code is an ADR-21 revision.
 */
export type OfferResolutionReason =
  | "responderNotInRoster" // declined — design D4.1 eligibility failure
  | "responderNotInterruptible" // declined — design D4.2 eligibility failure
  | "relationshipGate" // declined — design D4.3 two-sided non-hostile gate failure
  | "acceptanceDraw" // declined — design D5 attributed PRNG draw fell above the acceptance probability
  | "initiatorUnavailable" // cancelled — design D6: offer-creating goal abandoned or replaced
  | "responderUnavailable" // cancelled — design D6: responder left roster / double-booking guard
  | "timeout"; // expired — design D6: clock reached expiresAtTick

/** ADR-21 D2's validity matrix, reason column: the per-status closed reason sets are disjoint. */
const REASONS_BY_STATUS: Readonly<Record<Exclude<SocialOfferStatus, "pending">, readonly OfferResolutionReason[]>> = {
  accepted: [],
  declined: ["responderNotInRoster", "responderNotInterruptible", "relationshipGate", "acceptanceDraw"],
  cancelled: ["initiatorUnavailable", "responderUnavailable"],
  expired: ["timeout"],
};
const ALL_REASONS: readonly OfferResolutionReason[] = [
  ...REASONS_BY_STATUS.declined,
  ...REASONS_BY_STATUS.cancelled,
  ...REASONS_BY_STATUS.expired,
];

/** One offer record (ADR-21 D2). Tick fields are fixed at creation — never re-derived from tuning. */
export interface SocialOffer {
  readonly id: number;
  readonly initiatorId: ColonistId;
  readonly responderId: ColonistId;
  readonly action: SocialOfferAction;
  readonly createdAtTick: number;
  readonly respondableAtTick: number;
  readonly expiresAtTick: number;
  readonly status: SocialOfferStatus;
  readonly resolvedAtTick: number | null;
  readonly reason: OfferResolutionReason | null;
}

/** The M12-owned top-level store (ADR-21 D1): append-ordered offers plus the persisted counter. */
export interface SocialOfferStore {
  readonly offers: readonly SocialOffer[];
  readonly nextOfferSequence: number;
}

/** Creates an empty store — no offers, counter at zero. */
export function createSocialOfferStore(): SocialOfferStore {
  return { offers: [], nextOfferSequence: 0 };
}

/**
 * Ambient states in which a responder can be offered company (design D4.2 — ADR-18 D4.3:
 * Conversation/Shared Downtime seek colonists in interruptible states). Closed here so the
 * eligibility read in tick.ts and any test agree on one definition.
 */
export const INTERRUPTIBLE_AMBIENT_STATES: readonly AmbientState[] = ["resting", "eating", "socializing"];

export function isInterruptibleAmbientState(state: string): boolean {
  return (INTERRUPTIBLE_AMBIENT_STATES as readonly string[]).includes(state);
}

/**
 * Action-keyed responder ambient-state eligibility (design D6 / ADR-24 D2).
 * Conversation/Shared Downtime keep the interruptible-ambient table; Comfort targets
 * `"stressed"` only — which is deliberately outside INTERRUPTIBLE_AMBIENT_STATES.
 */
export function isEligibleTargetState(action: SocialOfferAction, ambientState: string): boolean {
  switch (action) {
    case "conversation":
    case "sharedDowntime":
      return isInterruptibleAmbientState(ambientState);
    case "comfort":
      return ambientState === "stressed";
    default: {
      const unhandled: never = action;
      throw new Error(`unhandled social offer action: ${String(unhandled)}`);
    }
  }
}

/**
 * The goal key an offer's creating goal must carry (design D6's cancellation match) — derived
 * from the offer's own fields (goals.ts's `voluntary:social:` key scheme), never stored
 * (ADR-21 D2 declares no goalKey field; derivation cannot drift from the stored fields).
 */
export function offerGoalKey(offer: Pick<SocialOffer, "action" | "responderId">): string {
  return `voluntary:social:${offer.action}:${offer.responderId}`;
}

/**
 * Creates one pending offer (design D3; ADR-21 D3's persisted-counter identity). Structural
 * floors are enforced here, at the only write path that mints tick fields: a response delay
 * below 1 tick would collapse the offer back into same-tick auto-resolution, and a timeout at
 * or below the delay could expire an offer before it was ever respondable (ADR-21 D5 rejects
 * both shapes on load; creation must never produce them).
 */
export function createPendingOffer(args: {
  readonly store: SocialOfferStore;
  readonly initiatorId: ColonistId;
  readonly responderId: ColonistId;
  readonly action: SocialOfferAction;
  readonly createdAtTick: number;
  readonly responseDelayTicks: number;
  readonly offerTimeoutTicks: number;
}): { readonly store: SocialOfferStore; readonly offer: SocialOffer } {
  const { store, initiatorId, responderId, action, createdAtTick, responseDelayTicks, offerTimeoutTicks } = args;
  assertSafeColonistId(initiatorId, "initiatorId");
  assertSafeColonistId(responderId, "responderId");
  if (initiatorId === responderId) {
    throw new Error("a social offer requires two distinct colonists; self-offers are invalid (ADR-21 D5)");
  }
  if (!Number.isInteger(responseDelayTicks) || responseDelayTicks < 1) {
    throw new Error(`responseDelayTicks must be an integer >= 1 (design D3's structural floor), got ${responseDelayTicks}`);
  }
  if (!Number.isInteger(offerTimeoutTicks) || offerTimeoutTicks <= responseDelayTicks) {
    throw new Error(
      `offerTimeoutTicks (${offerTimeoutTicks}) must exceed responseDelayTicks (${responseDelayTicks}) — ` +
        `an offer must never expire before it is respondable (design D6)`,
    );
  }
  const offer: SocialOffer = {
    id: store.nextOfferSequence,
    initiatorId,
    responderId,
    action,
    createdAtTick,
    respondableAtTick: createdAtTick + responseDelayTicks,
    expiresAtTick: createdAtTick + offerTimeoutTicks,
    status: "pending",
    resolvedAtTick: null,
    reason: null,
  };
  return { store: { offers: [...store.offers, offer], nextOfferSequence: store.nextOfferSequence + 1 }, offer };
}

/**
 * Resolves one pending offer to a terminal status (design D3 steps 1/2/5/6). Enforces the
 * ADR-21 D2 validity matrix at the write: only a pending offer can transition; the reason must
 * belong to the target status's closed set (null exactly for "accepted"). Pure; the store's
 * append order (and therefore ascending-id processing order) is preserved.
 */
export function resolveOffer(
  store: SocialOfferStore,
  id: number,
  status: Exclude<SocialOfferStatus, "pending">,
  resolvedAtTick: number,
  reason: OfferResolutionReason | null,
): SocialOfferStore {
  const index = store.offers.findIndex((o) => o.id === id);
  if (index === -1) throw new Error(`no social offer with id ${id}`);
  const offer = store.offers[index]!;
  if (offer.status !== "pending") {
    throw new Error(`only a pending offer can resolve; offer ${id} is already "${offer.status}" (terminal statuses are final)`);
  }
  const allowed = REASONS_BY_STATUS[status];
  if (status === "accepted" ? reason !== null : reason === null || !allowed.includes(reason)) {
    throw new Error(
      `reason ${JSON.stringify(reason)} is outside status "${status}"'s closed set ` +
        `(${status === "accepted" ? "must be null" : allowed.join(", ")}) — ADR-21 D2 validity matrix`,
    );
  }
  const resolved: SocialOffer = { ...offer, status, resolvedAtTick, reason };
  return { ...store, offers: store.offers.map((o, i) => (i === index ? resolved : o)) };
}

/** The pending offer currently addressed to `responderId`, if any — a pending-only read (ADR-21 Invariant 8). */
export function activePendingOfferForResponder(store: SocialOfferStore, responderId: ColonistId): SocialOffer | undefined {
  return store.offers.find((o) => o.status === "pending" && o.responderId === responderId);
}

/**
 * Bounded retention (ADR-21 D4): pending offers are never evicted; resolved offers beyond
 * `retention` are evicted oldest-first (lowest id first — append order). Never renumbers
 * survivors and never rolls back the counter.
 */
export function evictResolvedOffers(store: SocialOfferStore, retention: number): SocialOfferStore {
  if (!Number.isInteger(retention) || retention < 0) {
    throw new Error(`resolved-offer retention must be a non-negative integer, got ${retention}`);
  }
  const resolvedCount = store.offers.filter((o) => o.status !== "pending").length;
  let toEvict = resolvedCount - retention;
  if (toEvict <= 0) return store;
  const offers = store.offers.filter((o) => {
    if (o.status === "pending" || toEvict <= 0) return true;
    toEvict -= 1;
    return false;
  });
  return { ...store, offers };
}

// --- Load validation (ADR-21 D5) — validate, never repair. Mirrors relationships.ts's build
// step 3 discipline: operates on already-parsed JSON values, throws on every malformed shape,
// never sorts/clamps/renumbers/drops. ---

function fail(reason: string): never {
  throw new Error(`Invalid social offer store: ${reason}`);
}

function expectObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`"${field}" must be an object`);
  return value as Record<string, unknown>;
}

function expectNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(`"${field}" must be a non-negative integer`);
  return value;
}

function expectNoUnknownKeys(o: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.has(key)) fail(`"${field}" has an unrecognized field "${key}"`);
  }
}

const STORE_KEYS: ReadonlySet<string> = new Set(["offers", "nextOfferSequence"]);
const OFFER_KEYS: ReadonlySet<string> = new Set([
  "id",
  "initiatorId",
  "responderId",
  "action",
  "createdAtTick",
  "respondableAtTick",
  "expiresAtTick",
  "status",
  "resolvedAtTick",
  "reason",
]);

/**
 * Restores a social offer store from its saved slice, enforcing every ADR-21 D5 rule —
 * including the full (status, resolvedAtTick, reason) validity matrix row by row, so every
 * status/reason combination is either matched by its row or rejected. `knownColonistIds` and
 * `loadedClockTick` come from the rest of the save the caller has already parsed.
 */
export function validateSocialOfferStore(
  raw: unknown,
  knownColonistIds: ReadonlySet<ColonistId>,
  loadedClockTick: number,
): SocialOfferStore {
  const o = expectObject(raw, "socialOffers");
  expectNoUnknownKeys(o, STORE_KEYS, "socialOffers");
  if (!Array.isArray(o.offers)) fail(`"socialOffers.offers" must be an array`);
  const nextOfferSequence = expectNonNegativeInteger(o.nextOfferSequence, "socialOffers.nextOfferSequence");

  const pendingResponders = new Set<ColonistId>();
  let previousId = -1;

  const offers: SocialOffer[] = o.offers.map((offerRaw, i) => {
    const field = `socialOffers.offers[${i}]`;
    const oo = expectObject(offerRaw, field);
    expectNoUnknownKeys(oo, OFFER_KEYS, field);

    const id = expectNonNegativeInteger(oo.id, `${field}.id`);
    if (id <= previousId) fail(`"${field}.id" (${id}) is out of ascending-id order (previous ${previousId})`);
    previousId = id;
    if (id >= nextOfferSequence) {
      fail(`"${field}.id" (${id}) is at or past nextOfferSequence (${nextOfferSequence}) — the counter must exceed every id it produced`);
    }

    const initiatorId = typeof oo.initiatorId === "string" ? oo.initiatorId : fail(`"${field}.initiatorId" must be a string`);
    const responderId = typeof oo.responderId === "string" ? oo.responderId : fail(`"${field}.responderId" must be a string`);
    if (initiatorId === responderId) fail(`"${field}" is a self-offer ("${initiatorId}") — self-offers are invalid`);
    if (!knownColonistIds.has(initiatorId)) fail(`"${field}.initiatorId" references an unknown colonist id "${initiatorId}"`);
    if (!knownColonistIds.has(responderId)) fail(`"${field}.responderId" references an unknown colonist id "${responderId}"`);

    if (typeof oo.action !== "string" || !(SOCIAL_OFFER_ACTIONS as readonly string[]).includes(oo.action)) {
      fail(`"${field}.action" has unrecognized value "${String(oo.action)}"`);
    }
    const action = oo.action as SocialOfferAction;

    const createdAtTick = expectNonNegativeInteger(oo.createdAtTick, `${field}.createdAtTick`);
    if (createdAtTick > loadedClockTick) fail(`"${field}.createdAtTick" (${createdAtTick}) postdates the loaded clock (${loadedClockTick})`);
    const respondableAtTick = expectNonNegativeInteger(oo.respondableAtTick, `${field}.respondableAtTick`);
    if (respondableAtTick <= createdAtTick) {
      fail(`"${field}.respondableAtTick" (${respondableAtTick}) must exceed createdAtTick (${createdAtTick}) — the one-tick response-delay floor`);
    }
    const expiresAtTick = expectNonNegativeInteger(oo.expiresAtTick, `${field}.expiresAtTick`);
    if (expiresAtTick <= respondableAtTick) {
      fail(`"${field}.expiresAtTick" (${expiresAtTick}) must exceed respondableAtTick (${respondableAtTick}) — an offer must not expire before it is respondable`);
    }

    if (typeof oo.status !== "string" || !(SOCIAL_OFFER_STATUSES as readonly string[]).includes(oo.status)) {
      fail(`"${field}.status" has unrecognized value "${String(oo.status)}"`);
    }
    const status = oo.status as SocialOfferStatus;

    if (oo.reason !== null && (typeof oo.reason !== "string" || !(ALL_REASONS as readonly string[]).includes(oo.reason))) {
      fail(`"${field}.reason" has unrecognized value "${String(oo.reason)}" — reasons are a closed union (ADR-21 D2)`);
    }
    const reason = oo.reason as OfferResolutionReason | null;

    // The exhaustive validity matrix (ADR-21 D2/D5): each status row is matched exactly.
    let resolvedAtTick: number | null = null;
    if (status === "pending") {
      if (oo.resolvedAtTick !== null) fail(`"${field}" is pending but carries a resolvedAtTick — pending offers are unresolved`);
      if (reason !== null) fail(`"${field}" is pending but carries a reason — pending offers are unresolved`);
      if (pendingResponders.has(responderId)) {
        fail(`more than one pending offer shares responderId "${responderId}" — one pending offer per responder (ADR-21 D5)`);
      }
      pendingResponders.add(responderId);
    } else {
      if (oo.resolvedAtTick === null) fail(`"${field}.resolvedAtTick" must be set for terminal status "${status}"`);
      resolvedAtTick = expectNonNegativeInteger(oo.resolvedAtTick, `${field}.resolvedAtTick`);
      if (resolvedAtTick < createdAtTick) fail(`"${field}.resolvedAtTick" (${resolvedAtTick}) precedes createdAtTick (${createdAtTick})`);
      if (resolvedAtTick > loadedClockTick) fail(`"${field}.resolvedAtTick" (${resolvedAtTick}) postdates the loaded clock (${loadedClockTick})`);
      const allowed = REASONS_BY_STATUS[status];
      if (status === "accepted") {
        if (reason !== null) fail(`"${field}" is accepted but carries a reason — accepted offers have a null reason (ADR-21 D2 matrix)`);
      } else if (reason === null || !allowed.includes(reason)) {
        fail(
          `"${field}.reason" ${JSON.stringify(reason)} is outside status "${status}"'s closed set (${allowed.join(", ")}) — ADR-21 D2 matrix`,
        );
      }
    }

    return { id, initiatorId, responderId, action, createdAtTick, respondableAtTick, expiresAtTick, status, resolvedAtTick, reason };
  });

  return { offers, nextOfferSequence };
}
