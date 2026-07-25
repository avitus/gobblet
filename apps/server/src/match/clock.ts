import type { Player } from "@gobblet/game-core";
import type { MatchRow } from "@gobblet/db";

/**
 * Clocks are stored as remaining time plus the moment the active turn began, and
 * the active side's real remaining time is always derived (docs/adr/0009).
 * Nothing decrements a stored clock on a timer.
 */
export type ClockReading = Readonly<{
  lightRemainingMs: number;
  darkRemainingMs: number;
  activePlayer: Player;
  turnStartedAt: number | null;
  /** Derived remaining time of the active side, floored at zero. */
  activeRemainingMs: number;
  expired: boolean;
}>;

export function effectiveRemainingMs(
  storedRemainingMs: number,
  turnStartedAt: number | null,
  now: number,
): number {
  if (turnStartedAt === null) {
    return storedRemainingMs;
  }
  return storedRemainingMs - Math.max(0, now - turnStartedAt);
}

export function readClocks(row: MatchRow, now: number): ClockReading {
  const turnStartedAt = row.turnStartedAt?.getTime() ?? null;
  const running = row.status === "active" ? turnStartedAt : null;
  const storedActive = row.activePlayer === "light" ? row.lightRemainingMs : row.darkRemainingMs;
  const activeRemainingMs = effectiveRemainingMs(storedActive, running, now);

  return Object.freeze({
    lightRemainingMs: row.lightRemainingMs,
    darkRemainingMs: row.darkRemainingMs,
    activePlayer: row.activePlayer,
    turnStartedAt,
    activeRemainingMs: Math.max(0, activeRemainingMs),
    expired: activeRemainingMs <= 0,
  });
}

export type CommittedClocks = Readonly<{
  lightRemainingMs: number;
  darkRemainingMs: number;
}>;

/** Charges the elapsed turn time to the side that just moved. */
export function chargeActiveSide(row: MatchRow, now: number): CommittedClocks {
  const reading = readClocks(row, now);
  return Object.freeze(
    row.activePlayer === "light"
      ? { lightRemainingMs: reading.activeRemainingMs, darkRemainingMs: row.darkRemainingMs }
      : { lightRemainingMs: row.lightRemainingMs, darkRemainingMs: reading.activeRemainingMs },
  );
}

export function zeroActiveSide(row: MatchRow): CommittedClocks {
  return Object.freeze(
    row.activePlayer === "light"
      ? { lightRemainingMs: 0, darkRemainingMs: row.darkRemainingMs }
      : { lightRemainingMs: row.lightRemainingMs, darkRemainingMs: 0 },
  );
}
