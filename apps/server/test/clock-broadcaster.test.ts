import type { MatchSnapshot } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import {
  ClockBroadcaster,
  STEADY_INTERVAL_MS,
  URGENT_INTERVAL_MS,
  URGENT_THRESHOLD_MS,
} from "../src/socket/clock-broadcaster";
import { snapshotFixture } from "./helpers/match-fixtures";

const START = 1_000_000;

function tracked(
  overrides: Partial<MatchSnapshot> = {},
  clocks: Partial<MatchSnapshot["clocks"]> = {},
): MatchSnapshot {
  return snapshotFixture({
    ...overrides,
    clocks: {
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      turnStartedAt: START,
      serverTime: START,
      ...clocks,
    },
  });
}

describe("tracking", () => {
  it("tracks an active match with a running turn", () => {
    const broadcaster = new ClockBroadcaster();

    broadcaster.track(tracked(), START);

    expect(broadcaster.has("match-1")).toBe(true);
    expect(broadcaster.size).toBe(1);
  });

  it("does not track a finished match", () => {
    const broadcaster = new ClockBroadcaster();
    broadcaster.track(tracked(), START);

    broadcaster.track(tracked({ status: "completed" }), START);

    expect(broadcaster.has("match-1")).toBe(false);
    expect(broadcaster.size).toBe(0);
  });

  it("does not track a match whose turn has not started", () => {
    const broadcaster = new ClockBroadcaster();

    broadcaster.track(tracked({}, { turnStartedAt: null }), START);

    expect(broadcaster.size).toBe(0);
  });

  it("forgets a match on request", () => {
    const broadcaster = new ClockBroadcaster();
    broadcaster.track(tracked(), START);

    broadcaster.forget("match-1");

    expect(broadcaster.has("match-1")).toBe(false);
  });
});

describe("cadence", () => {
  it("stays quiet until the steady interval elapses", () => {
    const broadcaster = new ClockBroadcaster();
    broadcaster.track(tracked(), START);

    expect(broadcaster.tick(START + STEADY_INTERVAL_MS - 1).sync).toHaveLength(0);
    expect(broadcaster.tick(START + STEADY_INTERVAL_MS).sync).toHaveLength(1);
  });

  it("reports the active side's derived remaining time", () => {
    const broadcaster = new ClockBroadcaster();
    broadcaster.track(tracked({ activePlayer: "dark" }), START);

    const { sync } = broadcaster.tick(START + STEADY_INTERVAL_MS);

    expect(sync[0]).toEqual({
      matchId: "match-1",
      version: 0,
      activePlayer: "dark",
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000 - STEADY_INTERVAL_MS,
      serverTime: START + STEADY_INTERVAL_MS,
    });
  });

  it("switches to the urgent interval under the threshold", () => {
    const broadcaster = new ClockBroadcaster();
    broadcaster.track(tracked({}, { lightRemainingMs: URGENT_THRESHOLD_MS - 1 }), START);

    expect(broadcaster.tick(START + URGENT_INTERVAL_MS).sync).toHaveLength(1);
    expect(broadcaster.tick(START + URGENT_INTERVAL_MS + 1).sync).toHaveLength(0);
    expect(broadcaster.tick(START + URGENT_INTERVAL_MS * 2).sync).toHaveLength(1);
  });
});

describe("expiry", () => {
  it("reports an expired clock once and stops tracking it", () => {
    const broadcaster = new ClockBroadcaster();
    broadcaster.track(tracked({}, { lightRemainingMs: 5_000 }), START);

    const first = broadcaster.tick(START + 5_000);
    const second = broadcaster.tick(START + 5_001);

    expect(first).toEqual({ sync: [], expired: ["match-1"] });
    expect(second).toEqual({ sync: [], expired: [] });
    expect(broadcaster.size).toBe(0);
  });
});
