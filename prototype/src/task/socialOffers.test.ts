// Social offer store unit coverage (ADR-21; design D1-D2, D6, D8). Storage invariants,
// lifecycle transitions, and load-validation rules local to the module — tick wiring has its
// own integration coverage in simulation/tick.test.ts.

import { describe, expect, it } from "vitest";
import {
  activePendingOfferForResponder,
  createPendingOffer,
  createSocialOfferStore,
  evictResolvedOffers,
  isEligibleTargetState,
  offerGoalKey,
  resolveOffer,
  SOCIAL_OFFER_ACTIONS,
  validateSocialOfferStore,
  type SocialOffer,
  type SocialOfferStore,
} from "./socialOffers.js";

const KNOWN = new Set(["c1", "zeke", "mira"]);

function pending(overrides: Partial<SocialOffer> = {}): SocialOffer {
  return {
    id: 0,
    initiatorId: "c1",
    responderId: "zeke",
    action: "conversation",
    createdAtTick: 10,
    respondableAtTick: 11,
    expiresAtTick: 14,
    status: "pending",
    resolvedAtTick: null,
    reason: null,
    ...overrides,
  };
}

function storeOf(offers: SocialOffer[], nextOfferSequence?: number): SocialOfferStore {
  return { offers, nextOfferSequence: nextOfferSequence ?? offers.reduce((m, o) => Math.max(m, o.id), -1) + 1 };
}

describe("socialOffers store", () => {
  it("assigns monotonic ids and stores respondable/expires ticks explicitly", () => {
    const base = createSocialOfferStore();
    const first = createPendingOffer({
      store: base,
      initiatorId: "c1",
      responderId: "zeke",
      action: "conversation",
      createdAtTick: 10,
      responseDelayTicks: 1,
      offerTimeoutTicks: 4,
    });
    expect(first.offer.id).toBe(0);
    expect(first.offer.respondableAtTick).toBe(11);
    expect(first.offer.expiresAtTick).toBe(14);
    expect(first.offer.status).toBe("pending");
    expect(first.store.nextOfferSequence).toBe(1);

    const second = createPendingOffer({
      store: first.store,
      initiatorId: "c1",
      responderId: "mira",
      action: "sharedDowntime",
      createdAtTick: 12,
      responseDelayTicks: 1,
      offerTimeoutTicks: 4,
    });
    expect(second.offer.id).toBe(1);
    expect(second.store.nextOfferSequence).toBe(2);
  });

  it("enforces the structural response-delay floor and timeout > delay at creation", () => {
    const args = {
      store: createSocialOfferStore(),
      initiatorId: "c1",
      responderId: "zeke",
      action: "conversation" as const,
      createdAtTick: 10,
    };
    expect(() => createPendingOffer({ ...args, responseDelayTicks: 0, offerTimeoutTicks: 4 })).toThrow(/responseDelayTicks/);
    expect(() => createPendingOffer({ ...args, responseDelayTicks: 2, offerTimeoutTicks: 2 })).toThrow(/offerTimeoutTicks/);
  });

  it("rejects self-offers at creation", () => {
    expect(() =>
      createPendingOffer({
        store: createSocialOfferStore(),
        initiatorId: "c1",
        responderId: "c1",
        action: "conversation",
        createdAtTick: 0,
        responseDelayTicks: 1,
        offerTimeoutTicks: 4,
      }),
    ).toThrow(/self/i);
  });

  it("derives the offer-creating goal key without a stored field", () => {
    expect(offerGoalKey(pending())).toBe("voluntary:social:conversation:zeke");
    expect(offerGoalKey(pending({ action: "sharedDowntime", responderId: "mira" }))).toBe("voluntary:social:sharedDowntime:mira");
  });

  it("resolveOffer enforces the terminal validity matrix and pending-only transitions", () => {
    const store = storeOf([pending()]);
    const accepted = resolveOffer(store, 0, "accepted", 11, null);
    expect(accepted.offers[0]!.status).toBe("accepted");
    expect(accepted.offers[0]!.resolvedAtTick).toBe(11);
    // terminal offers never change again
    expect(() => resolveOffer(accepted, 0, "declined", 12, "acceptanceDraw")).toThrow(/pending/);
    // accepted must carry a null reason
    expect(() => resolveOffer(store, 0, "accepted", 11, "acceptanceDraw")).toThrow(/accepted/);
    // declined/cancelled/expired must carry a status-scoped reason
    expect(() => resolveOffer(store, 0, "declined", 11, null)).toThrow(/declined/);
    expect(() => resolveOffer(store, 0, "declined", 11, "timeout")).toThrow(/declined/);
    expect(() => resolveOffer(store, 0, "cancelled", 11, "relationshipGate")).toThrow(/cancelled/);
    expect(() => resolveOffer(store, 0, "expired", 14, "initiatorUnavailable")).toThrow(/expired/);
    expect(resolveOffer(store, 0, "expired", 14, "timeout").offers[0]!.reason).toBe("timeout");
  });

  it("activePendingOfferForResponder reads pending offers only", () => {
    const store = storeOf([
      { ...pending({ id: 0 }), status: "declined", resolvedAtTick: 11, reason: "acceptanceDraw" },
      pending({ id: 1, createdAtTick: 12, respondableAtTick: 13, expiresAtTick: 16 }),
    ]);
    expect(activePendingOfferForResponder(store, "zeke")?.id).toBe(1);
    expect(activePendingOfferForResponder(store, "mira")).toBeUndefined();
  });

  it("eviction is FIFO over resolved offers only and never rolls back the counter", () => {
    const offers: SocialOffer[] = [
      pending({ id: 0 }), // pending — must survive any retention
      { ...pending({ id: 1 }), status: "declined", resolvedAtTick: 11, reason: "acceptanceDraw" },
      { ...pending({ id: 2 }), status: "accepted", resolvedAtTick: 12, reason: null },
      { ...pending({ id: 3 }), status: "cancelled", resolvedAtTick: 13, reason: "initiatorUnavailable" },
    ];
    const store = storeOf(offers);
    const evicted = evictResolvedOffers(store, 2);
    expect(evicted.offers.map((o) => o.id)).toEqual([0, 2, 3]); // oldest resolved (id 1) evicted first
    expect(evicted.nextOfferSequence).toBe(4);
    const evictAll = evictResolvedOffers(store, 0);
    expect(evictAll.offers.map((o) => o.id)).toEqual([0]); // pending never evicted
    expect(evictAll.nextOfferSequence).toBe(4);
  });
});

describe("validateSocialOfferStore — validate-never-repair (ADR-21 D5)", () => {
  function raw(offers: unknown[], nextOfferSequence: number): unknown {
    return { offers, nextOfferSequence };
  }

  it("round-trips a well-formed store", () => {
    const store = storeOf([
      pending({ id: 0 }),
      { ...pending({ id: 1 }), responderId: "mira", status: "expired", resolvedAtTick: 14, reason: "timeout" },
    ]);
    expect(validateSocialOfferStore(JSON.parse(JSON.stringify(store)), KNOWN, 20)).toEqual(store);
  });

  it("rejects accepted offers with a non-null reason", () => {
    expect(() =>
      validateSocialOfferStore(raw([{ ...pending(), status: "accepted", resolvedAtTick: 12, reason: "acceptanceDraw" }], 1), KNOWN, 12),
    ).toThrow(/accepted/i);
  });

  it("rejects each terminal status with a null resolvedAtTick", () => {
    for (const [status, reason] of [
      ["accepted", null],
      ["declined", "acceptanceDraw"],
      ["cancelled", "initiatorUnavailable"],
      ["expired", "timeout"],
    ] as const) {
      expect(() => validateSocialOfferStore(raw([{ ...pending(), status, resolvedAtTick: null, reason }], 1), KNOWN, 20)).toThrow(
        /resolvedAtTick/,
      );
    }
  });

  it("rejects pending offers carrying resolution fields", () => {
    expect(() => validateSocialOfferStore(raw([{ ...pending(), resolvedAtTick: 11 }], 1), KNOWN, 20)).toThrow(/pending/);
    expect(() => validateSocialOfferStore(raw([{ ...pending(), reason: "timeout" }], 1), KNOWN, 20)).toThrow(/pending/);
  });

  it("rejects cross-status and unknown reason codes", () => {
    expect(() =>
      validateSocialOfferStore(raw([{ ...pending(), status: "declined", resolvedAtTick: 11, reason: "timeout" }], 1), KNOWN, 20),
    ).toThrow(/declined/);
    expect(() =>
      validateSocialOfferStore(raw([{ ...pending(), status: "expired", resolvedAtTick: 14, reason: "relationshipGate" }], 1), KNOWN, 20),
    ).toThrow(/expired/);
    expect(() =>
      validateSocialOfferStore(raw([{ ...pending(), status: "declined", resolvedAtTick: 11, reason: "becauseReasons" }], 1), KNOWN, 20),
    ).toThrow(/reason/);
  });

  it("rejects duplicate ids, ids at or past the counter, and out-of-order ids", () => {
    expect(() => validateSocialOfferStore(raw([pending({ id: 0 }), pending({ id: 0, responderId: "mira" })], 2), KNOWN, 20)).toThrow(
      /order|duplicate/i,
    );
    expect(() => validateSocialOfferStore(raw([pending({ id: 5 })], 5), KNOWN, 20)).toThrow(/nextOfferSequence/);
    expect(() =>
      validateSocialOfferStore(raw([pending({ id: 1 }), pending({ id: 0, responderId: "mira" })], 2), KNOWN, 20),
    ).toThrow(/order/i);
  });

  it("rejects unknown colonist ids, self-offers, and unknown actions", () => {
    expect(() => validateSocialOfferStore(raw([pending({ responderId: "ghost" })], 1), KNOWN, 20)).toThrow(/unknown colonist/);
    expect(() => validateSocialOfferStore(raw([pending({ initiatorId: "ghost" })], 1), KNOWN, 20)).toThrow(/unknown colonist/);
    expect(() => validateSocialOfferStore(raw([pending({ responderId: "c1" })], 1), KNOWN, 20)).toThrow(/self/i);
    expect(() => validateSocialOfferStore(raw([{ ...pending(), action: "confrontation" }], 1), KNOWN, 20)).toThrow(/action/);
  });

  it("rejects tick-field violations: delay floor, expiry ordering, clock bounds", () => {
    expect(() => validateSocialOfferStore(raw([pending({ respondableAtTick: 10 })], 1), KNOWN, 20)).toThrow(/respondableAtTick/);
    expect(() => validateSocialOfferStore(raw([pending({ expiresAtTick: 11 })], 1), KNOWN, 20)).toThrow(/expiresAtTick/);
    expect(() => validateSocialOfferStore(raw([pending({ createdAtTick: 30, respondableAtTick: 31, expiresAtTick: 34 })], 1), KNOWN, 20)).toThrow(
      /postdates/,
    );
    expect(() =>
      validateSocialOfferStore(
        raw([{ ...pending(), status: "accepted", resolvedAtTick: 25, reason: null }], 1),
        KNOWN,
        20,
      ),
    ).toThrow(/postdates/);
    expect(() =>
      validateSocialOfferStore(raw([{ ...pending(), status: "accepted", resolvedAtTick: 5, reason: null }], 1), KNOWN, 20),
    ).toThrow(/resolvedAtTick/);
  });

  it("rejects more than one pending offer per responder", () => {
    expect(() =>
      validateSocialOfferStore(
        raw([pending({ id: 0 }), pending({ id: 1, initiatorId: "mira" })], 2),
        KNOWN,
        20,
      ),
    ).toThrow(/pending/);
  });

  it("rejects unrecognized fields", () => {
    expect(() => validateSocialOfferStore(raw([{ ...pending(), derivedState: "positive" }], 1), KNOWN, 20)).toThrow(/unrecognized/);
    expect(() => validateSocialOfferStore({ offers: [], nextOfferSequence: 0, extra: 1 }, KNOWN, 20)).toThrow(/unrecognized/);
  });

  it("rejects assist as an out-of-union action", () => {
    expect(() =>
      validateSocialOfferStore(raw([{ ...pending(), action: "assist" }], 1), KNOWN, 20),
    ).toThrow(/action/);
  });
});

describe("ADR-24 Comfort offer action", () => {
  it("SOCIAL_OFFER_ACTIONS is closed at exactly three members and excludes assist", () => {
    expect(SOCIAL_OFFER_ACTIONS).toEqual(["conversation", "sharedDowntime", "comfort"]);
    expect(SOCIAL_OFFER_ACTIONS).not.toContain("assist");
  });

  it("isEligibleTargetState is action-keyed — comfort admits stressed only", () => {
    expect(isEligibleTargetState("comfort", "stressed")).toBe(true);
    expect(isEligibleTargetState("comfort", "resting")).toBe(false);
    expect(isEligibleTargetState("conversation", "resting")).toBe(true);
    expect(isEligibleTargetState("conversation", "stressed")).toBe(false);
    expect(isEligibleTargetState("sharedDowntime", "eating")).toBe(true);
  });

  it("createPendingOffer accepts comfort actions", () => {
    const created = createPendingOffer({
      store: createSocialOfferStore(),
      initiatorId: "c1",
      responderId: "zeke",
      action: "comfort",
      createdAtTick: 10,
      responseDelayTicks: 1,
      offerTimeoutTicks: 4,
    });
    expect(created.offer.action).toBe("comfort");
    expect(offerGoalKey(created.offer)).toBe("voluntary:social:comfort:zeke");
  });
});
