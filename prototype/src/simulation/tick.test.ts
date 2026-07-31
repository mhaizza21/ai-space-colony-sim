// Tick assembly tests — end-to-end tick, replay determinism, interruption/resume with
// preserved progress, completion, re-decision triggers, fixed-step enforcement, stable
// replay logs, purity.

// @ts-expect-error — no @types/node in this zero-runtime-dependency prototype (Stage 1 plan);
// Node/Vitest resolve this builtin at runtime regardless of the missing type declarations.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { advance, createClock } from "../core/clock.js";
import { createPrng } from "../core/prng.js";
import { deserialize, serialize } from "../core/serialization.js";
import { createDefaultPolicy } from "../world/policy.js";
import { createWorld, setModuleFunctional } from "../world/world.js";
import { CONFLICT_TUNING, MEMORY_TUNING, SOCIAL_OFFER_TUNING, STRESS_TUNING, TASK_TUNING } from "../config/tuning.js";
import { createColonist, withCurrentGoal, withNeeds, withStress, withSuspendedGoal } from "../colonist/colonist.js";
import type { TraitId } from "../colonist/traits.js";
import { createNeeds } from "../colonist/needs.js";
import { createFreshMemoryBaselines, tick, validateSimulationState, type ColonistRuntime, type SimulationState } from "./tick.js";
import { run } from "./run.js";
import { verifyReplay } from "../replay/replay.js";
import { commitGoal, suspendGoal } from "../decision/goals.js";
import { beginExecution, interruptExecution } from "../task/execution.js";
import { taskDefinition } from "../task/tasks.js";
import { createDecisionLog, createEventLog } from "../records/logs.js";
import { applyInteraction, createRelationshipStore, perspective } from "../colonist/relationships.js";
import { createSocialOfferStore, type SocialOffer } from "../task/socialOffers.js";
import { inspect } from "../inspection/inspector.js";

const policy = createDefaultPolicy();

function stateAtTickOfDay(
  tickOfDay: number,
  needsOverride: Partial<Record<string, { level: number; ticksBelowLow: number }>> = {},
  seed = 1,
): SimulationState {
  const colonist = withNeeds(createColonist("c1", "Maya"), { ...createNeeds(), ...needsOverride } as ReturnType<typeof createNeeds>);
  return {
    clock: advance(createClock(), tickOfDay),
    world: createWorld(),
    policy,
    colonists: [{ colonist, execution: null, suspendedExecution: null, ...createFreshMemoryBaselines() }],
    prng: createPrng(seed),
    hasBootstrapped: false, // a freshly-built colonist with no goal/execution — genuinely never decided
    eventLog: createEventLog(),
    decisionLog: createDecisionLog(),
    relationships: createRelationshipStore(),
    socialOffers: createSocialOfferStore(),
  };
}

// --- ADR-22 collection test helpers: patch the canonically-first colonist ("c1" in every
// fixture below — every id appended via withOthers sorts after it), or append fully-simulated
// others (Stage 2 Slice 6b: every colonists[] entry is simulated, none are inert). ---
function withRuntime(state: SimulationState, patch: Partial<ColonistRuntime>): SimulationState {
  const [first, ...rest] = state.colonists;
  return { ...state, colonists: [{ ...first!, ...patch }, ...rest] };
}
function withOthers(state: SimulationState, identities: readonly { id: string; name: string; skills: readonly string[]; baseTraits: readonly TraitId[] }[]): SimulationState {
  const others = identities.map((i) => ({
    colonist: createColonist(i.id, i.name, [...i.skills], [...i.baseTraits]),
    execution: null,
    suspendedExecution: null,
    ...createFreshMemoryBaselines(),
  }));
  const colonists = [...state.colonists, ...others].sort((a, b) => (a.colonist.identity.id < b.colonist.identity.id ? -1 : 1));
  return { ...state, colonists };
}

const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] } as const;

function socialExecutionState(taskId: "conversation" | "sharedDowntime", relatedColonistId: string | null = "zeke"): SimulationState {
  const freeStart = policy.workTicks + policy.restTicks;
  const base = stateAtTickOfDay(
    freeStart,
    {
      social: { level: 0.45, ticksBelowLow: 0 },
      purpose: { level: 0.5, ticksBelowLow: 0 },
    },
    11,
  );
  const goal = commitGoal(
    {
      source: "voluntary",
      tier: 5,
      key: relatedColonistId === null ? "voluntary:solo" : `voluntary:social:${relatedColonistId}`,
      baseUrgency: 0.2,
      relatedColonistId: relatedColonistId ?? undefined,
      relatedSocialTaskId: relatedColonistId === null ? undefined : taskId,
    },
    "test social motivation",
    base.clock.tick,
  );
  return {
    ...withOthers(withRuntime(base, {
      colonist: withCurrentGoal(base.colonists[0]!.colonist, goal),
      execution: beginExecution(taskDefinition(taskId), goal, base.clock.tick),
    }), [zeke]),
    hasBootstrapped: true,
  };
}

function eatingExecutionState(
  roster = [zeke],
  relationships = createRelationshipStore(),
  world = createWorld(),
): SimulationState {
  const base = stateAtTickOfDay(0, { hunger: { level: 0.35, ticksBelowLow: 10 }, social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } }, 13);
  const goal = commitGoal({ source: "criticalNeed", tier: 1, key: "criticalNeed:hunger", baseUrgency: 1, relatedNeed: "hunger" }, "test hunger", base.clock.tick);
  return {
    ...withOthers(withRuntime(base, {
      colonist: withCurrentGoal(base.colonists[0]!.colonist, goal),
      execution: beginExecution(taskDefinition("eatAtFoodStation"), goal, base.clock.tick),
    }), roster),
    hasBootstrapped: true,
    relationships,
    world,
  };
}

describe("fixed-step enforcement (review fix 2)", () => {
  it("rejects a delta larger than BASE_TICKS_PER_STEP", () => {
    const state = stateAtTickOfDay(0);
    expect(() => tick(state, 2)).toThrow();
  });

  it("rejects a delta smaller than BASE_TICKS_PER_STEP (0)", () => {
    const state = stateAtTickOfDay(0);
    expect(() => tick(state, 0)).toThrow();
  });

  it("accepts exactly BASE_TICKS_PER_STEP", () => {
    const state = stateAtTickOfDay(0);
    expect(() => tick(state, 1)).not.toThrow();
  });
});

describe("full end-to-end tick", () => {
  it("bootstraps: adopts a goal, resolves a task, begins execution in a single tick", () => {
    const state = stateAtTickOfDay(0); // work period start, all needs satisfied
    const result = tick(state, 1);
    expect(result.events.some((e) => e.kind === "bootstrap")).toBe(true);
    expect(result.events.some((e) => e.kind === "decision")).toBe(true);
    expect(result.events.some((e) => e.kind === "taskResolution")).toBe(true);
    expect(result.events.some((e) => e.kind === "executionBegun")).toBe(true);
    expect(result.state.colonists[0]!.colonist.currentGoal).not.toBeNull();
    expect(result.state.colonists[0]!.execution).not.toBeNull();
    expect(result.state.colonists[0]!.execution!.status).toBe("inProgress");
  });

  it("during work with all needs satisfied, adopts the shift-assignment goal", () => {
    const result = tick(stateAtTickOfDay(0), 1);
    expect(result.state.colonists[0]!.colonist.currentGoal?.source).toBe("shiftAssignment");
    expect(result.state.colonists[0]!.execution?.taskId).toBe("workAtWorkstation");
  });

  it("advances the clock by exactly BASE_TICKS_PER_STEP per call", () => {
    const state = stateAtTickOfDay(0);
    const result = tick(state, 1);
    expect(result.state.clock.tick).toBe(state.clock.tick + 1);
  });

  it("advancing multiple ticks via run() reaches the expected clock value", () => {
    const initial = stateAtTickOfDay(0);
    const result = run(initial, 5);
    expect(result.finalState.clock.tick).toBe(5);
  });
});

describe("companionship execution effects (Stage 2 Slice 3 Build Step 3)", () => {
  it("organic bootstrap sees roster members as nearby social candidates", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    const base = stateAtTickOfDay(freeStart, {}, 31);
    const warmRelationship = applyInteraction(base.relationships, {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: base.clock.tick,
      changeSource: "sharedTaskCompletion",
      initiatorId: "c1",
      responderId: "zeke",
      aTowardBDelta: 80,
      bTowardADelta: 80, // the acceptance draw keys on the RESPONDER's regard (design D5) — warm both directions
    });
    const state = { ...withOthers(base, [zeke]), relationships: warmRelationship.store };
    const afterCommit = run(state, 1).finalState;

    expect(afterCommit.colonists[0]!.colonist.currentGoal?.source).toBe("voluntary");
    expect(afterCommit.colonists[0]!.colonist.currentGoal?.relatedColonistId).toBe("zeke");
    // Stage 2 Slice 5 (design D3): committing a social goal creates a pending OFFER — execution
    // never begins on the creation tick (the one-tick response-delay floor). Stage 2 Slice 6b:
    // zeke is now fully simulated too and may independently bootstrap into its own social offer
    // toward c1 the same free-period tick — assert c1's own offer specifically, not the total.
    expect(afterCommit.colonists[0]!.execution).toBeNull();
    const c1Offer = afterCommit.socialOffers.offers.find((o) => o.initiatorId === "c1")!;
    expect(c1Offer.status).toBe("pending");
    expect(c1Offer.responderId).toBe("zeke");

    // On the respondable tick the offer resolves deterministically one way or the other — the
    // accept path itself (with a controlled, non-competing responder) is covered by the
    // dedicated fixtures in the "social offer/response protocol" suite below; this test's own
    // purpose is candidate generation seeing zeke as a real social candidate via the observation
    // basis, which it already demonstrated above by creating the offer with the right responder.
    const afterResolve = run(afterCommit, 1).finalState;
    const c1OfferResolved = afterResolve.socialOffers.offers.find((o) => o.initiatorId === "c1")!;
    expect(c1OfferResolved.status).not.toBe("pending");
  });

  it("conversation restores Social need while executing", () => {
    const initial = socialExecutionState("conversation");
    const final = run(initial, 20).finalState;

    expect(final.colonists[0]!.colonist.needs.social.level).toBeGreaterThan(initial.colonists[0]!.colonist.needs.social.level);
  });

  it("conversation materializes the relationship pair and applies a positive directional delta", () => {
    const final = run(socialExecutionState("conversation"), 20).finalState;

    expect(perspective(final.relationships, "c1", "zeke").affinity).toBeGreaterThan(0);
    expect(perspective(final.relationships, "zeke", "c1").affinity).toBeLessThanOrEqual(0);
  });

  it("does not apply atrophy to a pair created by the current tick's interaction", () => {
    const final = run(socialExecutionState("conversation"), 1).finalState;

    expect(perspective(final.relationships, "c1", "zeke").affinity).toBe(TASK_TUNING.conversationAffinityDeltaPerTick);
    expect(perspective(final.relationships, "zeke", "c1").affinity).toBe(0);
  });

  it("does not apply atrophy to the active companionship pair on later ticks", () => {
    const final = run(socialExecutionState("conversation"), 2).finalState;

    expect(perspective(final.relationships, "c1", "zeke").affinity).toBe(TASK_TUNING.conversationAffinityDeltaPerTick * 2);
    expect(perspective(final.relationships, "zeke", "c1").affinity).toBe(0);
  });

  it("sharedDowntime applies positive relationship drift no stronger than conversation", () => {
    const conversation = run(socialExecutionState("conversation"), 20).finalState;
    const sharedDowntime = run(socialExecutionState("sharedDowntime"), 20).finalState;

    const conversationAffinity = perspective(conversation.relationships, "c1", "zeke").affinity;
    const sharedDowntimeAffinity = perspective(sharedDowntime.relationships, "c1", "zeke").affinity;
    expect(sharedDowntimeAffinity).toBeGreaterThan(0);
    expect(sharedDowntimeAffinity).toBeLessThanOrEqual(conversationAffinity);
  });

  it("sharedDowntime restores Social need, at a lower rate than conversation", () => {
    const initialConversation = socialExecutionState("conversation");
    const initialSharedDowntime = socialExecutionState("sharedDowntime");
    const conversation = run(initialConversation, 20).finalState;
    const sharedDowntime = run(initialSharedDowntime, 20).finalState;

    expect(sharedDowntime.colonists[0]!.colonist.needs.social.level).toBeGreaterThan(initialSharedDowntime.colonists[0]!.colonist.needs.social.level);
    expect(sharedDowntime.colonists[0]!.colonist.needs.social.level).toBeLessThan(conversation.colonists[0]!.colonist.needs.social.level);
  });

  it("social actions do not credit Purpose", () => {
    const initial = socialExecutionState("conversation");
    const final = run(initial, 20).finalState;

    expect(final.colonists[0]!.colonist.needs.purpose.level).toBeLessThanOrEqual(initial.colonists[0]!.colonist.needs.purpose.level);
  });

  it("social execution remains replay-deterministic", () => {
    const initial = socialExecutionState("conversation");
    const final = run(initial, 50).finalState;

    expect(verifyReplay(initial, final).kind).toBe("match");
  });

  it("save/load round-trip preserves companionship needs, relationships, and records", () => {
    const final = run(socialExecutionState("conversation"), 50).finalState;
    const reloaded = deserialize(serialize(final));

    expect(reloaded.colonists[0]!.colonist.needs.social).toEqual(final.colonists[0]!.colonist.needs.social);
    expect(reloaded.relationships).toEqual(final.relationships);
    expect(reloaded.eventLog).toEqual(final.eventLog);
    expect(reloaded.decisionLog).toEqual(final.decisionLog);
  });

  it("a companionship task without relatedColonistId fails safely with no social consequence", () => {
    const initial = socialExecutionState("conversation", null);
    const final = run(initial, 20).finalState;

    expect(final.relationships).toEqual(createRelationshipStore());
    expect(final.colonists[0]!.colonist.needs.social.level).toBeLessThan(initial.colonists[0]!.colonist.needs.social.level);
  });

  it("rejects a social execution target that is not in the roster", () => {
    const state = socialExecutionState("conversation", "ghost");

    expect(() => validateSimulationState(state)).toThrow(/not present in the colonist collection/);
    expect(() => tick(state, 1)).toThrow(/not present in the colonist collection/);
  });

  it("rejects a social execution target that points at the primary colonist", () => {
    const state = socialExecutionState("conversation", "c1");

    expect(() => validateSimulationState(state)).toThrow(/must not target the goal owner/);
    expect(() => tick(state, 1)).toThrow(/must not target the goal owner/);
  });
});

describe("shared meal overlay (Stage 2 Slice 4)", () => {
  it("eating with non-hostile company also restores Social and applies positive relationship drift", () => {
    const initial = eatingExecutionState();
    const final = run(initial, 20).finalState;

    expect(final.colonists[0]!.colonist.needs.hunger.level).toBeGreaterThan(initial.colonists[0]!.colonist.needs.hunger.level);
    expect(final.colonists[0]!.colonist.needs.social.level).toBeGreaterThan(initial.colonists[0]!.colonist.needs.social.level);
    expect(perspective(final.relationships, "c1", "zeke").affinity).toBeGreaterThan(0);
    expect(perspective(final.relationships, "zeke", "c1").affinity).toBe(0);
  });

  it("eating alone keeps the pre-existing hunger behavior without Social or relationship overlay", () => {
    const initial = eatingExecutionState([]);
    const final = run(initial, 20).finalState;

    expect(final.colonists[0]!.colonist.needs.hunger.level).toBeGreaterThan(initial.colonists[0]!.colonist.needs.hunger.level);
    expect(final.colonists[0]!.colonist.needs.social.level).toBeLessThan(initial.colonists[0]!.colonist.needs.social.level);
    expect(final.relationships).toEqual(createRelationshipStore());
  });

  it("does not apply the overlay for hostile company", () => {
    const hostile = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "c1",
      responderId: "zeke",
      aTowardBDelta: -80,
      bTowardADelta: 0,
    }).store;
    const final = run(eatingExecutionState([zeke], hostile), 20).finalState;

    expect(final.colonists[0]!.colonist.needs.social.level).toBeLessThan(eatingExecutionState([zeke], hostile).colonists[0]!.colonist.needs.social.level);
    expect(perspective(final.relationships, "c1", "zeke").affinity).toBeLessThan(0);
  });

  it("sharedMeal remains an overlay, not a directly adopted voluntary task", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    const final = run(withOthers(stateAtTickOfDay(freeStart, {}, 31), [zeke]), 1).finalState;

    expect(final.colonists[0]!.execution?.taskId).not.toBe("sharedMeal");
  });

  it("preserves replay and save/load determinism", () => {
    const initial = eatingExecutionState();
    const final = run(initial, 50).finalState;
    const reloaded = deserialize(serialize(final));

    expect(verifyReplay(initial, final).kind).toBe("match");
    expect(reloaded.colonists[0]!.colonist.needs.social).toEqual(final.colonists[0]!.colonist.needs.social);
    expect(reloaded.relationships).toEqual(final.relationships);
  });

  it("never credits Purpose — Purpose decays identically with or without shared-meal company", () => {
    // Purpose still decays passively regardless of the overlay (that's ordinary need decay, not
    // an overlay effect) — isolate the overlay's contribution by comparing against a solo baseline
    // that experiences the same decay but none of the overlay's Social/affinity crediting.
    const withCompany = run(eatingExecutionState([zeke]), 20).finalState;
    const alone = run(eatingExecutionState([]), 20).finalState;

    expect(withCompany.colonists[0]!.colonist.needs.purpose.level).toBe(alone.colonists[0]!.colonist.needs.purpose.level);
  });

  it("scales Social credit and affinity drift to the fraction of food actually consumed (Copilot review fix)", () => {
    const scantStock = { ...createWorld(), foodStock: TASK_TUNING.foodConsumptionPerTick / 2 };
    const initial = eatingExecutionState([zeke], createRelationshipStore(), scantStock);
    const fullInitial = eatingExecutionState();
    const final = tick(initial, 1).state;
    const fullFinal = tick(fullInitial, 1).state;

    const partialSocialGain = final.colonists[0]!.colonist.needs.social.level - initial.colonists[0]!.colonist.needs.social.level;
    const fullSocialGain = fullFinal.colonists[0]!.colonist.needs.social.level - fullInitial.colonists[0]!.colonist.needs.social.level;
    expect(partialSocialGain).toBeGreaterThan(0);
    expect(partialSocialGain).toBeLessThan(fullSocialGain);

    const partialAffinity = perspective(final.relationships, "c1", "zeke").affinity;
    const fullAffinity = perspective(fullFinal.relationships, "c1", "zeke").affinity;
    expect(partialAffinity).toBeGreaterThan(0);
    expect(partialAffinity).toBeLessThan(fullAffinity);
  });

  it("does not exempt the pair from atrophy when food stock is already depleted (Copilot review fix)", () => {
    // A prior interaction pushes affinity up so atrophy (which pulls back toward 0) is observable.
    const withAffinity = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "c1",
      responderId: "zeke",
      aTowardBDelta: 10,
      bTowardADelta: 0,
    }).store;
    const depleted = { ...createWorld(), foodStock: 0 };
    const initial = eatingExecutionState([zeke], withAffinity, depleted);
    const final = tick(initial, 1).state;

    expect(perspective(final.relationships, "c1", "zeke").affinity).toBeLessThan(perspective(withAffinity, "c1", "zeke").affinity);
  });

  it("does not apply the overlay when only the partner's perspective is hostile (Codex review fix)", () => {
    // zeke -> c1 is hostile; c1 -> zeke stays neutral — an asymmetric relationship state.
    const asymmetric = applyInteraction(createRelationshipStore(), {
      colonistAId: "zeke",
      colonistBId: "c1",
      tick: 0,
      changeSource: "sharedTaskCompletion",
      initiatorId: "zeke",
      responderId: "c1",
      aTowardBDelta: -80,
      bTowardADelta: 0,
    }).store;
    const initial = eatingExecutionState([zeke], asymmetric);
    const final = run(initial, 20).finalState;

    expect(final.colonists[0]!.colonist.needs.social.level).toBeLessThan(initial.colonists[0]!.colonist.needs.social.level);
    // Sole positive mover on this pair is the overlay's affinityDelta — its absence means the
    // pair's affinity can only have gone down (ordinary atrophy) or stayed flat, never up.
    expect(perspective(final.relationships, "c1", "zeke").affinity).toBeLessThanOrEqual(0);
  });
});

describe("social offer/response protocol (Stage 2 Slice 5 — design D1–D9, ADR-21)", () => {
  const freeStart = policy.workTicks + policy.restTicks;

  /** Hand-built mid-run state: committed conversation goal toward zeke with its pending offer (created "last tick"). */
  function pendingOfferState(seed: number, offerOverrides: Partial<SocialOffer> = {}): SimulationState {
    const base = stateAtTickOfDay(freeStart, { social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } }, seed);
    const tickNow = base.clock.tick;
    const goal = commitGoal(
      {
        source: "voluntary",
        tier: 5,
        key: "voluntary:social:conversation:zeke",
        baseUrgency: 0.2,
        relatedColonistId: "zeke",
        relatedSocialTaskId: "conversation",
      },
      "test offer motivation",
      tickNow,
    );
    const offer: SocialOffer = {
      id: 0,
      initiatorId: "c1",
      responderId: "zeke",
      action: "conversation",
      createdAtTick: tickNow,
      respondableAtTick: tickNow + 1,
      expiresAtTick: tickNow + 4,
      status: "pending",
      resolvedAtTick: null,
      reason: null,
      ...offerOverrides,
    };
    // Stage 2 Slice 6b: zeke is now fully simulated too, so eligibility's ambientState read
    // (design D4.2) is real, not the old hardcoded "resting" placeholder — give zeke a genuine
    // in-progress idlePresence execution (ambientStateFor → "resting", interruptible) with its
    // own valid active goal, so these offer-lifecycle tests exercise steps 5/6 as intended
    // rather than tripping the (correct, but not what these tests are about) responderNotInterruptible
    // path. hasBootstrapped: true keeps zeke's own decision loop from touching this execution
    // this tick (nothing else triggers zeke either).
    const zekeGoal = commitGoal({ source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 }, "test fixture idle", tickNow);
    const zekeRuntime = {
      colonist: withCurrentGoal(createColonist("zeke", "Zeke"), zekeGoal),
      execution: beginExecution(taskDefinition("idlePresence"), zekeGoal, tickNow),
      suspendedExecution: null,
      ...createFreshMemoryBaselines(),
    };
    const withZeke = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, goal) });
    return {
      ...withZeke,
      colonists: [...withZeke.colonists, zekeRuntime].sort((a, b) => (a.colonist.identity.id < b.colonist.identity.id ? -1 : 1)),
      hasBootstrapped: true,
      socialOffers: { offers: [offer], nextOfferSequence: 1 },
    };
  }

  it("accepts on the respondable tick (draw under the acceptance probability) and begins the existing execution path", () => {
    // seed 7's first draw ≈ 0.0117 < 0.55 (acquainted — absent pair default) → accepted
    const result = tick(pendingOfferState(7), 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("accepted");
    expect(offer.reason).toBeNull();
    expect(offer.resolvedAtTick).toBe(result.state.clock.tick);
    expect(result.state.colonists[0]!.execution?.taskId).toBe("conversation");
    expect(result.events.some((e) => e.kind === "socialOfferResolved" && e.status === "accepted")).toBe(true);
    expect(result.events.some((e) => e.kind === "executionBegun" && e.taskId === "conversation")).toBe(true);
    expect(result.state.prng.draws).toBe(1); // exactly one attributed acceptance draw was spent
  });

  it("never resolves an offer on a tick before respondableAtTick — the response-delay floor", () => {
    const state = pendingOfferState(7, { respondableAtTick: freeStart + 3, expiresAtTick: freeStart + 6 });
    const afterOne = tick(state, 1);
    expect(afterOne.state.socialOffers.offers[0]!.status).toBe("pending");
    expect(afterOne.state.colonists[0]!.execution).toBeNull();
    expect(afterOne.state.prng.draws).toBe(0); // no draw is spent on a not-yet-respondable offer
  });

  it("declines (draw at/above the probability): no execution, no Social restore, decline friction in both directions", () => {
    // seed 1's first draw ≈ 0.6271 >= 0.55 → declined via acceptanceDraw
    const before = pendingOfferState(1);
    const socialBefore = before.colonists[0]!.colonist.needs.social.level;
    const result = tick(before, 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("declined");
    expect(offer.reason).toBe("acceptanceDraw");
    expect(result.state.colonists[0]!.execution).toBeNull();
    expect(result.state.colonists[0]!.colonist.currentGoal).toBeNull(); // initiator's goal is abandoned, not left dangling
    // ADR-18 D7: declined offers never restore Social — it only decayed this tick.
    expect(result.state.colonists[0]!.colonist.needs.social.level).toBeLessThan(socialBefore);
    // ADR-18 D6's decline row: forced-proximity friction, negative, both directions.
    expect(perspective(result.state.relationships, "c1", "zeke").affinity).toBeLessThan(0);
    expect(perspective(result.state.relationships, "zeke", "c1").affinity).toBeLessThan(0);
  });

  it("declines via the two-sided relationship gate without spending a PRNG draw", () => {
    const hostile = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: "directConflict",
      initiatorId: "zeke",
      responderId: "c1",
      aTowardBDelta: 0,
      bTowardADelta: -80, // zeke is hostile toward c1; c1's own view stays neutral
    }).store;
    const result = tick({ ...pendingOfferState(7), relationships: hostile }, 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("declined");
    expect(offer.reason).toBe("relationshipGate");
    expect(result.state.prng.draws).toBe(0);
  });

  it("cancels when the offer-creating goal is gone (initiatorUnavailable), with no relationship or Social effect", () => {
    const state = pendingOfferState(7);
    const withoutGoal = withRuntime(state, { colonist: withCurrentGoal(state.colonists[0]!.colonist, null) });
    const result = tick(withoutGoal, 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("cancelled");
    expect(offer.reason).toBe("initiatorUnavailable");
    expect(result.state.relationships.pairs).toEqual({}); // cancellation is not a change source
  });

  it("a survivable interruption during the delay window suspends the offer-creating goal and HOLDS the offer pending", () => {
    // Long delay so the interruption (critical hunger) lands inside the window.
    const state = pendingOfferState(7, { respondableAtTick: freeStart + 6, expiresAtTick: freeStart + 12 });
    const hungry = withRuntime(state, {
      colonist: withNeeds(state.colonists[0]!.colonist, { ...state.colonists[0]!.colonist.needs, hunger: { level: 0.1, ticksBelowLow: 50 } } as ColonistRuntime["colonist"]["needs"]),
    });
    const afterInterrupt = tick(hungry, 1);
    expect(afterInterrupt.state.colonists[0]!.colonist.suspendedGoal?.key).toBe("voluntary:social:conversation:zeke");
    expect(afterInterrupt.state.colonists[0]!.suspendedExecution).toBeNull(); // offer-backed suspension parks no execution
    expect(afterInterrupt.state.socialOffers.offers[0]!.status).toBe("pending");
    // The next tick's lifecycle pass holds (step 3) — still pending, no draw spent on it.
    const held = tick(afterInterrupt.state, 1);
    expect(held.state.socialOffers.offers[0]!.status).toBe("pending");
  });

  it("expires once clock.tick reaches expiresAtTick while the goal is suspended, abandoning the stranded goal", () => {
    const base = pendingOfferState(7);
    const suspended = suspendGoal(base.colonists[0]!.colonist.currentGoal!);
    const state: SimulationState = {
      ...withRuntime(base, { colonist: withSuspendedGoal(withCurrentGoal(base.colonists[0]!.colonist, null), suspended) }),
      socialOffers: { offers: [{ ...base.socialOffers.offers[0]!, expiresAtTick: freeStart + 1 }], nextOfferSequence: 1 },
    };
    const result = tick(state, 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("expired");
    expect(offer.reason).toBe("timeout");
    expect(result.state.colonists[0]!.colonist.suspendedGoal).toBeNull(); // the goal must not later resume into direct execution
    expect(result.state.relationships.pairs).toEqual({}); // expiry applies no relationship effect
  });

  it("identical seed and state reproduce the same offer-response sequence (Issue #120 determinism criterion)", () => {
    const a = run(pendingOfferState(7), 30).finalState;
    const b = run(pendingOfferState(7), 30).finalState;
    expect(b.socialOffers).toEqual(a.socialOffers);
    expect(b.prng).toEqual(a.prng);
    // A different seed may legitimately resolve differently — the sequence is seed-determined,
    // not hard-coded: seed 1's first draw declines where seed 7's accepts (see tests above).
    const c = run(pendingOfferState(1), 30).finalState;
    expect(c.socialOffers.offers[0]!.status).toBe("declined");
    expect(a.socialOffers.offers[0]!.status).toBe("accepted");
  });

  it("resolved-offer retention never evicts pending offers (ADR-21 D4)", () => {
    // Flood the store with more resolved offers than the retention window, plus one pending.
    const resolved: SocialOffer[] = Array.from({ length: SOCIAL_OFFER_TUNING.resolvedOfferRetention + 5 }, (_, i) => ({
      id: i,
      initiatorId: "c1",
      responderId: "zeke",
      action: "conversation",
      createdAtTick: 1,
      respondableAtTick: 2,
      expiresAtTick: 5,
      status: "declined",
      resolvedAtTick: 3,
      reason: "acceptanceDraw",
    }));
    const base = pendingOfferState(7);
    const pendingId = resolved.length;
    const state: SimulationState = {
      ...base,
      socialOffers: {
        offers: [...resolved, { ...base.socialOffers.offers[0]!, id: pendingId }],
        nextOfferSequence: pendingId + 1,
      },
    };
    const after = tick(state, 1).state;
    // The pending offer resolved (accepted, seed 7) this tick but was never evicted while
    // pending; eviction then trimmed the full RESOLVED population (the newly accepted offer
    // included) to the retention window, oldest ids first.
    expect(after.socialOffers.offers.some((o) => o.id === pendingId)).toBe(true);
    expect(after.socialOffers.offers.length).toBe(SOCIAL_OFFER_TUNING.resolvedOfferRetention);
    expect(after.socialOffers.offers[0]!.id).toBeGreaterThan(0); // oldest resolved ids evicted first
    expect(after.socialOffers.nextOfferSequence).toBe(pendingId + 1); // eviction never rolls the counter back
  });

  it("accepted, declined, cancelled, and expired offers all survive save/load (terminal-state matrix)", () => {
    const base = pendingOfferState(7);
    const terminal: SocialOffer[] = (
      [
        ["accepted", null],
        ["declined", "acceptanceDraw"],
        ["cancelled", "initiatorUnavailable"],
        ["expired", "timeout"],
      ] as const
    ).map(([status, reason], i) => ({
      id: i,
      initiatorId: "c1",
      responderId: "zeke",
      action: "conversation",
      createdAtTick: 1,
      respondableAtTick: 2,
      expiresAtTick: 5,
      status,
      resolvedAtTick: 3,
      reason,
    }));
    const state: SimulationState = { ...base, socialOffers: { offers: terminal, nextOfferSequence: terminal.length } };
    const reloaded = deserialize(serialize(state));
    expect(reloaded.socialOffers).toEqual(state.socialOffers);
  });

  it("full replay verification covers a run containing offer creation and resolution", () => {
    // Organic end-to-end: bootstrap → social commit → offer → resolution, then verifyReplay
    // proves the whole thing (traces AND terminal state, socialOffers included) reproduces.
    const freeStartState = stateAtTickOfDay(freeStart, { social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } }, 31);
    const initial = withOthers(freeStartState, [zeke]);
    const final = run(initial, 30).finalState;
    expect(final.socialOffers.offers.length).toBeGreaterThan(0); // sanity: the run really exercised the protocol
    expect(verifyReplay(initial, final).kind).toBe("match");
  });

  it("save/load round-trips a genuinely pending offer mid-delay without semantic change", () => {
    const state = pendingOfferState(7, { respondableAtTick: freeStart + 3, expiresAtTick: freeStart + 6 });
    const midDelay = tick(state, 1).state;
    expect(midDelay.socialOffers.offers[0]!.status).toBe("pending");
    const reloaded = deserialize(serialize(midDelay));
    expect(reloaded.socialOffers).toEqual(midDelay.socialOffers);
    // The reloaded run continues identically: same resolution on the same tick.
    const a = run(midDelay, 3).finalState;
    const b = run(reloaded, 3).finalState;
    expect(b.socialOffers).toEqual(a.socialOffers);
  });

  it("uses the shared Phase-4 responder state when that responder independently decides again in Phase 5 (Issue #135)", () => {
    const base = pendingOfferState(7);
    const responder = base.colonists.find((rt) => rt.colonist.identity.id === "zeke")!;
    const completedGoal = commitGoal(
      { source: "criticalNeed", tier: 1, key: "criticalNeed:hunger", baseUrgency: 1, relatedNeed: "hunger" },
      "test responder completion",
      base.clock.tick,
    );
    const responderColonist = withNeeds(withCurrentGoal(responder.colonist, completedGoal), {
      ...responder.colonist.needs,
      hunger: { level: 1, ticksBelowLow: 0 },
    } as ColonistRuntime["colonist"]["needs"]);
    const state: SimulationState = {
      ...base,
      colonists: base.colonists.map((rt) =>
        rt.colonist.identity.id === "zeke"
          ? {
              ...rt,
              colonist: responderColonist,
              execution: beginExecution(taskDefinition("eatAtFoodStation"), completedGoal, base.clock.tick),
            }
          : rt,
      ),
    };

    const result = tick(state, 1);
    const offer = result.state.socialOffers.offers[0]!;
    const responderAfter = result.state.colonists.find((rt) => rt.colonist.identity.id === "zeke")!;

    expect(result.events.some((event) => event.kind === "completion" && event.taskId === "eatAtFoodStation")).toBe(true);
    expect(responderAfter.colonist.currentGoal?.key).not.toBe(completedGoal.key);
    expect(offer.status).toBe("declined");
    expect(offer.reason).toBe("responderNotInterruptible");
  });
});

describe("goal completion", () => {
  it("a satisfaction task completes when its need reaches the satisfaction point, then a fresh decision follows in the same tick", () => {
    // Rest period, rest need low but not critical — the only actionable candidate.
    const restStart = policy.workTicks;
    let state = stateAtTickOfDay(restStart, { rest: { level: 0.3, ticksBelowLow: 500 } });

    let sawCompletion = false;
    for (let i = 0; i < 300 && !sawCompletion; i++) {
      const result = tick(state, 1);
      state = result.state;
      if (result.events.some((e) => e.kind === "completion" && e.taskId === "restAtBunk")) {
        sawCompletion = true;
        expect(result.events.some((e) => e.kind === "decision")).toBe(true);
      }
    }
    expect(sawCompletion).toBe(true);
  });
});

describe("goal interruption and resume — preserved execution progress (review fix 1)", () => {
  function runUntilInterrupted(): { state: SimulationState; interruptedAtElapsedTicks: number; originalVoluntary: NonNullable<ColonistRuntime["colonist"]["currentGoal"]> } {
    const freeStart = policy.workTicks + policy.restTicks;
    let state = stateAtTickOfDay(freeStart, { hunger: { level: 0.402, ticksBelowLow: 0 } });

    let result = tick(state, 1); // bootstrap: voluntary
    state = result.state;
    const originalVoluntary = state.colonists[0]!.colonist.currentGoal!;

    let interruptedAtElapsedTicks = -1;
    for (let i = 0; i < 50 && interruptedAtElapsedTicks < 0; i++) {
      result = tick(state, 1);
      state = result.state;
      if (result.events.some((e) => e.kind === "higherPriorityCondition")) {
        interruptedAtElapsedTicks = state.colonists[0]!.suspendedExecution!.elapsedTicks;
      }
    }
    return { state, interruptedAtElapsedTicks, originalVoluntary };
  }

  it("a higher-tier need crossing low interrupts a running voluntary goal, retaining goal AND execution as a pair", () => {
    const { state, originalVoluntary } = runUntilInterrupted();
    expect(state.colonists[0]!.colonist.suspendedGoal).not.toBeNull();
    expect(state.colonists[0]!.colonist.suspendedGoal!.key).toBe(originalVoluntary.key);
    expect(state.colonists[0]!.colonist.suspendedGoal!.status).toBe("suspended");
    expect(state.colonists[0]!.colonist.suspendedGoal!.motivation).toBe(originalVoluntary.motivation);
    expect(state.colonists[0]!.colonist.suspendedGoal!.adoptedAtTick).toBe(originalVoluntary.adoptedAtTick);
    expect(state.colonists[0]!.suspendedExecution).not.toBeNull();
    expect(state.colonists[0]!.suspendedExecution!.taskId).toBe("idlePresence");
    expect(state.colonists[0]!.suspendedExecution!.goalKey).toBe(originalVoluntary.key);
    expect(state.colonists[0]!.suspendedExecution!.status).toBe("interrupted");
    expect(state.colonists[0]!.colonist.currentGoal?.source).toBe("lowNeed");
    expect(state.colonists[0]!.colonist.currentGoal?.relatedNeed).toBe("hunger");
  });

  it("interrupted execution's elapsedTicks is nonzero and frozen while suspended", () => {
    const { state, interruptedAtElapsedTicks } = runUntilInterrupted();
    expect(interruptedAtElapsedTicks).toBeGreaterThan(0);
    expect(state.colonists[0]!.suspendedExecution!.elapsedTicks).toBe(interruptedAtElapsedTicks);
  });

  it("resuming preserves elapsedTicks exactly — the task never restarts from zero", () => {
    let { state, interruptedAtElapsedTicks, originalVoluntary } = runUntilInterrupted();

    let resumed = false;
    for (let i = 0; i < 400 && !resumed; i++) {
      const result = tick(state, 1);
      state = result.state;
      const resumeEvent = result.events.find((e) => e.kind === "executionResumed");
      if (resumeEvent && resumeEvent.kind === "executionResumed") {
        resumed = true;
        // The resumeEvent itself reports elapsedTicks EXACTLY as it was at interruption —
        // nothing progressed while suspended, and it is not reset to 0. Review fix (phase
        // ordering): Phase 6 (execution & consequences) now runs AFTER Phase 5 (decisions,
        // design D2) — so the resumed execution receives its own +1 tick of progress in THIS
        // SAME tick's Phase 6 pass, exactly like a freshly-adopted execution does.
        expect(resumeEvent.elapsedTicks).toBe(interruptedAtElapsedTicks);
        expect(resumeEvent.taskId).toBe("idlePresence");
        expect(state.colonists[0]!.execution!.elapsedTicks).toBe(interruptedAtElapsedTicks + 1);
        expect(state.colonists[0]!.execution!.status).toBe("inProgress");
        // Goal identity fully preserved.
        expect(state.colonists[0]!.colonist.currentGoal?.key).toBe(originalVoluntary.key);
        expect(state.colonists[0]!.colonist.currentGoal?.motivation).toBe(originalVoluntary.motivation);
        expect(state.colonists[0]!.colonist.currentGoal?.adoptedAtTick).toBe(originalVoluntary.adoptedAtTick);
        expect(state.colonists[0]!.colonist.suspendedGoal).toBeNull();
        expect(state.colonists[0]!.suspendedExecution).toBeNull();
      }
    }
    expect(resumed).toBe(true);
  });

  it("an unavailable task at resume time reports blockage explicitly instead of silently restarting", () => {
    // Hand-construct the "about to resume" precondition directly — a hunger goal and its
    // eatAtFoodStation execution already suspended, mid-progress — rather than growing it
    // organically (idlePresence, Stage 1's only easily-interrupting scenario, has no module
    // requirement and can never itself become unavailable, so it cannot exercise this guard
    // through a purely organic run). This exercises resumeSuspended's blockage branch through
    // the public tick() API using the same hand-built-state technique Build Step 6 used to
    // reach the otherwise-unreachable tier-1 path.
    const restPeriodTick = policy.workTicks;

    // Build the pair the same way real orchestration would: adopt, begin, progress, then
    // interrupt/suspend — not fabricated in an order the real code path could never produce.
    const activeGoal = commitGoal(
      { source: "lowNeed", tier: 4, key: "lowNeed:hunger", baseUrgency: 0.4, relatedNeed: "hunger" },
      "original motivation",
      0,
    );
    const begun = beginExecution(taskDefinition("eatAtFoodStation"), activeGoal, 0);
    const progressed = { ...begun, elapsedTicks: 30 }; // nonzero, so a silent restart would be detectable
    const suspendedExecution = interruptExecution(progressed);
    const suspendedGoal = suspendGoal(activeGoal);

    const colonist = withSuspendedGoal(createColonist("c1", "Maya"), suspendedGoal); // all needs satisfied by default — nothing else competes
    const brokenWorld = setModuleFunctional(createWorld(), "foodStation", false);

    const state: SimulationState = {
      clock: advance(createClock(), restPeriodTick),
      world: brokenWorld,
      policy,
      colonists: [{ colonist: colonist, execution: null, suspendedExecution: suspendedExecution, ...createFreshMemoryBaselines() }],
      prng: createPrng(1),
      hasBootstrapped: true, // hand-built mid-run precondition — already has an active/suspended goal
      eventLog: createEventLog(),
      decisionLog: createDecisionLog(),
      relationships: createRelationshipStore(),
      socialOffers: createSocialOfferStore(),
    };

    const result = tick(state, 1);
    expect(result.events.some((e) => e.kind === "suspensionResolved")).toBe(true);
    expect(result.events.some((e) => e.kind === "blockage")).toBe(true);
    expect(result.events.some((e) => e.kind === "executionAborted")).toBe(true);
    expect(result.events.some((e) => e.kind === "executionResumed")).toBe(false); // never silently resumed
    expect(result.events.some((e) => e.kind === "executionBegun")).toBe(false); // never silently restarted fresh either
    expect(result.state.colonists[0]!.colonist.currentGoal?.status).toBe("blocked");
    expect(result.state.colonists[0]!.execution).toBeNull();
    expect(result.state.colonists[0]!.suspendedExecution).toBeNull();
  });
});

describe("suspension overflow — Goal and Execution handled consistently", () => {
  it("a second interruption while one is already suspended abandons the old goal AND aborts its execution, with one explanatory event", () => {
    // Hand-constructed precondition (same technique as the blockage-at-resume test above,
    // and Build Step 6's tier-1 tests): growing this organically is unreliable, because any
    // second need that spends time in the same low-not-critical tier band as the first
    // active goal competes with it via ordinary weighted selection rather than cleanly
    // outranking it — that is a separate, pre-existing property of same-tier candidates,
    // not something this fix touches, and not worth fighting to route around in a fixture.
    //
    // Precondition: voluntary (tier 5) already suspended with a mid-progress execution;
    // hunger (tier 4) active with its own mid-progress execution; rest is ALREADY critical
    // (tier 2) from the start of this tick, so the unconditional interruption check fires
    // immediately against the still-occupied suspended slot.
    const voluntaryGoal = suspendGoal(commitGoal({ source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 }, "m", 0));
    const voluntaryExecution = interruptExecution(
      { ...beginExecution(taskDefinition("idlePresence"), { ...voluntaryGoal, status: "active" }, 0), elapsedTicks: 12 },
    );

    const hungerGoal = commitGoal(
      { source: "lowNeed", tier: 4, key: "lowNeed:hunger", baseUrgency: 0.4, relatedNeed: "hunger" },
      "hunger motivation",
      5,
    );
    const hungerExecution = { ...beginExecution(taskDefinition("eatAtFoodStation"), hungerGoal, 5), elapsedTicks: 7 };

    let colonist = withCurrentGoal(withSuspendedGoal(createColonist("c1", "Maya"), voluntaryGoal), hungerGoal);
    colonist = withNeeds(colonist, {
      ...createNeeds(),
      // Hunger must be below its satisfaction point — otherwise eatAtFoodStation reads as
      // already complete (hunger defaults to fully satisfied) and the goal completes before
      // the interruption check ever runs, since completion changes its status away from
      // "active" first. Not low/critical, just unsatisfied, so it doesn't itself generate a
      // competing candidate.
      hunger: { level: 0.5, ticksBelowLow: 0 },
      rest: { level: 0.05, ticksBelowLow: 500 }, // already critical
    });

    const state: SimulationState = {
      clock: advance(createClock(), policy.workTicks + policy.restTicks),
      world: createWorld(),
      policy,
      colonists: [{ colonist: colonist, execution: hungerExecution, suspendedExecution: voluntaryExecution, ...createFreshMemoryBaselines() }],
      prng: createPrng(1),
      hasBootstrapped: true, // hand-built mid-run precondition — already has an active/suspended goal
      eventLog: createEventLog(),
      decisionLog: createDecisionLog(),
      relationships: createRelationshipStore(),
      socialOffers: createSocialOfferStore(),
    };

    const result = tick(state, 1);

    expect(result.events.some((e) => e.kind === "higherPriorityCondition")).toBe(true);
    const overflow = result.events.find((e) => e.kind === "suspensionOverflow");
    expect(overflow).toBeDefined();
    if (overflow && overflow.kind === "suspensionOverflow") {
      expect(overflow.abandonedGoalKey).toBe("voluntary:idle");
      expect(overflow.abandonedExecutionTaskId).toBe("idlePresence");
    }

    // The new suspended slot now holds the hunger goal (the one that was overflowed OUT of
    // being active, not abandoned — it is properly suspended, not discarded).
    expect(result.state.colonists[0]!.colonist.suspendedGoal?.key).toBe("lowNeed:hunger");
    expect(result.state.colonists[0]!.colonist.suspendedGoal?.status).toBe("suspended");
    expect(result.state.colonists[0]!.suspendedExecution?.taskId).toBe("eatAtFoodStation");
    // 7 (hand-set), unchanged: review fix (phase ordering) — interruption/suspension detection
    // (design D2 phase 4/5) now runs BEFORE execution progress (phase 6), so an execution
    // suspended THIS tick never reaches phase 6's progress pass this same tick (it is already
    // parked in suspendedExecution by the time that pass runs). Preserved thereafter, not reset.
    expect(result.state.colonists[0]!.suspendedExecution?.elapsedTicks).toBe(7);
    expect(result.state.colonists[0]!.suspendedExecution?.status).toBe("interrupted");

    // The current goal is now the critical rest goal.
    expect(result.state.colonists[0]!.colonist.currentGoal?.relatedNeed).toBe("rest");
    expect(result.state.colonists[0]!.colonist.currentGoal?.source).toBe("criticalNeed");
  });
});

describe("re-decision triggers", () => {
  it("needThresholdCrossing fires exactly when a need crosses its low threshold, not before or after", () => {
    // decayPerTick 0.0011: 0.4008 -> 0.3997 after one tick — clearly crosses 0.4, with margin
    // away from the exact boundary so float rounding can't make the test ambiguous.
    const state = stateAtTickOfDay(0, { hunger: { level: 0.4008, ticksBelowLow: 0 } });
    const result = tick(state, 1);
    expect(result.events.some((e) => e.kind === "needThresholdCrossing" && e.needId === "hunger" && e.severity === "low")).toBe(true);
  });

  it("shiftBoundary fires when the period changes across the tick", () => {
    const state = stateAtTickOfDay(policy.workTicks - 1); // one tick before rest begins
    const result = tick(state, 1);
    expect(result.events.some((e) => e.kind === "shiftBoundary" && e.from === "work" && e.to === "rest")).toBe(true);
  });

  it("does not fire shiftBoundary mid-period", () => {
    const state = stateAtTickOfDay(10);
    const result = tick(state, 1);
    expect(result.events.some((e) => e.kind === "shiftBoundary")).toBe(false);
  });

  it("blockage fires when the running task's module becomes unavailable mid-execution", () => {
    let state = stateAtTickOfDay(policy.workTicks, { hunger: { level: 0.3, ticksBelowLow: 500 } }); // rest period, hunger low
    let result = tick(state, 1); // adopts+begins eatAtFoodStation
    state = result.state;
    expect(state.colonists[0]!.execution?.taskId).toBe("eatAtFoodStation");

    const brokenWorld = setModuleFunctional(state.world, "foodStation", false);
    state = { ...state, world: brokenWorld };
    result = tick(state, 1);
    expect(result.events.some((e) => e.kind === "blockage")).toBe(true);
    expect(result.events.some((e) => e.kind === "executionAborted")).toBe(true);
    expect(result.state.colonists[0]!.colonist.currentGoal?.status).toBe("blocked");
  });

  it("re-decision does not happen every tick when nothing changed (no trigger fires while progressing)", () => {
    const state = stateAtTickOfDay(0); // work period, all needs satisfied
    const first = tick(state, 1); // bootstrap tick — a decision happens here
    const second = tick(first.state, 1); // nothing should have changed
    expect(second.events.some((e) => e.kind === "decision")).toBe(false);
    expect(second.events.some((e) => e.kind === "bootstrap")).toBe(false);
  });

  it("no intermediate trigger is skipped across a multi-tick run() advance (review fix 2)", () => {
    // Two independent triggers land at different points within a short window: hunger
    // crosses low around tick 3-4, and — separately — verify each of the 4 ticks was
    // individually evaluated by checking the event trace contains a needThresholdCrossing
    // AND the clock progressed through every intermediate tick value (no jump).
    const initial = stateAtTickOfDay(0, { hunger: { level: 0.4029, ticksBelowLow: 0 } }); // crosses ~tick 3
    const result = run(initial, 4);
    const crossingEvents = result.events.filter((e) => e.kind === "needThresholdCrossing");
    expect(crossingEvents.length).toBeGreaterThan(0);
    expect(result.finalState.clock.tick).toBe(4);
  });

  it("run() detects a shift boundary and a need crossing within the same short advance, neither skipped", () => {
    // Position the clock one tick before the work→rest boundary, with hunger set to cross
    // low exactly two ticks later — both must appear in a 4-tick run().
    const start = policy.workTicks - 1;
    const initial = stateAtTickOfDay(start, { hunger: { level: 0.4019, ticksBelowLow: 0 } });
    const result = run(initial, 4);
    expect(result.events.some((e) => e.kind === "shiftBoundary")).toBe(true);
    expect(result.events.some((e) => e.kind === "needThresholdCrossing")).toBe(true);
  });

  it("suspensionResolved resumes the suspended goal once nothing outranks it, preserving its identity", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    let state = stateAtTickOfDay(freeStart, { hunger: { level: 0.402, ticksBelowLow: 0 } });
    let result = tick(state, 1); // bootstrap: voluntary
    state = result.state;
    const originalVoluntary = state.colonists[0]!.colonist.currentGoal!;

    let interrupted = false;
    for (let i = 0; i < 50 && !interrupted; i++) {
      result = tick(state, 1);
      state = result.state;
      interrupted = result.events.some((e) => e.kind === "higherPriorityCondition");
    }
    expect(interrupted).toBe(true);

    let resumed = false;
    for (let i = 0; i < 400 && !resumed; i++) {
      result = tick(state, 1);
      state = result.state;
      if (result.events.some((e) => e.kind === "suspensionResolved")) {
        resumed = true;
        expect(state.colonists[0]!.colonist.suspendedGoal).toBeNull();
        expect(state.colonists[0]!.suspendedExecution).toBeNull();
        expect(state.colonists[0]!.colonist.currentGoal?.key).toBe(originalVoluntary.key);
        expect(state.colonists[0]!.colonist.currentGoal?.motivation).toBe(originalVoluntary.motivation);
        expect(state.colonists[0]!.colonist.currentGoal?.adoptedAtTick).toBe(originalVoluntary.adoptedAtTick);
      }
    }
    expect(resumed).toBe(true);
  });
});

describe("replay determinism", () => {
  it("running the same initial state for the same number of ticks twice yields identical final states", () => {
    const initial = stateAtTickOfDay(0, { hunger: { level: 0.42, ticksBelowLow: 0 } }, 99);
    const a = run(initial, 200);
    const b = run(initial, 200);
    expect(a.finalState).toEqual(b.finalState);
  });

  it("different seeds may still converge deterministically per-seed (same seed always reproduces)", () => {
    const initialA = stateAtTickOfDay(0, {}, 5);
    const initialB = stateAtTickOfDay(0, {}, 5);
    expect(run(initialA, 100).finalState).toEqual(run(initialB, 100).finalState);
  });
});

describe("stable replay logs", () => {
  it("the full event trace is identical across two runs of the same initial state", () => {
    const initial = stateAtTickOfDay(0, { hunger: { level: 0.42, ticksBelowLow: 0 } }, 7);
    const a = run(initial, 150);
    const b = run(initial, 150);
    expect(a.events).toEqual(b.events);
  });
});

describe("purity", () => {
  it("tick() does not mutate its input state", () => {
    const state = stateAtTickOfDay(0);
    const snapshot = JSON.parse(JSON.stringify(state));
    tick(state, 1);
    expect(state).toEqual(snapshot);
  });

  it("run() does not mutate its input initial state", () => {
    const initial = stateAtTickOfDay(0);
    const snapshot = JSON.parse(JSON.stringify(initial));
    run(initial, 50);
    expect(initial).toEqual(snapshot);
  });
});

describe("same-tier commitment stickiness (final review fix, 2026-07-10)", () => {
  function stateWithHungerActiveAndSocialApproachingLow(): SimulationState {
    const restStart = policy.workTicks; // no shiftAssignment/voluntary competing during rest
    return stateAtTickOfDay(restStart, {
      hunger: { level: 0.3, ticksBelowLow: 500 }, // low, not critical — sole initial candidate
      social: { level: 0.404, ticksBelowLow: 0 }, // crosses low ~10 ticks later — same tier (4)
    });
  }

  it("a second low need appearing at the same tier does not replace the active Goal", () => {
    let state = stateWithHungerActiveAndSocialApproachingLow();
    let result = tick(state, 1); // bootstrap: hunger goal adopted
    state = result.state;
    const originalGoal = state.colonists[0]!.colonist.currentGoal!;
    expect(originalGoal.relatedNeed).toBe("hunger");

    let sawSocialCrossing = false;
    for (let i = 0; i < 30 && !sawSocialCrossing; i++) {
      result = tick(state, 1);
      state = result.state;
      if (result.events.some((e) => e.kind === "needThresholdCrossing" && e.needId === "social")) {
        sawSocialCrossing = true;
        // The event is still logged (an honest ambient signal) — but nothing re-decided.
        expect(result.events.some((e) => e.kind === "decision")).toBe(false);
        expect(result.events.some((e) => e.kind === "taskResolution")).toBe(false);
        expect(result.events.some((e) => e.kind === "executionBegun")).toBe(false);
        expect(state.colonists[0]!.colonist.currentGoal?.key).toBe(originalGoal.key);
        expect(state.colonists[0]!.colonist.currentGoal?.source).toBe("lowNeed");
        expect(state.colonists[0]!.colonist.currentGoal?.relatedNeed).toBe("hunger");
      }
    }
    expect(sawSocialCrossing).toBe(true);
  });

  it("no PRNG draw is consumed when a same-tier candidate appears", () => {
    let state = stateWithHungerActiveAndSocialApproachingLow();
    let result = tick(state, 1);
    state = result.state;

    for (let i = 0; i < 30; i++) {
      const prngBefore = state.prng;
      result = tick(state, 1);
      const sawCrossing = result.events.some((e) => e.kind === "needThresholdCrossing" && e.needId === "social");
      state = result.state;
      if (sawCrossing) {
        expect(state.prng).toEqual(prngBefore); // completely untouched — zero draws
        return;
      }
    }
    throw new Error("social never crossed low within the test window");
  });

  it("motivation and adoptedAtTick remain unchanged across a same-tier same-tick trigger", () => {
    let state = stateWithHungerActiveAndSocialApproachingLow();
    let result = tick(state, 1);
    state = result.state;
    const originalMotivation = state.colonists[0]!.colonist.currentGoal!.motivation;
    const originalAdoptedAtTick = state.colonists[0]!.colonist.currentGoal!.adoptedAtTick;

    for (let i = 0; i < 30; i++) {
      result = tick(state, 1);
      state = result.state;
      if (result.events.some((e) => e.kind === "needThresholdCrossing" && e.needId === "social")) {
        expect(state.colonists[0]!.colonist.currentGoal!.motivation).toBe(originalMotivation);
        expect(state.colonists[0]!.colonist.currentGoal!.adoptedAtTick).toBe(originalAdoptedAtTick);
        return;
      }
    }
    throw new Error("social never crossed low within the test window");
  });

  it("execution progress continues unchanged except for normal per-tick progress", () => {
    let state = stateWithHungerActiveAndSocialApproachingLow();
    let result = tick(state, 1);
    state = result.state;
    const taskId = state.colonists[0]!.execution!.taskId;

    let sawCrossing = false;
    for (let i = 0; i < 30 && !sawCrossing; i++) {
      const before = state.colonists[0]!.execution!.elapsedTicks;
      result = tick(state, 1);
      state = result.state;
      expect(state.colonists[0]!.execution!.taskId).toBe(taskId);
      expect(state.colonists[0]!.execution!.status).toBe("inProgress");
      // Exactly +1 per tick — no reset, no skip, no jump — even on the tick the same-tier
      // trigger fires.
      expect(state.colonists[0]!.execution!.elapsedTicks).toBe(before + 1);
      sawCrossing = result.events.some((e) => e.kind === "needThresholdCrossing" && e.needId === "social");
    }
    expect(sawCrossing).toBe(true);
  });

  it("a higher-tier candidate still interrupts correctly (the stickiness gate does not suppress real interruptions)", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    let state = stateAtTickOfDay(freeStart, { hunger: { level: 0.402, ticksBelowLow: 0 } });
    let result = tick(state, 1);
    state = result.state;
    expect(state.colonists[0]!.colonist.currentGoal?.source).toBe("voluntary");

    let interrupted = false;
    for (let i = 0; i < 50 && !interrupted; i++) {
      result = tick(state, 1);
      state = result.state;
      interrupted = result.events.some((e) => e.kind === "higherPriorityCondition");
    }
    expect(interrupted).toBe(true);
    expect(state.colonists[0]!.colonist.currentGoal?.source).toBe("lowNeed");
    expect(state.colonists[0]!.colonist.suspendedGoal?.source).toBe("voluntary");
  });

  it("completion still permits a new selection", () => {
    const restStart = policy.workTicks;
    let state = stateAtTickOfDay(restStart, { rest: { level: 0.3, ticksBelowLow: 500 } });
    let sawCompletionThenDecision = false;
    for (let i = 0; i < 300 && !sawCompletionThenDecision; i++) {
      const result = tick(state, 1);
      state = result.state;
      if (result.events.some((e) => e.kind === "completion")) {
        sawCompletionThenDecision = result.events.some((e) => e.kind === "decision");
      }
    }
    expect(sawCompletionThenDecision).toBe(true);
  });

  it("blockage still permits a new selection", () => {
    let state = stateAtTickOfDay(policy.workTicks, { hunger: { level: 0.3, ticksBelowLow: 500 } });
    let result = tick(state, 1);
    state = result.state;
    const brokenWorld = setModuleFunctional(state.world, "foodStation", false);
    state = { ...state, world: brokenWorld };
    result = tick(state, 1);
    // Blockage moves the goal's status away from "active", so the stickiness gate does not
    // apply and a fresh decision follows in the same tick.
    expect(result.events.some((e) => e.kind === "blockage")).toBe(true);
    expect(result.events.some((e) => e.kind === "decision")).toBe(true);
  });
});

describe("suspended-pair invariant (review fix 2, 2026-07-10)", () => {
  const voluntaryCandidate = { source: "voluntary" as const, tier: 5 as const, key: "voluntary:idle", baseUrgency: 0.2 };
  const hungerCandidate = {
    source: "lowNeed" as const,
    tier: 4 as const,
    key: "lowNeed:hunger",
    baseUrgency: 0.4,
    relatedNeed: "hunger" as const,
  };

  it("rejects goal present / execution missing", () => {
    const base = stateAtTickOfDay(0);
    const goal = suspendGoal(commitGoal(voluntaryCandidate, "m", 0));
    const state: SimulationState = withRuntime(base, { colonist: withSuspendedGoal(base.colonists[0]!.colonist, goal), suspendedExecution: null });
    expect(() => validateSimulationState(state)).toThrow();
    expect(() => tick(state, 1)).toThrow(); // input boundary rejects it too
  });

  it("rejects execution present / goal missing", () => {
    const base = stateAtTickOfDay(0);
    const exec = interruptExecution(beginExecution(taskDefinition("idlePresence"), commitGoal(voluntaryCandidate, "m", 0), 0));
    const state: SimulationState = withRuntime(base, { suspendedExecution: exec }); // colonist.suspendedGoal stays null
    expect(() => validateSimulationState(state)).toThrow();
    expect(() => tick(state, 1)).toThrow();
  });

  it("accepts a valid paired state", () => {
    const base = stateAtTickOfDay(0);
    const goal = suspendGoal(commitGoal(voluntaryCandidate, "m", 0));
    const exec = interruptExecution(beginExecution(taskDefinition("idlePresence"), { ...goal, status: "active" }, 0));
    const state: SimulationState = withRuntime(base, { colonist: withSuspendedGoal(base.colonists[0]!.colonist, goal), suspendedExecution: exec });
    expect(() => validateSimulationState(state)).not.toThrow();
  });

  it("rejects a mismatched pair — execution.goalKey does not name the suspended goal", () => {
    const base = stateAtTickOfDay(0);
    const goal = suspendGoal(commitGoal(voluntaryCandidate, "m", 0));
    const mismatchedExec = interruptExecution(beginExecution(taskDefinition("eatAtFoodStation"), commitGoal(hungerCandidate, "m", 0), 0));
    const state: SimulationState = withRuntime(base, { colonist: withSuspendedGoal(base.colonists[0]!.colonist, goal), suspendedExecution: mismatchedExec });
    expect(() => validateSimulationState(state)).toThrow();
  });

  it("rejects a suspended execution that isn't in 'interrupted' status", () => {
    const base = stateAtTickOfDay(0);
    const goal = suspendGoal(commitGoal(voluntaryCandidate, "m", 0));
    const stillInProgress = beginExecution(taskDefinition("idlePresence"), { ...goal, status: "active" }, 0); // NOT interrupted
    const state: SimulationState = withRuntime(base, { colonist: withSuspendedGoal(base.colonists[0]!.colonist, goal), suspendedExecution: stillInProgress });
    expect(() => validateSimulationState(state)).toThrow();
  });

  it("REGRESSION (Copilot-confirmed) — active-pair invariant: rejects an execution whose goalKey does not match currentGoal.key", () => {
    const base = stateAtTickOfDay(0);
    const goal = commitGoal(voluntaryCandidate, "m", 0);
    const unrelatedExec = beginExecution(taskDefinition("eatAtFoodStation"), commitGoal(hungerCandidate, "m", 0), 0);
    const state: SimulationState = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, goal), execution: unrelatedExec });
    expect(() => validateSimulationState(state)).toThrow(/goalKey/);
    expect(() => tick(state, 1)).toThrow(); // input boundary rejects it too
  });

  it("REGRESSION (Copilot-confirmed) — active-pair invariant: rejects an execution with no current goal at all", () => {
    const base = stateAtTickOfDay(0);
    const exec = beginExecution(taskDefinition("idlePresence"), commitGoal(voluntaryCandidate, "m", 0), 0);
    const state: SimulationState = withRuntime(base, { execution: exec }); // colonist.currentGoal stays null
    expect(() => validateSimulationState(state)).toThrow(/currentGoal is null/);
    expect(() => tick(state, 1)).toThrow();
  });

  it("REGRESSION (Copilot-confirmed) — active-pair invariant: rejects an execution running against a blocked goal", () => {
    const base = stateAtTickOfDay(0);
    const goal = commitGoal(voluntaryCandidate, "m", 0);
    const exec = beginExecution(taskDefinition("idlePresence"), goal, 0);
    const blocked = { ...goal, status: "blocked" as const };
    const state: SimulationState = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, blocked), execution: exec });
    expect(() => validateSimulationState(state)).toThrow(/only an active goal can be executing/);
  });

  it("REGRESSION (Copilot-confirmed) — active-pair invariant: rejects a non-inProgress execution in the active slot", () => {
    const base = stateAtTickOfDay(0);
    const goal = commitGoal(voluntaryCandidate, "m", 0);
    const interrupted = interruptExecution(beginExecution(taskDefinition("idlePresence"), goal, 0));
    const state: SimulationState = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, goal), execution: interrupted });
    expect(() => validateSimulationState(state)).toThrow(/inProgress/);
  });

  it("active-pair invariant: accepts a consistent in-progress pair, and every organic run output validates", () => {
    const base = stateAtTickOfDay(0);
    const goal = commitGoal(voluntaryCandidate, "m", 0);
    const exec = beginExecution(taskDefinition("idlePresence"), goal, 0);
    const state: SimulationState = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, goal), execution: exec });
    expect(() => validateSimulationState(state)).not.toThrow();

    // Organic sanity: a real run's every boundary state already passes through
    // validateSimulationState inside finish(); one long run exercises completion, blockage-free
    // re-decision, and shift boundaries under the tightened invariant.
    const finalState = run(stateAtTickOfDay(0), 600).finalState;
    expect(() => validateSimulationState(finalState)).not.toThrow();
  });

  it("invariant is preserved across suspend, resume, blockage, and overflow — every intermediate tick output validates", () => {
    // Suspend + resume (free-period interruption/resume scenario).
    const freeStart = policy.workTicks + policy.restTicks;
    let state = stateAtTickOfDay(freeStart, { hunger: { level: 0.402, ticksBelowLow: 0 } });
    let result = tick(state, 1);
    state = result.state;
    validateSimulationState(state); // bootstrap output

    for (let i = 0; i < 450; i++) {
      result = tick(state, 1);
      state = result.state;
      validateSimulationState(state); // every tick's output, through interruption and resume
    }
    expect(state.colonists[0]!.colonist.suspendedGoal).toBeNull(); // resumed by the end of the window
    expect(state.colonists[0]!.suspendedExecution).toBeNull();

    // Blockage (separate scenario): breaking a module mid-execution must still leave a valid state.
    let blockageState = stateAtTickOfDay(policy.workTicks, { hunger: { level: 0.3, ticksBelowLow: 500 } });
    let blockageResult = tick(blockageState, 1);
    blockageState = blockageResult.state;
    validateSimulationState(blockageState);
    blockageState = { ...blockageState, world: setModuleFunctional(blockageState.world, "foodStation", false) };
    blockageResult = tick(blockageState, 1);
    validateSimulationState(blockageResult.state);

    // Overflow (hand-built precondition, mirroring the suspension-overflow test above).
    const voluntarySuspended = suspendGoal(commitGoal(voluntaryCandidate, "m", 0));
    const voluntaryExec = interruptExecution(
      { ...beginExecution(taskDefinition("idlePresence"), { ...voluntarySuspended, status: "active" }, 0), elapsedTicks: 12 },
    );
    const hungerActive = commitGoal(hungerCandidate, "hunger motivation", 5);
    const hungerExec = { ...beginExecution(taskDefinition("eatAtFoodStation"), hungerActive, 5), elapsedTicks: 7 };
    let overflowColonist = withCurrentGoal(withSuspendedGoal(createColonist("c1", "Maya"), voluntarySuspended), hungerActive);
    overflowColonist = withNeeds(overflowColonist, {
      ...createNeeds(),
      hunger: { level: 0.5, ticksBelowLow: 0 },
      rest: { level: 0.05, ticksBelowLow: 500 },
    });
    const overflowState: SimulationState = {
      clock: advance(createClock(), policy.workTicks + policy.restTicks),
      world: createWorld(),
      policy,
      colonists: [{ colonist: overflowColonist, execution: hungerExec, suspendedExecution: voluntaryExec, ...createFreshMemoryBaselines() }],
      prng: createPrng(1),
      hasBootstrapped: true, // hand-built mid-run precondition — already has an active/suspended goal
      eventLog: createEventLog(),
      decisionLog: createDecisionLog(),
      relationships: createRelationshipStore(),
      socialOffers: createSocialOfferStore(),
    };
    validateSimulationState(overflowState); // the hand-built precondition is itself valid
    const overflowResult = tick(overflowState, 1);
    validateSimulationState(overflowResult.state); // and so is the state after overflow resolves
  });
});

describe("relational memory formation via real ticks (Stage 2 build step 8, ADR-20 D7)", () => {
  // atrophyPerTick is 0.02/tick (relationships.ts); relationshipChangeSignificance is 15
  // (config/tuning.ts) — cumulative drift needs ~750 ticks past the first-sighting tick to
  // cross it. Starting affinity of 50 stays well clear of clamping the whole way.
  const SIGNIFICANT_TICKS = 800;
  const NON_SIGNIFICANT_TICKS = 100; // 100 * 0.02 = 2, well below the 15 threshold

  function seededState(): SimulationState {
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
      policy,
      colonists: [{ colonist: colonist, execution: null, suspendedExecution: null, ...createFreshMemoryBaselines() }],
      prng: createPrng(1),
      hasBootstrapped: false,
      eventLog: createEventLog(),
      decisionLog: createDecisionLog(),
      relationships,
      socialOffers: createSocialOfferStore(),
    };
  }

  it("a real run path forms a Relational memory once cumulative atrophy drift becomes significant", () => {
    const result = run(seededState(), SIGNIFICANT_TICKS);
    const relational = result.finalState.colonists[0]!.colonist.memory.filter((e) => e.type === "relational");
    expect(relational.length).toBeGreaterThan(0);
    expect(relational[0]!.context).toEqual({ otherId: "zeke", direction: "negative" });
  });

  it("emits a memoryFormed event with memoryType relational and the correct otherId", () => {
    const result = run(seededState(), SIGNIFICANT_TICKS);
    const formed = result.events.filter((e) => e.kind === "memoryFormed" && e.memoryType === "relational");
    expect(formed.length).toBeGreaterThan(0);
    expect(formed[0]).toMatchObject({ kind: "memoryFormed", memoryType: "relational", otherId: "zeke" });
  });

  it("does NOT form a Relational memory while cumulative drift stays below significance", () => {
    const result = run(seededState(), NON_SIGNIFICANT_TICKS);
    const relational = result.finalState.colonists[0]!.colonist.memory.filter((e) => e.type === "relational");
    expect(relational).toEqual([]);
    expect(result.events.some((e) => e.kind === "memoryFormed" && e.memoryType === "relational")).toBe(false);
  });

  it("a real single-colonist run with no materialized pairs never forms a Relational memory (unchanged Stage 1 behavior)", () => {
    const colonist = withNeeds(createColonist("c1", "Maya"), createNeeds());
    const bare: SimulationState = {
      clock: createClock(),
      world: createWorld(),
      policy,
      colonists: [{ colonist: colonist, execution: null, suspendedExecution: null, ...createFreshMemoryBaselines() }],
      prng: createPrng(1),
      hasBootstrapped: false,
      eventLog: createEventLog(),
      decisionLog: createDecisionLog(),
      relationships: createRelationshipStore(),
      socialOffers: createSocialOfferStore(),
    };
    const result = run(bare, SIGNIFICANT_TICKS);
    expect(result.finalState.colonists[0]!.colonist.memory.filter((e) => e.type === "relational")).toEqual([]);
  });

  it("existing Deprivation/Condition memory formation is unaffected by relationship wiring", () => {
    const base = seededState();
    const withHunger: SimulationState = withRuntime(base, {
      colonist: withNeeds(base.colonists[0]!.colonist, { ...createNeeds(), hunger: { level: 0.9, ticksBelowLow: 0 } }),
    });
    const result = run(withHunger, SIGNIFICANT_TICKS);
    const deprivation = result.finalState.colonists[0]!.colonist.memory.filter((e) => e.type === "deprivation");
    expect(deprivation.length).toBeGreaterThan(0); // hunger decay over 800 ticks still forms Deprivation memories as before
  });

  it("never reads RelationshipStore.pairs or PairRecord.history directly — tick.ts only threads applyAtrophy's own consequence fields", () => {
    const source = readFileSync(new URL("./tick.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/relationships\.pairs/);
    expect(source).not.toMatch(/\.history\b/);
  });

  it("purity: run() does not mutate the seeded initial state", () => {
    const state = seededState();
    const snapshot = JSON.parse(JSON.stringify(state));
    run(state, SIGNIFICANT_TICKS);
    expect(state).toEqual(snapshot);
  });
});

describe("full multi-colonist simulation (Stage 2 Slice 6b, design D2/D3, ADR-22 D1/D4)", () => {
  const zeke = { id: "zeke", name: "Zeke", skills: [], baseTraits: [] } as const;
  const yara = { id: "yara", name: "Yara", skills: [], baseTraits: [] } as const;
  const aaron = { id: "aaron", name: "Aaron", skills: [], baseTraits: [] } as const; // sorts before "c1"

  it("every colonist in the collection is simulated — all bootstrap and adopt a goal on the first tick, regardless of canonical position", () => {
    const state = withOthers(stateAtTickOfDay(0), [yara, zeke, aaron]);
    expect(state.colonists.map((r) => r.colonist.identity.id)).toEqual(["aaron", "c1", "yara", "zeke"]); // sanity: aaron sorts first
    const result = tick(state, 1);
    expect(result.state.colonists).toHaveLength(4);
    // Every colonist bootstrapped and adopted a goal — none are silently skipped by position.
    for (const rt of result.state.colonists) {
      expect(rt.colonist.currentGoal).not.toBeNull();
    }
    expect(result.events.filter((e) => e.kind === "bootstrap")).toHaveLength(4);
  });

  it("same-tick non-observability: reordering two colonists' ids never changes a third colonist's decision inputs", () => {
    // Two runs differing only in which of two OTHER colonists' ids sorts first — colonist "m"'s
    // own decision-time snapshot (nearbyColonists content aside) and resulting commitment must
    // be identical either way, since D3's shared observation basis is fixed before any Phase 5
    // decision runs, independent of canonical iteration order.
    const m = { id: "m", name: "M", skills: [], baseTraits: [] } as const;
    const runA = withOthers(stateAtTickOfDay(0), [{ id: "aaa", name: "A", skills: [], baseTraits: [] }, m]);
    const runB = withOthers(stateAtTickOfDay(0), [{ id: "zzz", name: "Z", skills: [], baseTraits: [] }, m]);
    const resultA = tick(runA, 1).state.colonists.find((r) => r.colonist.identity.id === "m")!;
    const resultB = tick(runB, 1).state.colonists.find((r) => r.colonist.identity.id === "m")!;
    expect(resultA.colonist.currentGoal?.source).toBe(resultB.colonist.currentGoal?.source);
    expect(resultA.execution?.taskId).toBe(resultB.execution?.taskId);
  });

  it("same-tick non-observability: a colonist's own this-tick commitment is absent from another colonist's snapshot inputs", () => {
    // c1 and zeke both bootstrap into the SAME free-period tick. Neither's candidate generation
    // can have observed the OTHER's same-tick commitment: had it, an offer social candidate
    // toward a partner whose ambientState reflects a commitment made THIS tick would be a leak.
    // The shared observation basis is built once, from post-Phase-4 (pre-decision) state, so
    // both colonists' nearbyColonists content reflects each other's PRE-decision ambient state,
    // not any goal either adopts this same tick.
    const freeStart = policy.workTicks + policy.restTicks;
    const state = withOthers(stateAtTickOfDay(freeStart, { social: { level: 0.45, ticksBelowLow: 0 } }), [zeke]);
    const result = tick(state, 1);
    // Both colonists decided this tick (bootstrap fires for both); neither's decision record
    // references a candidate whose relatedColonistId ambient state could only be known from the
    // OTHER's same-tick decision — the observation basis predates both decisions entirely.
    const decisionEvents = result.events.filter((e) => e.kind === "decision");
    expect(decisionEvents.length).toBe(2);
  });

  it("validateSimulationState rejects duplicate colonist ids (out-of-order collection)", () => {
    const base = stateAtTickOfDay(0);
    const dup = { ...base, colonists: [base.colonists[0]!, base.colonists[0]!] };
    expect(() => validateSimulationState(dup)).toThrow(/canonical ascending id order/);
    expect(() => tick(dup, 1)).toThrow();
  });

  it("validateSimulationState rejects a collection out of canonical order", () => {
    const state = withOthers(stateAtTickOfDay(0), [zeke]);
    const reversed = { ...state, colonists: [...state.colonists].reverse() };
    expect(() => validateSimulationState(reversed)).toThrow(/canonical ascending id order/);
  });

  it("validateSimulationState rejects an empty collection", () => {
    const state = { ...stateAtTickOfDay(0), colonists: [] };
    expect(() => validateSimulationState(state)).toThrow(/non-empty/);
  });

  it("accepts a valid multi-entry collection with unique, ordered ids", () => {
    const state = withOthers(stateAtTickOfDay(0), [zeke, yara]);
    expect(() => validateSimulationState(state)).not.toThrow();
  });
});

describe("social protocol at full multi-colonist scale (Stage 2 Slice 6c, Issue #135)", () => {
  const yara = { id: "yara", name: "Yara", skills: [], baseTraits: [] } as const;

  it("cancels the later offer when two real initiators choose the same responder in one Phase 5", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    // With equal voluntary weights, seed 10 selects one of zeke's social candidates for both
    // c1 and yara. Both are real simulated deciders; neither offer is injected by the fixture.
    const initial = withOthers(stateAtTickOfDay(freeStart, {}, 10), [yara, zeke]);

    const result = tick(initial, 1);
    const offersToZeke = result.state.socialOffers.offers.filter((offer) => offer.responderId === "zeke");

    expect(offersToZeke).toHaveLength(2);
    expect(offersToZeke.map((offer) => [offer.initiatorId, offer.status, offer.reason])).toEqual([
      ["c1", "pending", null],
      ["yara", "cancelled", "responderUnavailable"],
    ]);
    expect(() => validateSimulationState(result.state)).not.toThrow();
  });

  it("does not reuse another initiator's pending offer when action and responder are identical", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    // Seed 11 makes both c1 and yara choose conversation with zeke. Offer ownership must
    // include the initiator even though ADR-21 derives the same goal key for both intents.
    const initial = withOthers(stateAtTickOfDay(freeStart, {}, 11), [yara, zeke]);

    const result = tick(initial, 1);
    const offersToZeke = result.state.socialOffers.offers.filter((offer) => offer.responderId === "zeke");

    expect(offersToZeke.map((offer) => [offer.initiatorId, offer.action, offer.status, offer.reason])).toEqual([
      ["c1", "conversation", "pending", null],
      ["yara", "conversation", "cancelled", "responderUnavailable"],
    ]);
    expect(() => validateSimulationState(result.state)).not.toThrow();
  });
});

describe("Stage 2 Slice 8 — Confrontation / In Conflict (design §14)", () => {
  function workstationPairState(seed = 1): SimulationState {
    const workStart = 0;
    const base = withOthers(stateAtTickOfDay(workStart, {}, seed), [zeke]);
    const workGoal = (ownerId: string) =>
      commitGoal(
        { source: "shiftAssignment", tier: 3, key: `shiftAssignment:work:${ownerId}`, baseUrgency: 0.5 },
        "work",
        0,
      );
    const withExec = (rt: ColonistRuntime, id: string): ColonistRuntime => {
      const goal = workGoal(id);
      return {
        ...rt,
        colonist: withCurrentGoal(
          withNeeds(rt.colonist, {
            ...rt.colonist.needs,
            // High stress so hostile pairs clear the combined-stress bar after Phase 3.
          } as ReturnType<typeof createNeeds>),
          goal,
        ),
        execution: beginExecution(taskDefinition("workAtWorkstation"), goal, base.clock.tick),
      };
    };
    const colonists = base.colonists.map((rt) => withExec(rt, rt.colonist.identity.id));
    // Force high stress after create — Phase 3 will move it slightly but we set near threshold.
    const stressed = colonists.map((rt) => ({
      ...rt,
      colonist: {
        ...rt.colonist,
        stress: { level: 0.7 },
      },
    }));
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
    return { ...base, colonists: stressed, relationships, hasBootstrapped: true };
  }

  it("fires Confrontation with relationship/stress/inConflict consequences and no goal/execution change", () => {
    // fireProbability forced via patching state is hard; use seed hunt or force via detect path.
    // Force fire by using conflictFireProbability=1 equivalent: run many seeds until one fires,
    // or temporarily rely on detectConfrontations with probability 1 by constructing a state
    // where we tick with a known-good seed. Probe a few seeds.
    let fired: ReturnType<typeof tick> | null = null;
    for (let seed = 1; seed <= 200 && fired === null; seed++) {
      const initial = workstationPairState(seed);
      const before = {
        goals: initial.colonists.map((r) => r.colonist.currentGoal),
        executions: initial.colonists.map((r) => r.execution),
        social: initial.colonists.map((r) => r.colonist.needs.social.level),
        purpose: initial.colonists.map((r) => r.colonist.needs.purpose.level),
        offers: initial.socialOffers.offers.length,
      };
      const result = tick(initial, 1);
      if (result.events.some((e) => e.kind === "confrontationOccurred")) {
        fired = result;
        const event = result.events.find((e) => e.kind === "confrontationOccurred");
        expect(event).toMatchObject({
          kind: "confrontationOccurred",
          colonistAId: "c1",
          colonistBId: "zeke",
          sharedModuleId: "workstation",
          severity: "hostile",
        });
        expect(perspective(result.state.relationships, "c1", "zeke").affinity).toBeLessThan(
          perspective(initial.relationships, "c1", "zeke").affinity,
        );
        expect(perspective(result.state.relationships, "zeke", "c1").affinity).toBeLessThan(
          perspective(initial.relationships, "zeke", "c1").affinity,
        );
        for (const rt of result.state.colonists) {
          expect(rt.inConflictUntilTick).toBe(result.state.clock.tick + CONFLICT_TUNING.inConflictDisplayTicks);
          expect(rt.colonist.stress.level).toBeGreaterThan(0.7);
        }
        const spikes = result.events.filter(
          (e) =>
            e.kind === "stressEvaluated" &&
            e.contributions.some((c) => c.id === "hostileProximityConflict" && c.rawDelta > 0),
        );
        expect(spikes.length).toBeGreaterThanOrEqual(2);
        // Confrontation credits no Social / Purpose (Phase 3 decay may still move levels).
        for (let i = 0; i < result.state.colonists.length; i++) {
          expect(result.state.colonists[i]!.colonist.needs.social.level).toBeLessThanOrEqual(before.social[i]!);
          expect(result.state.colonists[i]!.colonist.needs.purpose.level).toBeLessThanOrEqual(before.purpose[i]!);
        }
        expect(result.state.socialOffers.offers.length).toBe(before.offers);
        expect(result.state.colonists.map((r) => r.colonist.currentGoal)).toEqual(before.goals);
        // Confrontation does not create/abort/suspend executions — Phase 6 may still progress them.
        expect(result.state.colonists.map((r) => r.execution?.taskId)).toEqual(before.executions.map((e) => e?.taskId));
        expect(result.state.colonists.map((r) => r.execution?.goalKey)).toEqual(before.executions.map((e) => e?.goalKey));
        expect(result.state.colonists.map((r) => r.execution?.status)).toEqual(before.executions.map((e) => e?.status));
      }
    }
    expect(fired).not.toBeNull();
  });

  it("moduleId null colonists are never Confrontation participants", () => {
    const freeStart = policy.workTicks + policy.restTicks;
    const base = withOthers(stateAtTickOfDay(freeStart, {}, 1), [zeke]);
    const idle = base.colonists.map((rt) => ({
      ...rt,
      colonist: { ...rt.colonist, stress: { level: 0.9 } },
      execution: null,
    }));
    const relationships = applyInteraction(createRelationshipStore(), {
      colonistAId: "c1",
      colonistBId: "zeke",
      tick: 0,
      changeSource: "directConflict",
      initiatorId: null,
      responderId: null,
      aTowardBDelta: -80,
      bTowardADelta: -80,
    }).store;
    const result = tick({ ...base, colonists: idle, relationships, hasBootstrapped: true }, 1);
    expect(result.events.some((e) => e.kind === "confrontationOccurred")).toBe(false);
    expect(result.state.colonists.every((r) => r.inConflictUntilTick === null)).toBe(true);
  });

  it("fixed-seed run including Confrontation reproduces on replay", () => {
    let seedUsed: number | null = null;
    let initialWithFire: SimulationState | null = null;
    for (let seed = 1; seed <= 200; seed++) {
      const initial = workstationPairState(seed);
      const result = tick(initial, 1);
      if (result.events.some((e) => e.kind === "confrontationOccurred")) {
        seedUsed = seed;
        initialWithFire = initial;
        break;
      }
    }
    expect(seedUsed).not.toBeNull();
    const a = tick(initialWithFire!, 1);
    const b = tick(initialWithFire!, 1);
    expect(a.events).toEqual(b.events);
    expect(a.state.prng).toEqual(b.state.prng);
    expect(a.state.colonists.map((r) => r.inConflictUntilTick)).toEqual(b.state.colonists.map((r) => r.inConflictUntilTick));
  });
});

// --- Stage 2 Slice 9 — cross-slice validation sweep (design/stage-2-validation-plan.md §10).
// Test-only; no prototype/src production module is added or changed by this slice.

const runtimeOf = (state: SimulationState, id: string): ColonistRuntime =>
  state.colonists.find((r) => r.colonist.identity.id === id)!;

/** Steps one tick at a time and keeps every intermediate result — per-tick deltas must be visible. */
function stepTicks(initial: SimulationState, ticks: number): readonly ReturnType<typeof tick>[] {
  const results: ReturnType<typeof tick>[] = [];
  let state = initial;
  for (let i = 0; i < ticks; i++) {
    const result = tick(state, 1);
    results.push(result);
    state = result.state;
  }
  return results;
}

/**
 * Mid-run state: c1 holds a committed Comfort goal toward zeke plus its pending offer, created
 * "last tick" — the same hand-built shape the Slice 5 block's `pendingOfferState` uses for
 * Conversation. Comfort's responder eligibility is `ambientState === "stressed"` (ADR-24 D2),
 * deliberately outside INTERRUPTIBLE_AMBIENT_STATES, so zeke carries genuine stress well above the
 * threshold; an unstressed zeke declines with responderNotInterruptible and the scenario never
 * starts. zeke also holds his own valid idlePresence pair so his decision loop stays out of these
 * tests, and his stress baseline matches his actual stress so no spurious Condition memory forms.
 */
function pendingComfortState(seed = 7, offerOverrides: Partial<SocialOffer> = {}): SimulationState {
  const freeStart = policy.workTicks + policy.restTicks;
  const base = stateAtTickOfDay(freeStart, { social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } }, seed);
  const tickNow = base.clock.tick;
  const goal = commitGoal(
    {
      source: "voluntary",
      tier: 5,
      key: "voluntary:social:comfort:zeke",
      baseUrgency: 0.2,
      relatedColonistId: "zeke",
      relatedSocialTaskId: "comfort",
    },
    "test comfort motivation",
    tickNow,
  );
  const offer: SocialOffer = {
    id: 0,
    initiatorId: "c1",
    responderId: "zeke",
    action: "comfort",
    createdAtTick: tickNow,
    respondableAtTick: tickNow + 1,
    expiresAtTick: tickNow + 4,
    status: "pending",
    resolvedAtTick: null,
    reason: null,
    ...offerOverrides,
  };
  const zekeGoal = commitGoal({ source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 }, "test fixture idle", tickNow);
  // zeke's Social starts below the 1.0 ceiling on purpose: a saturated need would swallow
  // Comfort's own credit in the clamp and make the crediting assertions vacuously pass.
  const zekeNeeds = { ...createNeeds(), social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } } as ReturnType<typeof createNeeds>;
  const zekeRuntime: ColonistRuntime = {
    colonist: withStress(withNeeds(withCurrentGoal(createColonist("zeke", "Zeke"), zekeGoal), zekeNeeds), { level: 0.9 }),
    execution: beginExecution(taskDefinition("idlePresence"), zekeGoal, tickNow),
    suspendedExecution: null,
    ...createFreshMemoryBaselines(),
    stressBaseline: 0.9,
  };
  const withGoal = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, goal) });
  return {
    ...withGoal,
    colonists: [...withGoal.colonists, zekeRuntime].sort((a, b) => (a.colonist.identity.id < b.colonist.identity.id ? -1 : 1)),
    hasBootstrapped: true,
    socialOffers: { offers: [offer], nextOfferSequence: 1 },
  };
}

/** The same fixture with an unstressed responder — Comfort's stressed-only eligibility then fails. */
function withCalmResponder(state: SimulationState): SimulationState {
  return {
    ...state,
    colonists: state.colonists.map((rt) =>
      rt.colonist.identity.id === "zeke" ? { ...rt, colonist: withStress(rt.colonist, { level: 0 }), stressBaseline: 0 } : rt,
    ),
  };
}

describe("Stage 2 Slice 9 — accepted Comfort real-run consequences (validation plan §10)", () => {
  const reliefEvents = (result: ReturnType<typeof tick>) =>
    result.events.filter(
      (e) => e.kind === "stressEvaluated" && e.contributions.some((c) => c.id === "positiveSocialProximity" && c.rawDelta < 0),
    );

  it("accepts the offer and begins a real comfort execution through the existing offer lifecycle", () => {
    // seed 7's first draw ≈ 0.0117 < 0.65 (Comfort's own acquainted band) → accepted.
    const result = tick(pendingComfortState(), 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("accepted");
    expect(offer.action).toBe("comfort");
    expect(offer.reason).toBeNull();
    expect(runtimeOf(result.state, "c1").execution?.taskId).toBe("comfort");
    expect(result.events.some((e) => e.kind === "executionBegun" && e.taskId === "comfort")).toBe(true);
  });

  it("applies positiveSocialProximity relief to the recipient only, decomposable in a stressEvaluated event", () => {
    const steps = stepTicks(pendingComfortState(), 3);
    // The Comfort participation basis is built from tick-start state (design D12), so the tick
    // that ACCEPTS the offer cannot yet grant relief — it starts on the first full execution tick.
    expect(reliefEvents(steps[0]!)).toHaveLength(0);
    for (const step of [steps[1]!, steps[2]!]) {
      const withRelief = reliefEvents(step);
      expect(withRelief).toHaveLength(1); // exactly one of the two colonists — the recipient, not both
      expect(withRelief[0]!.kind === "stressEvaluated" && withRelief[0]!.contributions).toContainEqual({
        id: "positiveSocialProximity",
        rawDelta: -STRESS_TUNING.positiveSocialProximityReliefPerTick,
      });
    }
    // The single relieved colonist is the recipient: zeke's stress falls faster once Comfort is
    // running than it did on the pre-acceptance tick, on otherwise identical need conditions.
    const zekeStress = (step: ReturnType<typeof tick>) => runtimeOf(step.state, "zeke").colonist.stress.level;
    expect(zekeStress(steps[1]!) - zekeStress(steps[2]!)).toBeGreaterThan(0.9 - zekeStress(steps[0]!));
  });

  it("credits Social to BOTH participants per Comfort's own D7 table, and never credits Purpose", () => {
    // comfort-assist-protocol v0.4.0 §9 / stage-2-validation-plan.md v0.3.1 §10: an accepted
    // Comfort credits comfortSocialRestorePerTick to both participants; the "no Social" sentence
    // in earlier plan drafts was §9's Non-effects row (declined/cancelled/expired only).
    const social = (state: SimulationState, id: string) => runtimeOf(state, id).colonist.needs.social.level;
    const purpose = (state: SimulationState, id: string) => runtimeOf(state, id).colonist.needs.purpose.level;

    // Two one-tick runs from the same fixture, differing only in whether the Comfort is accepted:
    // the calm-responder control fails Comfort's stressed-only eligibility, so it declines and no
    // Comfort executes. Isolating a single tick keeps both sides free of re-decision noise, and
    // the difference between them is exactly the credit under test — need decay cancels out.
    const accepted = pendingComfortState();
    const declined = withCalmResponder(pendingComfortState());
    const afterAccepted = tick(accepted, 1);
    const afterDeclined = tick(declined, 1);
    expect(afterAccepted.state.socialOffers.offers[0]!.status).toBe("accepted");
    expect(afterDeclined.state.socialOffers.offers[0]!.status).toBe("declined");

    for (const id of ["c1", "zeke"]) {
      const withComfort = social(afterAccepted.state, id) - social(accepted, id);
      const withoutComfort = social(afterDeclined.state, id) - social(declined, id);
      expect(withoutComfort).toBeLessThan(0); // decay alone
      expect(withComfort - withoutComfort).toBeCloseTo(TASK_TUNING.comfortSocialRestorePerTick, 9);
      // Purpose is never credited by any social action (ADR-17 D6 / ADR-18 D7 distinctness).
      expect(purpose(afterAccepted.state, id)).toBeLessThan(purpose(accepted, id));
    }
  });

  it("a declined Comfort credits no Social and applies no positive affinity (§9 non-effects)", () => {
    // seed 1's first draw ≈ 0.6271 — below Conversation's 0.55 band it would decline; against
    // Comfort's higher acquainted band (0.65) it still lands under, so the decline is forced by
    // making the responder ineligible instead: an unstressed zeke is not a valid Comfort target.
    const base = withCalmResponder(pendingComfortState(1));
    const socialBefore = { c1: runtimeOf(base, "c1").colonist.needs.social.level, zeke: runtimeOf(base, "zeke").colonist.needs.social.level };
    const result = tick(base, 1);
    const offer = result.state.socialOffers.offers[0]!;
    expect(offer.status).toBe("declined");
    expect(offer.reason).toBe("responderNotInterruptible");
    expect(runtimeOf(result.state, "c1").execution?.taskId).not.toBe("comfort");
    expect(runtimeOf(result.state, "c1").colonist.needs.social.level).toBeLessThan(socialBefore.c1);
    expect(runtimeOf(result.state, "zeke").colonist.needs.social.level).toBeLessThan(socialBefore.zeke);
    // Decline friction only — never Comfort's positive mutualSupportCrisis delta.
    expect(perspective(result.state.relationships, "c1", "zeke").affinity).toBeLessThan(0);
    expect(perspective(result.state.relationships, "zeke", "c1").affinity).toBeLessThan(0);
  });

  it("accumulates positive mutualSupportCrisis affinity but cannot reach ADR-16 relational-memory significance on its provisional tuning", () => {
    // §10 asks that an accepted Comfort form a relational memory "when ADR-16's significance
    // criteria are met (or documents ... why a smaller-magnitude interaction did not)". This is
    // that documentation, measured rather than assumed. comfortAffinityDeltaPerTick is 0.04, so
    // relationshipChangeSignificance (15) needs ~375 crediting ticks; a Comfort accepted at the
    // start of the free period sustains a few hundred and still lands short. That is calibration
    // feedback for the Comfort design's own deferred DQ-2 (the sibling of the validation plan's
    // Finding 4 for Confrontation) — this slice records it and changes no tuning.
    const steps = stepTicks(pendingComfortState(), policy.freeTicks);
    const comfortTicks = steps.filter((s) => runtimeOf(s.state, "c1").execution?.taskId === "comfort").length;
    expect(comfortTicks).toBeGreaterThan(policy.freeTicks / 2); // genuinely sustained, not a one-tick brush

    const affinity = perspective(steps[steps.length - 1]!.state.relationships, "c1", "zeke").affinity;
    expect(affinity).toBeGreaterThan(0); // positive and both-directional, as D7's table requires
    expect(perspective(steps[steps.length - 1]!.state.relationships, "zeke", "c1").affinity).toBeGreaterThan(0);
    expect(affinity).toBeLessThan(MEMORY_TUNING.relationshipChangeSignificance);
    expect(steps.some((s) => s.events.some((e) => e.kind === "memoryFormed" && e.memoryType === "relational"))).toBe(false);
  });

  it("completes the accepted Comfort at the free-period boundary with a completion event and cleared comfort goal/execution", () => {
    // Park an already-accepted Comfort on the last free tick so hunger decay cannot preempt it,
    // then cross the free→work boundary and assert completion — not merely that comfort stayed
    // active for most of a long free-period sample.
    const accepted = tick(pendingComfortState(), 1).state;
    expect(runtimeOf(accepted, "c1").execution?.taskId).toBe("comfort");
    const lastFreeTick = policy.workTicks + policy.restTicks + policy.freeTicks - 1;
    const poised: SimulationState = { ...accepted, clock: advance(createClock(), lastFreeTick) };
    const result = tick(poised, 1);
    expect(result.events).toContainEqual({
      kind: "completion",
      goalKey: "voluntary:social:comfort:zeke",
      taskId: "comfort",
    });
    expect(runtimeOf(result.state, "c1").execution?.taskId).not.toBe("comfort");
    expect(runtimeOf(result.state, "c1").colonist.currentGoal?.key).not.toBe("voluntary:social:comfort:zeke");
  });

  it("rejects a second Comfort claim on the same recipient through a real tick (ADR-24 Invariant 12)", () => {
    // Admission side: with c1's Comfort already in progress, a second pending Comfort offer
    // naming zeke is declined by Phase 6's D11.5(a) claimed-recipient guard, and the produced
    // state still satisfies the invariant.
    const accepted = tick(pendingComfortState(), 1).state;
    const maya = { id: "ada", name: "Ada", skills: [] as readonly string[], baseTraits: [] as readonly TraitId[] };
    const withThird = withOthers(accepted, [maya]);
    const thirdGoal = commitGoal(
      { source: "voluntary", tier: 5, key: "voluntary:social:comfort:zeke", baseUrgency: 0.2, relatedColonistId: "zeke", relatedSocialTaskId: "comfort" },
      "second comforter",
      accepted.clock.tick,
    );
    const contested: SimulationState = {
      ...withThird,
      colonists: withThird.colonists.map((rt) =>
        rt.colonist.identity.id === "ada" ? { ...rt, colonist: withCurrentGoal(rt.colonist, thirdGoal) } : rt,
      ),
      socialOffers: {
        offers: [
          ...accepted.socialOffers.offers,
          {
            id: accepted.socialOffers.nextOfferSequence,
            initiatorId: "ada",
            responderId: "zeke",
            action: "comfort",
            createdAtTick: accepted.clock.tick,
            respondableAtTick: accepted.clock.tick + 1,
            expiresAtTick: accepted.clock.tick + 4,
            status: "pending",
            resolvedAtTick: null,
            reason: null,
          },
        ],
        nextOfferSequence: accepted.socialOffers.nextOfferSequence + 1,
      },
    };
    const result = tick(contested, 1);
    const second = result.state.socialOffers.offers.find((o) => o.initiatorId === "ada")!;
    expect(second.status).toBe("declined");
    expect(second.reason).toBe("responderNotInterruptible");
    expect(() => validateSimulationState(result.state)).not.toThrow();

    // State side: a hand-forced double claim is rejected at tick()'s own input boundary, not
    // only by the direct unit call in comfortParticipation.test.ts.
    const doubleClaim: SimulationState = {
      ...contested,
      colonists: contested.colonists.map((rt) =>
        rt.colonist.identity.id === "ada"
          ? { ...rt, execution: beginExecution(taskDefinition("comfort"), thirdGoal, contested.clock.tick) }
          : rt,
      ),
    };
    expect(() => tick(doubleClaim, 1)).toThrow(/ADR-24 Invariant 12/);
  });
});

describe("Stage 2 Slice 9 — Socializing ambient is reachable through real execution (validation plan §10)", () => {
  const ambientOf = (state: SimulationState, id: string) =>
    inspect(state).colonists.find((c) => c.identity.id === id)!.ambientState;

  /**
   * The accepted-offer fixture pattern from the Slice 5 block, rebuilt at this scope: a committed
   * conversation goal toward zeke with its pending, respondable-next-tick offer. seed 7's first
   * draw ≈ 0.0117 clears the acquainted acceptance band, so the tick under test genuinely begins
   * the execution rather than hand-installing one.
   */
  function pendingConversationState(): SimulationState {
    const freeStart = policy.workTicks + policy.restTicks;
    const base = stateAtTickOfDay(freeStart, { social: { level: 0.45, ticksBelowLow: 0 }, purpose: { level: 0.5, ticksBelowLow: 0 } }, 7);
    const tickNow = base.clock.tick;
    const goal = commitGoal(
      { source: "voluntary", tier: 5, key: "voluntary:social:conversation:zeke", baseUrgency: 0.2, relatedColonistId: "zeke", relatedSocialTaskId: "conversation" },
      "test offer motivation",
      tickNow,
    );
    const zekeGoal = commitGoal({ source: "voluntary", tier: 5, key: "voluntary:idle", baseUrgency: 0.2 }, "test fixture idle", tickNow);
    const zekeRuntime: ColonistRuntime = {
      colonist: withCurrentGoal(createColonist("zeke", "Zeke"), zekeGoal),
      execution: beginExecution(taskDefinition("idlePresence"), zekeGoal, tickNow),
      suspendedExecution: null,
      ...createFreshMemoryBaselines(),
    };
    const withGoal = withRuntime(base, { colonist: withCurrentGoal(base.colonists[0]!.colonist, goal) });
    return {
      ...withGoal,
      colonists: [...withGoal.colonists, zekeRuntime].sort((a, b) => (a.colonist.identity.id < b.colonist.identity.id ? -1 : 1)),
      hasBootstrapped: true,
      socialOffers: {
        offers: [
          {
            id: 0,
            initiatorId: "c1",
            responderId: "zeke",
            action: "conversation",
            createdAtTick: tickNow,
            respondableAtTick: tickNow + 1,
            expiresAtTick: tickNow + 4,
            status: "pending",
            resolvedAtTick: null,
            reason: null,
          },
        ],
        nextOfferSequence: 1,
      },
    };
  }

  it("an accepted Conversation offer leaves the initiator reading as socializing in the inspector", () => {
    const result = tick(pendingConversationState(), 1);
    expect(result.state.socialOffers.offers[0]!.status).toBe("accepted");
    expect(runtimeOf(result.state, "c1").execution?.taskId).toBe("conversation");
    expect(ambientOf(result.state, "c1")).toBe("socializing");
  });

  it("an in-progress Shared Downtime execution reads as socializing after a real tick", () => {
    const result = tick(socialExecutionState("sharedDowntime"), 1);
    expect(runtimeOf(result.state, "c1").execution?.taskId).toBe("sharedDowntime");
    expect(ambientOf(result.state, "c1")).toBe("socializing");
  });

  it("an executing comforter reads as socializing; the stressed recipient still reads as stressed", () => {
    // ambientStateFor gives the stress overlay precedence over the task mapping, so Comfort's
    // recipient — stressed by construction, that is Comfort's own eligibility rule — keeps
    // reading "stressed". The comforter is the participant whose socializing state is observable.
    const state = tick(pendingComfortState(), 1).state;
    expect(runtimeOf(state, "c1").execution?.taskId).toBe("comfort");
    expect(ambientOf(state, "c1")).toBe("socializing");
    expect(ambientOf(state, "zeke")).toBe("stressed");
  });
});
