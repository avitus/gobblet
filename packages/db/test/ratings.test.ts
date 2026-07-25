import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  findMatchById,
  findRating,
  insertMatch,
  insertRatingChanges,
  insertUser,
  listRatingChangesForMatch,
  listRatingChangesForUser,
  lockRatingsForUpdate,
  upsertRating,
} from "../src/index";
import type { DatabaseHandle, MatchRow, UserRow } from "../src/index";
import { matchFixture, userFixture } from "./helpers/fixtures";
import { expectQueryToFail, setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterEach(async () => {
  await truncateAll(handle);
});

afterAll(async () => {
  await handle.close();
});

async function createUser(): Promise<UserRow> {
  return insertUser(handle.db, userFixture());
}

async function createRankedMatch(light: UserRow, dark: UserRow): Promise<MatchRow> {
  return insertMatch(
    handle.db,
    matchFixture({
      mode: "ranked",
      lightPlayerType: "user",
      lightPlayerId: light.id,
      lightDisplayName: light.displayName,
      darkPlayerType: "user",
      darkPlayerId: dark.id,
      darkDisplayName: dark.displayName,
    }),
  );
}

const aggregate = {
  rating: 1216,
  gamesPlayed: 1,
  wins: 1,
  losses: 0,
  draws: 0,
  currentStreak: 1,
  bestStreak: 1,
};

describe("ratings", () => {
  it("has no row until a result is written, so an unplayed account has no rating", async () => {
    const user = await createUser();

    expect(await findRating(handle.db, user.id)).toBeUndefined();
  });

  it("creates the aggregate on the first result and replaces it on the next", async () => {
    const user = await createUser();

    const created = await upsertRating(handle.db, user.id, aggregate);
    expect(created).toMatchObject({ userId: user.id, ...aggregate });

    const updated = await upsertRating(handle.db, user.id, {
      rating: 1200,
      gamesPlayed: 2,
      wins: 1,
      losses: 1,
      draws: 0,
      currentStreak: -1,
      bestStreak: 1,
    });

    expect(updated).toMatchObject({ rating: 1200, gamesPlayed: 2, currentStreak: -1 });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    expect(await findRating(handle.db, user.id)).toMatchObject({ gamesPlayed: 2 });
  });

  it("disappears with the account it belongs to", async () => {
    const user = await createUser();
    await upsertRating(handle.db, user.id, aggregate);

    await handle.db.execute(`delete from users where id = '${user.id}'`);

    expect(await findRating(handle.db, user.id)).toBeUndefined();
  });

  it("refuses a rating for an account that does not exist", async () => {
    const failure = await expectQueryToFail(() => upsertRating(handle.db, randomUUID(), aggregate));

    expect(failure.constraint).toBe("ratings_user_id_users_id_fk");
  });

  it("locks both players in a stable order, ignoring an account with no rating yet", async () => {
    const first = await createUser();
    const second = await createUser();
    await upsertRating(handle.db, first.id, aggregate);
    await upsertRating(handle.db, second.id, aggregate);

    const locked = await handle.db.transaction(async (tx) =>
      lockRatingsForUpdate(tx, [second.id, first.id]),
    );

    expect(locked.map((row) => row.userId)).toEqual([first.id, second.id].sort());
    expect(await lockRatingsForUpdate(handle.db, [])).toEqual([]);
  });
});

describe("rating_changes", () => {
  it("records both sides of a match and reads them back by colour", async () => {
    const light = await createUser();
    const dark = await createUser();
    const match = await createRankedMatch(light, dark);

    const written = await insertRatingChanges(handle.db, [
      {
        matchId: match.id,
        userId: light.id,
        side: "light",
        ratingBefore: 1200,
        ratingAfter: 1216,
        delta: 16,
        opponentRatingBefore: 1200,
        outcome: "win",
        formulaVersion: 1,
      },
      {
        matchId: match.id,
        userId: dark.id,
        side: "dark",
        ratingBefore: 1200,
        ratingAfter: 1184,
        delta: -16,
        opponentRatingBefore: 1200,
        outcome: "loss",
        formulaVersion: 1,
      },
    ]);

    expect(written).toHaveLength(2);
    const stored = await listRatingChangesForMatch(handle.db, match.id);
    expect(stored.map((row) => [row.side, row.delta])).toEqual([
      ["light", 16],
      ["dark", -16],
    ]);
    expect(await listRatingChangesForUser(handle.db, light.id)).toHaveLength(1);
    expect(await insertRatingChanges(handle.db, [])).toEqual([]);
  });

  it("ignores a repeated completion instead of moving a rating twice", async () => {
    const light = await createUser();
    const dark = await createUser();
    const match = await createRankedMatch(light, dark);
    const row = {
      matchId: match.id,
      userId: light.id,
      side: "light" as const,
      ratingBefore: 1200,
      ratingAfter: 1216,
      delta: 16,
      opponentRatingBefore: 1200,
      outcome: "win" as const,
      formulaVersion: 1,
    };

    expect(await insertRatingChanges(handle.db, [row])).toHaveLength(1);
    expect(await insertRatingChanges(handle.db, [row])).toHaveLength(0);
    expect(await listRatingChangesForMatch(handle.db, match.id)).toHaveLength(1);
  });

  it("returns a user's changes newest first", async () => {
    const light = await createUser();
    const dark = await createUser();
    const older = await createRankedMatch(light, dark);
    const newer = await createRankedMatch(light, dark);

    await insertRatingChanges(handle.db, [
      {
        matchId: older.id,
        userId: light.id,
        side: "light",
        ratingBefore: 1200,
        ratingAfter: 1216,
        delta: 16,
        opponentRatingBefore: 1200,
        outcome: "win",
        formulaVersion: 1,
      },
    ]);
    await handle.db.execute(
      `update rating_changes set created_at = now() - interval '1 hour' where match_id = '${older.id}'`,
    );
    await insertRatingChanges(handle.db, [
      {
        matchId: newer.id,
        userId: light.id,
        side: "dark",
        ratingBefore: 1216,
        ratingAfter: 1200,
        delta: -16,
        opponentRatingBefore: 1216,
        outcome: "loss",
        formulaVersion: 1,
      },
    ]);

    const history = await listRatingChangesForUser(handle.db, light.id);

    expect(history.map((row) => row.matchId)).toEqual([newer.id, older.id]);
    expect(await listRatingChangesForUser(handle.db, light.id, 1)).toHaveLength(1);
  });
});

describe("matches colour metadata", () => {
  it("defaults to a random assignment and records the match a rematch followed", async () => {
    const light = await createUser();
    const dark = await createUser();
    const first = await createRankedMatch(light, dark);

    expect(first.colorAssignment).toBe("random");
    expect(first.rematchOfMatchId).toBeNull();

    const rematch = await insertMatch(
      handle.db,
      matchFixture({
        mode: "ranked",
        lightPlayerType: "user",
        lightPlayerId: dark.id,
        lightDisplayName: dark.displayName,
        darkPlayerType: "user",
        darkPlayerId: light.id,
        darkDisplayName: light.displayName,
        colorAssignment: "alternated",
        rematchOfMatchId: first.id,
      }),
    );

    expect(rematch).toMatchObject({ colorAssignment: "alternated", rematchOfMatchId: first.id });
  });

  it("refuses a rematch of a match that does not exist", async () => {
    const failure = await expectQueryToFail(() =>
      insertMatch(handle.db, matchFixture({ rematchOfMatchId: randomUUID() })),
    );

    expect(failure.constraint).toBe("matches_rematch_of_match_id_matches_id_fk");
  });

  it("keeps the rematch when the match it followed is deleted", async () => {
    const light = await createUser();
    const dark = await createUser();
    const first = await createRankedMatch(light, dark);
    const rematch = await insertMatch(
      handle.db,
      matchFixture({ colorAssignment: "alternated", rematchOfMatchId: first.id }),
    );

    await handle.db.execute(`delete from matches where id = '${first.id}'`);

    expect(await findMatchById(handle.db, rematch.id)).toMatchObject({ rematchOfMatchId: null });
  });
});
