import type { MatchClocks, Player } from "@gobblet/protocol";
import { useEffect, useState } from "react";
import { displayedClocks } from "./clock";
import type { DisplayedClocks } from "./clock";

export type ClockDisplayInput = Readonly<{
  clocks: MatchClocks;
  activePlayer: Player;
  /** A finished or unstarted match freezes the display (section 8.3). */
  running: boolean;
}>;

export type ClockDisplayOptions = Readonly<{
  /** A monotonic clock. Injected in tests; `performance.now()` in a browser. */
  now?: () => number;
  /** How often the display is recomputed while a clock runs. */
  intervalMs?: number;
}>;

const DEFAULT_INTERVAL_MS = 100;

function monotonicNow(): number {
  return performance.now();
}

/**
 * Ticks the clock display of appendix P5.13 and P5.14. Each authoritative reading
 * is stamped with the monotonic clock when it arrives and interpolated from there,
 * so a suspended tab snaps to the next reading instead of inventing elapsed time.
 */
export function useClockDisplay(
  input: ClockDisplayInput,
  options?: ClockDisplayOptions,
): DisplayedClocks;
export function useClockDisplay(
  input: ClockDisplayInput | null,
  options?: ClockDisplayOptions,
): DisplayedClocks | null;
export function useClockDisplay(
  input: ClockDisplayInput | null,
  options: ClockDisplayOptions = {},
): DisplayedClocks | null {
  const now = options.now ?? monotonicNow;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const clocks = input?.clocks ?? null;
  const running = input?.running ?? false;

  const [receivedAt, setReceivedAt] = useState(() => now());
  const [, setTick] = useState(0);

  useEffect(() => {
    setReceivedAt(now());
    // `now` is stable in practice; the reading is what decides a new stamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clocks]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [running, intervalMs]);

  if (input === null) {
    return null;
  }

  return displayedClocks(
    {
      clocks: input.clocks,
      activePlayer: input.activePlayer,
      receivedAt,
      running: input.running,
    },
    now(),
  );
}
