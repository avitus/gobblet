import { describe, expect, it } from "vitest";
import { LOW_TIME_THRESHOLD_MS, displayedClocks, formatClock, isLowTime } from "../src/clock";
import type { ClockReading } from "../src/clock";

const READING: ClockReading = {
  clocks: {
    lightRemainingMs: 62_000,
    darkRemainingMs: 45_000,
    turnStartedAt: 1_800_000_000_000,
    serverTime: 1_800_000_000_000,
  },
  activePlayer: "light",
  receivedAt: 5000,
  running: true,
};

describe("the displayed clock", () => {
  it("counts down only the active player from the last reading", () => {
    expect(displayedClocks(READING, 6000)).toEqual({
      lightRemainingMs: 61_000,
      darkRemainingMs: 45_000,
    });
    expect(displayedClocks({ ...READING, activePlayer: "dark" }, 6500)).toEqual({
      lightRemainingMs: 62_000,
      darkRemainingMs: 43_500,
    });
  });

  it("freezes when the match is not running", () => {
    expect(displayedClocks({ ...READING, running: false }, 900_000)).toEqual({
      lightRemainingMs: 62_000,
      darkRemainingMs: 45_000,
    });
  });

  it("clamps at zero instead of declaring a timeout", () => {
    const suspended = displayedClocks(READING, 5000 + 600_000);

    expect(suspended).toEqual({ lightRemainingMs: 0, darkRemainingMs: 45_000 });
  });

  it("ignores a monotonic clock that appears to move backwards", () => {
    expect(displayedClocks(READING, 1000)).toEqual({
      lightRemainingMs: 62_000,
      darkRemainingMs: 45_000,
    });
  });

  it("formats minutes and seconds, and tenths under ten seconds", () => {
    expect(formatClock(180_000)).toBe("3:00");
    expect(formatClock(62_400)).toBe("1:02");
    expect(formatClock(10_000)).toBe("0:10");
    expect(formatClock(9900)).toBe("0:09.9");
    expect(formatClock(1500)).toBe("0:01.5");
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(-500)).toBe("0:00.0");
  });

  it("names low time at the threshold the server syncs faster at", () => {
    expect(LOW_TIME_THRESHOLD_MS).toBe(10_000);
    expect(isLowTime(10_000)).toBe(true);
    expect(isLowTime(10_001)).toBe(false);
  });
});
