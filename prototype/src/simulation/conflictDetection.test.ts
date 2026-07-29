// Confrontation condition detection — design/confrontation-conflict-protocol.md §14 matrix
// (conjunction D1/D2, PRNG D4, multi-pair ordering D10).

import { describe, expect, it } from "vitest";
import { CONFLICT_TUNING, STRESS_TUNING } from "../config/tuning.js";
import { applyInteraction, createRelationshipStore } from "../colonist/relationships.js";
import { createPrng, next } from "../core/prng.js";
import {
  conflictSeverityForPair,
  detectConfrontations,
  evaluateConflictConjunction,
  type ConflictObservation,
} from "./conflictDetection.js";

function hostileStore(aId: string, bId: string, affinity = -50): ReturnType<typeof createRelationshipStore> {
  return applyInteraction(createRelationshipStore(), {
    colonistAId: aId,
    colonistBId: bId,
    tick: 0,
    changeSource: "directConflict",
    initiatorId: null,
    responderId: null,
    aTowardBDelta: affinity,
    bTowardADelta: affinity,
  }).store;
}

function fracturedStore(aId: string, bId: string): ReturnType<typeof createRelationshipStore> {
  return hostileStore(aId, bId, -80);
}

function obs(id: string, moduleId: ConflictObservation["moduleId"], stressLevel: number): ConflictObservation {
  return { id, moduleId, stressLevel };
}

describe("STRESS_TUNING conflict threshold structural invariant (design D2)", () => {
  it("fracturedConflictStressThreshold < hostileConflictStressThreshold", () => {
    expect(STRESS_TUNING.fracturedConflictStressThreshold).toBeLessThan(STRESS_TUNING.hostileConflictStressThreshold);
  });

  it("inConflictDisplayTicks structural floor is >= 1", () => {
    expect(CONFLICT_TUNING.inConflictDisplayTicks).toBeGreaterThanOrEqual(1);
  });
});

describe("evaluateConflictConjunction (design D1/D2)", () => {
  const a = obs("alice", "workstation", 0.7);
  const b = obs("bob", "workstation", 0.7);

  it("eligible when relationship OR-gate, shared module, and combined stress all hold", () => {
    const pair = evaluateConflictConjunction(a, b, hostileStore("alice", "bob"));
    expect(pair).toEqual({
      colonistAId: "alice",
      colonistBId: "bob",
      sharedModuleId: "workstation",
      combinedStress: 1.4,
      severity: "hostile",
    });
  });

  it("ineligible when relationship is not hostile/fractured either direction", () => {
    expect(evaluateConflictConjunction(a, b, createRelationshipStore())).toBeNull();
  });

  it("ineligible when modules differ", () => {
    expect(
      evaluateConflictConjunction(a, obs("bob", "foodStation", 0.7), hostileStore("alice", "bob")),
    ).toBeNull();
  });

  it("ineligible when either moduleId is null (idle / social — Finding 2)", () => {
    expect(
      evaluateConflictConjunction(obs("alice", null, 0.9), b, hostileStore("alice", "bob")),
    ).toBeNull();
    expect(
      evaluateConflictConjunction(a, obs("bob", null, 0.9), hostileStore("alice", "bob")),
    ).toBeNull();
  });

  it("ineligible when combined stress is below the severity-keyed threshold", () => {
    const low = obs("alice", "workstation", 0.4);
    const lowB = obs("bob", "workstation", 0.4); // sum 0.8 < hostile 1.3
    expect(evaluateConflictConjunction(low, lowB, hostileStore("alice", "bob"))).toBeNull();
  });

  it("Fractured pairs become eligible at a strictly lower combined stress than Hostile-only", () => {
    const midA = obs("alice", "workstation", 0.5);
    const midB = obs("bob", "workstation", 0.5); // sum 1.0: above fractured 0.9, below hostile 1.3
    expect(evaluateConflictConjunction(midA, midB, hostileStore("alice", "bob"))).toBeNull();
    expect(evaluateConflictConjunction(midA, midB, fracturedStore("alice", "bob"))).not.toBeNull();
    expect(evaluateConflictConjunction(midA, midB, fracturedStore("alice", "bob"))!.severity).toBe("fractured");
  });

  it("one-sided hostile qualifies via OR-gate; Fractured either side keys the lower threshold", () => {
    const oneSided = applyInteraction(createRelationshipStore(), {
      colonistAId: "alice",
      colonistBId: "bob",
      tick: 0,
      changeSource: "directConflict",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: -50,
      bTowardADelta: 0,
    }).store;
    expect(conflictSeverityForPair(oneSided, "alice", "bob")).toBe("hostile");
    const mixed = applyInteraction(createRelationshipStore(), {
      colonistAId: "alice",
      colonistBId: "bob",
      tick: 0,
      changeSource: "directConflict",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: -80,
      bTowardADelta: -50,
    }).store;
    expect(conflictSeverityForPair(mixed, "alice", "bob")).toBe("fractured");
  });

  it("emits canonical (min, max) id order regardless of argument order", () => {
    const pair = evaluateConflictConjunction(b, a, hostileStore("alice", "bob"));
    expect(pair!.colonistAId).toBe("alice");
    expect(pair!.colonistBId).toBe("bob");
  });
});

describe("detectConfrontations PRNG (design D4 / D10)", () => {
  it("an eligible pair consumes exactly one draw; an ineligible pair consumes zero", () => {
    const observations = [
      obs("alice", "workstation", 0.7),
      obs("bob", "workstation", 0.7),
      obs("carol", null, 0.9), // null module — never eligible with anyone
    ];
    const start = createPrng(1);
    const result = detectConfrontations(observations, hostileStore("alice", "bob"), start, 1);
    expect(result.eligible).toHaveLength(1);
    expect(result.prng.draws).toBe(start.draws + 1);
    // carol pairs with alice/bob are ineligible — no extra draws
    expect(result.eligible[0]!.colonistAId).toBe("alice");
  });

  it("fire when draw < probability; no fire at or above", () => {
    const observations = [obs("alice", "workstation", 0.7), obs("bob", "workstation", 0.7)];
    const always = detectConfrontations(observations, hostileStore("alice", "bob"), createPrng(1), 1);
    expect(always.fired).toHaveLength(1);
    const never = detectConfrontations(observations, hostileStore("alice", "bob"), createPrng(1), 0);
    expect(never.fired).toHaveLength(0);
    expect(never.eligible).toHaveLength(1);
  });

  it("different seeds can change fire outcomes but not eligibility", () => {
    const observations = [obs("alice", "workstation", 0.7), obs("bob", "workstation", 0.7)];
    const store = hostileStore("alice", "bob");
    const a = detectConfrontations(observations, store, createPrng(1), 0.5);
    const b = detectConfrontations(observations, store, createPrng(999), 0.5);
    expect(a.eligible).toEqual(b.eligible);
    // At least confirm both ran one draw
    expect(a.prng.draws).toBe(1);
    expect(b.prng.draws).toBe(1);
  });

  it("multi-pair ordering is fixed (min, max) regardless of observation list starting point", () => {
    // Three colonists sharing workstation; alice-bob and alice-carol hostile, bob-carol not.
    // Eligible pairs: (alice,bob), (alice,carol) — in that canonical order.
    let store = applyInteraction(createRelationshipStore(), {
      colonistAId: "alice",
      colonistBId: "bob",
      tick: 0,
      changeSource: "directConflict",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: -50,
      bTowardADelta: -50,
    }).store;
    store = applyInteraction(store, {
      colonistAId: "alice",
      colonistBId: "carol",
      tick: 0,
      changeSource: "directConflict",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: -50,
      bTowardADelta: -50,
    }).store;

    const forward = [
      obs("alice", "workstation", 0.7),
      obs("bob", "workstation", 0.7),
      obs("carol", "workstation", 0.7),
    ];
    // Same colonists, different array construction order but still sorted for the API contract
    const sorted = [...forward].sort((x, y) => (x.id < y.id ? -1 : 1));
    const r1 = detectConfrontations(sorted, store, createPrng(42), 1);
    const r2 = detectConfrontations(sorted, store, createPrng(42), 1);
    expect(r1.eligible.map((p) => [p.colonistAId, p.colonistBId])).toEqual([
      ["alice", "bob"],
      ["alice", "carol"],
    ]);
    expect(r1.fired.map((p) => [p.colonistAId, p.colonistBId])).toEqual(r2.fired.map((p) => [p.colonistAId, p.colonistBId]));

    // Draw sequence matches sequential next() from same seed
    let prng = createPrng(42);
    const d1 = next(prng);
    prng = d1.state;
    const d2 = next(prng);
    expect(r1.fired[0]!.drawValue).toBe(d1.value);
    expect(r1.fired[1]!.drawValue).toBe(d2.value);
  });
});
