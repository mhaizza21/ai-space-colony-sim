// M12 execution lifecycle tests — begin, progress, complete, interrupt, resume, abort,
// consequence application, deterministic execution, purity, immutability.

import { describe, expect, it } from "vitest";
import { STRESS_TUNING, TASK_TUNING } from "../config/tuning.js";
import { createNeeds, isSatisfied } from "../colonist/needs.js";
import { createWorld, consumeFood } from "../world/world.js";
import { commitGoal, type Goal } from "../decision/goals.js";
import { taskDefinition } from "./tasks.js";
import {
  abortExecution,
  ambientStateFor,
  applyProgressConsequences,
  beginExecution,
  completeExecution,
  interruptExecution,
  progressExecution,
  resumeExecution,
  type Execution,
} from "./execution.js";

const eatGoal: Goal = commitGoal({ source: "lowNeed", tier: 4, key: "lowNeed:hunger", baseUrgency: 0.4, relatedNeed: "hunger" }, "m", 0);
const eatTask = taskDefinition("eatAtFoodStation");
const workGoal: Goal = commitGoal({ source: "shiftAssignment", tier: 3, key: "shiftAssignment:work", baseUrgency: 0.5 }, "m", 0);
const workTask = taskDefinition("workAtWorkstation");

describe("begin", () => {
  it("starts a new execution in progress, at zero elapsed ticks", () => {
    const exec = beginExecution(eatTask, eatGoal, 10);
    expect(exec.status).toBe("inProgress");
    expect(exec.elapsedTicks).toBe(0);
    expect(exec.startedAtTick).toBe(10);
    expect(exec.taskId).toBe("eatAtFoodStation");
    expect(exec.goalKey).toBe("lowNeed:hunger");
  });
});

describe("progress", () => {
  it("accumulates elapsed ticks while in progress", () => {
    const exec = progressExecution(beginExecution(eatTask, eatGoal, 0), 50);
    expect(exec.elapsedTicks).toBe(50);
    expect(progressExecution(exec, 25).elapsedTicks).toBe(75);
  });

  it("throws when progressing a non-inProgress execution", () => {
    const completed = completeExecution(beginExecution(eatTask, eatGoal, 0));
    expect(() => progressExecution(completed, 10)).toThrow();
  });

  it("rejects non-integer or negative deltaTicks", () => {
    const exec = beginExecution(eatTask, eatGoal, 0);
    expect(() => progressExecution(exec, 1.5)).toThrow();
    expect(() => progressExecution(exec, -1)).toThrow();
  });
});

describe("complete", () => {
  it("inProgress → completed", () => {
    expect(completeExecution(beginExecution(eatTask, eatGoal, 0)).status).toBe("completed");
  });

  it("throws completing an already-completed or interrupted execution", () => {
    const completed = completeExecution(beginExecution(eatTask, eatGoal, 0));
    expect(() => completeExecution(completed)).toThrow();
    const interrupted = interruptExecution(beginExecution(eatTask, eatGoal, 0));
    expect(() => completeExecution(interrupted)).toThrow();
  });
});

describe("interrupt", () => {
  it("inProgress → interrupted, preserving elapsedTicks", () => {
    const progressed = progressExecution(beginExecution(eatTask, eatGoal, 0), 40);
    const interrupted = interruptExecution(progressed);
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.elapsedTicks).toBe(40);
  });

  it("throws interrupting a non-inProgress execution", () => {
    const completed = completeExecution(beginExecution(eatTask, eatGoal, 0));
    expect(() => interruptExecution(completed)).toThrow();
  });
});

describe("resume", () => {
  it("interrupted → inProgress, resuming from the same elapsedTicks — never restarts", () => {
    const progressed = progressExecution(beginExecution(eatTask, eatGoal, 0), 40);
    const interrupted = interruptExecution(progressed);
    const resumed = resumeExecution(interrupted);
    expect(resumed.status).toBe("inProgress");
    expect(resumed.elapsedTicks).toBe(40);
    // Progress continues from where it left off.
    expect(progressExecution(resumed, 10).elapsedTicks).toBe(50);
  });

  it("throws resuming a non-interrupted execution", () => {
    const exec = beginExecution(eatTask, eatGoal, 0);
    expect(() => resumeExecution(exec)).toThrow();
  });
});

describe("abort", () => {
  it("inProgress → aborted", () => {
    expect(abortExecution(beginExecution(eatTask, eatGoal, 0)).status).toBe("aborted");
  });

  it("interrupted → aborted", () => {
    expect(abortExecution(interruptExecution(beginExecution(eatTask, eatGoal, 0))).status).toBe("aborted");
  });

  it("throws aborting an already-completed or already-aborted execution", () => {
    const completed = completeExecution(beginExecution(eatTask, eatGoal, 0));
    expect(() => abortExecution(completed)).toThrow();
    const aborted = abortExecution(beginExecution(eatTask, eatGoal, 0));
    expect(() => abortExecution(aborted)).toThrow();
  });
});

describe("owned consequences — no world mutation beyond the task's own effect", () => {
  it("eating restores hunger and consumes food, nothing else", () => {
    const needs = { ...createNeeds(), hunger: { level: 0.3, ticksBelowLow: 500 } };
    const world = createWorld();
    const result = applyProgressConsequences("eatAtFoodStation", needs, world, 100);
    expect(result.needs!.hunger.level).toBeGreaterThan(needs.hunger.level);
    expect(result.world!.foodStock).toBeLessThan(world.foodStock);
    // Nothing else about needs changed.
    for (const id of ["rest", "safety", "social", "purpose"] as const) {
      expect(result.needs![id]).toEqual(needs[id]);
    }
  });

  it("food consumption clamps at 0 stock even under long progress", () => {
    const needs = createNeeds();
    const world = createWorld();
    const result = applyProgressConsequences("eatAtFoodStation", needs, world, 1_000_000);
    expect(result.world!.foodStock).toBe(0);
  });

  it("REGRESSION (Copilot-confirmed): hunger restoration scales to the food actually consumed, not the full tick span, once stock is exhausted mid-span", () => {
    const needs = { ...createNeeds(), hunger: { level: 0.3, ticksBelowLow: 500 } };
    const deltaTicks = 10; // small enough that full restoration stays well under the [0,1] ceiling
    const fullConsumption = TASK_TUNING.foodConsumptionPerTick * deltaTicks;

    // Case 1: plenty of stock — full restoration for the full span.
    const wellStocked = createWorld();
    const fullResult = applyProgressConsequences("eatAtFoodStation", needs, wellStocked, deltaTicks);

    // Case 2: only HALF the food this span would need is left in stock.
    const halfStock = consumeFood(wellStocked, wellStocked.foodStock - fullConsumption / 2);
    const halfResult = applyProgressConsequences("eatAtFoodStation", needs, halfStock, deltaTicks);
    const fullRestoreAmount = fullResult.needs!.hunger.level - needs.hunger.level;
    const halfRestoreAmount = halfResult.needs!.hunger.level - needs.hunger.level;
    expect(halfRestoreAmount).toBeCloseTo(fullRestoreAmount / 2, 10);

    // Case 3: NO food left at all — the defect's sharpest case: the old code granted a full
    // tick span's restoration even at zero consumption; the fix must grant none.
    const emptyStock = consumeFood(wellStocked, wellStocked.foodStock);
    const emptyResult = applyProgressConsequences("eatAtFoodStation", needs, emptyStock, deltaTicks);
    expect(emptyResult.needs!.hunger.level).toBe(needs.hunger.level); // unchanged — no free restoration
    expect(emptyResult.world!.foodStock).toBe(0);
  });

  it("REGRESSION (Copilot-confirmed): threads the colonist's traits through so ticksBelowLow retracks against the trait-shifted threshold, not the default one", () => {
    // "driven" shifts Rest's low threshold down by 0.05 (default 0.35 -> 0.30). Restoring rest
    // to 0.32 sits ABOVE the trait-shifted threshold (no longer low) but BELOW the default one
    // (still low, if traits are silently dropped) — the two callers must agree.
    const needs = { ...createNeeds(), rest: { level: 0.28, ticksBelowLow: 500 } };
    const world = createWorld();
    // Enough ticks to cross 0.28 -> ~0.32 at restorePerTick=0.004 (needs 1 tick's worth of headroom).
    const untraited = applyProgressConsequences("restAtBunk", needs, world, 10, []);
    const driven = applyProgressConsequences("restAtBunk", needs, world, 10, ["driven"]);
    expect(untraited.needs!.rest.level).toBe(driven.needs!.rest.level); // same restoration amount either way
    expect(untraited.needs!.rest.ticksBelowLow).toBeGreaterThan(0); // untraited: still reads as low -> counter keeps running
    expect(driven.needs!.rest.ticksBelowLow).toBe(0); // driven: correctly reads as no-longer-low -> counter resets
  });

  it("resting restores rest and touches no world state", () => {
    const needs = { ...createNeeds(), rest: { level: 0.2, ticksBelowLow: 500 } };
    const world = createWorld();
    const result = applyProgressConsequences("restAtBunk", needs, world, 100);
    expect(result.needs!.rest.level).toBeGreaterThan(needs.rest.level);
    expect(result.world).toBeUndefined();
  });

  it("working and idling produce no needs/world consequence in Stage 1", () => {
    const needs = createNeeds();
    const world = createWorld();
    expect(applyProgressConsequences("workAtWorkstation", needs, world, 100)).toEqual({});
    expect(applyProgressConsequences("idlePresence", needs, world, 100)).toEqual({});
  });

  it("does not mutate the input needs or world", () => {
    const needs = { ...createNeeds(), hunger: { level: 0.3, ticksBelowLow: 500 } };
    const world = createWorld();
    const needsSnapshot = JSON.parse(JSON.stringify(needs));
    const worldSnapshot = JSON.parse(JSON.stringify(world));
    applyProgressConsequences("eatAtFoodStation", needs, world, 50);
    expect(needs).toEqual(needsSnapshot);
    expect(world).toEqual(worldSnapshot);
  });
});

describe("completion via satisfaction — integration with needs.ts's own satisfaction query", () => {
  it("progress eventually satisfies the need it serves", () => {
    let needs = { ...createNeeds(), hunger: { level: 0.3, ticksBelowLow: 500 } };
    let world = createWorld();
    let exec: Execution = beginExecution(eatTask, eatGoal, 0);
    for (let i = 0; i < 200 && !isSatisfied("hunger", needs.hunger.level); i++) {
      const consequences = applyProgressConsequences("eatAtFoodStation", needs, world, 10);
      needs = consequences.needs ?? needs;
      world = consequences.world ?? world;
      exec = progressExecution(exec, 10);
    }
    expect(isSatisfied("hunger", needs.hunger.level)).toBe(true);
    const completed = completeExecution(exec);
    expect(completed.status).toBe("completed");
  });
});

describe("determinism", () => {
  it("identical progress sequences from identical starting states produce identical results", () => {
    const needs = { ...createNeeds(), hunger: { level: 0.3, ticksBelowLow: 500 } };
    const world = createWorld();
    const a = applyProgressConsequences("eatAtFoodStation", needs, world, 77);
    const b = applyProgressConsequences("eatAtFoodStation", needs, world, 77);
    expect(a).toEqual(b);
  });

  it("lifecycle transitions are deterministic and pure — do not mutate the input execution", () => {
    const exec = beginExecution(eatTask, eatGoal, 0);
    const snapshot = { ...exec };
    progressExecution(exec, 10);
    expect(exec).toEqual(snapshot);
  });
});

describe("workAtWorkstation lifecycle (a non-need-driven task) exercises the same state machine", () => {
  it("begins, progresses, and completes like any other task", () => {
    const exec = beginExecution(workTask, workGoal, 0);
    const progressed = progressExecution(exec, 480);
    expect(completeExecution(progressed).status).toBe("completed");
  });
});

describe("REGRESSION (Copilot-confirmed): ambientStateFor — the seven-state observable registry #103 requires", () => {
  const calm = { level: 0 };
  const stressed = { level: STRESS_TUNING.stressedStateThreshold };

  it("maps each in-progress task to its ambient state", () => {
    expect(ambientStateFor(beginExecution(workTask, workGoal, 0), calm)).toBe("working");
    expect(ambientStateFor(beginExecution(eatTask, eatGoal, 0), calm)).toBe("eating");
    const restTask = taskDefinition("restAtBunk");
    const restGoal = commitGoal({ source: "lowNeed", tier: 4, key: "lowNeed:rest", baseUrgency: 0.4, relatedNeed: "rest" }, "m", 0);
    expect(ambientStateFor(beginExecution(restTask, restGoal, 0), calm)).toBe("resting");
  });

  it("no execution at all reads as blocked — 'motionless, not resting, not on task'", () => {
    expect(ambientStateFor(null, calm)).toBe("blocked");
  });

  it("a non-inProgress execution (e.g. just completed or aborted) also reads as blocked, not its former task", () => {
    const completed = completeExecution(beginExecution(workTask, workGoal, 0));
    expect(ambientStateFor(completed, calm)).toBe("blocked");
  });

  it("stress overrides the task-based reading regardless of what is executing", () => {
    expect(ambientStateFor(beginExecution(workTask, workGoal, 0), stressed)).toBe("stressed");
    expect(ambientStateFor(null, stressed)).toBe("stressed");
  });

  it("inConflict overlay outranks stressed while currentTick < inConflictUntilTick (design D6)", () => {
    expect(ambientStateFor(beginExecution(workTask, workGoal, 0), stressed, 10, 5)).toBe("inConflict");
    expect(ambientStateFor(null, stressed, 10, 5)).toBe("inConflict");
    // Window ended: reverts to stressed
    expect(ambientStateFor(beginExecution(workTask, workGoal, 0), stressed, 10, 10)).toBe("stressed");
    expect(ambientStateFor(beginExecution(workTask, workGoal, 0), calm, 10, 10)).toBe("working");
  });

  it("is pure and deterministic", () => {
    const exec = beginExecution(workTask, workGoal, 0);
    expect(ambientStateFor(exec, calm)).toBe(ambientStateFor(exec, calm));
  });
});
