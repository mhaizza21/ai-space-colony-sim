// Build Step 10 — inspector tests: read-only summaries, suspended-pair visibility,
// completed/blocked transition visibility through records, recent-record limits and
// stable ordering, input immutability.

import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY } from "../config/constants.js";
import { createInitialState, run } from "../simulation/run.js";
import type { SimulationState } from "../simulation/tick.js";
import { setModuleFunctional } from "../world/world.js";
import { suspendGoal, type Goal } from "../decision/goals.js";
import type { Execution } from "../task/execution.js";
import { applyInteraction, createRelationshipStore, type RelationshipStore } from "../colonist/relationships.js";
import { CONFLICT_TUNING } from "../config/tuning.js";
import { inspect, recentDecisions, recentEvents, summarizeReplay } from "./inspector.js";
import { verifyReplay } from "../replay/replay.js";

/** Two materialized pairs sharing colonist "c1" (the real run's owner), asymmetric in both directions. */
function sampleRelationshipStore(): RelationshipStore {
  let store = createRelationshipStore();
  store = applyInteraction(store, {
    colonistAId: "c1",
    colonistBId: "zeke",
    tick: 0,
    changeSource: "sharedTaskCompletion",
    initiatorId: "c1",
    responderId: "zeke",
    aTowardBDelta: 15,
    bTowardADelta: 9,
  }).store;
  store = applyInteraction(store, {
    colonistAId: "c1",
    colonistBId: "yara",
    tick: 0,
    changeSource: "directConflict",
    initiatorId: "yara",
    responderId: "c1",
    aTowardBDelta: -20,
    bTowardADelta: -12,
  }).store;
  return store;
}

describe("active execution summary", () => {
  it("surfaces the running execution, current goal, needs, stress, and PRNG state as direct reads", () => {
    const state = run(createInitialState(42, "c1", "Maya", ["engineering"]), 100).finalState;
    const rt = state.colonists[0]!;
    expect(rt.execution).not.toBeNull(); // sanity: fixture actually has a running execution

    const summary = inspect(state);
    expect(summary.tick).toBe(100);
    expect(summary.day).toBe(1);
    expect(summary.period).toBe("work");
    expect(summary.colonists).toHaveLength(1);
    const me = summary.colonists[0]!;
    expect(me.identity).toEqual(rt.colonist.identity);
    expect(me.execution).toEqual(rt.execution);
    expect(me.currentGoal).toEqual(rt.colonist.currentGoal);
    expect(me.stress).toBe(rt.colonist.stress.level);
    expect(me.ambientState).toBe("working"); // fixture is mid-shift, not stressed
    expect(summary.prng).toEqual(state.prng);
    expect(summary.foodStock).toBe(state.world.foodStock);
    for (const row of me.needs) {
      expect(row.level).toBe(rt.colonist.needs[row.id].level);
      expect(row.ticksBelowLow).toBe(rt.colonist.needs[row.id].ticksBelowLow);
    }
  });
});

describe("suspended-pair summary", () => {
  it("surfaces the suspended goal and its interrupted execution together", () => {
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
    const state: SimulationState = {
      ...base,
      colonists: [{ ...base.colonists[0]!, colonist: { ...base.colonists[0]!.colonist, suspendedGoal }, suspendedExecution }],
    };

    const summary = inspect(state);
    const me = summary.colonists[0]!;
    expect(me.suspendedGoal).toEqual(suspendedGoal);
    expect(me.suspendedExecution).toEqual(suspendedExecution);
    expect(me.suspendedGoal!.status).toBe("suspended");
    expect(me.suspendedExecution!.status).toBe("interrupted");
  });
});

describe("completed/blocked transition visibility through records", () => {
  it("a full-day run's records show completion transitions", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"]), TICKS_PER_DAY).finalState;
    const all = recentEvents(state, state.eventLog.length);
    expect(all.some((r) => r.event.kind === "completion")).toBe(true);
  });

  it("a broken-module run's records show the blocked resolution", () => {
    const initial = createInitialState(1, "c1", "Maya");
    const broken = { ...initial, world: setModuleFunctional(initial.world, "foodStation", false) };
    const state = run(broken, 1000).finalState;
    const all = recentEvents(state, state.eventLog.length);
    expect(all.some((r) => r.event.kind === "taskResolution" && r.event.resolution.kind === "blocked")).toBe(true);
  });
});

describe("recent-record limits and stable ordering", () => {
  it("returns exactly the last N records in original append order", () => {
    const state = run(createInitialState(1, "c1", "Maya"), 300).finalState;
    expect(state.eventLog.length).toBeGreaterThan(5);
    expect(recentEvents(state, 5)).toEqual(state.eventLog.slice(-5));
    expect(recentDecisions(state, 2)).toEqual(state.decisionLog.slice(-2));
  });

  it("a limit larger than the log returns the whole log, unchanged", () => {
    const state = run(createInitialState(1, "c1", "Maya"), 100).finalState;
    expect(recentEvents(state, state.eventLog.length + 100)).toEqual(state.eventLog);
  });

  it("a limit of zero returns an empty slice; invalid limits are rejected", () => {
    const state = run(createInitialState(1, "c1", "Maya"), 10).finalState;
    expect(recentEvents(state, 0)).toEqual([]);
    expect(recentDecisions(state, 0)).toEqual([]);
    expect(() => recentEvents(state, -1)).toThrow();
    expect(() => recentEvents(state, 1.5)).toThrow();
    expect(() => inspect(state, -1)).toThrow();
  });

  it("inspect bounds its recent slices by recentLimit", () => {
    const state = run(createInitialState(1, "c1", "Maya"), 300).finalState;
    const summary = inspect(state, 3);
    expect(summary.recentEvents).toEqual(state.eventLog.slice(-3));
    expect(summary.recentDecisions.length).toBeLessThanOrEqual(3);
  });
});

describe("input immutability", () => {
  it("inspect never mutates the state it reads", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"]), 200).finalState;
    const snapshot = JSON.parse(JSON.stringify(state));
    inspect(state);
    recentEvents(state, 5);
    recentDecisions(state, 5);
    expect(state).toEqual(snapshot);
  });
});

describe("detached snapshots — mutating a result never aliases back into the state (final review fix)", () => {
  function activeState(): SimulationState {
    const state = run(createInitialState(42, "c1", "Maya", ["engineering"]), 100).finalState;
    expect(state.colonists[0]!.execution).not.toBeNull();
    expect(state.colonists[0]!.colonist.currentGoal).not.toBeNull();
    return state;
  }

  it("mutating the returned currentGoal does not alter state.colonist.currentGoal", () => {
    const state = activeState();
    const originalKey = state.colonists[0]!.colonist.currentGoal!.key;
    const summary = inspect(state);
    (summary.colonists[0]!.currentGoal as { key: string }).key = "tampered";
    expect(state.colonists[0]!.colonist.currentGoal!.key).toBe(originalKey);
  });

  it("mutating the returned execution does not alter state.execution", () => {
    const state = activeState();
    const originalElapsed = state.colonists[0]!.execution!.elapsedTicks;
    const summary = inspect(state);
    (summary.colonists[0]!.execution as { elapsedTicks: number }).elapsedTicks = 999999;
    expect(state.colonists[0]!.execution!.elapsedTicks).toBe(originalElapsed);
  });

  it("mutating the returned suspended goal/execution does not alter the state", () => {
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
    const state: SimulationState = {
      ...base,
      colonists: [{ ...base.colonists[0]!, colonist: { ...base.colonists[0]!.colonist, suspendedGoal }, suspendedExecution }],
    };

    const summary = inspect(state);
    (summary.colonists[0]!.suspendedGoal as { key: string }).key = "tampered";
    (summary.colonists[0]!.suspendedExecution as { elapsedTicks: number }).elapsedTicks = 999999;
    expect(state.colonists[0]!.colonist.suspendedGoal!.key).toBe("shiftAssignment:work");
    expect(state.colonists[0]!.suspendedExecution!.elapsedTicks).toBe(5);
  });

  // Stage 2 Slice 9 (validation plan §6): the detachment guarantee above was only ever exercised
  // on a mid-work colonist. These are the two Stage 2 states it had never been run against —
  // no new inspector mechanism, just the untested combinations.
  it.each([
    ["mid-Comfort", "socializing"],
    ["mid-inConflict", "inConflict"],
  ] as const)("mutating a returned %s colonist summary never aliases back into the state", (scenario, expectedAmbient) => {
    const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] } as const;
    const base = createInitialState(5, "c1", "Maya", [], [], [zeke]);
    const comfortGoal: Goal = {
      source: "voluntary",
      tier: 5,
      key: "voluntary:social:comfort:zeke",
      relatedColonistId: "zeke",
      relatedSocialTaskId: "comfort",
      status: "active",
      motivation: "test fixture",
      adoptedAtTick: 0,
    };
    const comfortExecution: Execution = {
      taskId: "comfort",
      goalKey: "voluntary:social:comfort:zeke",
      status: "inProgress",
      startedAtTick: 0,
      elapsedTicks: 7,
    };
    const posed =
      scenario === "mid-Comfort"
        ? { colonist: { ...base.colonists[0]!.colonist, currentGoal: comfortGoal }, execution: comfortExecution }
        : { inConflictUntilTick: 20 };
    const state: SimulationState = {
      ...base,
      clock: { ...base.clock, tick: 10 },
      colonists: [{ ...base.colonists[0]!, ...posed }, ...base.colonists.slice(1)],
    };

    const summary = inspect(state);
    expect(summary.colonists[0]!.ambientState).toBe(expectedAmbient);
    if (scenario === "mid-Comfort") {
      (summary.colonists[0]!.execution as { elapsedTicks: number }).elapsedTicks = 999999;
      (summary.colonists[0]!.currentGoal as { key: string }).key = "tampered";
      expect(state.colonists[0]!.execution!.elapsedTicks).toBe(7);
      expect(state.colonists[0]!.colonist.currentGoal!.key).toBe("voluntary:social:comfort:zeke");
    } else {
      // Same mutate-then-reassert pattern as mid-Comfort: tamper with every inConflict-bearing
      // field the summary exposes, then prove the live state and a fresh inspect are untouched.
      (summary.colonists[0] as { ambientState: string }).ambientState = "tampered";
      (summary.colonists[0]!.identity as { name: string }).name = "tampered";
      expect(state.colonists[0]!.inConflictUntilTick).toBe(20);
      expect(state.colonists[0]!.colonist.identity.name).toBe("Maya");
    }
    expect(inspect(state).colonists[0]!.ambientState).toBe(expectedAmbient); // unchanged by the tampering above
    expect(inspect(state).colonists[0]!.identity.name).toBe("Maya");
  });

  it("mutating the returned PRNG summary does not alter state.prng", () => {
    const state = activeState();
    const originalA = state.prng.a;
    const summary = inspect(state);
    (summary.prng as { a: number }).a = 0;
    expect(state.prng.a).toBe(originalA);
  });

  it("mutating returned recent record payloads does not alter the event/decision logs", () => {
    const state = run(createInitialState(1, "c1", "Maya"), 300).finalState;
    expect(state.decisionLog.length).toBeGreaterThan(0);
    const logSnapshot = JSON.parse(JSON.stringify({ events: state.eventLog, decisions: state.decisionLog }));

    const events = recentEvents(state, 5);
    (events[0]!.event as { kind: string }).kind = "tampered";
    const decisions = recentDecisions(state, 1);
    (decisions[0]!.outcome.prngState as { a: number }).a = 0;
    const summary = inspect(state);
    (summary.recentEvents[0]!.event as { kind: string }).kind = "alsoTampered";

    expect(state.eventLog).toEqual(logSnapshot.events);
    expect(state.decisionLog).toEqual(logSnapshot.decisions);
  });

  it("inspect still does not mutate its input during the call, with identity fields detached too", () => {
    const state = activeState();
    const snapshot = JSON.parse(JSON.stringify(state));
    const summary = inspect(state);
    (summary.colonists[0]!.identity.skills as string[]).push("tampered");
    expect(state).toEqual(snapshot);
  });
});

describe("replay verification summary", () => {
  it("formats a match result as a one-line summary", () => {
    const initial = createInitialState(1, "c1", "Maya");
    const final = run(initial, 50).finalState;
    const line = summarizeReplay(verifyReplay(initial, final));
    expect(line).toContain("match");
    expect(line).toContain(String(final.eventLog.length));
  });

  it("formats a divergence with its log, index, and record kind", () => {
    const final = run(createInitialState(1, "c1", "Maya"), 300).finalState;
    const otherSeedInitial = createInitialState(2, "c1", "Maya");
    const result = verifyReplay(otherSeedInitial, final);
    expect(result.kind).toBe("divergence");
    const line = summarizeReplay(result);
    expect(line).toContain("divergence");
    if (result.kind === "divergence") {
      expect(line).toContain(result.log);
      expect(line).toContain(String(result.index));
      expect(line).toContain(result.recordKind);
    }
  });
});

describe("relationship pair inspection (Stage 2 build step 5, ADR-20 D2)", () => {
  it("still works with existing Stage 1 behavior: a real run materializes nothing, so relationships is empty", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"]), 200).finalState;
    const summary = inspect(state);
    expect(summary.relationships).toEqual([]);
  });

  it("renders both directional perspectives for every materialized pair, in canonical pair order", () => {
    const base = createInitialState(1, "c1", "Maya");
    const state: SimulationState = { ...base, relationships: sampleRelationshipStore() };

    const summary = inspect(state);

    expect(summary.relationships).toEqual([
      {
        pair: ["c1", "yara"],
        minTowardMax: { affinity: -20, state: "tense" }, // c1 toward yara
        maxTowardMin: { affinity: -12, state: "tense" }, // yara toward c1
        history: expect.any(Array),
        lastInteractionTick: 0,
      },
      {
        pair: ["c1", "zeke"],
        minTowardMax: { affinity: 15, state: "neutral" }, // c1 toward zeke
        maxTowardMin: { affinity: 9, state: "acquainted" }, // zeke toward c1
        history: expect.any(Array),
        lastInteractionTick: 0,
      },
    ]);
  });

  // Stage 2 Slice 9 (validation plan §6): the same rendering, run against a pair a Confrontation
  // actually shifted — new fixture, no new inspector code.
  it("renders a Confrontation-shifted pair symmetrically, in both directions", () => {
    const base = createInitialState(1, "c1", "Maya");
    const shifted = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 12,
      changeSource: "directConflict",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: CONFLICT_TUNING.directConflictAffinityDelta,
      bTowardADelta: CONFLICT_TUNING.directConflictAffinityDelta,
    }).store;

    const summary = inspect({ ...base, relationships: shifted });
    expect(summary.relationships).toHaveLength(1);
    const pair = summary.relationships[0]!;
    expect(pair.pair).toEqual(["c1", "zeke"]);
    // Confrontation applies the same delta in both directions, so both perspectives read alike.
    expect(pair.minTowardMax.affinity).toBe(CONFLICT_TUNING.directConflictAffinityDelta);
    expect(pair.maxTowardMin.affinity).toBe(CONFLICT_TUNING.directConflictAffinityDelta);
    expect(pair.minTowardMax.state).toBe(pair.maxTowardMin.state);
    expect(pair.lastInteractionTick).toBe(12);
  });

  it("does not mutate the relationship store, and does not store or derive a named state anywhere in it", () => {
    const base = createInitialState(1, "c1", "Maya");
    const populated = sampleRelationshipStore();
    const state: SimulationState = { ...base, relationships: populated };
    const beforeCall = JSON.parse(JSON.stringify(populated));

    inspect(state);
    inspect(state); // twice — no caching side effect either

    expect(state.relationships).toEqual(beforeCall);
    // The stored record itself carries only M10's minimal D6 fields — no "state"/named-state
    // field was ever written into it as a side effect of rendering one.
    const record = state.relationships.pairs["c1"]!["zeke"]!;
    expect(Object.keys(record).sort()).toEqual(
      ["history", "lastInteractionTick", "maxTowardMinAffinity", "minTowardMaxAffinity", "pair"].sort(),
    );
  });

  it("detached: mutating the returned relationships array never aliases back into the state", () => {
    const base = createInitialState(1, "c1", "Maya");
    const state: SimulationState = { ...base, relationships: sampleRelationshipStore() };
    const originalAffinity = state.relationships.pairs["c1"]!["zeke"]!.minTowardMaxAffinity;

    const summary = inspect(state);
    const mutableRelationships = summary.relationships as unknown as { minTowardMax: { affinity: number } }[] & unknown[];
    mutableRelationships[0]!.minTowardMax.affinity = 999999;
    (mutableRelationships as unknown[]).push({
      pair: ["tampered", "tampered2"],
      minTowardMax: { affinity: 0, state: "acquainted" },
      maxTowardMin: { affinity: 0, state: "acquainted" },
      history: [],
      lastInteractionTick: null,
    });

    expect(state.relationships.pairs["c1"]!["zeke"]!.minTowardMaxAffinity).toBe(originalAffinity);
    expect(Object.keys(state.relationships.pairs)).toEqual(["c1"]);
  });
});

describe("colonist collection inspection (Stage 2 Slice 6a, ADR-22 D6)", () => {
  const zeke = { id: "zeke", name: "Zeke", skills: ["engineering"], baseTraits: [] } as const;
  const yara = { id: "yara", name: "Yara", skills: [], baseTraits: [] } as const;

  it("exposes one summary per collection entry, alongside the relationship pairs they may reference", () => {
    const base = createInitialState(1, "c1", "Maya", ["engineering"], [], [zeke, yara]);
    const state: SimulationState = { ...base, relationships: sampleRelationshipStore() };
    const summary = inspect(state);
    expect(summary.colonists.map((c) => c.identity.id)).toEqual(["c1", "yara", "zeke"]);
    expect(summary.relationships.length).toBeGreaterThan(0);
  });

  it("shows the absent-pair default for every unmaterialized collection pair", () => {
    const state = createInitialState(1, "c1", "Maya", ["engineering"], [], [zeke]);
    const summary = inspect(state);
    expect(summary.relationships).toEqual([
      {
        pair: ["c1", "zeke"],
        minTowardMax: { affinity: 0, state: "acquainted" },
        maxTowardMin: { affinity: 0, state: "acquainted" },
        history: [],
        lastInteractionTick: null,
      },
    ]);
  });

  it("a single-colonist run reports exactly one summary (unchanged Stage 1 behavior)", () => {
    const state = run(createInitialState(1, "c1", "Maya", ["engineering"]), 100).finalState;
    expect(inspect(state).colonists).toHaveLength(1);
  });

  it("detached: mutating a returned colonist summary never aliases back into the state", () => {
    const base = createInitialState(1, "c1", "Maya", [], [], [zeke]);
    const summary = inspect(base);
    (summary.colonists[1]!.identity as { name: string }).name = "Tampered";
    expect(base.colonists[1]!.colonist.identity.name).toBe("Zeke");
  });
});

describe("social offer inspection (Stage 2 Slice 5, ADR-21 D6)", () => {
  const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] } as const;

  function stateWithOffers(): SimulationState {
    const base = createInitialState(1, "c1", "Maya", [], [], [zeke]);
    return {
      ...base,
      socialOffers: {
        offers: [
          {
            id: 0,
            initiatorId: "c1",
            responderId: "zeke",
            action: "conversation",
            createdAtTick: 0,
            respondableAtTick: 1,
            expiresAtTick: 4,
            status: "declined",
            resolvedAtTick: 1,
            reason: "acceptanceDraw",
          },
          {
            id: 1,
            initiatorId: "c1",
            responderId: "zeke",
            action: "sharedDowntime",
            createdAtTick: 2,
            respondableAtTick: 3,
            expiresAtTick: 6,
            status: "pending",
            resolvedAtTick: null,
            reason: null,
          },
        ],
        nextOfferSequence: 2,
      },
    };
  }

  it("exposes every stored offer in ascending-id order with its full record", () => {
    const summary = inspect(stateWithOffers());
    expect(summary.socialOffers.map((o) => o.id)).toEqual([0, 1]);
    expect(summary.socialOffers[0]!.status).toBe("declined");
    expect(summary.socialOffers[0]!.reason).toBe("acceptanceDraw");
    expect(summary.socialOffers[1]!.status).toBe("pending");
  });

  it("an empty store reads as an empty list", () => {
    expect(inspect(createInitialState(1, "c1", "Maya")).socialOffers).toEqual([]);
  });

  // Stage 2 Slice 9 (validation plan §6): the existing tests use Conversation as their example
  // action. ADR-21 D6's rendering is action-agnostic, so this is a fixture-only addition that
  // confirms a Comfort offer's whole lifecycle is visible, not just Conversation's.
  it("exposes a Comfort offer across its full lifecycle — created, accepted, and resolved", () => {
    const base = createInitialState(1, "c1", "Maya", [], [], [zeke]);
    const lifecycle: SimulationState = {
      ...base,
      socialOffers: {
        offers: [
          { id: 0, initiatorId: "c1", responderId: "zeke", action: "comfort", createdAtTick: 10, respondableAtTick: 11, expiresAtTick: 14, status: "pending", resolvedAtTick: null, reason: null },
          { id: 1, initiatorId: "c1", responderId: "zeke", action: "comfort", createdAtTick: 20, respondableAtTick: 21, expiresAtTick: 24, status: "accepted", resolvedAtTick: 21, reason: null },
          { id: 2, initiatorId: "c1", responderId: "zeke", action: "comfort", createdAtTick: 30, respondableAtTick: 31, expiresAtTick: 34, status: "declined", resolvedAtTick: 31, reason: "responderNotInterruptible" },
        ],
        nextOfferSequence: 3,
      },
    };

    const summary = inspect(lifecycle);
    expect(summary.socialOffers.map((o) => o.action)).toEqual(["comfort", "comfort", "comfort"]);
    expect(summary.socialOffers.map((o) => o.status)).toEqual(["pending", "accepted", "declined"]);
    expect(summary.socialOffers[1]!.resolvedAtTick).toBe(21);
    expect(summary.socialOffers[2]!.reason).toBe("responderNotInterruptible");
  });

  it("detached: mutating the returned socialOffers never aliases back into the state", () => {
    const state = stateWithOffers();
    const summary = inspect(state);
    (summary.socialOffers as unknown as { status: string }[])[1]!.status = "accepted";
    expect(state.socialOffers.offers[1]!.status).toBe("pending");
  });
});
