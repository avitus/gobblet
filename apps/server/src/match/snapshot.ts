import type { MatchRow } from "@gobblet/db";
import type { Move, Player } from "@gobblet/game-core";
import type {
  MatchClocks,
  MatchPlayers,
  MatchResult,
  MatchSnapshot,
  MatchSummary,
  TimeControl,
} from "@gobblet/protocol";
import { readClocks } from "./clock";

export type Actor = Readonly<{
  actorType: "user" | "guest";
  actorId: string;
}>;

export type LastMove = Readonly<{
  move: Move;
  version: number;
}>;

/** The rating shown beside each seat, `null` for a guest or an unrated account. */
export type SeatRatings = Readonly<{ light: number | null; dark: number | null }>;

const UNRATED_SEATS: SeatRatings = Object.freeze({ light: null, dark: null });

export function matchPlayers(row: MatchRow, ratings: SeatRatings = UNRATED_SEATS): MatchPlayers {
  return {
    light: {
      actorId: row.lightPlayerId,
      actorType: row.lightPlayerType,
      displayName: row.lightDisplayName,
      isGuest: row.lightPlayerType === "guest",
      rating: ratings.light,
    },
    dark: {
      actorId: row.darkPlayerId,
      actorType: row.darkPlayerType,
      displayName: row.darkDisplayName,
      isGuest: row.darkPlayerType === "guest",
      rating: ratings.dark,
    },
  };
}

/** Returns the side an actor plays, or null when the actor is not a participant. */
export function participantSide(row: MatchRow, actor: Actor): Player | null {
  if (row.lightPlayerType === actor.actorType && row.lightPlayerId === actor.actorId) {
    return "light";
  }
  if (row.darkPlayerType === actor.actorType && row.darkPlayerId === actor.actorId) {
    return "dark";
  }
  return null;
}

export function matchResultOf(row: MatchRow): MatchResult | null {
  if (row.result === null || row.endReason === null) {
    return null;
  }
  return { outcome: row.result, reason: row.endReason };
}

/**
 * Clocks travel as the stored remaining time plus `turnStartedAt`, so the client
 * applies the same formula the server does instead of trusting a rendered number
 * (docs/protocol.md section 12).
 */
export function matchClocks(row: MatchRow, now: number): MatchClocks {
  const reading = readClocks(row, now);
  return {
    lightRemainingMs: reading.lightRemainingMs,
    darkRemainingMs: reading.darkRemainingMs,
    turnStartedAt: reading.turnStartedAt,
    serverTime: now,
  };
}

export function toSnapshot(
  row: MatchRow,
  now: number,
  lastMove: LastMove | null,
  ratings: SeatRatings = UNRATED_SEATS,
): MatchSnapshot {
  return {
    matchId: row.id,
    version: row.stateVersion,
    status: row.status,
    mode: row.mode,
    timeControlSeconds: row.timeControlSeconds as TimeControl,
    players: matchPlayers(row, ratings),
    state: row.gameState as MatchSnapshot["state"],
    activePlayer: row.activePlayer,
    clocks: matchClocks(row, now),
    result: matchResultOf(row),
    lastMove,
  };
}

export function toSummary(row: MatchRow, ratings: SeatRatings = UNRATED_SEATS): MatchSummary {
  return {
    matchId: row.id,
    mode: row.mode,
    timeControlSeconds: row.timeControlSeconds as TimeControl,
    status: row.status,
    result: matchResultOf(row),
    players: matchPlayers(row, ratings),
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
