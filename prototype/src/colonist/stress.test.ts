// M7 Stress System tests — accumulation, dissipation, clamping, attribution, purity.

import { describe, expect, it } from "vitest";
import { STRESS_TUNING } from "../config/tuning.js";
import { createNeeds, decayNeeds, restoreNeed, type NeedsState } from "./needs.js";
import {
  createStress,
  evaluateStress,
  exceedsTaskAcceptanceThreshold,
  isStressedState,
  stressResponseConflictMultiplier,
  type StressState,
} from "./stress.js";
import type { TraitId } from "./traits.js";

function fullySatisfied(): NeedsState {
  return createNeeds();
}

describe("initial state", () => {
  it("starts unstressed", () => {
    expect(createStress().level).toBe(0);
  });
});

describe("accumulation — sustained unmet psychological needs", () => {
  it("accumulates stress when a psychological need is low and no relief is simultaneously active", () => {
    // Rest held mid-band (neither low nor satisfied) so rest-adequacy relief does not mask
    // the accumulation under test — isolating one channel from the others it composes with.
    const needs = {
      ...fullySatisfied(),
      rest: { level: 0.5, ticksBelowLow: 0 },
      social: { level: 0.1, ticksBelowLow: 500 },
    };
    const result = evaluateStress(createStress(), needs, 100);
    expect(result.state.level).toBeGreaterThan(0);
  });

  it("net movement can go negative when relief outweighs a single unmet need (both channels are real, not a bug)", () => {
    // With Rest satisfied, restAdequacy relief (-0.08) outweighs one low psych need's
    // accumulation (+0.03) at the current provisional rates — demonstrates the channels
    // compose additively rather than the accumulation source taking silent priority.
    const needs = { ...fullySatisfied(), social: { level: 0.1, ticksBelowLow: 500 } };
    const result = evaluateStress(createStress(), needs, 100);
    const psych = result.contributions.find((x) => x.id === "psychNeedDeprivation")!.rawDelta;
    const rest = result.contributions.find((x) => x.id === "restAdequacy")!.rawDelta;
    expect(psych).toBeGreaterThan(0);
    expect(psych + rest).toBeLessThan(0);
    expect(result.state.level).toBe(0);
  });

  it("attributes the accumulation to psychNeedDeprivation", () => {
    const needs = { ...fullySatisfied(), social: { level: 0.1, ticksBelowLow: 500 } };
    const result = evaluateStress(createStress(), needs, 100);
    const c = result.contributions.find((x) => x.id === "psychNeedDeprivation")!;
    expect(c.rawDelta).toBeGreaterThan(0);
  });

  it("contributes zero when no psychological need is low", () => {
    const result = evaluateStress(createStress(), fullySatisfied(), 100);
    const c = result.contributions.find((x) => x.id === "psychNeedDeprivation")!;
    expect(c.rawDelta).toBe(0);
  });

  it("is decomposable: the psychNeedDeprivation channel is independently attributable, not folded into a total", () => {
    const needs = {
      ...fullySatisfied(),
      rest: { level: 0.5, ticksBelowLow: 0 },
      social: { level: 0.1, ticksBelowLow: 500 },
    };
    const result = evaluateStress(createStress(), needs, 100);
    const psych = result.contributions.find((x) => x.id === "psychNeedDeprivation");
    expect(psych).toBeDefined();
    expect(psych!.rawDelta).toBeGreaterThan(0);
  });

  it("is deterministic: identical need state and tick span produce identical attribution", () => {
    const needs = {
      ...fullySatisfied(),
      rest: { level: 0.5, ticksBelowLow: 0 },
      social: { level: 0.1, ticksBelowLow: 500 },
      purpose: { level: 0.15, ticksBelowLow: 300 },
    };
    const first = evaluateStress(createStress(), needs, 100);
    const second = evaluateStress(createStress(), needs, 100);
    expect(second).toEqual(first);
  });

  it("OBSERVED (not contracted) behavior: more low psychological needs currently produce a larger contribution — Prototype Stage 1 provisional aggregation strategy, not an architectural invariant; a future aggregation may change this shape without an ADR", () => {
    const oneLow = { ...fullySatisfied(), social: { level: 0.1, ticksBelowLow: 500 } };
    const twoLow = { ...oneLow, purpose: { level: 0.1, ticksBelowLow: 500 } };
    const oneC = evaluateStress(createStress(), oneLow, 100).contributions.find(
      (x) => x.id === "psychNeedDeprivation",
    )!.rawDelta;
    const twoC = evaluateStress(createStress(), twoLow, 100).contributions.find(
      (x) => x.id === "psychNeedDeprivation",
    )!.rawDelta;
    expect(twoC).toBeGreaterThan(oneC);
  });
});

describe("accumulation — sustained biological strain (low, not critical)", () => {
  it("accumulates stress when a biological need is low but not critical", () => {
    const needs = { ...fullySatisfied(), hunger: { level: 0.3, ticksBelowLow: 500 } };
    const result = evaluateStress(createStress(), needs, 100);
    const c = result.contributions.find((x) => x.id === "biologicalStrain")!;
    expect(c.rawDelta).toBeGreaterThan(0);
  });

  it("REGRESSION: crossing from low into critical does not make the biologicalStrain contribution disappear — priority override (ADR-01 tier 2) and stress accumulation are separate concerns", () => {
    const lowNeeds = { ...fullySatisfied(), hunger: { level: 0.2, ticksBelowLow: 500 } };
    const criticalNeeds = { ...fullySatisfied(), hunger: { level: 0, ticksBelowLow: 500 } };
    const lowResult = evaluateStress(createStress(), lowNeeds, 100);
    const criticalResult = evaluateStress(createStress(), criticalNeeds, 100);
    const lowContribution = lowResult.contributions.find((x) => x.id === "biologicalStrain")!.rawDelta;
    const criticalContribution = criticalResult.contributions.find((x) => x.id === "biologicalStrain")!.rawDelta;
    expect(lowContribution).toBeGreaterThan(0);
    expect(criticalContribution).toBeGreaterThan(0);
  });

  it("does not attribute biological strain to a low psychological need", () => {
    const needs = { ...fullySatisfied(), social: { level: 0.1, ticksBelowLow: 500 } };
    const result = evaluateStress(createStress(), needs, 100);
    const c = result.contributions.find((x) => x.id === "biologicalStrain")!;
    expect(c.rawDelta).toBe(0);
  });

  it("REGRESSION (Copilot-confirmed): honors a trait-shifted low threshold, consistent with M6/decision generation", () => {
    // "driven" shifts Rest's low threshold down by 0.05 (default 0.35 -> 0.30). At level 0.32:
    // untraited reads this as low (0.32 < 0.35); traited reads it as NOT low (0.32 >= 0.30).
    // Before the fix, evaluateStress always used the untraited threshold, so a driven
    // colonist accrued biologicalStrain stress for a level M6/decision generation had already
    // stopped treating as deprived — an inconsistency between systems reading the same fact.
    const needs = { ...fullySatisfied(), rest: { level: 0.32, ticksBelowLow: 0 } };
    const untraited = evaluateStress(createStress(), needs, 100, []);
    const driven = evaluateStress(createStress(), needs, 100, ["driven"]);
    expect(untraited.contributions.find((c) => c.id === "biologicalStrain")!.rawDelta).toBeGreaterThan(0);
    expect(driven.contributions.find((c) => c.id === "biologicalStrain")!.rawDelta).toBe(0);
  });
});

describe("dissipation — rest adequacy and needs satisfied", () => {
  it("dissipates stress when Rest is satisfied", () => {
    const stressed: StressState = { level: 0.5 };
    const result = evaluateStress(stressed, fullySatisfied(), 100);
    const c = result.contributions.find((x) => x.id === "restAdequacy")!;
    expect(c.rawDelta).toBeLessThan(0);
    expect(result.state.level).toBeLessThan(0.5);
  });

  it("does not apply rest relief when Rest is not satisfied", () => {
    const needs = { ...fullySatisfied(), rest: { level: 0.5, ticksBelowLow: 0 } };
    const result = evaluateStress({ level: 0.5 }, needs, 100);
    const c = result.contributions.find((x) => x.id === "restAdequacy")!;
    expect(c.rawDelta).toBe(0);
  });

  it("applies needsSatisfied relief only when every need is satisfied", () => {
    const allSatisfied = evaluateStress({ level: 0.5 }, fullySatisfied(), 100);
    const oneUnsatisfied = evaluateStress(
      { level: 0.5 },
      { ...fullySatisfied(), purpose: { level: 0.5, ticksBelowLow: 0 } },
      100,
    );
    const withAll = allSatisfied.contributions.find((x) => x.id === "needsSatisfied")!;
    const withOne = oneUnsatisfied.contributions.find((x) => x.id === "needsSatisfied")!;
    expect(withAll.rawDelta).toBeLessThan(0);
    expect(withOne.rawDelta).toBe(0);
  });

  it("both reliefs apply simultaneously and compound when all conditions hold", () => {
    const result = evaluateStress({ level: 0.5 }, fullySatisfied(), 100);
    const restC = result.contributions.find((x) => x.id === "restAdequacy")!.rawDelta;
    const satC = result.contributions.find((x) => x.id === "needsSatisfied")!.rawDelta;
    const totalRelief = restC + satC;
    expect(result.state.level).toBeCloseTo(0.5 + totalRelief, 10);
  });
});

describe("clamping", () => {
  it("never exceeds 1 under sustained accumulation", () => {
    const needs = { ...fullySatisfied(), social: { level: 0, ticksBelowLow: 999999 }, purpose: { level: 0, ticksBelowLow: 999999 }, safety: { level: 0, ticksBelowLow: 999999 } };
    const result = evaluateStress({ level: 0.99 }, needs, 1_000_000);
    expect(result.state.level).toBe(1);
  });

  it("never drops below 0 under sustained relief", () => {
    const result = evaluateStress({ level: 0.01 }, fullySatisfied(), 1_000_000);
    expect(result.state.level).toBe(0);
  });
});

describe("attribution — every channel always present, decomposable", () => {
  it("always returns all seven channels, even when their contribution is zero", () => {
    const result = evaluateStress(createStress(), fullySatisfied(), 100);
    const ids = result.contributions.map((c) => c.id).sort();
    expect(ids).toEqual([
      "biologicalStrain",
      "hostileProximityConflict",
      "needsSatisfied",
      "overwork",
      "positiveSocialProximity",
      "psychNeedDeprivation",
      "restAdequacy",
    ]);
  });

  it("positiveSocialProximity relief applies only while isReceivingComfort", () => {
    const idle = evaluateStress(createStress(), fullySatisfied(), 100, [], false, false);
    const comforted = evaluateStress(createStress(), fullySatisfied(), 100, [], false, true);
    expect(idle.contributions.find((c) => c.id === "positiveSocialProximity")!.rawDelta).toBe(0);
    expect(comforted.contributions.find((c) => c.id === "positiveSocialProximity")!.rawDelta).toBeLessThan(0);
  });

  it("hostileProximityConflict is a one-shot spike via conflictSpike input, not rate×ticks", () => {
    const none = evaluateStress(createStress(), fullySatisfied(), 100, [], false, false, 0);
    const spiked = evaluateStress({ level: 0.2 }, fullySatisfied(), 0, [], false, false, STRESS_TUNING.hostileProximityConflictSpike);
    expect(none.contributions.find((c) => c.id === "hostileProximityConflict")!.rawDelta).toBe(0);
    expect(spiked.contributions.find((c) => c.id === "hostileProximityConflict")!.rawDelta).toBe(
      STRESS_TUNING.hostileProximityConflictSpike,
    );
    expect(spiked.state.level).toBeCloseTo(0.2 + STRESS_TUNING.hostileProximityConflictSpike, 10);
  });

  it("stressResponseConflictMultiplier returns exactly 1 for every currently-defined TraitId (hook-only)", () => {
    for (const trait of ["driven", "resilient", "gregarious", "wary"] as const satisfies readonly TraitId[]) {
      expect(stressResponseConflictMultiplier([trait])).toBe(1);
    }
    expect(stressResponseConflictMultiplier([])).toBe(1);
  });

  it("overwork accumulates only while executing the shift-assignment task (isWorking=true)", () => {
    const idle = evaluateStress(createStress(), fullySatisfied(), 100, [], false);
    const working = evaluateStress(createStress(), fullySatisfied(), 100, [], true);
    expect(idle.contributions.find((c) => c.id === "overwork")!.rawDelta).toBe(0);
    expect(working.contributions.find((c) => c.id === "overwork")!.rawDelta).toBeGreaterThan(0);
    // Compare from a mid-range starting level so neither result is floor-clamped to 0 — both
    // reliefs (rest adequacy, needs satisfied) are active in this fixture regardless of
    // isWorking, so the level difference isolates overwork's own contribution.
    const start: StressState = { level: 0.5 };
    const idleFromMid = evaluateStress(start, fullySatisfied(), 100, [], false);
    const workingFromMid = evaluateStress(start, fullySatisfied(), 100, [], true);
    expect(workingFromMid.state.level).toBeGreaterThan(idleFromMid.state.level);
  });

  it("contributions sum exactly to the applied delta when no clamping occurs", () => {
    const needs = { ...fullySatisfied(), social: { level: 0.1, ticksBelowLow: 500 } };
    const start: StressState = { level: 0.3 };
    const result = evaluateStress(start, needs, 50);
    const total = result.contributions.reduce((sum, c) => sum + c.rawDelta, 0);
    expect(result.state.level).toBeCloseTo(start.level + total, 10);
  });
});

describe("purity", () => {
  it("does not mutate the input stress state or need state", () => {
    const state: StressState = { level: 0.4 };
    const needs = decayNeeds(fullySatisfied(), 500);
    const stateSnapshot = { ...state };
    const needsSnapshot = JSON.parse(JSON.stringify(needs));
    evaluateStress(state, needs, 100);
    expect(state).toEqual(stateSnapshot);
    expect(needs).toEqual(needsSnapshot);
  });

  it("same inputs produce the same result", () => {
    const state: StressState = { level: 0.2 };
    const needs = restoreNeed(decayNeeds(fullySatisfied(), 300), "hunger", 20);
    expect(evaluateStress(state, needs, 40)).toEqual(evaluateStress(state, needs, 40));
  });

  it("rejects non-integer or negative tick counts", () => {
    expect(() => evaluateStress(createStress(), fullySatisfied(), 1.5)).toThrow();
    expect(() => evaluateStress(createStress(), fullySatisfied(), -1)).toThrow();
  });
});

describe("behavioral thresholds", () => {
  it("isStressedState reflects the configured threshold", () => {
    expect(isStressedState({ level: STRESS_TUNING.stressedStateThreshold })).toBe(true);
    expect(isStressedState({ level: STRESS_TUNING.stressedStateThreshold - 0.01 })).toBe(false);
  });

  it("exceedsTaskAcceptanceThreshold reflects the configured threshold", () => {
    expect(exceedsTaskAcceptanceThreshold({ level: STRESS_TUNING.taskAcceptanceThreshold })).toBe(true);
    expect(exceedsTaskAcceptanceThreshold({ level: STRESS_TUNING.taskAcceptanceThreshold - 0.01 })).toBe(false);
  });
});
