import type { MatchClocks, Player } from "@gobblet/protocol";

/**
 * The clock display of section 8.3 and appendix P5.13. The last authoritative
 * reading is interpolated against a monotonic browser clock, clamped at zero, and
 * the client never declares a timeout: only the server's `match:ended` does.
 */
export type ClockReading = Readonly<{
  clocks: MatchClocks;
  activePlayer: Player;
  /** `performance.now()` when the reading was received, not a wall-clock instant. */
  receivedAt: number;
  /** A finished match freezes the clocks (section 8.3). */
  running: boolean;
}>;

export type DisplayedClocks = Readonly<{
  lightRemainingMs: number;
  darkRemainingMs: number;
}>;

function clampRemaining(value: number): number {
  return value <= 0 ? 0 : Math.floor(value);
}

/**
 * Interpolates one reading to `monotonicNow`. A suspended tab produces a large
 * elapsed value, so the display snaps to the truth rather than inventing it: the
 * result is still the reading minus real elapsed time, clamped at zero.
 */
export function displayedClocks(reading: ClockReading, monotonicNow: number): DisplayedClocks {
  const elapsed = reading.running ? Math.max(0, monotonicNow - reading.receivedAt) : 0;
  const light = reading.clocks.lightRemainingMs - (reading.activePlayer === "light" ? elapsed : 0);
  const dark = reading.clocks.darkRemainingMs - (reading.activePlayer === "dark" ? elapsed : 0);

  return {
    lightRemainingMs: clampRemaining(light),
    darkRemainingMs: clampRemaining(dark),
  };
}

/** `m:ss`, and `m:ss.t` under ten seconds where the server syncs faster (P5.14). */
export function formatClock(remainingMs: number): string {
  const total = Math.max(0, remainingMs);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const padded = seconds.toString().padStart(2, "0");

  if (total >= 10_000) {
    return `${String(minutes)}:${padded}`;
  }
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(minutes)}:${padded}.${String(tenths)}`;
}

export const LOW_TIME_THRESHOLD_MS = 10_000;

/** True when the low-time treatment and its warning sound apply (P5.14). */
export function isLowTime(remainingMs: number): boolean {
  return remainingMs <= LOW_TIME_THRESHOLD_MS;
}
