// M11 selection tests — strict priority filtering, actionability-aware fall-through, tier-1
// immunity, seeded determinism, PRNG attribution, fixed motivation, no per-tick re-decision,
// purity.

import { describe, expect, it } from "vitest";
import { advance, createClock } from "../core/clock.js";
import { createPrng, next } from "../core/prng.js";
import { createColonist, withMemory, withNeeds, withStress } from "../colonist/colonist.js";
import { createDefaultPolicy } from "../world/policy.js";
import { createWorld, setModuleFunctional, consumeFood } from "../world/world.js";
import { buildSnapshot, type WorldSnapshot } from "../world/snapshot.js";
import type { GoalCandidate } from "./goals.js";
import { decideFromCandidates, decideNext } from "./decide.js";
import { createNeeds } from "../colonist/needs.js";
import { MEMORY_TUNING } from "../config/tuning.js";
import { influence, type MemoryEntry, type MemoryPool } from "../colonist/memory.js";
import { applyInteraction, createRelationshipStore, perspective } from "../colonist/relationships.js";
import { createDecisionLog, createEventLog } from "../records/logs.js";
import { createSocialOfferStore } from "../task/socialOffers.js";
import { createFreshMemoryBaselines, type SimulationState } from "../simulation/tick.js";
import { run } from "../simulation/run.js";

const survival: GoalCandidate = { source: "survivalCondition", tier: 1, key: "survivalCondition:z", baseUrgency: 999 };
const survival2: GoalCandidate = { source: "survivalCondition", tier: 1, key: "survivalCondition:a", baseUrgency: 1 };
const critical: GoalCandidate = { source: "criticalNeed", tier: 2, key: "criticalNeed:hunger", baseUrgency: 0.9, relatedNeed: "hunger" };
const assignment: GoalCandidate = { source: "shiftAssignment", tier: 3, key: "shiftAssignment:work", baseUrgency: 0.5 };
const lowA: GoalCandidate = { source: "lowNeed", tier: 4, key: "lowNeed:hunger", baseUrgency: 0.3, relatedNeed: "hunger" };
const lowB: GoalCandidate = { source: "lowNeed", tier: 4, key: "lowNeed:rest", baseUrgency: 0.3, relatedNeed: "rest" };
const voluntary: GoalCandidate = { source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 };

const colonist = createColonist("c1", "Maya", [], ["driven"]);
const seed = createPrng(42);

/** Every Stage 1 task executable: functional modules, full food stock, permissive policy. */
const workSnapshot: WorldSnapshot = buildSnapshot(advance(createClock(), 0), createDefaultPolicy(), createWorld());

describe("strict priority filtering", () => {
  it("the highest tier with any candidate wins, regardless of lower-tier weights", () => {
    const outcome = decideFromCandidates([survival, critical, assignment, lowA, voluntary], colonist, seed, 0, workSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(1);
  });

  it("no candidate from a losing tier ever appears in composedWeights", () => {
    const outcome = decideFromCandidates([critical, assignment, lowA], colonist, seed, 0, workSnapshot);
    if (outcome.kind === "commit") {
      expect(outcome.winningTier).toBe(2);
      expect(outcome.composedWeights.every((w) => w.tier === 2)).toBe(true);
    }
  });
});

describe("empty-tier fall-through (documented)", () => {
  it("falls through an empty tier to the next non-empty one", () => {
    const outcome = decideFromCandidates([assignment, lowA], colonist, seed, 0, workSnapshot); // no tier 1 or 2
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(3);
  });

  it("falls through multiple empty tiers", () => {
    const outcome = decideFromCandidates([voluntary], colonist, seed, 0, workSnapshot); // only tier 5 present
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(5);
  });

  it("returns 'blocked' when no candidate exists at any tier", () => {
    const outcome = decideFromCandidates([], colonist, seed, 0, workSnapshot);
    expect(outcome.kind).toBe("blocked");
    expect(outcome.blockedCandidates).toEqual([]);
  });
});

describe("actionability-aware fall-through — the Copilot-confirmed defect this suite regression-tests", () => {
  it("a non-actionable higher tier falls through to an actionable lower tier, in the SAME decision pass", () => {
    // Hunger is critical (tier 2) but the food station is broken — no task can serve it.
    // Work (tier 3) must win instead of the colonist committing to an unexecutable goal.
    const brokenFoodWorld = setModuleFunctional(createWorld(), "foodStation", false);
    const brokenSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), brokenFoodWorld);

    const outcome = decideFromCandidates([critical, assignment], colonist, seed, 0, brokenSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") {
      expect(outcome.winningTier).toBe(3);
      expect(outcome.goal.source).toBe("shiftAssignment");
    }
  });

  it("the blocked higher-tier candidate is retained in blockedCandidates, not silently dropped", () => {
    const brokenFoodWorld = setModuleFunctional(createWorld(), "foodStation", false);
    const brokenSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), brokenFoodWorld);

    const outcome = decideFromCandidates([critical, assignment], colonist, seed, 0, brokenSnapshot);
    expect(outcome.blockedCandidates).toHaveLength(1);
    expect(outcome.blockedCandidates[0]!.key).toBe("criticalNeed:hunger");
    expect(outcome.blockedCandidates[0]!.tier).toBe(2);
    expect(outcome.blockedCandidates[0]!.reasons.some((r) => r.includes("not functional"))).toBe(true);
  });

  it("falls through two consecutive non-actionable tiers to the first actionable one", () => {
    // Hunger (tier 2) blocked by a broken food station; rest (tier 4, since not critical here)
    // ALSO blocked by a broken bunk; voluntary (tier 5) is the only actionable candidate left.
    const brokenWorld = setModuleFunctional(setModuleFunctional(createWorld(), "foodStation", false), "restBunk", false);
    const brokenSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), brokenWorld);

    const outcome = decideFromCandidates([critical, lowB, voluntary], colonist, seed, 0, brokenSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(5);
    expect(outcome.blockedCandidates.map((b) => b.key).sort()).toEqual(["criticalNeed:hunger", "lowNeed:rest"]);
  });

  it("when nothing anywhere is actionable, the highest-priority candidate is still adopted (as active) so task resolution can record why it's blocked, rather than the colonist silently having no goal at all", () => {
    const brokenWorld = setModuleFunctional(createWorld(), "foodStation", false);
    const brokenSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), brokenWorld);

    const outcome = decideFromCandidates([critical], colonist, seed, 0, brokenSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") {
      expect(outcome.goal.key).toBe("criticalNeed:hunger");
      expect(outcome.goal.status).toBe("active"); // decide.ts never calls blockGoal — tasks.ts does, downstream
    }
    expect(outcome.blockedCandidates).toHaveLength(1);
    expect(outcome.blockedCandidates[0]!.key).toBe("criticalNeed:hunger");
  });

  it("returns 'blocked' only when literally no candidate was generated at any tier", () => {
    const brokenWorld = setModuleFunctional(createWorld(), "foodStation", false);
    const brokenSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), brokenWorld);
    const outcome = decideFromCandidates([], colonist, seed, 0, brokenSnapshot);
    expect(outcome.kind).toBe("blocked");
    expect(outcome.blockedCandidates).toEqual([]);
  });

  it("a partially-blocked winning tier still selects only among its actionable candidates", () => {
    // Both hunger and rest are low (tier 4); the bunk is broken, so only hunger is actionable.
    const brokenBunkWorld = setModuleFunctional(createWorld(), "restBunk", false);
    const brokenSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), brokenBunkWorld);

    const outcome = decideFromCandidates([lowA, lowB], colonist, seed, 0, brokenSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") {
      expect(outcome.goal.key).toBe("lowNeed:hunger");
      expect(outcome.composedWeights).toHaveLength(1); // rest never entered selection
    }
    expect(outcome.blockedCandidates.map((b) => b.key)).toEqual(["lowNeed:rest"]);
  });

  it("depleted food stock blocks hunger the same way a broken module does", () => {
    const depletedSnapshot = buildSnapshot(createClock(), createDefaultPolicy(), consumeFood(createWorld(), 100));
    const outcome = decideFromCandidates([critical, assignment], colonist, seed, 0, depletedSnapshot);
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(3);
    expect(outcome.blockedCandidates.some((b) => b.reasons.some((r) => r.includes("no food stock")))).toBe(true);
  });

  it("tier 1 is exempt from the actionability query — adopted unconditionally even with no matching task content", () => {
    // Stage 1 has no response task at all for survivalCondition (tasks.ts candidateTaskIdsFor
    // returns []), yet tier 1 must still win outright, never falling through to tier 3.
    const outcome = decideFromCandidates([survival, assignment], colonist, seed, 0, workSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(1);
    expect(outcome.blockedCandidates).toEqual([]);
  });
});

describe("no cross-tier modifier movement", () => {
  it("a low-tier candidate can never win over a higher tier no matter how large its weight is", () => {
    const hugeLowTier: GoalCandidate = { ...lowA, baseUrgency: 100000 };
    const outcome = decideFromCandidates([critical, hugeLowTier], colonist, seed, 0, workSnapshot);
    if (outcome.kind === "commit") expect(outcome.winningTier).toBe(2);
  });
});

describe("tier-1 modifier immunity — trait/memory/stress immune, no weighing of any kind", () => {
  it("does not call weight composition for tier 1 — composedWeights is empty", () => {
    const outcome = decideFromCandidates([survival], colonist, seed, 0, workSnapshot);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.composedWeights).toEqual([]);
  });

  it("selection among multiple simultaneous tier-1 candidates is by stable order, not weight, trait, or stress", () => {
    const stressedColonist = withStress(colonist, { level: 0.95 });
    const outcomeCalm = decideFromCandidates([survival, survival2], colonist, seed, 0, workSnapshot);
    const outcomeStressed = decideFromCandidates([survival, survival2], stressedColonist, seed, 0, workSnapshot);
    // survival2's key ("survivalCondition:a") sorts before survival's ("survivalCondition:z")
    expect(outcomeCalm.kind).toBe("commit");
    expect(outcomeStressed.kind).toBe("commit");
    if (outcomeCalm.kind === "commit" && outcomeStressed.kind === "commit") {
      expect(outcomeCalm.goal.key).toBe("survivalCondition:a");
      expect(outcomeStressed.goal.key).toBe("survivalCondition:a"); // unaffected by stress
    }
  });

  it("consumes no PRNG draw for tier 1", () => {
    const outcome = decideFromCandidates([survival, survival2], colonist, seed, 0, workSnapshot);
    if (outcome.kind === "commit") {
      expect(outcome.draws).toEqual([]);
      expect(outcome.prngState).toEqual(seed);
    }
  });
});

describe("weight composition within the selected tier only", () => {
  it("composedWeights contains exactly the winning tier's candidates", () => {
    const outcome = decideFromCandidates([lowA, lowB], colonist, seed, 0, workSnapshot);
    if (outcome.kind === "commit") {
      expect(outcome.composedWeights).toHaveLength(2);
      expect(outcome.composedWeights.map((w) => w.key).sort()).toEqual(["lowNeed:hunger", "lowNeed:rest"]);
    }
  });
});

describe("selection determinism", () => {
  it("same state + same seed produces an identical selection", () => {
    const a = decideFromCandidates([lowA, lowB], colonist, createPrng(7), 100, workSnapshot);
    const b = decideFromCandidates([lowA, lowB], colonist, createPrng(7), 100, workSnapshot);
    expect(a).toEqual(b);
  });

  it("different seeds may produce different valid selections", () => {
    const winners = new Set<string>();
    for (let s = 0; s < 25; s++) {
      const outcome = decideFromCandidates([lowA, lowB], colonist, createPrng(s), 0, workSnapshot);
      if (outcome.kind === "commit") winners.add(outcome.goal.key);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it("a single candidate in the winning tier needs no draw and is always selected", () => {
    const outcome = decideFromCandidates([lowA], colonist, seed, 0, workSnapshot);
    if (outcome.kind === "commit") {
      expect(outcome.goal.key).toBe("lowNeed:hunger");
      expect(outcome.draws).toEqual([]);
      expect(outcome.prngState).toEqual(seed);
    }
  });
});

describe("PRNG draw attribution", () => {
  it("records exactly one attributed draw for a multi-candidate tier, with purpose and state transition", () => {
    const outcome = decideFromCandidates([lowA, lowB], colonist, seed, 0, workSnapshot);
    if (outcome.kind === "commit") {
      expect(outcome.draws).toHaveLength(1);
      const draw = outcome.draws[0]!;
      expect(draw.purpose).toBe("candidateSelection:tier4");
      expect(draw.stateBefore).toEqual(seed);
      expect(draw.stateAfter).toEqual(next(seed).state);
      expect(outcome.prngState).toEqual(draw.stateAfter);
    }
  });
});

describe("motivation fixed at adoption", () => {
  it("the committed goal's motivation reflects the decision that was made and does not change afterward", () => {
    const outcome = decideFromCandidates([lowA], colonist, seed, 5, workSnapshot);
    if (outcome.kind === "commit") {
      expect(outcome.goal.motivation.length).toBeGreaterThan(0);
      expect(outcome.goal.adoptedAtTick).toBe(5);
      const motivationSnapshot = outcome.goal.motivation;
      // Re-running the decision (e.g. a later re-decision) produces a NEW goal object; the
      // original goal reference's motivation is untouched — nothing rewrites it in place.
      decideFromCandidates([lowA], colonist, seed, 999, workSnapshot);
      expect(outcome.goal.motivation).toBe(motivationSnapshot);
    }
  });
});

describe("not per-tick — idempotent under repeated invocation with unchanged inputs", () => {
  it("calling decideFromCandidates repeatedly with the same unchanged inputs never drifts", () => {
    const first = decideFromCandidates([lowA, lowB], colonist, seed, 10, workSnapshot);
    const second = decideFromCandidates([lowA, lowB], colonist, seed, 10, workSnapshot);
    const third = decideFromCandidates([lowA, lowB], colonist, seed, 10, workSnapshot);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });
});

describe("decideNext forwards the colonist's traits to candidate generation (Copilot-confirmed defect)", () => {
  it("a trait-shifted threshold changes which candidates are even generated, not just how they're weighed", () => {
    // "driven" shifts Rest's low threshold down by 0.05 (more tolerant). At level 0.32: the
    // UNTRAITED threshold (0.35) reads this as low (would generate lowNeed:rest, tier 4,
    // which — being actionable and higher-priority than voluntary — would win outright); the
    // TRAITED threshold (0.30) reads it as NOT low. If decideNext drops traits when generating
    // candidates, it wrongly adopts lowNeed:rest; forwarding traits correctly falls through to
    // the only other candidate available during free time: voluntary.
    const drivenColonist = withNeeds(createColonist("c2", "Rei", [], ["driven"]), {
      ...createNeeds(),
      rest: { level: 0.32, ticksBelowLow: 0 },
    });
    const freeSnapshot = buildSnapshot(advance(createClock(), 960), createDefaultPolicy(), createWorld()); // free period start
    const outcome = decideNext(drivenColonist, freeSnapshot, seed, 0);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") expect(outcome.goal.source).toBe("voluntary");
  });
});

// --- Stage 2 Slice 9 (design/stage-2-validation-plan.md §3/§10): relationship and memory state
// must not merely tilt a weight — it must be able to change WHICH candidate a later decision
// selects. Both scenarios use hand-authored magnitudes rather than seed-hunting, per the plan's
// own stated preference; the fixed seed's draw is asserted against the flip window it has to sit
// in, so the choice of seed explains itself instead of being an unexplained constant.

describe("Stage 2 Slice 9 — relationship state flips which candidate a later decision selects", () => {
  const freeSnapshot: WorldSnapshot = buildSnapshot(advance(createClock(), 960), createDefaultPolicy(), createWorld());
  const untraitedColonist = createColonist("c1", "Maya"); // no traits, no stress: the relationship family is the only live tilt
  const idleCandidate: GoalCandidate = { source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 };
  const socialCandidate: GoalCandidate = {
    source: "voluntary",
    tier: 5,
    key: "voluntary:social:conversation:zeke",
    baseUrgency: 0.2,
    relatedColonistId: "zeke",
    relatedSocialTaskId: "conversation",
  };

  /** A real M10 store built the same way a run builds one: one large hand-authored interaction. */
  function storeWithAffinity(delta: number) {
    return applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: delta < 0 ? "directConflict" : "sharedTaskCompletion",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: delta,
      bTowardADelta: delta,
    }).store;
  }

  it("the same seed and candidates select the social candidate when bonded and the unrelated one when hostile", () => {
    const bonded = storeWithAffinity(100);
    const hostile = storeWithAffinity(-100);
    expect(perspective(bonded, "c1", "zeke").affinity).toBeGreaterThan(0);
    expect(perspective(hostile, "c1", "zeke").affinity).toBeLessThan(0);

    // Both candidates share the same base weight, so the relationship tilt alone decides where
    // the draw lands: the unrelated candidate holds 0.2/0.55 of the total when bonded and
    // 0.2/0.314 of it when hostile. Seed 10's single draw sits between those two shares, which
    // is exactly the interval in which the two relationship states disagree.
    const drawValue = next(createPrng(10)).value;
    expect(drawValue).toBeGreaterThan(0.2 / 0.55);
    expect(drawValue).toBeLessThan(0.2 / 0.314);

    const candidates = [idleCandidate, socialCandidate];
    const whenBonded = decideFromCandidates(candidates, untraitedColonist, createPrng(10), 0, freeSnapshot, bonded);
    const whenHostile = decideFromCandidates(candidates, untraitedColonist, createPrng(10), 0, freeSnapshot, hostile);

    expect(whenBonded.kind).toBe("commit");
    expect(whenHostile.kind).toBe("commit");
    if (whenBonded.kind !== "commit" || whenHostile.kind !== "commit") return;
    expect(whenBonded.goal.key).toBe(socialCandidate.key);
    expect(whenHostile.goal.key).toBe(idleCandidate.key);
    // The flip is the relationship family's doing, not a different draw or a different tier.
    expect(whenBonded.draws.map((d) => d.value)).toEqual(whenHostile.draws.map((d) => d.value));
    expect(whenBonded.winningTier).toBe(whenHostile.winningTier);
  });

  it("the relationship tilt is what moved, and it stays inside the family bound", () => {
    const candidates = [idleCandidate, socialCandidate];
    const bonded = decideFromCandidates(candidates, untraitedColonist, createPrng(10), 0, freeSnapshot, storeWithAffinity(100));
    const hostile = decideFromCandidates(candidates, untraitedColonist, createPrng(10), 0, freeSnapshot, storeWithAffinity(-100));
    if (bonded.kind !== "commit" || hostile.kind !== "commit") throw new Error("expected commits");
    const socialWeight = (outcome: typeof bonded) => outcome.composedWeights.find((w) => w.key === socialCandidate.key)!;
    const idleWeight = (outcome: typeof bonded) => outcome.composedWeights.find((w) => w.key === idleCandidate.key)!;

    expect(socialWeight(bonded).relationships).toBeGreaterThan(1);
    expect(socialWeight(hostile).relationships).toBeLessThan(1);
    // The unrelated candidate carries no relationship contribution in either state.
    expect(idleWeight(bonded).relationships).toBe(1);
    expect(idleWeight(hostile).relationships).toBe(1);
    expect(idleWeight(bonded).composed).toBeCloseTo(idleWeight(hostile).composed, 12);
  });
});

describe("Stage 2 Slice 9 — a formed memory flips which candidate a later decision selects", () => {
  const untraitedColonist = createColonist("c1", "Maya");
  const decisionTick = 100; // "later": the memories below formed at tick 0

  /** Hand-authored deprivation memories, the only memory type the weight family reads. */
  function deprivationPool(needId: "hunger" | "rest"): MemoryPool {
    return [0, 1].map<MemoryEntry>((id) => ({
      id,
      type: "deprivation",
      context: { needId },
      formedAtTick: 0,
      impact: 1,
    }));
  }

  it("with no memory the rest candidate wins; the same decision with hunger memories selects hunger instead", () => {
    // memoryContributions only matches a candidate's own relatedNeed, so a hunger memory lifts
    // lowA and leaves lowB untouched. Seed 13's draw sits between the no-memory share (0.5) and
    // the capped-memory share (0.525/0.825) — the window where the two pools disagree.
    const drawValue = next(createPrng(13)).value;
    expect(drawValue).toBeGreaterThan(0.5);
    expect(drawValue).toBeLessThan(0.525 / 0.825);

    const candidates = [lowA, lowB];
    const withoutMemory = decideFromCandidates(candidates, untraitedColonist, createPrng(13), decisionTick, workSnapshot);
    const withHungerMemory = decideFromCandidates(
      candidates,
      withMemory(untraitedColonist, deprivationPool("hunger")),
      createPrng(13),
      decisionTick,
      workSnapshot,
    );
    const withRestMemory = decideFromCandidates(
      candidates,
      withMemory(untraitedColonist, deprivationPool("rest")),
      createPrng(13),
      decisionTick,
      workSnapshot,
    );

    if (withoutMemory.kind !== "commit" || withHungerMemory.kind !== "commit" || withRestMemory.kind !== "commit") {
      throw new Error("expected commits");
    }
    expect(withoutMemory.goal.key).toBe(lowB.key);
    expect(withHungerMemory.goal.key).toBe(lowA.key); // the flip
    expect(withRestMemory.goal.key).toBe(lowB.key); // the mirrored memory does not flip it back
    expect(withHungerMemory.draws.map((d) => d.value)).toEqual(withoutMemory.draws.map((d) => d.value));
  });

  it("the flipping memories are still inside their non-negligible influence window at the decision tick", () => {
    // ADR-16's fade curve: influence = recency x impact, recency = 1 - recencyDecayPerTick x age.
    // The decision above happens 100 ticks after formation, so the memories are demonstrably
    // faded but far from spent — the flip is not an artifact of reading a memory at age zero.
    const [entry] = deprivationPool("hunger");
    const value = influence(entry!, decisionTick);
    expect(value).toBeCloseTo(1 - MEMORY_TUNING.recencyDecayPerTick * decisionTick, 12);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(entry!.impact);
  });

  it("hand-authored relational memories are not read by the weight family at all — only deprivation memories tilt a candidate", () => {
    // Unit-level pin of memoryContributions' type filter. The separately named real-tick gap pin
    // below forms a relational memory the simulation actually produced; this one only proves the
    // filter itself rejects the relational shape.
    const relationalPool: MemoryPool = [
      { id: 0, type: "relational", context: { otherId: "zeke", direction: "negative" }, formedAtTick: 0, impact: 1 },
    ];
    const outcome = decideFromCandidates(
      [lowA, lowB],
      withMemory(untraitedColonist, relationalPool),
      createPrng(13),
      decisionTick,
      workSnapshot,
    );
    if (outcome.kind !== "commit") throw new Error("expected a commit");
    for (const weight of outcome.composedWeights) {
      expect(weight.memoryContributions).toEqual([]);
      expect(weight.memory).toBe(1);
    }
  });
});

describe("Stage 2 Slice 9 — a relational memory formed via a real tick produces no candidate-selection change", () => {
  // §3 step 4 / §10 gap pin: memoryContributions reads deprivation memories only. Form a real
  // relational memory through the same atrophy path tick.test.ts already uses, then show that
  // carrying it into a later decision changes neither the selected candidate nor any memory tilt.
  const SIGNIFICANT_TICKS = 800; // atrophyPerTick 0.02 × 800 ≫ relationshipChangeSignificance 15

  function atrophyStateThatFormsRelationalMemory(): SimulationState {
    const colonist = withNeeds(createColonist("c1", "Maya"), createNeeds());
    const relationships = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "c1",
      responderId: "zeke",
      aTowardBDelta: 50,
      bTowardADelta: 50,
    }).store;
    return {
      clock: createClock(),
      world: createWorld(),
      policy: createDefaultPolicy(),
      colonists: [{ colonist, execution: null, suspendedExecution: null, ...createFreshMemoryBaselines() }],
      prng: createPrng(1),
      hasBootstrapped: false,
      eventLog: createEventLog(),
      decisionLog: createDecisionLog(),
      relationships,
      socialOffers: createSocialOfferStore(),
    };
  }

  it("a relational memory formed by real ticks does not flip which candidate a later decision selects", () => {
    const formed = run(atrophyStateThatFormsRelationalMemory(), SIGNIFICANT_TICKS);
    expect(formed.events.some((e) => e.kind === "memoryFormed" && e.memoryType === "relational")).toBe(true);
    const relationalMemories = formed.finalState.colonists[0]!.colonist.memory.filter((e) => e.type === "relational");
    expect(relationalMemories.length).toBeGreaterThan(0);

    const decisionTick = formed.finalState.clock.tick;
    const candidates = [lowA, lowB];
    const withoutMemory = decideFromCandidates(candidates, createColonist("c1", "Maya"), createPrng(13), decisionTick, workSnapshot);
    const withRelationalMemory = decideFromCandidates(
      candidates,
      withMemory(createColonist("c1", "Maya"), relationalMemories),
      createPrng(13),
      decisionTick,
      workSnapshot,
    );

    expect(withoutMemory.kind).toBe("commit");
    expect(withRelationalMemory.kind).toBe("commit");
    if (withoutMemory.kind !== "commit" || withRelationalMemory.kind !== "commit") return;
    // Same seed, same candidates, same draw — and the same winning key. The formed relational
    // memory is present and still inside its influence window, but contributes nothing.
    expect(withRelationalMemory.goal.key).toBe(withoutMemory.goal.key);
    expect(withRelationalMemory.draws.map((d) => d.value)).toEqual(withoutMemory.draws.map((d) => d.value));
    for (const weight of withRelationalMemory.composedWeights) {
      expect(weight.memoryContributions).toEqual([]);
      expect(weight.memory).toBe(1);
    }
    expect(influence(relationalMemories[0]!, decisionTick)).toBeGreaterThan(0);
  });
});

describe("purity", () => {
  it("does not mutate the input candidate list, colonist, or PRNG state", () => {
    const candidates = [lowA, lowB];
    const candidatesSnapshot = JSON.parse(JSON.stringify(candidates));
    const colonistSnapshot = JSON.parse(JSON.stringify(colonist));
    const seedSnapshot = { ...seed };
    decideFromCandidates(candidates, colonist, seed, 0, workSnapshot);
    expect(candidates).toEqual(candidatesSnapshot);
    expect(colonist).toEqual(colonistSnapshot);
    expect(seed).toEqual(seedSnapshot);
  });
});
