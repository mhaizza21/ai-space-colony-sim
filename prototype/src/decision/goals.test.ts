// M11 goal generation + lifecycle tests — all five sources, closed vocabulary, lifecycle states.

import { describe, expect, it } from "vitest";
import { GOAL_SOURCES } from "../config/constants.js";
import { createClock, advance } from "../core/clock.js";
import { createDefaultPolicy } from "../world/policy.js";
import { createWorld } from "../world/world.js";
import { buildSnapshot, type ObservableColonist, type WorldSnapshot } from "../world/snapshot.js";
import { createNeeds, decayNeeds, type NeedsState } from "../colonist/needs.js";
import {
  abandonGoal,
  blockGoal,
  commitGoal,
  completeGoal,
  generateCandidates,
  resumeGoal,
  suspendGoal,
  unblockGoal,
  type GoalCandidate,
} from "./goals.js";

const policy = createDefaultPolicy();
const world = createWorld();

function snapshotAt(tickOfDay: number): WorldSnapshot {
  return buildSnapshot(advance(createClock(), tickOfDay), policy, world);
}

const workSnapshot = snapshotAt(0); // tick 0 is always "work" per the default policy
const freeSnapshot = snapshotAt(policy.workTicks + policy.restTicks); // first tick of "free"
const restSnapshot = snapshotAt(policy.workTicks); // first tick of "rest"

function needsWithHungerAt(level: number, ticksBelowLow = 500): NeedsState {
  return { ...createNeeds(), hunger: { level, ticksBelowLow } };
}

describe("source 1 — station survival (tier 1)", () => {
  it("generates no candidates in Stage 1 (no survival-condition data in WorldSnapshot) — structurally present, currently always empty", () => {
    const candidates = generateCandidates(workSnapshot, createNeeds());
    expect(candidates.some((c) => c.source === "survivalCondition")).toBe(false);
  });
});

describe("social candidate target preservation", () => {
  it("commitGoal carries social target/action forward without forcing later layers to parse key", () => {
    const goal = commitGoal(
      {
        source: "voluntary",
        tier: 5,
        key: "voluntary:social:conversation:zeke",
        baseUrgency: 0.2,
        relatedColonistId: "zeke",
        relatedSocialTaskId: "conversation",
      },
      "social motivation",
      100,
    );
    expect(goal.relatedColonistId).toBe("zeke");
    expect(goal.relatedSocialTaskId).toBe("conversation");
  });
});

describe("source 2 — critical biological need (tier 2)", () => {
  it("generates a candidate when a biological need is critical", () => {
    const needs = needsWithHungerAt(0); // 0 is below any critical threshold
    const candidates = generateCandidates(workSnapshot, needs);
    const c = candidates.find((x) => x.source === "criticalNeed");
    expect(c).toBeDefined();
    expect(c!.tier).toBe(2);
    expect(c!.relatedNeed).toBe("hunger");
    expect(c!.baseUrgency).toBeGreaterThan(0);
  });

  it("generates no criticalNeed candidate when no biological need is critical", () => {
    const candidates = generateCandidates(workSnapshot, createNeeds());
    expect(candidates.some((c) => c.source === "criticalNeed")).toBe(false);
  });
});

describe("source 3 — shift assignment (tier 3)", () => {
  it("generates a candidate during the work period", () => {
    const candidates = generateCandidates(workSnapshot, createNeeds());
    const c = candidates.find((x) => x.source === "shiftAssignment");
    expect(c).toBeDefined();
    expect(c!.tier).toBe(3);
  });

  it("generates no candidate outside the work period", () => {
    expect(generateCandidates(restSnapshot, createNeeds()).some((c) => c.source === "shiftAssignment")).toBe(false);
    expect(generateCandidates(freeSnapshot, createNeeds()).some((c) => c.source === "shiftAssignment")).toBe(false);
  });
});

describe("source 4 — low need satisfaction (tier 4)", () => {
  it("generates a candidate when a need is low but not critical", () => {
    const needs = needsWithHungerAt(0.3);
    const candidates = generateCandidates(workSnapshot, needs);
    const c = candidates.find((x) => x.source === "lowNeed" && x.relatedNeed === "hunger");
    expect(c).toBeDefined();
    expect(c!.tier).toBe(4);
  });

  it("does NOT generate a redundant lowNeed candidate for a need that is already critical (represented once, at tier 2)", () => {
    const needs = needsWithHungerAt(0);
    const candidates = generateCandidates(workSnapshot, needs);
    expect(candidates.some((c) => c.source === "lowNeed" && c.relatedNeed === "hunger")).toBe(false);
    expect(candidates.filter((c) => c.relatedNeed === "hunger")).toHaveLength(1); // exactly the tier-2 one
  });

  it("psychological needs (never critical) still generate lowNeed candidates", () => {
    const needs = { ...createNeeds(), social: { level: 0.1, ticksBelowLow: 500 } };
    const candidates = generateCandidates(workSnapshot, needs);
    expect(candidates.some((c) => c.source === "lowNeed" && c.relatedNeed === "social")).toBe(true);
  });
});

describe("source 5 — trait-weighted voluntary behavior (tier 5)", () => {
  it("generates a candidate during the free period", () => {
    const candidates = generateCandidates(freeSnapshot, createNeeds());
    const c = candidates.find((x) => x.source === "voluntary");
    expect(c).toBeDefined();
    expect(c!.tier).toBe(5);
  });

  it("generates no candidate outside the free period", () => {
    expect(generateCandidates(workSnapshot, createNeeds()).some((c) => c.source === "voluntary")).toBe(false);
    expect(generateCandidates(restSnapshot, createNeeds()).some((c) => c.source === "voluntary")).toBe(false);
  });
});

describe("source 5 — social voluntary candidates from nearby colonists (Stage 2 build step 6, ADR-20 D3)", () => {
  const nearby: readonly ObservableColonist[] = [
    { id: "zeke", ambientState: "idle", moduleId: null },
    { id: "yara", ambientState: "working", moduleId: "workstation" },
  ];

  it("generates companionship social candidates per snapshot-reported nearby colonist, tagged with target and action", () => {
    const snapshot = buildSnapshot(advance(createClock(), policy.workTicks + policy.restTicks), policy, world, nearby);
    const candidates = generateCandidates(snapshot, createNeeds());
    const social = candidates.filter((c) => c.relatedColonistId !== undefined);
    expect(social).toHaveLength(4);
    expect(social.map((c) => `${c.relatedSocialTaskId}:${c.relatedColonistId}`).sort()).toEqual([
      "conversation:yara",
      "conversation:zeke",
      "sharedDowntime:yara",
      "sharedDowntime:zeke",
    ]);
    expect(social.every((c) => c.source === "voluntary" && c.tier === 5)).toBe(true);
  });

  it("generates a Comfort candidate only for a nearby colonist observed stressed", () => {
    const stressedNearby: readonly ObservableColonist[] = [
      { id: "zeke", ambientState: "stressed", moduleId: null },
      { id: "yara", ambientState: "resting", moduleId: "restBunk" },
    ];
    const snapshot = buildSnapshot(advance(createClock(), policy.workTicks + policy.restTicks), policy, world, stressedNearby);
    const social = generateCandidates(snapshot, createNeeds()).filter((c) => c.relatedColonistId !== undefined);
    expect(social.map((c) => `${c.relatedSocialTaskId}:${c.relatedColonistId}`).sort()).toEqual([
      "comfort:zeke",
      "conversation:yara",
      "conversation:zeke",
      "sharedDowntime:yara",
      "sharedDowntime:zeke",
    ]);
    expect(social.every((c) => c.relatedSocialTaskId === "comfort" || c.relatedSocialTaskId === "conversation" || c.relatedSocialTaskId === "sharedDowntime")).toBe(true);
  });

  it("never produces a Confrontation-related GoalCandidate (design D3 encounter-only)", () => {
    const snapshot = buildSnapshot(advance(createClock(), policy.workTicks + policy.restTicks), policy, world, nearby);
    for (const c of generateCandidates(snapshot, createNeeds())) {
      expect(c.relatedSocialTaskId).not.toBe("confrontation");
      expect(c.key).not.toMatch(/confrontation/i);
      expect(JSON.stringify(c)).not.toMatch(/confrontation/i);
    }
  });

  it("a never-interacted nearby colonist is still reachable as a candidate — generation never consults the relationship store", () => {
    const snapshot = buildSnapshot(advance(createClock(), policy.workTicks + policy.restTicks), policy, world, nearby);
    const candidates = generateCandidates(snapshot, createNeeds());
    expect(candidates.some((c) => c.relatedColonistId === "zeke")).toBe(true);
  });

  it("generates no social candidates outside the free period, even with nearby colonists present", () => {
    const snapshot = buildSnapshot(createClock(), policy, world, nearby);
    expect(generateCandidates(snapshot, createNeeds()).some((c) => c.relatedColonistId !== undefined)).toBe(false);
  });

  it("generates no social candidates when no nearby colonists are reported (real single-colonist runs today)", () => {
    expect(generateCandidates(freeSnapshot, createNeeds()).some((c) => c.relatedColonistId !== undefined)).toBe(false);
  });
});

describe("closed goal-source vocabulary", () => {
  it("every generated candidate's source is one of the five closed GOAL_SOURCES", () => {
    const needs = needsWithHungerAt(0);
    const allPeriods = [workSnapshot, restSnapshot, freeSnapshot];
    for (const snapshot of allPeriods) {
      for (const c of generateCandidates(snapshot, needs)) {
        expect(GOAL_SOURCES).toContain(c.source);
      }
    }
  });
});

describe("determinism and purity", () => {
  it("identical inputs produce identical candidate lists", () => {
    const needs = needsWithHungerAt(0.2);
    expect(generateCandidates(workSnapshot, needs)).toEqual(generateCandidates(workSnapshot, needs));
  });

  it("does not mutate the input needs state", () => {
    const needs = decayNeeds(createNeeds(), 500);
    const snapshot = JSON.parse(JSON.stringify(needs));
    generateCandidates(workSnapshot, needs);
    expect(needs).toEqual(snapshot);
  });
});

describe("goal lifecycle", () => {
  const candidate: GoalCandidate = { source: "lowNeed", tier: 4, key: "lowNeed:hunger", baseUrgency: 0.5, relatedNeed: "hunger" };

  it("commitGoal creates an active goal with a fixed motivation", () => {
    const goal = commitGoal(candidate, "test motivation", 100);
    expect(goal.status).toBe("active");
    expect(goal.motivation).toBe("test motivation");
    expect(goal.adoptedAtTick).toBe(100);
    expect(goal.source).toBe("lowNeed");
    expect(goal.tier).toBe(4);
  });

  it("supports active → suspended → active (interruption and resume)", () => {
    const goal = commitGoal(candidate, "m", 0);
    const suspended = suspendGoal(goal);
    expect(suspended.status).toBe("suspended");
    const resumed = resumeGoal(suspended);
    expect(resumed.status).toBe("active");
  });

  it("supports active → blocked → active (unblock)", () => {
    const goal = commitGoal(candidate, "m", 0);
    const blocked = blockGoal(goal);
    expect(blocked.status).toBe("blocked");
    expect(unblockGoal(blocked).status).toBe("active");
  });

  it("supports active → completed", () => {
    expect(completeGoal(commitGoal(candidate, "m", 0)).status).toBe("completed");
  });

  it("supports active → abandoned and blocked → abandoned", () => {
    expect(abandonGoal(commitGoal(candidate, "m", 0)).status).toBe("abandoned");
    expect(abandonGoal(blockGoal(commitGoal(candidate, "m", 0))).status).toBe("abandoned");
  });

  it("supports suspended → abandoned (required for suspension overflow — tick.ts review fix 1)", () => {
    const suspended = suspendGoal(commitGoal(candidate, "m", 0));
    expect(suspended.status).toBe("suspended");
    expect(abandonGoal(suspended).status).toBe("abandoned");
  });

  it("rejects invalid transitions (e.g. completed goal cannot be suspended)", () => {
    const completed = completeGoal(commitGoal(candidate, "m", 0));
    expect(() => suspendGoal(completed)).toThrow();
    expect(() => completeGoal(completed)).toThrow();
  });

  it("blocked goal can also be suspended (goal-system: infrastructure signal, not abandoned)", () => {
    const blocked = blockGoal(commitGoal(candidate, "m", 0));
    expect(suspendGoal(blocked).status).toBe("suspended");
  });

  it("motivation never changes across lifecycle transitions", () => {
    const goal = commitGoal(candidate, "original motivation", 0);
    const suspended = suspendGoal(goal);
    const resumed = resumeGoal(suspended);
    expect(resumed.motivation).toBe("original motivation");
    expect(goal.motivation).toBe("original motivation"); // original untouched (purity)
  });

  it("lifecycle transitions are pure — do not mutate the input goal", () => {
    const goal = commitGoal(candidate, "m", 0);
    const snapshot = { ...goal };
    suspendGoal(goal);
    expect(goal).toEqual(snapshot);
  });
});
