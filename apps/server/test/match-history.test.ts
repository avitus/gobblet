import { insertMatch, insertProfile, insertRatingChanges, insertUser } from "@gobblet/db";
import type { DatabaseHandle, MatchRow, UserRow } from "@gobblet/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listCompletedPlayerHistory, listPlayerHistory } from "../src/match/history";
import { CLOCK_START } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;
let sequence = 0;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
});

async function createAccount(): Promise<UserRow> {
  sequence += 1;
  const username = `player${sequence}`;
  const user = await insertUser(handle.db, {
    email: `${username}@example.com`,
    passwordHash: "scrypt$32768$8$1$placeholder$placeholder",
    username,
    usernameNormalized: username,
    displayName: username,
  });
  await insertProfile(handle.db, { userId: user.id });
  return user;
}

async function createRankedMatch(light: UserRow, dark: UserRow): Promise<MatchRow> {
  const match = await insertMatch(handle.db, {
    mode: "ranked",
    timeControlSeconds: 300,
    status: "completed",
    result: "light",
    endReason: "line",
    moveCount: 9,
    lightPlayerType: "user",
    lightPlayerId: light.id,
    lightDisplayName: light.displayName,
    darkPlayerType: "user",
    darkPlayerId: dark.id,
    darkDisplayName: dark.displayName,
    gameState: { version: 1, ply: 0 },
    stateVersion: 10,
    lightRemainingMs: 1_000,
    darkRemainingMs: 1_000,
    activePlayer: "dark",
    startedAt: new Date(CLOCK_START),
    endedAt: new Date(CLOCK_START + 60_000),
  });

  await insertRatingChanges(handle.db, [
    {
      matchId: match.id,
      userId: light.id,
      side: "light",
      outcome: "win",
      ratingBefore: 1200,
      ratingAfter: 1216,
      delta: 16,
      opponentRatingBefore: 1200,
      formulaVersion: 1,
    },
    {
      matchId: match.id,
      userId: dark.id,
      side: "dark",
      outcome: "loss",
      ratingBefore: 1200,
      ratingAfter: 1184,
      delta: -16,
      opponentRatingBefore: 1200,
      formulaVersion: 1,
    },
  ]);
  return match;
}

describe("match history read from a seat", () => {
  it("reads the same match as a win for one account and a loss for the other", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);

    const mine = await listPlayerHistory(handle.db, { actorType: "user", actorId: light.id }, 10);
    const theirs = await listPlayerHistory(handle.db, { actorType: "user", actorId: dark.id }, 10);

    expect(mine[0]).toMatchObject({
      matchId: match.id,
      side: "light",
      outcome: "win",
      ratingDelta: 16,
      moveCount: 9,
    });
    expect(theirs[0]).toMatchObject({ side: "dark", outcome: "loss", ratingDelta: -16 });
  });

  it("carries no rating change for a guest, who has no rating audit", async () => {
    const light = await createAccount();
    const guestId = "33333333-3333-4333-8333-333333333333";
    await insertMatch(handle.db, {
      mode: "casual",
      timeControlSeconds: 300,
      status: "active",
      lightPlayerType: "user",
      lightPlayerId: light.id,
      lightDisplayName: light.displayName,
      darkPlayerType: "guest",
      darkPlayerId: guestId,
      darkDisplayName: "guest-1",
      gameState: { version: 1, ply: 0 },
      stateVersion: 1,
      lightRemainingMs: 1_000,
      darkRemainingMs: 1_000,
      activePlayer: "light",
    });

    const summaries = await listPlayerHistory(
      handle.db,
      { actorType: "guest", actorId: guestId },
      10,
    );

    expect(summaries[0]).toMatchObject({ side: "dark", outcome: null, ratingDelta: null });
  });

  it("lists only finished matches for a profile, newest first", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const finished = await createRankedMatch(light, dark);
    await insertMatch(handle.db, {
      mode: "casual",
      timeControlSeconds: 300,
      status: "active",
      lightPlayerType: "user",
      lightPlayerId: light.id,
      lightDisplayName: light.displayName,
      darkPlayerType: "user",
      darkPlayerId: dark.id,
      darkDisplayName: dark.displayName,
      gameState: { version: 1, ply: 0 },
      stateVersion: 1,
      lightRemainingMs: 1_000,
      darkRemainingMs: 1_000,
      activePlayer: "light",
    });

    const completed = await listCompletedPlayerHistory(
      handle.db,
      { actorType: "user", actorId: light.id },
      5,
    );

    expect(completed.map((summary) => summary.matchId)).toEqual([finished.id]);
  });
});
