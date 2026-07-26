import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  insertMatch,
  insertRatingChanges,
  insertUser,
  ratings,
  readLeaderboardPage,
  updateProfile,
  insertProfile,
  upsertRating,
  users,
} from "../src/index";
import type { DatabaseHandle, LeaderboardWindow, UserRow } from "../src/index";
import { matchFixture, userFixture } from "./helpers/fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

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

const WINDOW: LeaderboardWindow = {
  start: new Date("2026-07-20T00:00:00.000Z"),
  end: new Date("2026-07-27T00:00:00.000Z"),
};

const INSIDE = new Date("2026-07-22T12:00:00.000Z");
const BEFORE = new Date("2026-07-19T12:00:00.000Z");

type Placed = Readonly<{ user: UserRow; ratedAt: Date }>;

async function place(
  username: string,
  aggregate: Readonly<{ rating: number; wins?: number; games?: number }>,
  ratedAt = new Date("2026-07-22T09:00:00.000Z"),
): Promise<Placed> {
  const user = await insertUser(handle.db, userFixture({ username }));
  const wins = aggregate.wins ?? 0;
  const games = aggregate.games ?? wins;
  await upsertRating(handle.db, user.id, {
    rating: aggregate.rating,
    gamesPlayed: games,
    wins,
    losses: games - wins,
    draws: 0,
    currentStreak: 0,
    bestStreak: wins,
  });
  await handle.db.update(ratings).set({ updatedAt: ratedAt }).where(eq(ratings.userId, user.id));
  return { user, ratedAt };
}

/** One audit row per ranked result, which is what a period board counts. */
async function recordRankedResults(
  user: UserRow,
  results: readonly Readonly<{ outcome: "win" | "loss" | "draw"; at: Date }>[],
): Promise<void> {
  for (const result of results) {
    const match = await insertMatch(
      handle.db,
      matchFixture({
        mode: "ranked",
        lightPlayerType: "user",
        lightPlayerId: user.id,
        lightDisplayName: user.displayName,
        status: "completed",
      }),
    );
    await insertRatingChanges(handle.db, [
      {
        matchId: match.id,
        userId: user.id,
        side: "light",
        ratingBefore: 1200,
        ratingAfter: 1216,
        delta: 16,
        opponentRatingBefore: 1200,
        outcome: result.outcome,
        formulaVersion: 1,
        createdAt: result.at,
      },
    ]);
  }
}

describe("the all-time board", () => {
  it("ranks every active rated account by rating, highest first", async () => {
    await place("ada", { rating: 1500, wins: 5, games: 8 });
    await place("grace", { rating: 1700, wins: 9, games: 12 });
    await place("linus", { rating: 1300, wins: 1, games: 4 });

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries.map((entry) => [entry.rank, entry.username, entry.rating])).toEqual([
      [1, "grace", 1700],
      [2, "ada", 1500],
      [3, "linus", 1300],
    ]);
    expect(page.entries[0]).toMatchObject({ wins: 9, games: 12 });
  });

  it("answers the moment the rating changed as a date, not as raw text", async () => {
    const placed = await place("ada", { rating: 1500 });

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries[0]?.ratedAt).toBeInstanceOf(Date);
    expect(page.entries[0]?.ratedAt.toISOString()).toBe(placed.ratedAt.toISOString());
  });

  it("reports the moment at the resolution a cursor carries, so a page cannot repeat a row", async () => {
    const placed = await place("ada", { rating: 1500 });
    await handle.db.execute(
      sql`update ratings set updated_at = '2026-07-22T09:00:00.123456Z' where user_id = ${placed.user.id}::uuid`,
    );

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });
    const after = await readLeaderboardPage(handle.db, {
      window: null,
      limit: 10,
      cursor: {
        rating: 1500,
        wins: 0,
        games: 0,
        ratedAt: new Date("2026-07-22T09:00:00.123Z"),
        userId: placed.user.id,
      },
    });

    expect(page.entries[0]?.ratedAt.toISOString()).toBe("2026-07-22T09:00:00.123Z");
    expect(after.entries).toEqual([]);
  });

  it("omits an account with no rating row, so nothing is invented for it", async () => {
    await place("ada", { rating: 1400 });
    await insertUser(handle.db, userFixture({ username: "newcomer" }));

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries.map((entry) => entry.username)).toEqual(["ada"]);
  });

  it("omits suspended and deleted accounts", async () => {
    const suspended = await place("suspended_one", { rating: 1900 });
    const deleted = await place("deleted_one", { rating: 1800 });
    await place("ada", { rating: 1400 });
    await handle.db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, suspended.user.id));
    await handle.db.update(users).set({ status: "deleted" }).where(eq(users.id, deleted.user.id));

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries.map((entry) => entry.username)).toEqual(["ada"]);
    expect(page.entries[0]?.rank).toBe(1);
  });

  it("carries the avatar and country a profile chose to show", async () => {
    const placed = await place("ada", { rating: 1400 });
    await insertProfile(handle.db, { userId: placed.user.id });
    await updateProfile(handle.db, placed.user.id, {
      avatarUrl: "https://cdn.example.com/a.png",
      countryCode: "GB",
    });

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries[0]).toMatchObject({
      avatarUrl: "https://cdn.example.com/a.png",
      countryCode: "GB",
    });
  });

  it("leaves the avatar and country null when no profile row exists", async () => {
    await place("ada", { rating: 1400 });

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries[0]).toMatchObject({ avatarUrl: null, countryCode: null });
  });
});

describe("the tie-breakers of section 11.3", () => {
  it("prefers more wins, then fewer games, then the earlier rating, then the id", async () => {
    const early = new Date("2026-07-21T08:00:00.000Z");
    const late = new Date("2026-07-23T08:00:00.000Z");
    await place("fewer_wins", { rating: 1500, wins: 3, games: 6 });
    await place("more_wins", { rating: 1500, wins: 5, games: 9 });
    await place("fewer_games", { rating: 1500, wins: 5, games: 7 });
    await place("earlier", { rating: 1500, wins: 5, games: 7 }, early);
    await place("later", { rating: 1500, wins: 5, games: 7 }, late);

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });
    const order = page.entries.map((entry) => entry.username);

    expect(order.indexOf("more_wins")).toBeLessThan(order.indexOf("fewer_wins"));
    expect(order.indexOf("fewer_games")).toBeLessThan(order.indexOf("more_wins"));
    expect(order.indexOf("earlier")).toBeLessThan(order.indexOf("fewer_games"));
    expect(order.indexOf("fewer_games")).toBeLessThan(order.indexOf("later"));
  });

  it("breaks a complete tie by account id, so the order is total", async () => {
    const same = new Date("2026-07-22T09:00:00.000Z");
    const first = await place("twin_a", { rating: 1500, wins: 2, games: 3 }, same);
    const second = await place("twin_b", { rating: 1500, wins: 2, games: 3 }, same);
    const expected = [first, second]
      .sort((left, right) => left.user.id.localeCompare(right.user.id))
      .map((placed) => placed.user.username);

    const page = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(page.entries.map((entry) => entry.username)).toEqual(expected);
    expect(page.entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });
});

describe("a period board", () => {
  it("contains only accounts that finished a ranked match inside the period", async () => {
    const inside = await place("inside", { rating: 1600 });
    const outside = await place("outside", { rating: 1800 });
    await recordRankedResults(inside.user, [{ outcome: "win", at: INSIDE }]);
    await recordRankedResults(outside.user, [{ outcome: "win", at: BEFORE }]);

    const page = await readLeaderboardPage(handle.db, { window: WINDOW, limit: 10 });

    expect(page.entries.map((entry) => entry.username)).toEqual(["inside"]);
  });

  it("counts wins and games inside the period, not over the account's life", async () => {
    const placed = await place("ada", { rating: 1600, wins: 40, games: 90 });
    await recordRankedResults(placed.user, [
      { outcome: "win", at: INSIDE },
      { outcome: "loss", at: INSIDE },
      { outcome: "win", at: BEFORE },
    ]);

    const page = await readLeaderboardPage(handle.db, { window: WINDOW, limit: 10 });

    expect(page.entries[0]).toMatchObject({ wins: 1, games: 2 });
  });

  it("excludes a result at the closing boundary and includes one at the opening", async () => {
    const opening = await place("opening", { rating: 1500 });
    const closing = await place("closing", { rating: 1600 });
    await recordRankedResults(opening.user, [{ outcome: "win", at: WINDOW.start }]);
    await recordRankedResults(closing.user, [{ outcome: "win", at: WINDOW.end }]);

    const page = await readLeaderboardPage(handle.db, { window: WINDOW, limit: 10 });

    expect(page.entries.map((entry) => entry.username)).toEqual(["opening"]);
  });
});

describe("the caller's own row", () => {
  it("is returned even when it falls outside the page", async () => {
    await place("top", { rating: 1900 });
    await place("middle", { rating: 1700 });
    const mine = await place("mine", { rating: 1100 });

    const page = await readLeaderboardPage(handle.db, {
      window: null,
      limit: 1,
      viewerUserId: mine.user.id,
    });

    expect(page.entries.map((entry) => entry.username)).toEqual(["top"]);
    expect(page.viewer).toMatchObject({ username: "mine", rank: 3 });
  });

  it("is null for an unrated account and for no caller at all", async () => {
    await place("top", { rating: 1900 });
    const unrated = await insertUser(handle.db, userFixture({ username: "unrated" }));

    const withoutRating = await readLeaderboardPage(handle.db, {
      window: null,
      limit: 10,
      viewerUserId: unrated.id,
    });
    const anonymous = await readLeaderboardPage(handle.db, { window: null, limit: 10 });

    expect(withoutRating.viewer).toBeNull();
    expect(anonymous.viewer).toBeNull();
  });

  it("is null when the caller played nothing inside the period", async () => {
    const inside = await place("inside", { rating: 1600 });
    const mine = await place("mine", { rating: 1500 });
    await recordRankedResults(inside.user, [{ outcome: "win", at: INSIDE }]);
    await recordRankedResults(mine.user, [{ outcome: "win", at: BEFORE }]);

    const page = await readLeaderboardPage(handle.db, {
      window: WINDOW,
      limit: 10,
      viewerUserId: mine.user.id,
    });

    expect(page.viewer).toBeNull();
  });

  it("is not confused with a page row of the same account", async () => {
    const mine = await place("mine", { rating: 1900 });

    const page = await readLeaderboardPage(handle.db, {
      window: null,
      limit: 10,
      viewerUserId: mine.user.id,
    });

    expect(page.entries).toHaveLength(1);
    expect(page.viewer).toMatchObject({ username: "mine", rank: 1 });
  });
});

describe("paging", () => {
  it("continues from the cursor without repeating or skipping an account", async () => {
    for (const [index, rating] of [1900, 1800, 1700, 1600, 1500].entries()) {
      await place(`player_${index}`, { rating, wins: index, games: index + 1 });
    }

    const first = await readLeaderboardPage(handle.db, { window: null, limit: 2 });
    const last = first.entries[first.entries.length - 1];
    const second = await readLeaderboardPage(handle.db, {
      window: null,
      limit: 2,
      cursor: {
        rating: last?.rating ?? 0,
        wins: last?.wins ?? 0,
        games: last?.games ?? 0,
        ratedAt: last?.ratedAt ?? new Date(0),
        userId: last?.userId ?? randomUUID(),
      },
    });

    expect(first.entries.map((entry) => entry.username)).toEqual(["player_0", "player_1"]);
    expect(second.entries.map((entry) => entry.username)).toEqual(["player_2", "player_3"]);
    expect(second.entries.map((entry) => entry.rank)).toEqual([3, 4]);
  });

  it("ends with an empty page rather than repeating the last account", async () => {
    const only = await place("solo", { rating: 1500, wins: 2, games: 3 });

    const page = await readLeaderboardPage(handle.db, {
      window: null,
      limit: 5,
      cursor: {
        rating: 1500,
        wins: 2,
        games: 3,
        ratedAt: only.ratedAt,
        userId: only.user.id,
      },
    });

    expect(page.entries).toEqual([]);
  });

  it("pages a period board by the same key", async () => {
    const first = await place("first", { rating: 1600 });
    const second = await place("second", { rating: 1500 });
    await recordRankedResults(first.user, [{ outcome: "win", at: INSIDE }]);
    await recordRankedResults(second.user, [{ outcome: "win", at: INSIDE }]);

    const page = await readLeaderboardPage(handle.db, { window: WINDOW, limit: 1 });
    const cursorRow = page.entries[0];
    const next = await readLeaderboardPage(handle.db, {
      window: WINDOW,
      limit: 1,
      cursor: {
        rating: cursorRow?.rating ?? 0,
        wins: cursorRow?.wins ?? 0,
        games: cursorRow?.games ?? 0,
        ratedAt: cursorRow?.ratedAt ?? new Date(0),
        userId: cursorRow?.userId ?? randomUUID(),
      },
    });

    expect(page.entries.map((entry) => entry.username)).toEqual(["first"]);
    expect(next.entries.map((entry) => entry.username)).toEqual(["second"]);
  });
});
