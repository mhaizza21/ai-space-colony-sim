// Build Step 10 — main/CLI tests: deterministic seeded runs, identical-arguments identical
// output, save/load continuation, replay verification success and failure paths, input
// validation and rejection.

import { describe, expect, it } from "vitest";
import { continueRun, demoRun, runCli, verifySaveReplay } from "./main.js";
import { createInitialState, run } from "./simulation/run.js";
import { deserialize, serialize } from "./core/serialization.js";
import { advance, createClock } from "./core/clock.js";
import { createPrng } from "./core/prng.js";
import { createColonist, withCurrentGoal, withNeeds, withStress } from "./colonist/colonist.js";
import { createNeeds } from "./colonist/needs.js";
import { applyInteraction, createRelationshipStore, perspective } from "./colonist/relationships.js";
import { commitGoal } from "./decision/goals.js";
import { beginExecution } from "./task/execution.js";
import { taskDefinition } from "./task/tasks.js";
import { createDefaultPolicy } from "./world/policy.js";
import { createWorld } from "./world/world.js";
import { CONFLICT_TUNING, TASK_TUNING } from "./config/tuning.js";
import { createFreshMemoryBaselines, tick, type ColonistRuntime, type SimulationState, type TickEvent } from "./simulation/tick.js";
import { verifyReplay } from "./replay/replay.js";
import { createDecisionLog, createEventLog } from "./records/logs.js";
import { createSocialOfferStore } from "./task/socialOffers.js";

describe("deterministic run from seed", () => {
  it("the same seed and tick count produce an identical result, including the save string", () => {
    expect(demoRun(7, 200)).toEqual(demoRun(7, 200));
  });

  it("different seeds produce different results", () => {
    expect(demoRun(1, 200)).not.toEqual(demoRun(2, 200));
  });

  it("the summary reflects the requested tick count", () => {
    expect(demoRun(7, 250).summary.tick).toBe(250);
  });

  it("every demonstration run's own replay verification is a match", () => {
    expect(demoRun(7, 300).replay.kind).toBe("match");
  });
});

describe("same arguments produce identical output (CLI)", () => {
  it("runCli returns byte-identical output for identical argv", () => {
    const args = ["run", "--seed", "7", "--ticks", "200"];
    expect(runCli(args)).toBe(runCli(args));
  });

  it("run output is parseable structured JSON carrying summary, replay line, and save", () => {
    const parsed = JSON.parse(runCli(["run", "--seed", "1", "--ticks", "100"]));
    expect(parsed.command).toBe("run");
    expect(parsed.summary.tick).toBe(100);
    expect(parsed.replay).toContain("match");
    expect(typeof parsed.save).toBe("string");
    expect(parsed.summary.recentEvents.length).toBeLessThanOrEqual(5);
  });
});

describe("load serialized state and continue identically", () => {
  it("continuing a save reaches the same state as an uninterrupted run of the same total length", () => {
    const uninterrupted = demoRun(7, 300);
    const midpoint = demoRun(7, 200);
    const continued = continueRun(midpoint.save, 100);
    expect(continued.save).toBe(uninterrupted.save);
    expect(continued.summary).toEqual(uninterrupted.summary);
  });

  it("the CLI continue command produces the same final summary as the API path", () => {
    const midpoint = demoRun(7, 200);
    const parsed = JSON.parse(runCli(["continue", "--ticks", "100", "--save", midpoint.save]));
    expect(parsed.command).toBe("continue");
    expect(parsed.summary.tick).toBe(300);
    expect(parsed.save).toBe(demoRun(7, 300).save);
  });
});

describe("replay verification paths", () => {
  it("succeeds for an untampered save with the correct seed", () => {
    const output = demoRun(7, 150);
    expect(verifySaveReplay(output.save, 7).kind).toBe("match");
  });

  it("reports divergence for a tampered (structurally valid) record payload", () => {
    const output = demoRun(7, 150);
    const saved = JSON.parse(output.save);
    // reason: `saved` is untyped JSON.parse output being searched before it's deliberately
    // tampered with below — typing this record shape here would need the same unsafe cast
    // deserialize()'s own tests already justify (core/serialization.test.ts's RawSave).
    const idx = saved.eventLog.findIndex((r: any) => r.event.kind === "executionProgressed");
    expect(idx).toBeGreaterThanOrEqual(0);
    saved.eventLog[idx].event.elapsedTicks += 1;
    const result = verifySaveReplay(JSON.stringify(saved), 7);
    expect(result.kind).toBe("divergence");
    if (result.kind === "divergence") {
      expect(result.log).toBe("event");
      expect(result.index).toBe(idx);
      expect(result.recordKind).toBe("executionProgressed");
    }
  });

  it("reports divergence when verifying against the wrong seed — returned, never thrown", () => {
    const output = demoRun(7, 150);
    expect(verifySaveReplay(output.save, 8).kind).toBe("divergence");
  });

  it("REGRESSION: succeeds for an untampered save whose initial state carried a roster entry", () => {
    // verifySaveReplay rebuilds its own replay baseline via createInitialState — every field
    // deserialize() restores onto SimulationState has to be threaded through that
    // reconstruction too, or the rebuilt baseline silently diverges from the saved state.
    // roster (Stage 2 Slice 2) was the one instance of this actually happening.
    const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] as const };
    const initial = createInitialState(7, "c1", "Maya", ["engineering"], [], [zeke]);
    const final = run(initial, 150).finalState;
    const result = verifySaveReplay(serialize(final), 7);
    expect(result.kind).toBe("match");
  });

  it("the CLI verify command carries both the summary line and the structured result", () => {
    const output = demoRun(7, 100);
    const parsed = JSON.parse(runCli(["verify", "--seed", "7", "--save", output.save]));
    expect(parsed.command).toBe("verify");
    expect(parsed.replay).toContain("match");
    expect(parsed.result.kind).toBe("match");
  });
});

describe("input rejection", () => {
  it("rejects an invalid tick count (negative, non-integer, non-numeric)", () => {
    expect(() => demoRun(1, -5)).toThrow();
    expect(() => demoRun(1, 1.5)).toThrow();
    expect(() => runCli(["run", "--seed", "1", "--ticks", "abc"])).toThrow();
  });

  it("rejects an invalid seed (NaN, non-integer, non-numeric)", () => {
    expect(() => demoRun(Number.NaN, 10)).toThrow();
    expect(() => demoRun(1.5, 10)).toThrow();
    expect(() => runCli(["run", "--seed", "abc", "--ticks", "10"])).toThrow();
  });

  it("rejects malformed serialized input on continue and verify", () => {
    expect(() => continueRun("{not valid json", 10)).toThrow();
    expect(() => verifySaveReplay("42", 1)).toThrow();
    expect(() => runCli(["continue", "--ticks", "10", "--save", "{oops"])).toThrow();
  });

  it("rejects unknown commands and malformed flag pairs", () => {
    expect(() => runCli(["explode"])).toThrow(/Unknown command/);
    expect(() => runCli(["run", "--seed"])).toThrow();
    expect(() => runCli(["run", "seed", "1"])).toThrow();
    expect(() => runCli(["run", "--ticks", "10"])).toThrow(/--seed/);
  });
});

// --- Stage 2 Slice 9 — cross-slice validation sweep (design/stage-2-validation-plan.md §4/§5).
// Test-only; no prototype/src production module is added or changed by this slice.

const ZEKE = { id: "zeke", name: "Zeke", skills: [] as readonly string[], baseTraits: [] as const };
const ADA = { id: "ada", name: "Ada", skills: [] as readonly string[], baseTraits: [] as const };
const FREE_START = createDefaultPolicy().workTicks + createDefaultPolicy().restTicks;

const runtimeOf = (state: SimulationState, id: string): ColonistRuntime =>
  state.colonists.find((r) => r.colonist.identity.id === id)!;

function patchColonist(state: SimulationState, id: string, patch: Partial<ColonistRuntime>): SimulationState {
  return {
    ...state,
    colonists: state.colonists.map((rt) => (rt.colonist.identity.id === id ? { ...rt, ...patch } : rt)),
  };
}

/** Two fully simulated colonists parked at the start of the free period, ready to be posed mid-action. */
function freeStartPair(seed: number): SimulationState {
  const base = createInitialState(seed, "c1", "Maya", [], [], [ZEKE]);
  const posed = patchColonist(base, "c1", {
    colonist: withNeeds(runtimeOf(base, "c1").colonist, {
      ...createNeeds(),
      social: { level: 0.45, ticksBelowLow: 0 },
      purpose: { level: 0.5, ticksBelowLow: 0 },
    } as ReturnType<typeof createNeeds>),
  });
  return { ...posed, clock: advance(createClock(), FREE_START), hasBootstrapped: true };
}

/** Gives zeke his own valid, non-interfering pair so these fixtures test one action at a time. */
function withIdleZeke(state: SimulationState, stressLevel = 0): SimulationState {
  const t = state.clock.tick;
  const zekeGoal = commitGoal({ source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 }, "fixture idle", t);
  const zeke = runtimeOf(state, "zeke").colonist;
  const needs = { ...createNeeds(), social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } } as ReturnType<typeof createNeeds>;
  return patchColonist(state, "zeke", {
    colonist: withStress(withNeeds(withCurrentGoal(zeke, zekeGoal), needs), { level: stressLevel }),
    execution: beginExecution(taskDefinition("idlePresence"), zekeGoal, t),
    stressBaseline: stressLevel,
  });
}

/**
 * §4 / v0.3.1 assertion shape for a save taken mid-action: continuing from a mid-run save must
 * land where an uninterrupted run of the same total length lands. Both sides go through
 * `continueRun`, so the only difference is the extra serialize/deserialize round trip at
 * `splitAt`.
 */
function continuationParity(state: SimulationState, splitAt: number, total: number) {
  const save = serialize(state);
  const uninterrupted = continueRun(save, total);
  const midpoint = continueRun(save, splitAt);
  const continued = continueRun(midpoint.save, total - splitAt);
  return { uninterrupted, midpoint, continued };
}

/**
 * Plan §4 v0.3.1 — explicit assertion shape (literal `continued.save === uninterrupted.save` is
 * superseded for this slice by issue #163's encoding defect). Asserts summary equality,
 * decoded-state equality, and replay match. Does NOT assert byte-identical save strings.
 */
function expectSameContinuedState(parity: ReturnType<typeof continuationParity>): void {
  // Named deliberately: the plan's corrected shape, not a silent workaround.
  expect(parity.continued.summary).toEqual(parity.uninterrupted.summary);
  expect(deserialize(parity.continued.save)).toEqual(deserialize(parity.uninterrupted.save));
  expect(parity.continued.replay.kind).toBe("match");
  expect(parity.uninterrupted.replay.kind).toBe("match");
  // Issue #163 means the encodings may differ even when the states match; that defect is pinned
  // in its own describe below — these four continuation tests do not assert save-string equality.
}

describe("Stage 2 Slice 9 — save/load continuation from a mid-action save (validation plan §4)", () => {
  it("continues identically from a save taken mid-pending social offer at the respondable boundary", () => {
    // §4 save point 1: "respondable but not yet resolved". Hand-posed so clock.tick already
    // equals respondableAtTick while status is still pending — a state a completed tick cannot
    // leave behind (that tick would resolve the offer), which is exactly the mid-action seam.
    const base = withIdleZeke(freeStartPair(7));
    const t = base.clock.tick;
    const goal = commitGoal(
      { source: "voluntary", tier: 5, key: "voluntary:social:conversation:zeke", baseUrgency: 0.2, relatedColonistId: "zeke", relatedSocialTaskId: "conversation" },
      "mid-offer fixture",
      t,
    );
    const state: SimulationState = {
      ...patchColonist(base, "c1", { colonist: withCurrentGoal(runtimeOf(base, "c1").colonist, goal) }),
      socialOffers: {
        offers: [
          {
            id: 0,
            initiatorId: "c1",
            responderId: "zeke",
            action: "conversation",
            createdAtTick: t - 1,
            respondableAtTick: t,
            expiresAtTick: t + 7,
            status: "pending",
            resolvedAtTick: null,
            reason: null,
          },
        ],
        nextOfferSequence: 1,
      },
    };

    // splitAt 0: the posed state IS the mid-action save (already at the respondable boundary).
    const parity = continuationParity(state, 0, 20);
    const offer = parity.midpoint.summary.socialOffers[0]!;
    expect(offer.status).toBe("pending");
    expect(parity.midpoint.summary.tick).toBe(offer.respondableAtTick);
    expectSameContinuedState(parity);
  });

  it("continues identically from a save taken mid-accepted-Comfort execution", () => {
    const base = withIdleZeke(freeStartPair(7), 0.9);
    const t = base.clock.tick;
    const goal = commitGoal(
      { source: "voluntary", tier: 5, key: "voluntary:social:comfort:zeke", baseUrgency: 0.2, relatedColonistId: "zeke", relatedSocialTaskId: "comfort" },
      "mid-comfort fixture",
      t,
    );
    const state: SimulationState = {
      ...patchColonist(base, "c1", {
        colonist: withCurrentGoal(runtimeOf(base, "c1").colonist, goal),
        execution: beginExecution(taskDefinition("comfort"), goal, t),
      }),
      socialOffers: {
        offers: [
          {
            id: 0,
            initiatorId: "c1",
            responderId: "zeke",
            action: "comfort",
            createdAtTick: t - 1,
            respondableAtTick: t,
            expiresAtTick: t + 3,
            status: "accepted",
            resolvedAtTick: t,
            reason: null,
          },
        ],
        nextOfferSequence: 1,
      },
    };

    const parity = continuationParity(state, 4, 20);
    const comforter = parity.midpoint.summary.colonists.find((c) => c.identity.id === "c1")!;
    expect(comforter.execution?.taskId).toBe("comfort");
    expect(comforter.execution!.elapsedTicks).toBeGreaterThan(0); // genuinely mid-execution
    expectSameContinuedState(parity);
  });

  it("continues identically from a save taken mid-In-Conflict window", () => {
    const base = withIdleZeke(freeStartPair(7));
    const t = base.clock.tick;
    const untilTick = t + 8;
    const state = patchColonist(patchColonist(base, "c1", { inConflictUntilTick: untilTick }), "zeke", {
      inConflictUntilTick: untilTick,
    });

    const parity = continuationParity(state, 3, 20);
    // ADR-25: an unexpired window is live state at the save point, not a decoration.
    expect(parity.midpoint.summary.tick).toBeLessThan(untilTick);
    expect(parity.midpoint.summary.colonists.every((c) => c.ambientState === "inConflict")).toBe(true);
    expectSameContinuedState(parity);
    // The window expires on schedule after the round trip rather than being re-based on load.
    expect(deserialize(parity.continued.save).colonists.every((r) => r.inConflictUntilTick === untilTick)).toBe(true);
  });

  it("continues identically from a save taken mid-suspended-goal", () => {
    // Organic rather than hand-posed: run until a higher-tier need actually interrupts the
    // voluntary goal, so the suspended pair under test is one the simulation really produced.
    let state = freeStartPair(7);
    state = patchColonist(state, "c1", {
      colonist: withNeeds(runtimeOf(state, "c1").colonist, {
        ...createNeeds(),
        hunger: { level: 0.402, ticksBelowLow: 0 },
      } as ReturnType<typeof createNeeds>),
    });
    state = { ...state, hasBootstrapped: false };
    // The split point itself has to land inside the suspension, so it is measured rather than
    // guessed: advance from the origin until the suspended pair exists, and split exactly there.
    let splitAt = -1;
    let probe = state;
    for (let i = 1; i <= 200 && splitAt < 0; i++) {
      probe = tick(probe, 1).state;
      if (probe.colonists.some((r) => r.suspendedExecution !== null)) splitAt = i;
    }
    expect(splitAt).toBeGreaterThan(0);
    expect(runtimeOf(probe, "c1").colonist.suspendedGoal?.status).toBe("suspended");

    const parity = continuationParity(state, splitAt, splitAt + 20);
    const saved = parity.midpoint.summary.colonists.find((c) => c.identity.id === "c1")!;
    expect(saved.suspendedGoal?.status).toBe("suspended");
    expect(saved.suspendedExecution?.status).toBe("interrupted");
    expectSameContinuedState(parity);
  });
});

describe("Stage 2 Slice 9 — issue #163: serialize() is not byte-stable across a MemoryEntry round trip", () => {
  it("a save string differs across serialize→deserialize→serialize once a colonist holds memories", () => {
    // Tracked as issue #163 against core/serialization.ts. serialize is JSON.stringify, so it
    // records key insertion order; deserialize rebuilds a MemoryEntry with a different key order
    // than memory.ts uses when forming one live. Two encodings of the same state therefore differ
    // as strings while comparing equal as states. Pinned here — separately from the four §4
    // continuation tests — so the encoding defect cannot drift silently. Fixing it is out of
    // this test-only slice's scope (§12).
    const base = withIdleZeke(freeStartPair(7));
    const live = run(base, 5).finalState;
    expect(live.colonists.some((r) => r.colonist.memory.length > 0)).toBe(true);

    const roundTripped = deserialize(serialize(live));
    expect(roundTripped).toEqual(live); // identical state ...
    expect(serialize(roundTripped)).not.toBe(serialize(live)); // ... non-identical encoding
    expect(JSON.parse(serialize(roundTripped))).toEqual(JSON.parse(serialize(live)));
  });
});

describe("Stage 2 Slice 9 — multi-action fixed-seed replay integration (validation plan §5)", () => {
  // Seed chosen by the same seed-hunt pattern tick.test.ts's Confrontation block already uses,
  // and for the same reason: a fired Confrontation and social activity both have to appear in one
  // organic multi-colonist run for the replay/determinism half of §5.
  const SEED = 17;
  const TICKS = 2880; // two full in-game days: two work/rest/free cycles for three colonists
  const initial = () => createInitialState(SEED, "maya", "Maya", [], [], [ZEKE, ADA]);

  it("a fixed-seed three-colonist run reproduces byte-identically and verifies as a replay match", () => {
    const first = run(initial(), TICKS);
    const second = run(initial(), TICKS);

    // Byte-identical event and decision logs across two independent runs from the same state.
    expect(serialize(first.finalState)).toBe(serialize(second.finalState));
    expect(first.finalState.eventLog).toEqual(second.finalState.eventLog);
    expect(first.finalState.decisionLog).toEqual(second.finalState.decisionLog);
    expect(first.events).toEqual(second.events);

    // Terminal state matches through replay.ts's generic STATE_FIELDS diff — zero divergence.
    expect(verifyReplay(initial(), first.finalState).kind).toBe("match");
    // And through the save-level entry point a caller would actually use.
    expect(verifySaveReplay(serialize(first.finalState), SEED).kind).toBe("match");
  });

  it("a hand-authored scenario exercises Conversation, Shared Downtime, Shared Meal, accepted Comfort, and Confrontation in one continuous trace", () => {
    // Organic seed-hunting across 2880-tick three-colonist runs does not reliably accept Comfort
    // and begin Conversation in the same trace (seed 17 accepts Shared Downtime and fires
    // Confrontation, but never an accepted Comfort). Same pattern Confrontation's own tests use:
    // hand-author each action's known-good mid-state, tick through it, and accumulate one event
    // trace that asserts each occurrence explicitly — not merely that offers were created.
    const events: TickEvent[] = [];
    const append = (state: SimulationState, n = 1): SimulationState => {
      let next = state;
      for (let i = 0; i < n; i++) {
        const result = tick(next, 1);
        events.push(...result.events);
        next = result.state;
      }
      return next;
    };

    const clearToIdlePair = (state: SimulationState, stressLevel = 0): SimulationState => {
      const t = state.clock.tick;
      let next = state;
      for (const id of ["c1", "zeke"] as const) {
        const goal = commitGoal({ source: "voluntary", tier: 5, key: `voluntary:idle:${id}`, baseUrgency: 0.2 }, "fixture idle", t);
        const colonist = runtimeOf(next, id).colonist;
        const needs = {
          ...createNeeds(),
          social: { level: 0.45, ticksBelowLow: 0 },
          purpose: { level: 0.5, ticksBelowLow: 0 },
        } as ReturnType<typeof createNeeds>;
        next = patchColonist(next, id, {
          colonist: withStress(withNeeds(withCurrentGoal(colonist, goal), needs), { level: stressLevel }),
          execution: beginExecution(taskDefinition("idlePresence"), goal, t),
          suspendedExecution: null,
          stressBaseline: stressLevel,
          inConflictUntilTick: null,
        });
      }
      return { ...next, socialOffers: createSocialOfferStore() };
    };

    const posePendingOffer = (
      state: SimulationState,
      action: "conversation" | "sharedDowntime" | "comfort",
      responderStress = 0,
    ): SimulationState => {
      const t = state.clock.tick;
      const goal = commitGoal(
        {
          source: "voluntary",
          tier: 5,
          key: `voluntary:social:${action}:zeke`,
          baseUrgency: 0.2,
          relatedColonistId: "zeke",
          relatedSocialTaskId: action,
        },
        `multi-action ${action}`,
        t,
      );
      let next = clearToIdlePair(state, responderStress);
      next = patchColonist(next, "c1", {
        colonist: withCurrentGoal(runtimeOf(next, "c1").colonist, goal),
        execution: null,
      });
      return {
        ...next,
        prng: createPrng(7), // seed 7's first draw accepts Comfort's acquainted band and Conversation's
        socialOffers: {
          offers: [
            {
              id: 0,
              initiatorId: "c1",
              responderId: "zeke",
              action,
              createdAtTick: t,
              respondableAtTick: t + 1,
              expiresAtTick: t + 4,
              status: "pending",
              resolvedAtTick: null,
              reason: null,
            },
          ],
          nextOfferSequence: 1,
        },
      };
    };

    let state = freeStartPair(7);

    // --- Conversation: accept + begin ---
    state = append(posePendingOffer(state, "conversation"), 1);
    expect(state.socialOffers.offers[0]!.status).toBe("accepted");
    expect(state.socialOffers.offers[0]!.action).toBe("conversation");
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "conversation")).toBe(true);

    // --- Shared Downtime: accept + begin ---
    state = append(posePendingOffer(state, "sharedDowntime"), 1);
    expect(state.socialOffers.offers[0]!.status).toBe("accepted");
    expect(state.socialOffers.offers[0]!.action).toBe("sharedDowntime");
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "sharedDowntime")).toBe(true);

    // --- Shared Meal: eating with non-hostile company applies the overlay ---
    {
      const t = state.clock.tick;
      const eatGoal = commitGoal(
        { source: "criticalNeed", tier: 1, key: "criticalNeed:hunger", baseUrgency: 1, relatedNeed: "hunger" },
        "multi-action shared meal",
        t,
      );
      state = clearToIdlePair(state);
      state = patchColonist(state, "c1", {
        colonist: withNeeds(withCurrentGoal(runtimeOf(state, "c1").colonist, eatGoal), {
          ...createNeeds(),
          hunger: { level: 0.35, ticksBelowLow: 10 },
          social: { level: 0.45, ticksBelowLow: 0 },
          purpose: { level: 0.5, ticksBelowLow: 0 },
        } as ReturnType<typeof createNeeds>),
        execution: beginExecution(taskDefinition("eatAtFoodStation"), eatGoal, t),
      });
      state = { ...state, world: createWorld(), relationships: createRelationshipStore() };
      const socialBefore = runtimeOf(state, "c1").colonist.needs.social.level;
      const affinityBefore = perspective(state.relationships, "c1", "zeke").affinity;
      state = append(state, 1);
      expect(events.some((e) => e.kind === "executionProgressed" && e.taskId === "eatAtFoodStation")).toBe(true);
      // Shared Meal is an overlay on eating — no dedicated event — so assert its own consequences.
      // Social also decays in Phase 3, so the overlay is the net lift above that decay; affinity is
      // exact because the shared-meal pair is excluded from atrophy this tick.
      expect(runtimeOf(state, "c1").colonist.needs.social.level).toBeGreaterThan(socialBefore);
      expect(perspective(state.relationships, "c1", "zeke").affinity - affinityBefore).toBeCloseTo(
        TASK_TUNING.sharedMealAffinityDeltaPerTick,
        9,
      );
    }

    // --- Comfort: accept + begin (stressed responder required) ---
    state = append(posePendingOffer(state, "comfort", 0.9), 1);
    expect(state.socialOffers.offers[0]!.status).toBe("accepted");
    expect(state.socialOffers.offers[0]!.action).toBe("comfort");
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "comfort")).toBe(true);

    // --- Confrontation: workstation pair + hostile affinity, seed-hunt until fire (seed 7 known) ---
    {
      const workGoal = (id: string) =>
        commitGoal({ source: "shiftAssignment", tier: 3, key: `shiftAssignment:work:${id}`, baseUrgency: 0.5 }, "work", 0);
      const withWork = (id: string, name: string): ColonistRuntime => {
        const goal = workGoal(id);
        return {
          colonist: {
            ...withCurrentGoal(withNeeds(createColonist(id, name), createNeeds()), goal),
            stress: { level: 0.7 },
          },
          execution: beginExecution(taskDefinition("workAtWorkstation"), goal, 0),
          suspendedExecution: null,
          ...createFreshMemoryBaselines(),
        };
      };
      const relationships = applyInteraction(createRelationshipStore(), {
        colonistAId: "c1",
        colonistBId: "zeke",
        tick: 0,
        changeSource: "directConflict",
        initiatorId: null,
        responderId: null,
        aTowardBDelta: -50,
        bTowardADelta: -50,
      }).store;
      // Seed 7 fires under CONFLICT_TUNING.conflictFireProbability (probed; same hunt pattern as
      // tick.test.ts's Confrontation block). Keep the structural floor explicit.
      expect(CONFLICT_TUNING.conflictFireProbability).toBeGreaterThan(0);
      const confrontationState: SimulationState = {
        clock: createClock(),
        world: createWorld(),
        policy: createDefaultPolicy(),
        colonists: [withWork("c1", "Maya"), withWork("zeke", "Zeke")].sort((a, b) =>
          a.colonist.identity.id < b.colonist.identity.id ? -1 : 1,
        ),
        prng: createPrng(7),
        hasBootstrapped: true,
        eventLog: createEventLog(),
        decisionLog: createDecisionLog(),
        relationships,
        socialOffers: createSocialOfferStore(),
      };
      state = append(confrontationState, 1);
      expect(events.some((e) => e.kind === "confrontationOccurred")).toBe(true);
    }

    // Explicit occurrence pins for all five Stage 2 actions in this one accumulated trace.
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "conversation")).toBe(true);
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "sharedDowntime")).toBe(true);
    expect(events.some((e) => e.kind === "executionProgressed" && e.taskId === "eatAtFoodStation")).toBe(true);
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "comfort")).toBe(true);
    expect(events.some((e) => e.kind === "confrontationOccurred")).toBe(true);

    // Assist stays unreachable by Human ruling (comfort-assist-protocol §15).
    expect(events.some((e) => e.kind === "executionBegun" && e.taskId === "assist")).toBe(false);
    const createdActions = events.flatMap((e) => (e.kind === "socialOfferCreated" ? [e.action as string] : []));
    expect(createdActions).not.toContain("assist");
  });
});
