import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  findRating,
  insertAuditRecord,
  insertRatingAdjustment,
  insertUser,
  listRatingAdjustmentsForUser,
  setRating,
  upsertRating,
} from "../src/index";
import type { AuditLogRow, DatabaseHandle, UserRow } from "../src/index";
import { userFixture } from "./helpers/fixtures";
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

async function createRatedUser(rating: number): Promise<UserRow> {
  const user = await insertUser(handle.db, userFixture());
  await upsertRating(handle.db, user.id, {
    rating,
    gamesPlayed: 12,
    wins: 7,
    losses: 4,
    draws: 1,
    currentStreak: 2,
    bestStreak: 3,
  });
  return user;
}

async function createAudit(target: UserRow, admin: UserRow): Promise<AuditLogRow> {
  return insertAuditRecord(handle.db, {
    adminUserId: admin.id,
    action: "rating-adjusted",
    targetType: "user",
    targetId: target.id,
    targetLabel: target.username,
    before: { rating: 1500 },
    after: { rating: 1400 },
    reason: "Rolling back a rating gained from a disconnection exploit.",
  });
}

describe("a corrective rating change", () => {
  it("writes the rating and moves the moment it was rated", async () => {
    const user = await createRatedUser(1500);
    const before = await findRating(handle.db, user.id);

    const updated = await setRating(handle.db, user.id, 1400);

    expect(updated.rating).toBe(1400);
    expect(updated.gamesPlayed).toBe(12);
    expect(updated.wins).toBe(7);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before?.updatedAt.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it("records the correction beside the audit row that authorised it", async () => {
    const admin = await insertUser(handle.db, userFixture());
    const user = await createRatedUser(1500);
    const audit = await createAudit(user, admin);

    const adjustment = await insertRatingAdjustment(handle.db, {
      userId: user.id,
      adminUserId: admin.id,
      auditId: audit.id,
      ratingBefore: 1500,
      ratingAfter: 1400,
      delta: -100,
      reason: audit.reason,
    });

    expect(adjustment).toMatchObject({
      userId: user.id,
      auditId: audit.id,
      ratingBefore: 1500,
      ratingAfter: 1400,
      delta: -100,
    });
  });

  it("lists an account's corrections newest first", async () => {
    const admin = await insertUser(handle.db, userFixture());
    const user = await createRatedUser(1500);
    const audit = await createAudit(user, admin);

    for (const [before, after] of [
      [1500, 1400],
      [1400, 1450],
    ] as const) {
      await insertRatingAdjustment(handle.db, {
        userId: user.id,
        adminUserId: admin.id,
        auditId: audit.id,
        ratingBefore: before,
        ratingAfter: after,
        delta: after - before,
        reason: audit.reason,
      });
    }

    const listed = await listRatingAdjustmentsForUser(handle.db, user.id, 10);
    expect(listed.map((row) => row.ratingAfter)).toEqual([1450, 1400]);
  });

  it("refuses to correct an account that has never been rated", async () => {
    const user = await insertUser(handle.db, userFixture());

    await expect(setRating(handle.db, user.id, 1400)).rejects.toThrow(
      `setRating found no rating for ${user.id}`,
    );
  });
});
