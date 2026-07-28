// M12 task resolution tests — goal → task mapping, executable vs blocked, eligibility,
// availability, determinism, purity.

import { describe, expect, it } from "vitest";
import { createClock, advance } from "../core/clock.js";
import { createDefaultPolicy } from "../world/policy.js";
import { createWorld, setModuleFunctional, consumeFood } from "../world/world.js";
import { buildSnapshot, type WorldSnapshot } from "../world/snapshot.js";
import { commitGoal, type Goal, type GoalCandidate } from "../decision/goals.js";
import { checkAvailability, checkEligibility, isTaskComplete, resolveTask, taskDefinition } from "./tasks.js";

const policy = createDefaultPolicy();
const world = createWorld();
const workSnapshot: WorldSnapshot = buildSnapshot(advance(createClock(), 0), policy, world);
const freeSnapshot: WorldSnapshot = buildSnapshot(advance(createClock(), policy.workTicks + policy.restTicks), policy, world);

function goalFor(candidate: GoalCandidate): Goal {
  return commitGoal(candidate, "test", 0);
}

const assignmentGoal = goalFor({ source: "shiftAssignment", tier: 3, key: "shiftAssignment:work", baseUrgency: 0.5 });
const hungerGoal = goalFor({ source: "lowNeed", tier: 4, key: "lowNeed:hunger", baseUrgency: 0.4, relatedNeed: "hunger" });
const restGoal = goalFor({ source: "criticalNeed", tier: 2, key: "criticalNeed:rest", baseUrgency: 0.9, relatedNeed: "rest" });
const voluntaryGoal = goalFor({ source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 });
const socialVoluntaryGoal = goalFor({
  source: "voluntary",
  tier: 5,
  key: "voluntary:social:zeke",
  baseUrgency: 0.2,
  relatedColonistId: "zeke",
  relatedSocialTaskId: "conversation",
});
const sharedDowntimeVoluntaryGoal = goalFor({
  source: "voluntary",
  tier: 5,
  key: "voluntary:social:sharedDowntime:zeke",
  baseUrgency: 0.2,
  relatedColonistId: "zeke",
  relatedSocialTaskId: "sharedDowntime",
});
const safetyGoal = goalFor({ source: "lowNeed", tier: 4, key: "lowNeed:safety", baseUrgency: 0.3, relatedNeed: "safety" });
const socialGoal = goalFor({ source: "lowNeed", tier: 4, key: "lowNeed:social", baseUrgency: 0.3, relatedNeed: "social" });
const purposeGoal = goalFor({ source: "lowNeed", tier: 4, key: "lowNeed:purpose", baseUrgency: 0.3, relatedNeed: "purpose" });
const survivalGoal = goalFor({ source: "survivalCondition", tier: 1, key: "survivalCondition:x", baseUrgency: 999 });

describe("goal → task mapping", () => {
  it("shiftAssignment maps to workAtWorkstation", () => {
    const r = resolveTask(assignmentGoal, [], workSnapshot);
    expect(r.kind).toBe("executable");
    if (r.kind === "executable") expect(r.task.id).toBe("workAtWorkstation");
  });

  it("hunger need goals map to eatAtFoodStation", () => {
    const r = resolveTask(hungerGoal, [], workSnapshot);
    if (r.kind === "executable") expect(r.task.id).toBe("eatAtFoodStation");
  });

  it("rest need goals map to restAtBunk", () => {
    const r = resolveTask(restGoal, [], workSnapshot);
    if (r.kind === "executable") expect(r.task.id).toBe("restAtBunk");
  });

  it("voluntary maps to idlePresence", () => {
    const r = resolveTask(voluntaryGoal, [], workSnapshot);
    if (r.kind === "executable") expect(r.task.id).toBe("idlePresence");
  });

  it("safety/social/purpose need goals have no serving task — correctly blocked (Social unsatisfiable at 1 colonist)", () => {
    for (const goal of [safetyGoal, socialGoal, purposeGoal]) {
      const r = resolveTask(goal, [], workSnapshot);
      expect(r.kind).toBe("blocked");
    }
  });

  it("survivalCondition has no Stage 1 response task — correctly blocked", () => {
    const r = resolveTask(survivalGoal, [], workSnapshot);
    expect(r.kind).toBe("blocked");
  });
});

describe("executable vs blocked outcomes", () => {
  it("is executable when the module is functional and stocked", () => {
    expect(resolveTask(hungerGoal, [], workSnapshot).kind).toBe("executable");
  });

  it("is blocked when the required module is not functional", () => {
    const brokenWorld = setModuleFunctional(world, "foodStation", false);
    const brokenSnapshot = buildSnapshot(createClock(), policy, brokenWorld);
    const r = resolveTask(hungerGoal, [], brokenSnapshot);
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") {
      expect(r.reasons.some((reason) => reason.includes("not functional"))).toBe(true);
      expect(r.goal.status).toBe("blocked");
    }
  });

  it("is blocked when the food station has no stock", () => {
    const depletedWorld = consumeFood(world, 100);
    const depletedSnapshot = buildSnapshot(createClock(), policy, depletedWorld);
    const r = resolveTask(hungerGoal, [], depletedSnapshot);
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") expect(r.reasons.some((reason) => reason.includes("no food stock"))).toBe(true);
  });

  it("blocked goals originate ONLY from task resolution, not from the goal as committed", () => {
    // The goal as committed by decide.ts/goals.ts is always "active" — resolveTask is the
    // only place that ever calls blockGoal (structural claim, demonstrated by observing the
    // status transition happen here and only here).
    expect(hungerGoal.status).toBe("active");
    const brokenWorld = setModuleFunctional(world, "foodStation", false);
    const r = resolveTask(hungerGoal, [], buildSnapshot(createClock(), policy, brokenWorld));
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") {
      expect(r.goal.status).toBe("blocked");
      expect(hungerGoal.status).toBe("active"); // original goal untouched (purity)
    }
  });

  it("throws when resolving a non-active goal", () => {
    const alreadyBlocked = { ...hungerGoal, status: "blocked" as const };
    expect(() => resolveTask(alreadyBlocked, [], workSnapshot)).toThrow();
  });
});

describe("eligibility — the real skill ∩ permission ∩ requirement intersection", () => {
  it("a task with no required skill is eligible regardless of the colonist's skills", () => {
    const task = taskDefinition("workAtWorkstation");
    expect(checkEligibility(task, [], workSnapshot).eligible).toBe(true);
  });

  it("a hand-built task requiring a skill the colonist lacks is ineligible (proves the intersection is real)", () => {
    const skilledTask = { id: "workAtWorkstation" as const, taskClass: "assignment" as const, moduleId: "workstation" as const, requiredSkill: "medical" };
    const result = checkEligibility(skilledTask, ["engineering"], workSnapshot);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("medical"))).toBe(true);
  });

  it("a colonist holding the required skill is eligible", () => {
    const skilledTask = { id: "workAtWorkstation" as const, taskClass: "assignment" as const, moduleId: "workstation" as const, requiredSkill: "medical" };
    expect(checkEligibility(skilledTask, ["medical"], workSnapshot).eligible).toBe(true);
  });
});

describe("availability — read only through WorldSnapshot", () => {
  it("checkAvailability never receives a WorldState — only WorldSnapshot (type-level guarantee)", () => {
    const task = taskDefinition("eatAtFoodStation");
    expect(checkAvailability(task, workSnapshot).available).toBe(true);
  });

  it("a task with no module requirement is always available on module grounds", () => {
    const task = taskDefinition("idlePresence");
    const brokenWorld = setModuleFunctional(world, "workstation", false);
    expect(checkAvailability(task, buildSnapshot(createClock(), policy, brokenWorld)).available).toBe(true);
  });
});

describe("ADR-18 social task vocabulary (Build Step 1 — data only, not yet wired)", () => {
  const socialTaskIds = ["conversation", "sharedDowntime", "sharedMeal", "comfort", "assist", "confrontation"] as const;

  it("all six ADR-18 social action task kinds exist and resolve to a definition", () => {
    for (const id of socialTaskIds) {
      const task = taskDefinition(id);
      expect(task.id).toBe(id);
    }
  });

  it("the six social task ids are distinct from each other and from the Stage 1 task ids", () => {
    const allIds = [...socialTaskIds, "workAtWorkstation", "eatAtFoodStation", "restAtBunk", "idlePresence"];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("all six social tasks belong to the social task class", () => {
    for (const id of socialTaskIds) {
      expect(taskDefinition(id).taskClass).toBe("social");
    }
  });

  it("solo voluntary still resolves to idlePresence", () => {
    const r = resolveTask(voluntaryGoal, [], workSnapshot);
    expect(r.kind).toBe("executable");
    if (r.kind === "executable") expect(r.task.id).toBe("idlePresence");
  });

  it("social voluntary resolves to the first reachable sought social action, not idlePresence", () => {
    const r = resolveTask(socialVoluntaryGoal, [], workSnapshot);
    expect(r.kind).toBe("executable");
    if (r.kind === "executable") {
      expect(r.task.id).toBe("conversation");
      expect(r.task.id).not.toBe("confrontation");
    }
  });

  it("shared-downtime social voluntary resolves to sharedDowntime, not conversation", () => {
    const r = resolveTask(sharedDowntimeVoluntaryGoal, [], workSnapshot);
    expect(r.kind).toBe("executable");
    if (r.kind === "executable") expect(r.task.id).toBe("sharedDowntime");
  });

  it("social need goals still find no serving task — social vocabulary exists but is not wired to any candidate source", () => {
    const r = resolveTask(socialGoal, [], workSnapshot);
    expect(r.kind).toBe("blocked");
  });

  it("reachable companionship tasks complete when free time ends", () => {
    expect(isTaskComplete("conversation", () => false, freeSnapshot)).toBe(false);
    expect(isTaskComplete("sharedDowntime", () => false, freeSnapshot)).toBe(false);
    expect(isTaskComplete("comfort", () => false, freeSnapshot)).toBe(false);
    expect(isTaskComplete("conversation", () => false, workSnapshot)).toBe(true);
    expect(isTaskComplete("sharedDowntime", () => false, workSnapshot)).toBe(true);
    expect(isTaskComplete("comfort", () => false, workSnapshot)).toBe(true);
  });

  it("assist remains unreachable vocabulary — isTaskComplete stays false for every period", () => {
    expect(isTaskComplete("assist", () => false, freeSnapshot)).toBe(false);
    expect(isTaskComplete("assist", () => false, workSnapshot)).toBe(false);
  });
});

describe("determinism", () => {
  it("identical inputs produce identical resolutions", () => {
    expect(resolveTask(hungerGoal, ["engineering"], workSnapshot)).toEqual(resolveTask(hungerGoal, ["engineering"], workSnapshot));
  });
});

describe("purity", () => {
  it("does not mutate the input goal or skills array", () => {
    const skills = ["engineering"];
    const goalSnapshot = { ...hungerGoal };
    const skillsSnapshot = [...skills];
    resolveTask(hungerGoal, skills, workSnapshot);
    expect(hungerGoal).toEqual(goalSnapshot);
    expect(skills).toEqual(skillsSnapshot);
  });
});
