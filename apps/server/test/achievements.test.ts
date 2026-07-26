import {
  findMatchById,
  insertMatch,
  insertProfile,
  insertUser,
  listAchievementProgress,
  upsertRating,
} from "@gobblet/db";
import type { DatabaseHandle, MatchRow, UserRow } from "@gobblet/db";
import type { Move } from "@gobblet/game-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { awardAchievementsForCompletion } from "../src/achievements/service";
import { lineCategories, winningLineIds } from "../src/achievements/lines";
import { earnedAchievements } from "../src/achievements/rules";
import type { AchievementFacts } from "../src/achievements/rules";
import { MatchRuntime } from "../src/match/runtime";
import {
  REVEAL_LOSS_SCRIPT,
  TestClock,
  UNCOVERED_SCRIPT,
  WINNING_SCRIPT,
  envelope,
} from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;
let sequence = 0;

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

function actorOf(user: UserRow): Readonly<{ actorType: "user"; actorId: string }> {
  return { actorType: "user", actorId: user.id };
}

async function play(
  matchId: string,
  light: UserRow,
  dark: UserRow,
  script: readonly Move[],
): Promise<void> {
  for (const [index, move] of script.entries()) {
    const actor = index % 2 === 0 ? light : dark;
    clock.advance(1_000);
    const result = await runtime.applyMoveCommand(actorOf(actor), {
      ...envelope(matchId, index),
      payload: { move },
    });
    if (!result.ack.ok) {
      throw new Error(`script move ${index} was rejected: ${result.ack.reason}`);
    }
  }
}

async function earnedCodes(user: UserRow): Promise<string[]> {
  const progress = await listAchievementProgress(handle.db, user.id);
  return progress.filter((entry) => entry.earnedAt !== null).map((entry) => entry.code);
}

const baseFacts: AchievementFacts = {
  mode: "casual",
  endReason: "line",
  wonMatch: false,
  completedMatches: 1,
  totalWins: 0,
  rankedWins: 0,
  rankedStreak: 0,
  revealedAndBlocked: false,
  wonLineCategories: [],
};

describe("the achievement rules", () => {
  it("awards nothing for a first completed match that was lost", () => {
    expect(earnedAchievements(baseFacts)).toEqual([]);
  });

  it("awards the first victory for a win in either mode", () => {
    expect(earnedAchievements({ ...baseFacts, totalWins: 1 })).toEqual(["first-victory"]);
    expect(
      earnedAchievements({ ...baseFacts, mode: "ranked", totalWins: 1, rankedWins: 1 }),
    ).toEqual(["first-victory"]);
  });

  it("counts completed matches across both modes, at ten and at a hundred", () => {
    expect(earnedAchievements({ ...baseFacts, completedMatches: 9 })).toEqual([]);
    expect(earnedAchievements({ ...baseFacts, completedMatches: 10 })).toEqual(["getting-started"]);
    expect(earnedAchievements({ ...baseFacts, completedMatches: 100 })).toEqual([
      "getting-started",
      "century-club",
    ]);
  });

  it("counts ranked wins and a ranked winning streak separately", () => {
    expect(earnedAchievements({ ...baseFacts, rankedWins: 9, rankedStreak: 2 })).toEqual([]);
    expect(earnedAchievements({ ...baseFacts, rankedWins: 10, rankedStreak: 3 })).toEqual([
      "contender",
      "on-a-roll",
    ]);
  });

  it("reads a losing streak as no streak, because it is negative", () => {
    expect(earnedAchievements({ ...baseFacts, rankedStreak: -4 })).toEqual([]);
  });

  it("awards the clock only for a ranked win by timeout", () => {
    const timeout = { ...baseFacts, endReason: "timeout" as const, wonMatch: true, totalWins: 1 };

    expect(earnedAchievements({ ...timeout, mode: "ranked" })).toEqual([
      "first-victory",
      "time-keeper",
    ]);
    expect(earnedAchievements(timeout)).toEqual(["first-victory"]);
    expect(earnedAchievements({ ...timeout, mode: "ranked", wonMatch: false })).toEqual([
      "first-victory",
    ]);
  });

  it("awards the reveal only to the winner of the match it happened in", () => {
    const revealed = { ...baseFacts, revealedAndBlocked: true };

    expect(earnedAchievements({ ...revealed, wonMatch: true, totalWins: 1 })).toEqual([
      "first-victory",
      "uncovered",
    ]);
    expect(earnedAchievements(revealed)).toEqual([]);
  });

  it("awards four ways only when all four categories are held", () => {
    const three = { ...baseFacts, wonLineCategories: ["row", "column", "diagonal-0"] as const };

    expect(earnedAchievements(three)).toEqual([]);
    expect(
      earnedAchievements({
        ...baseFacts,
        wonLineCategories: ["row", "column", "diagonal-0", "diagonal-1"],
      }),
    ).toEqual(["four-ways"]);
  });

  it("awards nothing when a match ended without a recorded reason", () => {
    expect(earnedAchievements({ ...baseFacts, endReason: null, wonMatch: true })).toEqual([]);
  });
});

describe("line categories", () => {
  it("maps every line id to its category, and both diagonals separately", () => {
    expect(lineCategories(["row-2", "column-0", "diagonal-0", "diagonal-1"])).toEqual([
      "row",
      "column",
      "diagonal-0",
      "diagonal-1",
    ]);
    expect(lineCategories(["row-0", "row-3"])).toEqual(["row"]);
  });

  it("ignores an id that names no line, so a stray value cannot award anything", () => {
    expect(lineCategories(["knight-move", ""])).toEqual([]);
    expect(lineCategories([])).toEqual([]);
  });

  it("names the lines an engine evaluation produced", () => {
    expect(
      winningLineIds([
        {
          id: "row-1",
          kind: "row",
          index: 1,
          squares: ["r1c0", "r1c1", "r1c2", "r1c3"],
          player: "light",
          pieces: ["L04", "L14", "L24", "L03"],
        },
      ]),
    ).toEqual(["row-1"]);
  });
});

describe("awarding on completion", () => {
  it("records the winning line on the match and awards the first victory", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
    });

    await play(match.matchId, light, dark, WINNING_SCRIPT);

    expect((await findMatchById(handle.db, match.matchId))?.winningLineIds).toEqual(["row-0"]);
    expect(await earnedCodes(light)).toEqual(["first-victory"]);
    expect(await earnedCodes(dark)).toEqual([]);
  });

  it("awards Uncovered to a winner who revealed a line and blocked it in one move", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
    });

    await play(match.matchId, light, dark, UNCOVERED_SCRIPT);

    expect((await findMatchById(handle.db, match.matchId))?.result).toBe("light");
    expect(await earnedCodes(light)).toEqual(["first-victory", "uncovered"]);
  });

  it("awards nothing for a reveal that was not blocked, which loses the match", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
    });

    await play(match.matchId, light, dark, REVEAL_LOSS_SCRIPT);

    const row = await findMatchById(handle.db, match.matchId);
    expect(row).toMatchObject({ result: "dark", endReason: "revealed-line" });
    expect(row?.winningLineIds).toEqual(["row-0"]);
    expect(await earnedCodes(light)).toEqual([]);
    expect(await earnedCodes(dark)).toEqual(["first-victory"]);
  });

  it("is idempotent when the same completed match is evaluated again", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
    });
    await play(match.matchId, light, dark, WINNING_SCRIPT);
    const row = await findMatchById(handle.db, match.matchId);

    const repeated = await awardAchievementsForCompletion(handle.db, row as MatchRow);

    expect(repeated).toEqual({ light: [], dark: [] });
    expect(await earnedCodes(light)).toEqual(["first-victory"]);
  });

  it("awards nothing while a match is still running", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    const match = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
    });
    const row = await findMatchById(handle.db, match.matchId);

    expect(await awardAchievementsForCompletion(handle.db, row as MatchRow)).toEqual({
      light: [],
      dark: [],
    });
  });

  it("awards nothing to a guest, who has no account to award to", async () => {
    const light = await createAccount();
    const row = await insertMatch(handle.db, {
      mode: "casual",
      timeControlSeconds: 300,
      status: "completed",
      result: "dark",
      endReason: "line",
      lightPlayerType: "user",
      lightPlayerId: light.id,
      lightDisplayName: light.displayName,
      darkPlayerType: "guest",
      darkPlayerId: "11111111-1111-4111-8111-111111111111",
      darkDisplayName: "guest-1",
      gameState: { version: 1, ply: 0 },
      stateVersion: 1,
      lightRemainingMs: 1_000,
      darkRemainingMs: 1_000,
      activePlayer: "light",
    });

    expect(await awardAchievementsForCompletion(handle.db, row)).toEqual({
      light: [],
      dark: [],
    });
  });

  it("reads the ranked aggregate this completion has just moved", async () => {
    const light = await createAccount();
    const dark = await createAccount();
    await upsertRating(handle.db, light.id, {
      rating: 1400,
      gamesPlayed: 12,
      wins: 9,
      losses: 3,
      draws: 0,
      currentStreak: 2,
      bestStreak: 4,
    });
    const match = await runtime.createMatch({
      mode: "ranked",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: light.id, displayName: light.displayName },
      dark: { actorType: "user", actorId: dark.id, displayName: dark.displayName },
    });

    await play(match.matchId, light, dark, WINNING_SCRIPT);

    expect(await earnedCodes(light)).toEqual(["contender", "first-victory", "on-a-roll"]);
  });
});
