// Headless run harness — sets up a Stage 2 simulation and advances it in fixed steps via
// tick.ts. Every colonist in the collection is fully simulated (Stage 2 Slice 6b).
//
// Fixed-step rule (review fix 2, 2026-07-10): tick() only accepts BASE_TICKS_PER_STEP, so
// run() is the only place a larger timeline advances — by calling tick() once per step, never
// by passing a larger delta. This guarantees every fixed simulation step is evaluated and no
// intermediate need-threshold crossing or shift boundary can be skipped by a coarse caller.

import { createClock } from "../core/clock.js";
import { createPrng } from "../core/prng.js";
import { BASE_TICKS_PER_STEP } from "../config/constants.js";
import { createColonist, type ColonistIdentity } from "../colonist/colonist.js";
import type { TraitId } from "../colonist/traits.js";
import { createRelationshipStore } from "../colonist/relationships.js";
import { createSocialOfferStore } from "../task/socialOffers.js";
import { createDefaultPolicy } from "../world/policy.js";
import { createWorld } from "../world/world.js";
import { createDecisionLog, createEventLog } from "../records/logs.js";
import { createFreshMemoryBaselines, tick, validateSimulationState, type ColonistRuntime, type SimulationState, type TickEvent } from "./tick.js";

/**
 * Creates a fresh Stage 2 simulation: default station, default policy, seeded PRNG, and a
 * canonically ordered collection (ADR-22 D1) of fully simulated colonists (Stage 2 Slice 6b —
 * every entry, not just the first, is simulated each tick by tick.ts). `colonistId`/`colonistName`
 * plus the optional `roster` are both just colonists to seed; the split is a call-shape
 * convenience only — both paths produce identical runtime containers.
 */
export function createInitialState(
  seed: number,
  colonistId: string,
  colonistName: string,
  skills: readonly string[] = [],
  baseTraits: readonly TraitId[] = [],
  roster: readonly ColonistIdentity[] = [],
): SimulationState {
  // ADR-22 D1: one canonically ordered colonist collection, sorted at creation (the collection
  // itself carries no notion of "which one is primary" — every entry is simulated).
  const runtimes: ColonistRuntime[] = [
    freshRuntime(createColonist(colonistId, colonistName, skills, baseTraits)),
    ...roster.map((entry) => freshRuntime(createColonist(entry.id, entry.name, entry.skills, entry.baseTraits))),
  ].sort((a, b) => (a.colonist.identity.id < b.colonist.identity.id ? -1 : a.colonist.identity.id > b.colonist.identity.id ? 1 : 0));
  const state: SimulationState = {
    clock: createClock(),
    world: createWorld(),
    policy: createDefaultPolicy(),
    colonists: runtimes,
    prng: createPrng(seed),
    hasBootstrapped: false,
    eventLog: createEventLog(),
    decisionLog: createDecisionLog(),
    relationships: createRelationshipStore(),
    socialOffers: createSocialOfferStore(),
  };
  validateSimulationState(state);
  return state;
}

/** A fresh, inert runtime container for a newly created colonist: no execution, fresh baselines. */
export function freshRuntime(colonist: ColonistRuntime["colonist"]): ColonistRuntime {
  return {
    colonist,
    execution: null,
    suspendedExecution: null,
    ...createFreshMemoryBaselines(),
  };
}

/** The full result of a headless run: final state plus the concatenated event trace across every tick. */
export interface RunResult {
  readonly finalState: SimulationState;
  readonly events: readonly TickEvent[];
}

/**
 * Advances `initial` by `totalTicks` in-game ticks, calling tick() exactly once per
 * BASE_TICKS_PER_STEP — never with a larger delta, so every fixed step (and everything it
 * might trigger) is evaluated. Pure with respect to `initial` — never mutates it.
 */
export function run(initial: SimulationState, totalTicks: number): RunResult {
  if (!Number.isInteger(totalTicks) || totalTicks < 0) {
    throw new Error(`totalTicks must be a non-negative integer, got ${totalTicks}`);
  }
  if (totalTicks % BASE_TICKS_PER_STEP !== 0) {
    throw new Error(`totalTicks must be a whole multiple of BASE_TICKS_PER_STEP (${BASE_TICKS_PER_STEP}), got ${totalTicks}`);
  }

  let state = initial;
  const events: TickEvent[] = [];
  const steps = totalTicks / BASE_TICKS_PER_STEP;
  for (let i = 0; i < steps; i++) {
    const result = tick(state, BASE_TICKS_PER_STEP);
    state = result.state;
    events.push(...result.events);
  }
  return { finalState: state, events };
}
