import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchClocks } from "@gobblet/protocol";
import { useClockDisplay } from "../src/use-clock-display";
import type { ClockDisplayInput, DisplayedClocks } from "../src/index";

const CLOCKS: MatchClocks = {
  lightRemainingMs: 60_000,
  darkRemainingMs: 45_000,
  turnStartedAt: 1_000,
  serverTime: 1_000,
};

function harness(initial: ClockDisplayInput | null, now: () => number) {
  let latest: DisplayedClocks | null = null;

  function Probe({ input }: Readonly<{ input: ClockDisplayInput | null }>): null {
    latest = useClockDisplay(input, { now, intervalMs: 100 });
    return null;
  }

  const view = render(<Probe input={initial} />);
  return {
    read: () => latest,
    update: (input: ClockDisplayInput | null) => {
      view.rerender(<Probe input={input} />);
    },
  };
}

describe("the clock display", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has nothing to show without a reading", () => {
    expect(harness(null, () => 0).read()).toBeNull();
  });

  it("counts down the side to move and leaves the other alone", () => {
    let clock = 0;
    const { read } = harness({ clocks: CLOCKS, activePlayer: "dark", running: true }, () => clock);

    expect(read()).toEqual({ lightRemainingMs: 60_000, darkRemainingMs: 45_000 });

    clock = 2_500;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(read()).toEqual({ lightRemainingMs: 60_000, darkRemainingMs: 42_500 });
  });

  it("stops ticking when the match is not running", () => {
    let clock = 0;
    const { read } = harness({ clocks: CLOCKS, activePlayer: "dark", running: false }, () => clock);

    clock = 5_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(read()).toEqual({ lightRemainingMs: 60_000, darkRemainingMs: 45_000 });
  });

  it("restamps a new reading instead of accumulating the old one", () => {
    let clock = 0;
    const { read, update } = harness(
      { clocks: CLOCKS, activePlayer: "dark", running: true },
      () => clock,
    );

    clock = 3_000;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(read()?.darkRemainingMs).toBe(42_000);

    const fresh: MatchClocks = { ...CLOCKS, darkRemainingMs: 41_500 };
    act(() => {
      update({ clocks: fresh, activePlayer: "dark", running: true });
    });
    expect(read()?.darkRemainingMs).toBe(41_500);

    clock = 3_500;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(read()?.darkRemainingMs).toBe(41_000);
  });

  it("clamps at zero and never goes below", () => {
    let clock = 0;
    const { read } = harness(
      {
        clocks: { ...CLOCKS, darkRemainingMs: 400 },
        activePlayer: "dark",
        running: true,
      },
      () => clock,
    );

    clock = 90_000;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(read()?.darkRemainingMs).toBe(0);
  });

  it("reads the browser's own monotonic clock when none is injected", () => {
    let latest: DisplayedClocks | null = null;

    function Probe(): null {
      latest = useClockDisplay({ clocks: CLOCKS, activePlayer: "light", running: true });
      return null;
    }

    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(500);
    render(<Probe />);

    expect(nowSpy).toHaveBeenCalled();
    expect(latest).toEqual({ lightRemainingMs: 60_000, darkRemainingMs: 45_000 });

    nowSpy.mockReturnValue(1_500);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(latest).toEqual({ lightRemainingMs: 59_000, darkRemainingMs: 45_000 });
    nowSpy.mockRestore();
  });

  it("stops its timer when the reading is taken away", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { update } = harness({ clocks: CLOCKS, activePlayer: "light", running: true }, () => 0);

    act(() => {
      update(null);
    });

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
