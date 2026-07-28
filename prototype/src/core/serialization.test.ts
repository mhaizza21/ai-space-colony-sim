// Build Step 9 — core/serialization.ts tests: complete-state round-trip, deterministic replay
// continuation after save/load (including mid-execution and suspended-pair scenarios), version
// rejection, malformed-input rejection, purity.
//
// Step 9 review pass — deep TickEvent/DecisionOutcome payload validation, log seq/tick
// invariants: these tests deliberately corrupt a *valid* saved object's nested payload (not
// just top-level fields), reusing a real run's output so the fixtures reflect actual shapes.

import { describe, expect, it } from "vitest";
import { createInitialState, run } from "../simulation/run.js";
import { tick, type SimulationState } from "../simulation/tick.js";
import { BASE_TICKS_PER_STEP } from "../config/constants.js";
import { setModuleFunctional } from "../world/world.js";
import { suspendGoal, type Goal } from "../decision/goals.js";
import type { Execution } from "../task/execution.js";
import { MEMORY_TUNING } from "../config/tuning.js";
import { applyInteraction, createRelationshipStore } from "../colonist/relationships.js";
import type { ColonistIdentity } from "../colonist/colonist.js";
import { createPendingOffer } from "../task/socialOffers.js";
import { deserialize, SAVE_FORMAT_VERSION, serialize } from "./serialization.js";

// reason: these fixtures are deliberately mutated into shapes deserialize() must REJECT (a
// missing field, a wrong enum, a corrupted nested payload) — that is the entire point of this
// test file. Typing them as parsed-save data would fight the tests' own purpose: every
// "corrupt this field" assignment below would need an unsafe cast anyway, in the opposite
// direction from where safety matters (the code under test, not the fixture). `unknown` would
// only push the same casts one line later. Named once here so every occurrence traces to this
// explanation rather than repeating it.
type RawSave = any;

/**
 * A real, valid saved object (parsed) — a run long enough to guarantee at least one decision
 * AND at least one needThresholdCrossing (hunger crosses its low threshold ~tick 545 at its
 * decayPerTick, uninterrupted — see config/tuning.ts).
 */
function validSaved(): RawSave {
  const state = run(createInitialState(1, "c1", "Maya", ["engineering"], ["driven"]), 700).finalState;
  expect(state.decisionLog.length).toBeGreaterThan(0); // sanity: fixture actually has a decision to corrupt
  return JSON.parse(serialize(state));
}

describe("complete state round-trip", () => {
  it("deserialize(serialize(state)) reproduces the state exactly", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"], ["driven"]), 200).finalState;
    const roundTripped = deserialize(serialize(state));
    expect(roundTripped).toEqual(state);
  });

  it("round-trips an untouched initial state (empty logs, no execution)", () => {
    const state = createInitialState(7, "c1", "Maya");
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it("round-trips a goal with relatedColonistId (social voluntary goal survives save/load)", () => {
    const base = createInitialState(7, "c1", "Maya");
    const socialGoal: Goal = {
      source: "voluntary",
      tier: 5,
      key: "voluntary:social:conversation:npc-42",
      relatedColonistId: "npc-42",
      relatedSocialTaskId: "conversation",
      status: "active",
      motivation: "free-time social candidate",
      adoptedAtTick: 0,
    };
    const seeded = createInitialState(7, "c1", "Maya", [], [], [{ id: "npc-42", name: "NPC 42", skills: [], baseTraits: [] }]);
    const withSocialGoal: SimulationState = {
      ...seeded,
      colonists: [{ ...seeded.colonists[0]!, colonist: { ...seeded.colonists[0]!.colonist, currentGoal: socialGoal } }, seeded.colonists[1]!],
    };
    const reloaded = deserialize(serialize(withSocialGoal));
    expect(reloaded.colonists[0]!.colonist.currentGoal).toEqual(socialGoal);
    expect(reloaded.colonists[0]!.colonist.currentGoal?.relatedColonistId).toBe("npc-42");
  });
});

describe("multi-colonist roster + relationship pair round-trip (Stage 2 Slice 2)", () => {
  const zeke: ColonistIdentity = { id: "zeke", name: "Zeke", skills: ["engineering"], baseTraits: ["driven"] };
  const yara: ColonistIdentity = { id: "yara", name: "Yara", skills: [], baseTraits: ["gregarious"] };

  it("round-trips a 3-entry colonist collection", () => {
    const state = createInitialState(1, "c1", "Maya", [], [], [zeke, yara]);
    const reloaded = deserialize(serialize(state));
    expect(reloaded.colonists.map((r) => r.colonist.identity.id)).toEqual(["c1", "yara", "zeke"]);
    expect(reloaded).toEqual(state);
  });

  it("round-trips a materialized two-party relationship pair against a real roster member (the original single-colonist limitation is lifted)", () => {
    const base = createInitialState(1, "c1", "Maya", [], [], [zeke]);
    const relationships = applyInteraction(base.relationships, {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "c1",
      responderId: "zeke",
      aTowardBDelta: 20,
      bTowardADelta: 15,
    }).store;
    const state: SimulationState = { ...base, relationships };
    const reloaded = deserialize(serialize(state));
    expect(reloaded.relationships).toEqual(relationships);
    expect(reloaded.relationships.pairs["c1"]!["zeke"]!.minTowardMaxAffinity).toBe(20);
  });

  it("still rejects a relationship pair naming a colonist id outside the collection", () => {
    const base = createInitialState(1, "c1", "Maya", [], [], [zeke]); // collection has c1+zeke, not yara
    const relationships = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "yara",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "c1",
      responderId: "yara",
      aTowardBDelta: 10,
      bTowardADelta: 10,
    }).store;
    const state: SimulationState = { ...base, relationships };
    expect(() => deserialize(serialize(state))).toThrow(/unknown colonist id/);
  });

  it("accepts a relationship pair between two non-first collection entries (ADR-22: no privileged colonist)", () => {
    const base = createInitialState(1, "c1", "Maya", [], [], [zeke, yara]);
    const relationships = applyInteraction(createRelationshipStore(), {
      colonistAId: "zeke",
      colonistBId: "yara",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "zeke",
      responderId: "yara",
      aTowardBDelta: 10,
      bTowardADelta: 10,
    }).store;
    const state: SimulationState = { ...base, relationships };
    expect(deserialize(serialize(state)).relationships).toEqual(relationships);
  });

  it("a real run with a 3-entry collection still round-trips exactly after ticks advance", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"], [], [zeke, yara]), 200).finalState;
    expect(state.colonists).toHaveLength(3);
    expect(deserialize(serialize(state))).toEqual(state);
  });
});

describe("social offer store round-trip and validation (Stage 2 Slice 5, ADR-21 D5)", () => {
  const zeke: ColonistIdentity = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] };

  function savedWithOffer(offer: Record<string, unknown>, nextOfferSequence = 1): RawSave {
    const state = createInitialState(7, "c1", "Maya", [], [], [zeke]);
    const saved: RawSave = JSON.parse(serialize({ ...state, clock: { ...state.clock, tick: 100 } }));
    saved.socialOffers = { offers: [offer], nextOfferSequence };
    return saved;
  }

  const pendingOffer = {
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
  };

  it("round-trips a pending social offer without recomputing its ticks or reason", () => {
    const saved = savedWithOffer(pendingOffer);
    const reloaded = deserialize(JSON.stringify(saved));
    expect(reloaded.socialOffers.offers).toEqual([pendingOffer]);
    expect(reloaded.socialOffers.nextOfferSequence).toBe(1);
  });

  it("round-trips every terminal status", () => {
    for (const [status, reason] of [
      ["accepted", null],
      ["declined", "acceptanceDraw"],
      ["cancelled", "initiatorUnavailable"],
      ["expired", "timeout"],
    ] as const) {
      const saved = savedWithOffer({ ...pendingOffer, status, resolvedAtTick: 12, reason });
      const reloaded = deserialize(JSON.stringify(saved));
      expect(reloaded.socialOffers.offers[0]!.status).toBe(status);
      expect(reloaded.socialOffers.offers[0]!.reason).toBe(reason);
    }
  });

  it("rejects unknown reason codes", () => {
    expect(() =>
      deserialize(JSON.stringify(savedWithOffer({ ...pendingOffer, status: "declined", resolvedAtTick: 12, reason: "she said no" }))),
    ).toThrow(/reason/);
  });

  it("rejects accepted offers carrying a reason (validity matrix)", () => {
    expect(() =>
      deserialize(JSON.stringify(savedWithOffer({ ...pendingOffer, status: "accepted", resolvedAtTick: 12, reason: "acceptanceDraw" }))),
    ).toThrow(/accepted/);
  });

  it("rejects an offer referencing an unknown colonist id", () => {
    expect(() => deserialize(JSON.stringify(savedWithOffer({ ...pendingOffer, responderId: "ghost" })))).toThrow(/unknown colonist/);
  });

  it("rejects a counter at or below the highest stored id", () => {
    expect(() => deserialize(JSON.stringify(savedWithOffer(pendingOffer, 0)))).toThrow(/nextOfferSequence/);
  });

  it("rejects a missing socialOffers slice outright (no repair to an empty store)", () => {
    const saved = savedWithOffer(pendingOffer);
    delete saved.socialOffers;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/socialOffers/);
  });
});

describe("deterministic replay after save/load", () => {
  it("save mid-execution and continue identically to an uninterrupted run", () => {
    const initial = createInitialState(42, "c1", "Maya", ["engineering"]);
    const midpoint = run(initial, 100).finalState;
    expect(midpoint.colonists[0]!.execution).not.toBeNull(); // sanity: something is actually in progress by tick 100

    const reloaded = deserialize(serialize(midpoint));
    const continuedFromReload = run(reloaded, 100);
    const continuedLive = run(midpoint, 100);

    expect(continuedFromReload.finalState).toEqual(continuedLive.finalState);
    expect(continuedFromReload.events).toEqual(continuedLive.events);
  });

  it("PRNG sequence continues identically after load", () => {
    const midpoint = run(createInitialState(9, "c1", "Maya"), 60).finalState;
    const reloaded = deserialize(serialize(midpoint));
    expect(reloaded.prng).toEqual(midpoint.prng);

    const afterReload = tick(reloaded, BASE_TICKS_PER_STEP);
    const afterLive = tick(midpoint, BASE_TICKS_PER_STEP);
    expect(afterReload.state.prng).toEqual(afterLive.state.prng);
  });

  it("save with suspended goal/execution and continue identically", () => {
    const base = createInitialState(5, "c1", "Maya");
    const suspendedGoal: Goal = suspendGoal({
      source: "shiftAssignment",
      tier: 3,
      key: "shiftAssignment:work",
      status: "active",
      motivation: "test fixture",
      adoptedAtTick: 0,
    });
    const suspendedExecution: Execution = {
      taskId: "workAtWorkstation",
      goalKey: "shiftAssignment:work",
      status: "interrupted",
      startedAtTick: 0,
      elapsedTicks: 5,
    };
    const withSuspension: SimulationState = {
      ...base,
      colonists: [{ ...base.colonists[0]!, colonist: { ...base.colonists[0]!.colonist, suspendedGoal }, suspendedExecution }],
    };

    const reloaded = deserialize(serialize(withSuspension));
    expect(reloaded).toEqual(withSuspension);

    const continuedFromReload = run(reloaded, 10);
    const continuedLive = run(withSuspension, 10);
    expect(continuedFromReload.finalState).toEqual(continuedLive.finalState);
    expect(continuedFromReload.events).toEqual(continuedLive.events);
  });

  it("records remain append-only after load — the reloaded log has exactly the saved entries, and appending continues from there", () => {
    const midpoint = run(createInitialState(3, "c1", "Maya"), 30).finalState;
    const reloaded = deserialize(serialize(midpoint));
    expect(reloaded.eventLog).toEqual(midpoint.eventLog);
    expect(reloaded.decisionLog).toEqual(midpoint.decisionLog);

    const next = tick(reloaded, BASE_TICKS_PER_STEP);
    expect(next.state.eventLog.length).toBeGreaterThan(reloaded.eventLog.length);
    expect(next.state.eventLog.slice(0, reloaded.eventLog.length)).toEqual(reloaded.eventLog);
  });
});

describe("unsupported version rejection", () => {
  it("rejects a version other than the current SAVE_FORMAT_VERSION", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved = JSON.parse(serialize(state)) as Record<string, unknown>;
    saved.version = SAVE_FORMAT_VERSION + 1;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/Unsupported save format version/);
  });

  it("rejects a missing version field", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete saved.version;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a v6 save at the version gate (not a field error)", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved = JSON.parse(serialize(state)) as Record<string, unknown>;
    saved.version = 6;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/Unsupported save format version: 6 \(expected 7\)/);
  });
});

describe("ADR-24 Comfort / Assist persistence pins", () => {
  it("round-trips a pending Comfort offer bit-identically", () => {
    const state = createInitialState(1, "c1", "Maya", [], [], [{ id: "zeke", name: "Zeke", skills: [], baseTraits: [] }]);
    const created = createPendingOffer({
      store: state.socialOffers,
      initiatorId: "c1",
      responderId: "zeke",
      action: "comfort",
      createdAtTick: 0,
      responseDelayTicks: 1,
      offerTimeoutTicks: 4,
    });
    const withOffer = { ...state, socialOffers: created.store };
    const reloaded = deserialize(serialize(withOffer));
    expect(reloaded.socialOffers).toEqual(withOffer.socialOffers);
    expect(reloaded.socialOffers.offers[0]?.action).toBe("comfort");
  });

  it("rejects assist in socialOffers.offers[].action on load", () => {
    const state = createInitialState(1, "c1", "Maya", [], [], [{ id: "zeke", name: "Zeke", skills: [], baseTraits: [] }]);
    const saved = JSON.parse(serialize(state)) as Record<string, unknown>;
    const socialOffers = saved.socialOffers as { offers: unknown[]; nextOfferSequence: number };
    socialOffers.offers = [
      {
        id: 0,
        initiatorId: "c1",
        responderId: "zeke",
        action: "assist",
        createdAtTick: 10,
        respondableAtTick: 11,
        expiresAtTick: 14,
        status: "pending",
        resolvedAtTick: null,
        reason: null,
      },
    ];
    socialOffers.nextOfferSequence = 1;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/action/);
  });

  it("rejects relatedSocialTaskId assist on a persisted goal", () => {
    const state = createInitialState(1, "c1", "Maya", [], [], [{ id: "zeke", name: "Zeke", skills: [], baseTraits: [] }]);
    const saved = JSON.parse(serialize(state)) as {
      colonists: Array<{ colonist: { currentGoal: Record<string, unknown> | null } }>;
    };
    saved.colonists[0]!.colonist.currentGoal = {
      source: "voluntary",
      tier: 5,
      key: "voluntary:social:assist:zeke",
      relatedColonistId: "zeke",
      relatedSocialTaskId: "assist",
      status: "active",
      motivation: "x",
      adoptedAtTick: 0,
    };
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/relatedSocialTaskId/);
  });
});

describe("malformed-state rejection", () => {
  it("rejects invalid JSON outright", () => {
    expect(() => deserialize("{not valid json")).toThrow();
  });

  it("rejects a non-object top level", () => {
    expect(() => deserialize("42")).toThrow();
  });

  it("rejects a missing required field", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete saved.colonists;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a wrong-typed field rather than coercing it", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved: RawSave = JSON.parse(serialize(state));
    saved.colonists[0].stressBaseline = "not a number";
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a malformed suspended-pair invariant (suspendedExecution without a suspendedGoal), never silently repairing it", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved: RawSave = JSON.parse(serialize(state));
    saved.colonists[0].suspendedExecution = {
      taskId: "workAtWorkstation",
      goalKey: "shiftAssignment:work",
      status: "interrupted",
      startedAtTick: 0,
      elapsedTicks: 1,
    };
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects an unrecognized enum value instead of guessing", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved = JSON.parse(serialize(state)) as { world: { modules: Record<string, { functional: boolean }> } };
    (saved.world.modules as unknown as Record<string, unknown>).foodStation = { id: "foodStation", functional: "yes" };
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("REGRESSION (Copilot-confirmed): rejects an unrecognized trait id in baseTraits instead of casting it through", () => {
    const state = createInitialState(1, "c1", "Maya", ["engineering"], ["driven"]);
    const saved: RawSave = JSON.parse(serialize(state));
    saved.colonists[0].colonist.identity.baseTraits = ["unknown"];
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/unrecognized value/);
  });

  it("REGRESSION (Copilot-confirmed): rejects a need level outside [0, 1]", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved: RawSave = JSON.parse(serialize(state));
    saved.colonists[0].colonist.needs.hunger.level = -10;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("REGRESSION (Copilot-confirmed): rejects a negative or fractional ticksBelowLow", () => {
    const state = createInitialState(1, "c1", "Maya");
    const negative: RawSave = JSON.parse(serialize(state));
    negative.colonists[0].colonist.needs.rest.ticksBelowLow = -5;
    expect(() => deserialize(JSON.stringify(negative))).toThrow();

    const fractional: RawSave = JSON.parse(serialize(state));
    fractional.colonists[0].colonist.needs.rest.ticksBelowLow = 1.5;
    expect(() => deserialize(JSON.stringify(fractional))).toThrow();
  });

  it("REGRESSION (Copilot-confirmed): rejects an inconsistent ACTIVE goal/execution pair at the save boundary", () => {
    const midpoint = run(createInitialState(42, "c1", "Maya", ["engineering"]), 100).finalState;
    expect(midpoint.colonists[0]!.execution).not.toBeNull(); // sanity: the fixture actually has an active pair to corrupt

    const mismatchedKey: RawSave = JSON.parse(serialize(midpoint));
    mismatchedKey.colonists[0].execution.goalKey = "lowNeed:social"; // no longer names the current goal
    expect(() => deserialize(JSON.stringify(mismatchedKey))).toThrow(/goalKey/);

    const orphaned: RawSave = JSON.parse(serialize(midpoint));
    orphaned.colonists[0].colonist.currentGoal = null; // execution left running for no goal at all
    expect(() => deserialize(JSON.stringify(orphaned))).toThrow(/currentGoal/);

    const blockedGoal: RawSave = JSON.parse(serialize(midpoint));
    blockedGoal.colonists[0].colonist.currentGoal.status = "blocked"; // an execution cannot serve a blocked goal
    expect(() => deserialize(JSON.stringify(blockedGoal))).toThrow(/active/);

    const notInProgress: RawSave = JSON.parse(serialize(midpoint));
    notInProgress.colonists[0].execution.status = "completed"; // the active slot never retains a finished execution
    expect(() => deserialize(JSON.stringify(notInProgress))).toThrow(/inProgress/);
  });

  it("rejects a collection entry with an unrecognized trait id (Stage 2 Slice 6a)", () => {
    const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] };
    const saved: RawSave = JSON.parse(serialize(createInitialState(1, "c1", "Maya", [], [], [zeke])));
    saved.colonists[1].colonist.identity.baseTraits = ["unknown"];
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/unrecognized value/);
  });

  it("rejects a collection entry missing a required identity field", () => {
    const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] };
    const saved: RawSave = JSON.parse(serialize(createInitialState(1, "c1", "Maya", [], [], [zeke])));
    delete saved.colonists[1].colonist.identity.name;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects duplicate colonist ids in the collection (ADR-22 D4 cross-field invariant)", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved: RawSave = JSON.parse(serialize(state));
    saved.colonists = [saved.colonists[0], saved.colonists[0]];
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/canonical ascending id order/);
  });

  it("rejects an out-of-order collection (ADR-22 D4)", () => {
    const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] };
    const saved: RawSave = JSON.parse(serialize(createInitialState(1, "c1", "Maya", [], [], [zeke])));
    saved.colonists = [saved.colonists[1], saved.colonists[0]];
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/canonical ascending id order/);
  });

  it("rejects an empty collection (ADR-22 D4)", () => {
    const state = createInitialState(1, "c1", "Maya");
    const saved: RawSave = JSON.parse(serialize(state));
    saved.colonists = [];
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/non-empty/);
  });
});

describe("memory-pool validation (Copilot-confirmed): the memory module's own contracts enforced at the save boundary", () => {
  /** A valid saved object carrying `entries` as the colonist's memory pool, clock at `clockTick`. */
  function savedWithMemory(entries: readonly Record<string, unknown>[], clockTick = 0): RawSave {
    const state = createInitialState(1, "c1", "Maya");
    const saved: RawSave = JSON.parse(serialize(state));
    saved.clock.tick = clockTick;
    saved.colonists[0].colonist.memory = entries;
    return saved;
  }

  function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: 0, type: "deprivation", context: { needId: "hunger" }, formedAtTick: 0, impact: 0.5, ...overrides };
  }

  it("accepts a valid pool (positive control), up to exactly the configured capacity", () => {
    const atCapacity = Array.from({ length: MEMORY_TUNING.poolSize }, (_, i) => entry({ id: i }));
    const loaded = deserialize(JSON.stringify(savedWithMemory(atCapacity)));
    expect(loaded.colonists[0]!.colonist.memory.length).toBe(MEMORY_TUNING.poolSize);
  });

  it("rejects a fractional or negative memory id (memory ids are non-negative integers, assigned in formation order)", () => {
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ id: 1.5 })])))).toThrow(/id/);
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ id: -1 })])))).toThrow(/id/);
  });

  it("rejects duplicate memory ids", () => {
    const duplicated = [entry({ id: 3 }), entry({ id: 3, type: "condition", context: { direction: "rising" } })];
    expect(() => deserialize(JSON.stringify(savedWithMemory(duplicated)))).toThrow(/duplicates id 3/);
  });

  it("rejects a fractional or negative formedAtTick", () => {
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ formedAtTick: 0.5 })])))).toThrow(/formedAtTick/);
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ formedAtTick: -1 })])))).toThrow(/formedAtTick/);
  });

  it("rejects a formedAtTick that postdates the saved clock — a future memory would make influence() throw mid-continuation", () => {
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ formedAtTick: 6 })], 5)))).toThrow(/postdates/);
    // The boundary itself stays valid: formed on the save's current tick.
    const atBoundary = deserialize(JSON.stringify(savedWithMemory([entry({ formedAtTick: 5 })], 5)));
    expect(atBoundary.colonists[0]!.colonist.memory[0]!.formedAtTick).toBe(5);
  });

  it("rejects an impact outside the fixed-at-formation [0, 1] range", () => {
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ impact: 1.5 })])))).toThrow(/impact/);
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ impact: -0.1 })])))).toThrow(/impact/);
  });

  it("rejects a pool over the configured capacity (bound owned by MEMORY_TUNING, not re-declared)", () => {
    const overCapacity = Array.from({ length: MEMORY_TUNING.poolSize + 1 }, (_, i) => entry({ id: i }));
    expect(() => deserialize(JSON.stringify(savedWithMemory(overCapacity)))).toThrow(/capacity/);
  });

  it("still rejects malformed memory-type-specific fields (pre-existing checks unchanged)", () => {
    expect(() => deserialize(JSON.stringify(savedWithMemory([entry({ context: { needId: "notANeed" } })])))).toThrow(/unrecognized/);
    const badDirection = entry({ type: "condition", context: { direction: "sideways" } });
    expect(() => deserialize(JSON.stringify(savedWithMemory([badDirection])))).toThrow(/unrecognized/);
  });
});

describe("deep TickEvent payload validation", () => {
  it("rejects an unknown TickEvent kind", () => {
    const saved = validSaved();
    saved.eventLog[0].event.kind = "somethingThatDoesNotExist";
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/unrecognized value/);
  });

  it("rejects a known TickEvent kind with a missing required field", () => {
    const saved = validSaved();
    const idx = saved.eventLog.findIndex((r: RawSave) => r.event.kind === "executionBegun");
    expect(idx).toBeGreaterThanOrEqual(0); // sanity: fixture actually reaches executionBegun
    delete saved.eventLog[idx].event.taskId;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a needThresholdCrossing with an out-of-set severity", () => {
    const saved = validSaved();
    const idx = saved.eventLog.findIndex((r: RawSave) => r.event.kind === "needThresholdCrossing");
    expect(idx).toBeGreaterThanOrEqual(0);
    saved.eventLog[idx].event.severity = "extreme";
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a negative elapsedTicks on executionProgressed", () => {
    const saved = validSaved();
    const idx = saved.eventLog.findIndex((r: RawSave) => r.event.kind === "executionProgressed");
    expect(idx).toBeGreaterThanOrEqual(0);
    saved.eventLog[idx].event.elapsedTicks = -1;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a non-integer elapsedTicks on executionProgressed", () => {
    const saved = validSaved();
    const idx = saved.eventLog.findIndex((r: RawSave) => r.event.kind === "executionProgressed");
    expect(idx).toBeGreaterThanOrEqual(0);
    saved.eventLog[idx].event.elapsedTicks = 1.5;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });
});

describe("deep DecisionOutcome payload validation", () => {
  function firstDecisionEvent(saved: RawSave): RawSave {
    const record = saved.eventLog.find((r: RawSave) => r.event.kind === "decision");
    expect(record).toBeDefined();
    return record.event;
  }

  it("rejects a malformed DecisionOutcome kind", () => {
    const saved = validSaved();
    firstDecisionEvent(saved).outcome.kind = "maybe";
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a decision outcome missing a required top-level field (goal)", () => {
    const saved = validSaved();
    const outcome = firstDecisionEvent(saved).outcome;
    expect(outcome.kind).toBe("commit"); // sanity: a "commit" outcome actually carries `goal`
    delete outcome.goal;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a missing weight-decomposition field (traitContributions) on a composed weight", () => {
    const saved = validSaved();
    const outcome = firstDecisionEvent(saved).outcome;
    expect(outcome.composedWeights.length).toBeGreaterThan(0);
    delete outcome.composedWeights[0].traitContributions;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a composed weight with an out-of-set source", () => {
    const saved = validSaved();
    const outcome = firstDecisionEvent(saved).outcome;
    outcome.composedWeights[0].source = "notASource";
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a non-finite numeric field encoded through constructed input (Infinity serializes to null via JSON)", () => {
    const saved = validSaved();
    const outcome = firstDecisionEvent(saved).outcome;
    // JSON has no literal for Infinity/NaN — JSON.stringify silently turns them into `null`.
    // Constructing the object with Infinity and round-tripping through JSON.stringify is the
    // realistic way such a value would ever reach deserialize(); it must still be rejected
    // (as a wrong-typed field), not silently accepted as some default.
    outcome.composedWeights[0].composed = JSON.parse(JSON.stringify(Infinity)); // -> null
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects PRNG draw attribution with a value outside the [0, 1) draw contract", () => {
    const saved = validSaved();
    const outcome = firstDecisionEvent(saved).outcome;
    if (outcome.draws.length === 0) return; // a single-candidate tier draws nothing — nothing to corrupt here
    outcome.draws[0].value = 1.5;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });

  it("rejects a malformed PRNG draw attribution state (reuses prng.ts's own validation)", () => {
    const saved = validSaved();
    const outcome = firstDecisionEvent(saved).outcome;
    if (outcome.draws.length === 0) return;
    delete outcome.draws[0].stateAfter.a;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });
});

describe("log seq/tick invariants", () => {
  it("rejects a duplicate sequence number", () => {
    const saved = validSaved();
    expect(saved.eventLog.length).toBeGreaterThan(1);
    saved.eventLog[1].seq = saved.eventLog[0].seq;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/seq/);
  });

  it("rejects an out-of-order (non-contiguous) sequence number", () => {
    const saved = validSaved();
    expect(saved.eventLog.length).toBeGreaterThan(2);
    saved.eventLog[2].seq = 99;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/seq/);
  });

  it("rejects a decreasing tick within a log", () => {
    const saved = validSaved();
    const idx = saved.eventLog.findIndex((r: RawSave, i: number) => i > 0 && r.tick > saved.eventLog[i - 1].tick);
    expect(idx).toBeGreaterThan(0); // sanity: fixture actually advances tick somewhere
    saved.eventLog[idx].tick = saved.eventLog[idx - 1].tick - 1;
    expect(() => deserialize(JSON.stringify(saved))).toThrow(/tick/);
  });

  it("rejects a negative seq", () => {
    const saved = validSaved();
    saved.eventLog[0].seq = -1;
    expect(() => deserialize(JSON.stringify(saved))).toThrow();
  });
});

describe("valid logs still round-trip identically after the hardening pass", () => {
  it("a run containing decisions, executions, and memory formation serializes and deserializes identically", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"], ["driven"]), 100).finalState;
    expect(state.eventLog.some((r) => r.event.kind === "decision")).toBe(true);
    expect(state.decisionLog.length).toBeGreaterThan(0);
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it("deterministic continuation remains unchanged after the hardening pass", () => {
    const midpoint = run(createInitialState(1, "c1", "Maya", ["engineering"], ["driven"]), 100).finalState;
    const reloaded = deserialize(serialize(midpoint));
    const continuedFromReload = run(reloaded, 50);
    const continuedLive = run(midpoint, 50);
    expect(continuedFromReload.finalState).toEqual(continuedLive.finalState);
    expect(continuedFromReload.events).toEqual(continuedLive.events);
  });
});

describe("purity", () => {
  it("serialize does not mutate the state passed in", () => {
    const state = run(createInitialState(1, "c1", "Maya"), 50).finalState;
    const snapshot = JSON.parse(JSON.stringify(state));
    serialize(state);
    expect(state).toEqual(snapshot);
  });

  it("deserialize is a pure function of its string input — repeated calls yield equal (but distinct) objects", () => {
    const state = createInitialState(1, "c1", "Maya");
    const json = serialize(state);
    const a = deserialize(json);
    const b = deserialize(json);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("using a scenario originating from setModuleFunctional (world mutation helper) still round-trips purely", () => {
    const state = createInitialState(1, "c1", "Maya");
    const broken = { ...state, world: setModuleFunctional(state.world, "foodStation", false) };
    const roundTripped = deserialize(serialize(broken));
    expect(roundTripped).toEqual(broken);
  });
});
