// M4 Snapshot Service tests — completeness, fixity, empty nearby-colonist field,
// no live-world mutation leaking into an existing snapshot, determinism.

import { describe, expect, it } from "vitest";
import { advance, createClock } from "../core/clock.js";
import { createDefaultPolicy } from "./policy.js";
import { consumeFood, createWorld, setModuleFunctional } from "./world.js";
import { buildSnapshot, type ObservableColonist } from "./snapshot.js";
import { createRelationshipStore, perspective } from "../colonist/relationships.js";

describe("snapshot completeness", () => {
  it("includes time references, effective policy, module states, and resource conditions", () => {
    const clock = advance(createClock(), 100);
    const policy = createDefaultPolicy();
    const world = createWorld();
    const snapshot = buildSnapshot(clock, policy, world);

    expect(snapshot.tick).toBe(100);
    expect(snapshot.day).toBe(1);
    expect(snapshot.tickOfDay).toBe(100);
    expect(snapshot.currentPeriod).toBe("work");
    expect(snapshot.effectivePolicy).toEqual(policy);
    expect(snapshot.modules).toEqual(world.modules);
    expect(snapshot.foodStock).toBe(world.foodStock);
  });
});

describe("empty nearby-colonist field (Stage 1: single colonist)", () => {
  it("nearbyColonists is present and empty", () => {
    const snapshot = buildSnapshot(createClock(), createDefaultPolicy(), createWorld());
    expect(snapshot.nearbyColonists).toBeDefined();
    expect(snapshot.nearbyColonists).toEqual([]);
  });
});

describe("snapshot fixity — no live-world mutation leaks into an existing snapshot", () => {
  it("a later world update does not change an already-built snapshot", () => {
    const clock = createClock();
    const policy = createDefaultPolicy();
    const world = createWorld();
    const snapshot = buildSnapshot(clock, policy, world);

    // Mutate-looking operations on the *world*, all of which are pure and return new state —
    // the original `world` reference, and therefore the already-built snapshot, must be untouched.
    setModuleFunctional(world, "foodStation", false);
    consumeFood(world, 50);

    expect(snapshot.modules.foodStation.functional).toBe(true);
    expect(snapshot.foodStock).toBe(world.foodStock);
  });

  it("REGRESSION (Copilot-confirmed): the snapshot does not alias the caller's policy or module objects — direct mutation through the original references cannot reach an existing snapshot", () => {
    const policy = createDefaultPolicy();
    const world = createWorld();
    const snapshot = buildSnapshot(createClock(), policy, world);

    // Simulate a caller (or future code) mutating the ORIGINAL objects in place — the exact
    // hazard the aliasing left open. The already-built snapshot must be genuinely fixed, by
    // copy, not merely by the convention that nobody mutates.
    (policy as { workTicks: number }).workTicks = 1;
    (world.modules.foodStation as { functional: boolean }).functional = false;

    expect(snapshot.effectivePolicy.workTicks).toBe(createDefaultPolicy().workTicks);
    expect(snapshot.modules.foodStation.functional).toBe(true);
  });

  it("a snapshot built from a later world state differs from one built earlier", () => {
    const clock = createClock();
    const policy = createDefaultPolicy();
    const worldBefore = createWorld();
    const before = buildSnapshot(clock, policy, worldBefore);

    const worldAfter = setModuleFunctional(worldBefore, "foodStation", false);
    const after = buildSnapshot(clock, policy, worldAfter);

    expect(before.modules.foodStation.functional).toBe(true);
    expect(after.modules.foodStation.functional).toBe(false);
  });
});

describe("determinism", () => {
  it("identical clock/policy/world produce an identical snapshot", () => {
    const clock = advance(createClock(), 777);
    const policy = createDefaultPolicy();
    const world = setModuleFunctional(createWorld(), "restBunk", false);
    expect(buildSnapshot(clock, policy, world)).toEqual(buildSnapshot(clock, policy, world));
  });
});

describe("snapshot is the only world-to-decision read path (structural note)", () => {
  it("WorldSnapshot carries the effective policy directly — no cascade needed at Stage 1's single scope", () => {
    const snapshot = buildSnapshot(createClock(), createDefaultPolicy(), createWorld());
    expect(snapshot.effectivePolicy).toEqual(createDefaultPolicy());
  });
});

describe("nearbyColonists population (Stage 2 build step 4, ADR-20 D3)", () => {
  const nearby: readonly ObservableColonist[] = [
    { id: "zeke", ambientState: "working", moduleId: "workstation" },
    { id: "yara", ambientState: "resting", moduleId: "restBunk" },
  ];

  it("populates nearbyColonists from a given list at 3-colonist scale", () => {
    const snapshot = buildSnapshot(createClock(), createDefaultPolicy(), createWorld(), nearby);
    expect(snapshot.nearbyColonists).toEqual(nearby);
  });

  it("a never-interacted colonist stays visible — perspective resolves to the D4 default", () => {
    const snapshot = buildSnapshot(createClock(), createDefaultPolicy(), createWorld(), nearby);
    const zeke = snapshot.nearbyColonists.find((c) => c.id === "zeke");
    expect(zeke).toBeDefined();
    expect(perspective(createRelationshipStore(), "c1", "zeke")).toEqual({ affinity: 0, state: "acquainted" });
  });

  it("building a snapshot with real nearby colonists never touches the relationship store", () => {
    const store = createRelationshipStore();
    buildSnapshot(createClock(), createDefaultPolicy(), createWorld(), nearby);
    expect(Object.keys(store.pairs)).toEqual([]);
  });
});
