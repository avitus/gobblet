import { randomUUID } from "node:crypto";
import type { NewGuestSessionRow, NewMatchRow, NewUserRow } from "../../src/index";

/**
 * `game_state` is opaque JSONB to this package; the engine shape is validated by
 * the server, so these fixtures deliberately avoid depending on the rules engine.
 */
const OPAQUE_STATE = { version: 1, ply: 0 } as const;

export function matchFixture(overrides: Partial<NewMatchRow> = {}): NewMatchRow {
  const timeControlSeconds = 300;
  return {
    mode: "casual",
    timeControlSeconds,
    lightPlayerType: "guest",
    lightPlayerId: randomUUID(),
    lightDisplayName: "light-player",
    darkPlayerType: "guest",
    darkPlayerId: randomUUID(),
    darkDisplayName: "dark-player",
    gameState: OPAQUE_STATE,
    stateVersion: 0,
    lightRemainingMs: timeControlSeconds * 1000,
    darkRemainingMs: timeControlSeconds * 1000,
    activePlayer: "light",
    ...overrides,
  };
}

export function userFixture(overrides: Partial<NewUserRow> = {}): NewUserRow {
  const username = overrides.username ?? `player_${randomUUID().slice(0, 8)}`;
  return {
    email: `${username}@example.com`.toLowerCase(),
    passwordHash: "scrypt$32768$8$1$placeholder$placeholder",
    username,
    usernameNormalized: username.toLowerCase(),
    displayName: username,
    ...overrides,
  };
}

export function guestFixture(displayName = "guest-one"): NewGuestSessionRow {
  return {
    tokenHash: `hash-${randomUUID()}`,
    displayName,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}
