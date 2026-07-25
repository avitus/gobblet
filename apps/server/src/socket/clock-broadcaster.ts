import type { MatchClockSyncEvent, MatchSnapshot } from "@gobblet/protocol";
import { effectiveRemainingMs } from "../match/clock";

/**
 * Cadence from docs/protocol.md section 12: every two seconds, or four times a
 * second once the active clock is under ten seconds.
 */
export const STEADY_INTERVAL_MS = 2_000;
export const URGENT_INTERVAL_MS = 250;
export const URGENT_THRESHOLD_MS = 10_000;
export const TICK_INTERVAL_MS = URGENT_INTERVAL_MS;

type TrackedMatch = {
  matchId: string;
  version: number;
  activePlayer: "light" | "dark";
  lightRemainingMs: number;
  darkRemainingMs: number;
  turnStartedAt: number;
  lastBroadcastAt: number;
};

export type ClockTick = Readonly<{
  sync: readonly MatchClockSyncEvent[];
  expired: readonly string[];
}>;

/**
 * Tracks the clock of every match with a listener. Readings come from the last
 * committed snapshot, so a tick derives time in memory and only touches the
 * database when a clock actually ran out.
 */
export class ClockBroadcaster {
  private readonly tracked = new Map<string, TrackedMatch>();

  track(snapshot: MatchSnapshot, now: number): void {
    if (snapshot.status !== "active" || snapshot.clocks.turnStartedAt === null) {
      this.tracked.delete(snapshot.matchId);
      return;
    }

    this.tracked.set(snapshot.matchId, {
      matchId: snapshot.matchId,
      version: snapshot.version,
      activePlayer: snapshot.activePlayer,
      lightRemainingMs: snapshot.clocks.lightRemainingMs,
      darkRemainingMs: snapshot.clocks.darkRemainingMs,
      turnStartedAt: snapshot.clocks.turnStartedAt,
      lastBroadcastAt: now,
    });
  }

  forget(matchId: string): void {
    this.tracked.delete(matchId);
  }

  has(matchId: string): boolean {
    return this.tracked.has(matchId);
  }

  get size(): number {
    return this.tracked.size;
  }

  /**
   * Returns the clock syncs due now and the matches whose clock ran out. Expired
   * matches are dropped from tracking, so a timeout is reported once.
   */
  tick(now: number): ClockTick {
    const sync: MatchClockSyncEvent[] = [];
    const expired: string[] = [];

    for (const match of this.tracked.values()) {
      const remaining = effectiveRemainingMs(this.storedActive(match), match.turnStartedAt, now);
      if (remaining <= 0) {
        expired.push(match.matchId);
        this.tracked.delete(match.matchId);
        continue;
      }

      const interval = remaining < URGENT_THRESHOLD_MS ? URGENT_INTERVAL_MS : STEADY_INTERVAL_MS;
      if (now - match.lastBroadcastAt < interval) {
        continue;
      }

      match.lastBroadcastAt = now;
      const active = match.activePlayer === "light";
      // The sync event carries no turn start, so the active side is already
      // derived here and both readings are true as of `serverTime`.
      sync.push({
        matchId: match.matchId,
        version: match.version,
        activePlayer: match.activePlayer,
        lightRemainingMs: active ? remaining : match.lightRemainingMs,
        darkRemainingMs: active ? match.darkRemainingMs : remaining,
        serverTime: now,
      });
    }

    return { sync, expired };
  }

  private storedActive(match: TrackedMatch): number {
    return match.activePlayer === "light" ? match.lightRemainingMs : match.darkRemainingMs;
  }
}
