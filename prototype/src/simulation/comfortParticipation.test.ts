import { describe, expect, it } from "vitest";
import { GOAL_SOURCE_TIER } from "../config/constants.js";
import { createColonist, withCurrentGoal, withSuspendedGoal } from "../colonist/colonist.js";
import { createRelationshipStore } from "../colonist/relationships.js";
import { createClock } from "../core/clock.js";
import { createPrng } from "../core/prng.js";
import { createDecisionLog, createEventLog } from "../records/logs.js";
import { beginExecution, interruptExecution } from "../task/execution.js";
import { createSocialOfferStore } from "../task/socialOffers.js";
import { taskDefinition } from "../task/tasks.js";
import { createDefaultPolicy } from "../world/policy.js";
import { createWorld } from "../world/world.js";
import { buildComfortParticipationBasis, collectComfortClaims } from "./comfortParticipation.js";
import { createFreshMemoryBaselines, validateSimulationState, type ColonistRuntime, type SimulationState } from "./tick.js";
import type { Goal } from "../decision/goals.js";

function comfortGoal(recipientId: string, status: Goal["status"] = "active"): Goal {
  return {
    source: "voluntary",
    tier: GOAL_SOURCE_TIER.voluntary,
    key: `voluntary:social:comfort:${recipientId}`,
    relatedColonistId: recipientId,
    relatedSocialTaskId: "comfort",
    status,
    motivation: "test",
    adoptedAtTick: 0,
  };
}

function baseState(colonists: readonly ColonistRuntime[]): SimulationState {
  return {
    clock: createClock(),
    world: createWorld(),
    policy: createDefaultPolicy(),
    colonists: [...colonists].sort((a, b) =>
      a.colonist.identity.id < b.colonist.identity.id ? -1 : a.colonist.identity.id > b.colonist.identity.id ? 1 : 0,
    ),
    prng: createPrng(1),
    hasBootstrapped: true,
    eventLog: createEventLog(),
    decisionLog: createDecisionLog(),
    relationships: createRelationshipStore(),
    socialOffers: createSocialOfferStore(),
  };
}

function activeComforter(id: string, recipientId: string): ColonistRuntime {
  const goal = comfortGoal(recipientId);
  const colonist = withCurrentGoal(createColonist(id, id), goal);
  return {
    colonist,
    execution: beginExecution(taskDefinition("comfort"), goal, 0),
    suspendedExecution: null,
    ...createFreshMemoryBaselines(),
  };
}

function suspendedComforter(id: string, recipientId: string): ColonistRuntime {
  const goal = comfortGoal(recipientId, "suspended");
  const colonist = withSuspendedGoal(withCurrentGoal(createColonist(id, id), null), goal);
  const begun = beginExecution(taskDefinition("comfort"), { ...goal, status: "active" }, 0);
  return {
    colonist,
    execution: null,
    suspendedExecution: interruptExecution(begun),
    ...createFreshMemoryBaselines(),
  };
}

function idleColonist(id: string): ColonistRuntime {
  return {
    colonist: createColonist(id, id),
    execution: null,
    suspendedExecution: null,
    ...createFreshMemoryBaselines(),
  };
}

describe("buildComfortParticipationBasis", () => {
  it("records active recipients and participants; suspended claims without relief", () => {
    const basis = buildComfortParticipationBasis([
      activeComforter("a", "c"),
      suspendedComforter("b", "d"),
      idleColonist("c"),
      idleColonist("d"),
    ]);
    expect([...basis.recipients.entries()]).toEqual([["c", "a"]]);
    expect([...basis.participants]).toEqual(["a"]);
    expect([...basis.claimedRecipients].sort()).toEqual(["c", "d"]);
  });

  it("fail-closed: mismatched suspended goal key contributes no claim", () => {
    const goal = comfortGoal("c", "suspended");
    const colonist = withSuspendedGoal(withCurrentGoal(createColonist("a", "a"), null), {
      ...goal,
      key: "voluntary:social:comfort:other",
    });
    const begun = beginExecution(taskDefinition("comfort"), { ...goal, status: "active" }, 0);
    const mismatched: ColonistRuntime = {
      colonist,
      execution: null,
      suspendedExecution: interruptExecution(begun),
      ...createFreshMemoryBaselines(),
    };
    const basis = buildComfortParticipationBasis([mismatched, idleColonist("c")]);
    expect(basis.claimedRecipients.size).toBe(0);
    expect(basis.recipients.size).toBe(0);
  });
});

describe("validateSimulationState — one-comforter invariant", () => {
  it("rejects two active comfort executions naming the same recipient", () => {
    expect(() =>
      validateSimulationState(
        baseState([activeComforter("a", "c"), activeComforter("b", "c"), idleColonist("c")]),
      ),
    ).toThrow(/ADR-24 Invariant 12/);
  });

  it("rejects one active and one suspended comfort naming the same recipient", () => {
    expect(() =>
      validateSimulationState(
        baseState([activeComforter("a", "c"), suspendedComforter("b", "c"), idleColonist("c")]),
      ),
    ).toThrow(/ADR-24 Invariant 12/);
  });

  it("accepts a single active comfort claim", () => {
    expect(() => validateSimulationState(baseState([activeComforter("a", "c"), idleColonist("c")]))).not.toThrow();
  });
});

describe("collectComfortClaims", () => {
  it("lists every comforter per recipient", () => {
    const claims = collectComfortClaims([activeComforter("a", "c")]);
    expect(claims.get("c")).toEqual(["a"]);
  });

  it("counts both active and suspended claims when one comforter holds distinct recipients", () => {
    const goalActive = comfortGoal("d");
    const goalSuspended = comfortGoal("c", "suspended");
    const colonist = withSuspendedGoal(withCurrentGoal(createColonist("a", "a"), goalActive), goalSuspended);
    const begunActive = beginExecution(taskDefinition("comfort"), goalActive, 0);
    const begunSuspended = beginExecution(taskDefinition("comfort"), { ...goalSuspended, status: "active" }, 0);
    const both: ColonistRuntime = {
      colonist,
      execution: begunActive,
      suspendedExecution: interruptExecution(begunSuspended),
      ...createFreshMemoryBaselines(),
    };
    // Hand-built: active→d and suspended→c. Admission basis claims both; validation must too.
    const claims = collectComfortClaims([both]);
    expect([...claims.keys()].sort()).toEqual(["c", "d"]);
    expect(claims.get("c")).toEqual(["a"]);
    expect(claims.get("d")).toEqual(["a"]);
  });
});
