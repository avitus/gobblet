import { randomUUID } from "node:crypto";
import { ACHIEVEMENT_CATALOGUE } from "@gobblet/protocol";
import { eq, notInArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  achievements,
  awardAchievements,
  findAchievementByCode,
  insertAchievement,
  insertMatch,
  insertUser,
  listAchievementProgress,
  listAchievementsForAdmin,
  listEnabledAchievements,
  updateAchievement,
  userAchievements,
} from "../src/index";
import type { DatabaseHandle, MatchRow, UserRow } from "../src/index";
import { matchFixture, userFixture } from "./helpers/fixtures";
import { expectQueryToFail, setupTestDatabase, truncateAll } from "./helpers/test-database";

const CATALOGUE_CODES = ACHIEVEMENT_CATALOGUE.map((entry) => entry.code);

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterEach(async () => {
  await truncateAll(handle);
  await handle.db.delete(achievements).where(notInArray(achievements.code, CATALOGUE_CODES));
  await restoreCatalogue();
});

/** The catalogue is seeded by a migration, so an editing test must put it back. */
async function restoreCatalogue(): Promise<void> {
  for (const entry of ACHIEVEMENT_CATALOGUE) {
    await handle.db
      .update(achievements)
      .set({
        name: entry.name,
        description: entry.description,
        badgeAsset: entry.badge,
        ruleVersion: entry.ruleVersion,
        enabled: true,
      })
      .where(eq(achievements.code, entry.code));
  }
}

afterAll(async () => {
  await handle.close();
});

async function createUser(): Promise<UserRow> {
  return insertUser(handle.db, userFixture());
}

async function createMatch(user: UserRow): Promise<MatchRow> {
  return insertMatch(
    handle.db,
    matchFixture({
      lightPlayerType: "user",
      lightPlayerId: user.id,
      lightDisplayName: user.displayName,
      status: "completed",
      result: "light",
      endReason: "line",
    }),
  );
}

describe("the seeded catalogue", () => {
  it("matches the catalogue the protocol defines, so the two cannot drift", async () => {
    const rows = await listEnabledAchievements(handle.db);

    expect(rows).toHaveLength(ACHIEVEMENT_CATALOGUE.length);
    for (const entry of ACHIEVEMENT_CATALOGUE) {
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: entry.code,
            name: entry.name,
            description: entry.description,
            badgeAsset: entry.badge,
            ruleVersion: entry.ruleVersion,
            enabled: true,
          }),
        ]),
      );
    }
  });

  it("withholds a disabled achievement", async () => {
    await handle.db
      .update(achievements)
      .set({ enabled: false })
      .where(eq(achievements.code, "uncovered"));

    const codes = (await listEnabledAchievements(handle.db)).map((row) => row.code);

    expect(codes).not.toContain("uncovered");
    expect(codes).toHaveLength(ACHIEVEMENT_CATALOGUE.length - 1);
  });
});

describe("awarding", () => {
  it("writes the codes it was given and names what it wrote", async () => {
    const user = await createUser();
    const match = await createMatch(user);

    const awarded = await awardAchievements(
      handle.db,
      user.id,
      ["first-victory", "getting-started"],
      match.id,
    );

    expect(awarded).toEqual(["first-victory", "getting-started"]);
    const rows = await handle.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, user.id));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.sourceMatchId).toBe(match.id);
  });

  it("is idempotent: a repeated award writes nothing and claims nothing", async () => {
    const user = await createUser();
    const match = await createMatch(user);

    expect(await awardAchievements(handle.db, user.id, ["first-victory"], match.id)).toEqual([
      "first-victory",
    ]);
    expect(await awardAchievements(handle.db, user.id, ["first-victory"], match.id)).toEqual([]);

    const rows = await handle.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it("awards once when two transactions award the same achievement at once", async () => {
    const user = await createUser();
    const match = await createMatch(user);

    const [first, second] = await Promise.all([
      handle.db.transaction((tx) => awardAchievements(tx, user.id, ["contender"], match.id)),
      handle.db.transaction((tx) => awardAchievements(tx, user.id, ["contender"], match.id)),
    ]);

    expect([...first, ...second]).toEqual(["contender"]);
  });

  it("awards nothing for an unknown code, a disabled one or an empty list", async () => {
    const user = await createUser();
    await handle.db
      .update(achievements)
      .set({ enabled: false })
      .where(eq(achievements.code, "four-ways"));

    expect(await awardAchievements(handle.db, user.id, ["grandmaster"], null)).toEqual([]);
    expect(await awardAchievements(handle.db, user.id, ["four-ways"], null)).toEqual([]);
    expect(await awardAchievements(handle.db, user.id, [], null)).toEqual([]);
  });

  it("records no match when the award did not come from one", async () => {
    const user = await createUser();

    await awardAchievements(handle.db, user.id, ["century-club"], null);

    const [row] = await handle.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, user.id));
    expect(row?.sourceMatchId).toBeNull();
  });
});

describe("progress", () => {
  it("reports every enabled achievement, earned or not", async () => {
    const user = await createUser();
    const match = await createMatch(user);
    await awardAchievements(handle.db, user.id, ["time-keeper"], match.id);

    const progress = await listAchievementProgress(handle.db, user.id);

    expect(progress).toHaveLength(ACHIEVEMENT_CATALOGUE.length);
    const earned = progress.filter((entry) => entry.earnedAt !== null);
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ code: "time-keeper", sourceMatchId: match.id });
    expect(progress.filter((entry) => entry.earnedAt === null)).toHaveLength(
      ACHIEVEMENT_CATALOGUE.length - 1,
    );
  });

  it("does not leak another account's awards", async () => {
    const [mine, theirs] = [await createUser(), await createUser()];
    await awardAchievements(handle.db, theirs.id, ["on-a-roll"], null);

    const progress = await listAchievementProgress(handle.db, mine.id);

    expect(progress.every((entry) => entry.earnedAt === null)).toBe(true);
  });
});

describe("the catalogue an administrator manages", () => {
  it("lists every row, disabled ones included, with how many hold it", async () => {
    const user = await createUser();
    await awardAchievements(handle.db, user.id, ["first-victory"], null);
    await handle.db
      .update(achievements)
      .set({ enabled: false })
      .where(eq(achievements.code, "four-ways"));

    const rows = await listAchievementsForAdmin(handle.db);

    expect(rows).toHaveLength(ACHIEVEMENT_CATALOGUE.length);
    expect(rows.map((row) => row.code)).toEqual([...CATALOGUE_CODES].sort());
    expect(rows.find((row) => row.code === "first-victory")).toMatchObject({
      awarded: 1,
      enabled: true,
    });
    expect(rows.find((row) => row.code === "four-ways")).toMatchObject({
      awarded: 0,
      enabled: false,
    });
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("edits the metadata and the flag, and moves the moment it was edited", async () => {
    const before = await findAchievementByCode(handle.db, "time-keeper");
    if (before === undefined) {
      throw new Error("expected the seeded catalogue");
    }

    const updated = await updateAchievement(handle.db, before.id, {
      name: "Clockwatcher",
      enabled: false,
    });

    expect(updated).toMatchObject({
      code: "time-keeper",
      name: "Clockwatcher",
      description: before.description,
      enabled: false,
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it("refuses to edit a row that does not exist", async () => {
    const missing = randomUUID();

    await expect(updateAchievement(handle.db, missing, { enabled: true })).rejects.toThrow(
      `updateAchievement found no achievement ${missing}`,
    );
  });

  it("cannot add a second row for a code that already exists", async () => {
    const failure = await expectQueryToFail(() =>
      insertAchievement(handle.db, {
        code: "first-victory",
        name: "First Victory",
        description: "Win your first match.",
        badgeAsset: "bronze",
      }),
    );

    expect(failure.constraint).toBe("achievements_code_key");
  });

  it("finds nothing for a code the catalogue does not carry", async () => {
    expect(await findAchievementByCode(handle.db, "grandmaster")).toBeUndefined();
  });
});
