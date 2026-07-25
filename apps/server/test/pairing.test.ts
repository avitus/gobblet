import { describe, expect, it } from "vitest";
import { STARTING_RATING } from "@gobblet/protocol";
import {
  INITIAL_WINDOW,
  MAXIMUM_WINDOW,
  UNBOUNDED_AFTER_MS,
  WINDOW_STEP,
  WINDOW_STEP_INTERVAL_MS,
  areCompatible,
  findPairing,
  orderingRating,
  queueKeyOf,
  ratingWindowFor,
  windowHalfWidth,
} from "../src/matchmaking/pairing";
import type { QueueEntry } from "../src/matchmaking/pairing";

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);

function entry(
  actorId: string,
  rating: number | null,
  waitedMs = 0,
  actorType: "user" | "guest" = "user",
): QueueEntry {
  return {
    actor: { actorType, actorId },
    displayName: actorId,
    rating,
    joinedAt: NOW - waitedMs,
  };
}

describe("queueKeyOf", () => {
  it("separates queues by mode and by time control (spec section 9.1)", () => {
    expect(queueKeyOf({ mode: "ranked", timeControlSeconds: 300 })).toBe("ranked:300");
    expect(queueKeyOf({ mode: "casual", timeControlSeconds: 300 })).not.toBe(
      queueKeyOf({ mode: "ranked", timeControlSeconds: 300 }),
    );
    expect(queueKeyOf({ mode: "ranked", timeControlSeconds: 180 })).not.toBe(
      queueKeyOf({ mode: "ranked", timeControlSeconds: 300 }),
    );
  });
});

describe("orderingRating", () => {
  it("treats a guest and an unrated account as the starting rating", () => {
    expect(orderingRating(entry("guest", null, 0, "guest"))).toBe(STARTING_RATING);
    expect(orderingRating(entry("fresh", null))).toBe(STARTING_RATING);
    expect(orderingRating(entry("rated", 1543))).toBe(1543);
  });
});

describe("windowHalfWidth", () => {
  it.each([
    [0, INITIAL_WINDOW],
    [9_999, INITIAL_WINDOW],
    [10_000, 150],
    [19_999, 150],
    [20_000, 200],
    [50_000, 350],
    [59_999, 350],
  ])("is %i ms into the wait a half width of %i", (waitedMs, expected) => {
    expect(windowHalfWidth(waitedMs)).toBe(expected);
  });

  it("reaches the maximum the specification names exactly when the window is removed", () => {
    // The cap therefore never binds at the current expansion rate, which is
    // recorded as appendix P4.10 rather than left as a surprise in the code.
    const stepsToUnbounded = UNBOUNDED_AFTER_MS / WINDOW_STEP_INTERVAL_MS;

    expect(INITIAL_WINDOW + stepsToUnbounded * WINDOW_STEP).toBe(MAXIMUM_WINDOW);
    expect(windowHalfWidth(UNBOUNDED_AFTER_MS - 1)).toBeLessThan(MAXIMUM_WINDOW);
  });

  it("stops limiting the search after a minute (spec section 9.2)", () => {
    expect(windowHalfWidth(UNBOUNDED_AFTER_MS)).toBeNull();
    expect(windowHalfWidth(UNBOUNDED_AFTER_MS + 60_000)).toBeNull();
  });

  it("never widens below the initial window for a wait that cannot have happened", () => {
    expect(windowHalfWidth(-5_000)).toBe(INITIAL_WINDOW);
  });
});

describe("ratingWindowFor", () => {
  it("centres a ranked window on the player's rating", () => {
    expect(ratingWindowFor("ranked", entry("ada", 1500), NOW)).toEqual({
      minimum: 1400,
      maximum: 1600,
    });
  });

  it("reports no window in casual, where rating only orders candidates", () => {
    expect(ratingWindowFor("casual", entry("ada", 1500), NOW)).toBeNull();
  });

  it("reports no window once a ranked search has waited a minute", () => {
    expect(ratingWindowFor("ranked", entry("ada", 1500, UNBOUNDED_AFTER_MS), NOW)).toBeNull();
  });
});

describe("areCompatible", () => {
  it("refuses to pair a player with itself, however it was queued twice", () => {
    expect(areCompatible(entry("ada", 1200), entry("ada", 1200), "ranked", NOW)).toBe(false);
  });

  it("requires both windows to accept, so a newcomer is never dragged into a mismatch", () => {
    const patient = entry("patient", 1200, 55_000);
    const newcomer = entry("newcomer", 1500);

    expect(windowHalfWidth(55_000)).toBe(350);
    expect(areCompatible(patient, newcomer, "ranked", NOW)).toBe(false);
    expect(areCompatible(newcomer, patient, "ranked", NOW)).toBe(false);
  });

  it("pairs any two players in casual, whatever their ratings", () => {
    expect(areCompatible(entry("ada", 800), entry("grace", 2400), "casual", NOW)).toBe(true);
  });

  it("pairs a wide gap in ranked once both have waited a minute", () => {
    const first = entry("ada", 800, UNBOUNDED_AFTER_MS);
    const second = entry("grace", 2400, UNBOUNDED_AFTER_MS);

    expect(areCompatible(first, second, "ranked", NOW)).toBe(true);
  });
});

describe("findPairing", () => {
  it("finds nobody in an empty queue or a queue of one", () => {
    expect(findPairing([], "ranked", NOW)).toBeNull();
    expect(findPairing([entry("ada", 1200)], "ranked", NOW)).toBeNull();
  });

  it("serves the longest waiting player first", () => {
    const waiting = entry("waiting", 1200, 30_000);
    const pairing = findPairing(
      [entry("fresh", 1200), waiting, entry("newer", 1200, 5_000)],
      "ranked",
      NOW,
    );

    expect(pairing?.first.actor.actorId).toBe("waiting");
    expect(pairing?.waitedMs).toBe(30_000);
  });

  it("chooses the closest rating among the candidates it may pair", () => {
    const pairing = findPairing(
      [entry("ada", 1200, 20_000), entry("far", 1330), entry("near", 1210), entry("mid", 1260)],
      "ranked",
      NOW,
    );

    expect(pairing?.first.actor.actorId).toBe("ada");
    expect(pairing?.second.actor.actorId).toBe("near");
  });

  it("leaves a player unpaired while every candidate is outside the window", () => {
    expect(findPairing([entry("ada", 1200), entry("grace", 1600)], "ranked", NOW)).toBeNull();
  });

  it("pairs the same two players once the window has widened enough", () => {
    const entries = [entry("ada", 1200, 40_000), entry("grace", 1500, 40_000)];

    expect(findPairing(entries, "ranked", NOW - 40_000)).toBeNull();
    expect(findPairing(entries, "ranked", NOW)).not.toBeNull();
  });

  it("skips a player nobody can meet and pairs the two who can", () => {
    const pairing = findPairing(
      [entry("lonely", 2400, 30_000), entry("ada", 1200, 20_000), entry("grace", 1250, 10_000)],
      "ranked",
      NOW,
    );

    expect([pairing?.first.actor.actorId, pairing?.second.actor.actorId]).toEqual(["ada", "grace"]);
  });
});
