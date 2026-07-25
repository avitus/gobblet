import { randomUUID } from "node:crypto";
import type { MatchRow } from "@gobblet/db";
import { createInitialGame, toSerializableGameState } from "@gobblet/game-core";
import type { Move } from "@gobblet/game-core";
import type { CommandEnvelopeMetadata, MatchSnapshot } from "@gobblet/protocol";
import { toSnapshot } from "../../src/match/snapshot";
import type { Actor } from "../../src/match/snapshot";

export const CLOCK_START = Date.UTC(2026, 6, 25, 12, 0, 0);

export const LIGHT_ACTOR: Actor & Readonly<{ displayName: string }> = Object.freeze({
  actorType: "guest",
  actorId: "11111111-1111-4111-8111-111111111111",
  displayName: "light-player",
});

export const DARK_ACTOR: Actor & Readonly<{ displayName: string }> = Object.freeze({
  actorType: "guest",
  actorId: "22222222-2222-4222-8222-222222222222",
  displayName: "dark-player",
});

export const STRANGER: Actor = Object.freeze({
  actorType: "guest",
  actorId: "33333333-3333-4333-8333-333333333333",
});

/** A fake clock keeps every timing assertion deterministic (docs/adr/0009). */
export class TestClock {
  private current: number;

  constructor(start = CLOCK_START) {
    this.current = start;
  }

  now = (): number => this.current;

  advance(ms: number): void {
    this.current += ms;
  }
}

export function envelope(
  matchId: string,
  expectedVersion: number,
  overrides: Partial<CommandEnvelopeMetadata> = {},
): CommandEnvelopeMetadata {
  return {
    commandId: randomUUID(),
    matchId,
    expectedVersion,
    sentAtClient: CLOCK_START,
    ...overrides,
  };
}

/** An in-memory row for the projections and the clock, which never touch the database. */
export function matchRowFixture(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    mode: "casual",
    timeControlSeconds: 300,
    status: "active",
    result: null,
    endReason: null,
    lightPlayerType: LIGHT_ACTOR.actorType,
    lightPlayerId: LIGHT_ACTOR.actorId,
    lightDisplayName: LIGHT_ACTOR.displayName,
    darkPlayerType: "user",
    darkPlayerId: DARK_ACTOR.actorId,
    darkDisplayName: DARK_ACTOR.displayName,
    gameState: toSerializableGameState(createInitialGame("light")),
    stateVersion: 0,
    lightRemainingMs: 300_000,
    darkRemainingMs: 300_000,
    activePlayer: "light",
    turnStartedAt: new Date(CLOCK_START),
    lastClockCommitAt: new Date(CLOCK_START),
    moveCount: 0,
    colorAssignment: "random",
    rematchOfMatchId: null,
    createdAt: new Date(CLOCK_START),
    startedAt: new Date(CLOCK_START),
    endedAt: null,
    ...overrides,
  };
}

/** A snapshot for the units that only read the projection, such as the clock cadence. */
export function snapshotFixture(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    ...toSnapshot(matchRowFixture(), CLOCK_START, null),
    matchId: "match-1",
    ...overrides,
  };
}

/**
 * Light builds row 0 from three reserve stacks plus the second piece of stack 0,
 * while dark builds an unfinished row 3. Light completes a line on version 7.
 */
export const WINNING_SCRIPT: readonly Move[] = Object.freeze([
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "reserve", reserveStack: 0, to: "r3c0" },
  { kind: "reserve", reserveStack: 1, to: "r0c1" },
  { kind: "reserve", reserveStack: 1, to: "r3c1" },
  { kind: "reserve", reserveStack: 2, to: "r0c2" },
  { kind: "reserve", reserveStack: 2, to: "r3c2" },
  { kind: "reserve", reserveStack: 0, to: "r0c3" },
] as const satisfies readonly Move[]);

/**
 * Both sides shuffle one piece between two squares. The position after the two
 * opening placements occurs three times, which is a draw (docs/rules.md
 * section 11). Reserves never change, so the position key repeats exactly.
 */
export const REPETITION_SCRIPT: readonly Move[] = Object.freeze([
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "reserve", reserveStack: 0, to: "r3c0" },
  { kind: "board", from: "r0c0", to: "r0c1" },
  { kind: "board", from: "r3c0", to: "r3c1" },
  { kind: "board", from: "r0c1", to: "r0c0" },
  { kind: "board", from: "r3c1", to: "r3c0" },
  { kind: "board", from: "r0c0", to: "r0c1" },
  { kind: "board", from: "r3c0", to: "r3c1" },
  { kind: "board", from: "r0c1", to: "r0c0" },
  { kind: "board", from: "r3c1", to: "r3c0" },
] as const satisfies readonly Move[]);
