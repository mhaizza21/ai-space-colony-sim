// Build Step 10 — main/CLI tests: deterministic seeded runs, identical-arguments identical
// output, save/load continuation, replay verification success and failure paths, input
// validation and rejection.

import { describe, expect, it } from "vitest";
import { continueRun, demoRun, runCli, verifySaveReplay } from "./main.js";
import { createInitialState, run } from "./simulation/run.js";
import { deserialize, serialize } from "./core/serialization.js";
import { advance, createClock } from "./core/clock.js";
import { createColonist, withCurrentGoal, withNeeds, withStress } from "./colonist/colonist.js";
import { createNeeds } from "./colonist/needs.js";
import { commitGoal } from "./decision/goals.js";
import { beginExecution } from "./task/execution.js";
import { taskDefinition } from "./task/tasks.js";
import { createDefaultPolicy } from "./world/policy.js";
import { tick, type ColonistRuntime, type SimulationState } from "./simulation/tick.js";
import { verifyReplay } from "./replay/replay.js";

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
 * §4's assertion shape, applied to a save taken mid-action: continuing from a mid-run save must
 * land exactly where an uninterrupted run of the same total length lands. Both sides go through
 * `continueRun`, so the only difference between them is the extra serialize/deserialize round
 * trip at `splitAt` — which is the whole point of the test.
 */
function continuationParity(state: SimulationState, splitAt: number, total: number) {
  const save = serialize(state);
  const uninterrupted = continueRun(save, total);
  const midpoint = continueRun(save, splitAt);
  const continued = continueRun(midpoint.save, total - splitAt);
  return { uninterrupted, midpoint, continued };
}

/**
 * §4 specifies `continued.save === uninterrupted.save`. That literal string comparison is not
 * usable for any state in which a colonist holds memories, for a reason unrelated to continuation:
 * `serialize` is `JSON.stringify`, so it records object key INSERTION order, and a MemoryEntry
 * rebuilt by `deserialize` carries a different key order than one built live by `memory.ts`
 * (`{id,type,context,formedAtTick,impact}` live vs `{id,formedAtTick,impact,type,context}`
 * reloaded). The states are identical; only the encodings differ. The continuation contract is
 * therefore asserted on the decoded state — which is what "reaches the same state" actually
 * means — and the encoding defect is pinned separately, and reported, below.
 */
function expectSameContinuedState(parity: ReturnType<typeof continuationParity>): void {
  expect(deserialize(parity.continued.save)).toEqual(deserialize(parity.uninterrupted.save));
  expect(parity.continued.summary).toEqual(parity.uninterrupted.summary);
  expect(parity.continued.replay.kind).toBe("match");
}

describe("Stage 2 Slice 9 — save/load continuation from a mid-action save (validation plan §4)", () => {
  it("continues identically from a save taken mid-pending social offer", () => {
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
            createdAtTick: t,
            respondableAtTick: t + 5,
            expiresAtTick: t + 12,
            status: "pending",
            resolvedAtTick: null,
            reason: null,
          },
        ],
        nextOfferSequence: 1,
      },
    };

    const parity = continuationParity(state, 3, 20);
    // The save really was taken mid-action: the offer is still unresolved at the split point.
    expect(parity.midpoint.summary.socialOffers[0]!.status).toBe("pending");
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

  it("FINDING: a save string is not byte-stable across a load round trip once a colonist holds memories", () => {
    // Not a continuation defect and not introduced by this slice — an encoding one, surfaced for
    // the first time by §4's mid-action saves. `serialize` is JSON.stringify, so it records key
    // insertion order; `deserialize` rebuilds a MemoryEntry with a different key order than
    // `memory.ts` uses when forming one. Two encodings of the same state therefore differ as
    // strings while comparing equal as states. Pinned here so the behavior is known and cannot
    // regress further; fixing it would change core/serialization.ts, which §12 puts out of scope
    // for this test-only slice.
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
  // and for the same reason: a fired Confrontation and an accepted social offer both have to
  // appear in one trace, and neither is guaranteed by any hand-authored magnitude.
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

  it("that same run exercises the whole current action set together in one trace", () => {
    const { events } = run(initial(), TICKS);
    const offerActions = new Set(events.flatMap((e) => (e.kind === "socialOfferCreated" ? [e.action] : [])));
    const begunTasks = new Set(events.flatMap((e) => (e.kind === "executionBegun" ? [e.taskId] : [])));
    const resolutions = new Set(events.flatMap((e) => (e.kind === "socialOfferResolved" ? [e.status] : [])));

    // All three offer-backed actions are reached by real candidate generation, not hand-posed.
    expect([...offerActions].sort()).toEqual(["comfort", "conversation", "sharedDowntime"]);
    // An accepted offer really does become a running social execution inside this trace.
    expect(begunTasks.has("sharedDowntime")).toBe(true);
    // Three of the four terminal offer statuses appear in this one run rather than one per
    // isolated fixture; `declined` does not occur at this seed and stays covered by the Slice 5
    // decline fixtures in tick.test.ts.
    expect([...resolutions].sort()).toEqual(["accepted", "cancelled", "expired"]);
    // Confrontation fires organically here — the encounter-only path in a full multi-colonist run.
    expect(events.filter((e) => e.kind === "confrontationOccurred").length).toBeGreaterThan(0);

    // Scope note: Comfort is offered in this trace but never accepted in it, so the accepted-Comfort
    // consequences are covered by tick.test.ts's dedicated real-run block rather than here.
    // Assist stays unreachable by Human ruling (comfort-assist-protocol §15) — pinned here too, so
    // the integration trace itself is evidence the deferral holds end-to-end.
    expect([...begunTasks]).not.toContain("assist");
    expect([...offerActions]).not.toContain("assist");
  });
});
