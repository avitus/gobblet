import {
  findMatchById,
  findRating,
  insertProfile,
  insertUser,
  listRatingChangesForMatch,
} from "@gobblet/db";
import type { DatabaseHandle, MatchRow, UserRow } from "@gobblet/db";
import type { Move } from "@gobblet/game-core";
import { STARTING_RATING } from "@gobblet/protocol";
import type { MatchSnapshot } from "@gobblet/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MatchRuntime } from "../src/match/runtime";
import type { CommandResult } from "../src/match/runtime";
import { applyRatingsForCompletion, readSeatRatings } from "../src/rating/service";
import { REPETITION_SCRIPT, TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  runtime = new MatchRuntime({ db: handle.db, now: clock.now });
});

let sequence = 0;

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

async function createRankedMatch(
  light: UserRow,
  dark: UserRow,
  mode: MatchRow["mode"] = "ranked",
): Promise<MatchSnapshot> {
  return runtime.createMatch({
    mode,
    timeControlSeconds: 300,
    light: { actorType: "user", actorId: light.id, displayName: light.displayName },
    dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
  });
}

function actorOf(user: UserRow): Readonly<{ actorType: "user"; actorId: string }> {
  return { actorType: "user", actorId: user.id };
}

/** Plays a script until it ends and returns the result of the last command. */
async function playToEnd(
  matchId: string,
  light: UserRow,
  dark: UserRow,
  script: readonly Move[],
): Promise<CommandResult> {
  let result: CommandResult | null = null;

  for (const [index, move] of script.entries()) {
    const actor = index % 2 === 0 ? light : dark;
    clock.advance(1_000);
    result = await runtime.applyMoveCommand(actorOf(actor), {
      ...envelope(matchId, index),
      payload: { move },
    });
    if (result.ended) {
      break;
    }
  }

  if (!result) {
    throw new Error("the script played no moves");
  }
  return result;
}

describe("ratings on completion", () => {
  it("moves both ratings from the starting value and reports the change", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);

    const result = await playToEnd(match.matchId, light, dark, WINNING_SCRIPT);

    expect(result.ended?.result).toBe("light");
    expect(result.ended?.ratings).toEqual({
      light: {
        before: STARTING_RATING,
        after: 1216,
        delta: 16,
        opponentBefore: STARTING_RATING,
        outcome: "win",
        formulaVersion: 1,
      },
      dark: {
        before: STARTING_RATING,
        after: 1184,
        delta: -16,
        opponentBefore: STARTING_RATING,
        outcome: "loss",
        formulaVersion: 1,
      },
    });
    expect(await findRating(handle.db, light.id)).toMatchObject({
      rating: 1216,
      gamesPlayed: 1,
      wins: 1,
      currentStreak: 1,
      bestStreak: 1,
    });
    expect(await findRating(handle.db, dark.id)).toMatchObject({
      rating: 1184,
      losses: 1,
      currentStreak: -1,
      bestStreak: 0,
    });
  });

  it("writes the audit rows in the same transaction as the result", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);

    await playToEnd(match.matchId, light, dark, WINNING_SCRIPT);

    const changes = await listRatingChangesForMatch(handle.db, match.matchId);
    expect(changes.map((row) => [row.side, row.delta, row.formulaVersion])).toEqual([
      ["light", 16, 1],
      ["dark", -16, 1],
    ]);
  });

  it("records a draw as a draw for both sides", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);

    const result = await playToEnd(match.matchId, light, dark, REPETITION_SCRIPT);

    expect(result.ended).toMatchObject({ result: "draw", reason: "repetition" });
    expect(result.ended?.ratings?.light.delta).toBe(0);
    expect(await findRating(handle.db, light.id)).toMatchObject({ draws: 1, currentStreak: 0 });
  });

  it("leaves ratings alone in a casual match between two accounts", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark, "casual");

    const result = await playToEnd(match.matchId, light, dark, WINNING_SCRIPT);

    expect(result.ended?.result).toBe("light");
    expect(result.ended?.ratings).toBeUndefined();
    expect(await findRating(handle.db, light.id)).toBeUndefined();
  });

  it("leaves ratings alone when a seat is a guest, even in a ranked match", async () => {
    const light = await createAccount();
    const match = await runtime.createMatch({
      mode: "ranked",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: {
        actorType: "guest",
        actorId: "22222222-2222-4222-8222-222222222222",
        displayName: "guest-1",
      },
    });

    const result = await runtime.applyResignCommand(actorOf(light), envelope(match.matchId, 0));

    expect(result.ended?.result).toBe("dark");
    expect(result.ended?.ratings).toBeUndefined();
    expect(await findRating(handle.db, light.id)).toBeUndefined();
  });

  it("moves a rating once, even if completion is applied again", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);
    await runtime.applyResignCommand(actorOf(dark), envelope(match.matchId, 0));
    const row = await requireRow(match.matchId);

    const repeated = await handle.db.transaction(async (tx) =>
      applyRatingsForCompletion(tx, { ...row, result: "light" }),
    );

    expect(repeated).toEqual({
      light: expect.objectContaining({ after: 1216 }),
      dark: expect.objectContaining({ after: 1184 }),
    });
    expect(await findRating(handle.db, light.id)).toMatchObject({ gamesPlayed: 1, rating: 1216 });
    expect(await listRatingChangesForMatch(handle.db, match.matchId)).toHaveLength(2);
  });

  it("refuses to extend an audit that lost one of its two rows", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);
    await runtime.applyResignCommand(actorOf(dark), envelope(match.matchId, 0));
    await handle.db.execute(
      `delete from rating_changes where match_id = '${match.matchId}' and side = 'dark'`,
    );
    const row = await requireRow(match.matchId);

    await expect(
      handle.db.transaction(async (tx) => applyRatingsForCompletion(tx, row)),
    ).rejects.toThrow("missing a side");
  });

  it("reports nothing for a match that has not finished", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);
    const row = await requireRow(match.matchId);

    expect(
      await handle.db.transaction(async (tx) => applyRatingsForCompletion(tx, row)),
    ).toBeNull();
  });

  it("carries the second result forward from the rating the first one produced", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const first = await createRankedMatch(light, dark);
    await runtime.applyResignCommand(actorOf(dark), envelope(first.matchId, 0));

    const second = await createRankedMatch(light, dark);
    const result = await runtime.applyResignCommand(actorOf(dark), envelope(second.matchId, 0));

    expect(result.ended?.ratings?.light).toMatchObject({ before: 1216, opponentBefore: 1184 });
    expect(await findRating(handle.db, light.id)).toMatchObject({
      gamesPlayed: 2,
      wins: 2,
      currentStreak: 2,
      bestStreak: 2,
    });
  });
});

describe("seat ratings", () => {
  it("shows a rating beside a ranked seat and nothing beside a casual one", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const first = await createRankedMatch(light, dark);
    await runtime.applyResignCommand(actorOf(dark), envelope(first.matchId, 0));

    const ranked = await createRankedMatch(light, dark);
    const rankedSnapshot = await runtime.getSnapshotForActor(ranked.matchId, actorOf(light));
    expect(rankedSnapshot?.players.light.rating).toBe(1216);
    expect(rankedSnapshot?.players.dark.rating).toBe(1184);

    const casual = await createRankedMatch(light, dark, "casual");
    const casualSnapshot = await runtime.getSnapshotForActor(casual.matchId, actorOf(light));
    expect(casualSnapshot?.players.light.rating).toBeNull();
  });

  it("shows no rating for an account that has never played ranked", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await createRankedMatch(light, dark);
    const row = await requireRow(match.matchId);

    expect(await readSeatRatings(handle.db, row)).toEqual({ light: null, dark: null });
  });
});

async function requireRow(matchId: string): Promise<MatchRow> {
  const row = await findMatchById(handle.db, matchId);
  if (!row) {
    throw new Error(`no match ${matchId}`);
  }
  return row;
}
