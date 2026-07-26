import type { MatchRow } from "@gobblet/db";
import { describe, expect, it } from "vitest";
import {
  chargeActiveSide,
  clockAnomaly,
  effectiveRemainingMs,
  readClocks,
  zeroActiveSide,
} from "../src/match/clock";
import { CLOCK_START, matchRowFixture } from "./helpers/match-fixtures";

const BASE = CLOCK_START;

function row(overrides: Partial<MatchRow> = {}): MatchRow {
  return matchRowFixture(overrides);
}

describe("effectiveRemainingMs", () => {
  it("returns the stored value when no turn is running", () => {
    expect(effectiveRemainingMs(300_000, null, BASE + 60_000)).toBe(300_000);
  });

  it("subtracts the elapsed turn time", () => {
    expect(effectiveRemainingMs(300_000, BASE, BASE + 1_500)).toBe(298_500);
  });

  it("ignores a clock that moved backwards", () => {
    expect(effectiveRemainingMs(300_000, BASE, BASE - 5_000)).toBe(300_000);
  });

  it("goes negative once the budget is gone, so expiry is detectable", () => {
    expect(effectiveRemainingMs(1_000, BASE, BASE + 1_400)).toBe(-400);
  });
});

describe("readClocks", () => {
  it("derives the active side only", () => {
    const reading = readClocks(row(), BASE + 10_000);

    expect(reading.activeRemainingMs).toBe(290_000);
    expect(reading.lightRemainingMs).toBe(300_000);
    expect(reading.darkRemainingMs).toBe(300_000);
    expect(reading.turnStartedAt).toBe(BASE);
    expect(reading.expired).toBe(false);
  });

  it("charges the side actually on the clock", () => {
    const reading = readClocks(row({ activePlayer: "dark" }), BASE + 10_000);

    expect(reading.activeRemainingMs).toBe(290_000);
    expect(reading.activePlayer).toBe("dark");
  });

  it("stops the clock for a match that is not active", () => {
    const reading = readClocks(
      row({ status: "completed", turnStartedAt: null }),
      BASE + 10_000_000,
    );

    expect(reading.activeRemainingMs).toBe(300_000);
    expect(reading.expired).toBe(false);
  });

  it("does not run the clock before the first turn starts", () => {
    const reading = readClocks(row({ status: "queued", turnStartedAt: null }), BASE + 60_000);

    expect(reading.activeRemainingMs).toBe(300_000);
    expect(reading.expired).toBe(false);
  });

  it("treats an exactly exhausted clock as expired and floors the display at zero", () => {
    const reading = readClocks(row({ lightRemainingMs: 5_000 }), BASE + 5_000);

    expect(reading.expired).toBe(true);
    expect(reading.activeRemainingMs).toBe(0);
  });

  it("reports expiry when the budget was overrun", () => {
    const reading = readClocks(row({ lightRemainingMs: 5_000 }), BASE + 9_000);

    expect(reading.expired).toBe(true);
    expect(reading.activeRemainingMs).toBe(0);
  });

  it("is frozen so callers cannot mutate a reading", () => {
    expect(Object.isFrozen(readClocks(row(), BASE))).toBe(true);
  });
});

describe("committing clocks", () => {
  it("charges light and leaves dark untouched", () => {
    expect(chargeActiveSide(row(), BASE + 4_000)).toEqual({
      lightRemainingMs: 296_000,
      darkRemainingMs: 300_000,
    });
  });

  it("charges dark and leaves light untouched", () => {
    expect(chargeActiveSide(row({ activePlayer: "dark" }), BASE + 4_000)).toEqual({
      lightRemainingMs: 300_000,
      darkRemainingMs: 296_000,
    });
  });

  it("zeroes the side that ran out", () => {
    expect(zeroActiveSide(row())).toEqual({ lightRemainingMs: 0, darkRemainingMs: 300_000 });
    expect(zeroActiveSide(row({ activePlayer: "dark" }))).toEqual({
      lightRemainingMs: 300_000,
      darkRemainingMs: 0,
    });
  });
});

describe("clockAnomaly", () => {
  it("sees nothing wrong with an ordinary running clock", () => {
    expect(clockAnomaly(row(), BASE + 10_000)).toBeNull();
  });

  it("names a clock that has run into debt", () => {
    expect(clockAnomaly(row({ darkRemainingMs: -1 }), BASE)).toBe("negative-remaining");
  });

  it("names a turn that has not begun yet", () => {
    expect(clockAnomaly(row({ turnStartedAt: new Date(BASE + 5_000) }), BASE)).toBe(
      "turn-starts-in-the-future",
    );
  });

  it("says nothing about a match that holds no running turn", () => {
    expect(clockAnomaly(row({ turnStartedAt: null }), BASE)).toBeNull();
  });
});
