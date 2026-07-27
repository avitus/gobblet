import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  countActiveActors,
  countActiveSessions,
  countAuditRecords,
  countCasualResults,
  countCompletedMatchesForActor,
  countMatchEvents,
  insertAchievement,
  insertAuditRecord,
  insertEmailVerificationToken,
  insertGuestSession,
  insertMatch,
  insertMatchConnectionEvent,
  insertMatchEvent,
  insertProfile,
  insertRatingAdjustment,
  insertRelease,
  insertUser,
  insertUserSession,
  summariseMatches,
  summarisePairings,
  upsertRating,
} from "../src/index";
import { guestFixture, matchFixture, userFixture } from "./helpers/fixtures";
import { executorAnsweringNothing } from "./helpers/stub-executor";

/**
 * Every write here asks the database to return the row it wrote, and every count
 * reads a single aggregate row. A driver that answers with nothing instead is the
 * failure these guards exist for, so they are proved against a driver that does.
 */

const actor = { actorType: "user" as const, actorId: randomUUID() };

describe("a statement answered with no rows at all", () => {
  it("fails the write loudly rather than handing back a record that was never stored", async () => {
    const executor = executorAnsweringNothing();
    const userId = randomUUID();

    await expect(insertUser(executor, userFixture())).rejects.toThrow(/insertUser returned no row/);
    await expect(insertProfile(executor, { userId })).rejects.toThrow(
      /insertProfile returned no row/,
    );
    await expect(
      insertUserSession(executor, {
        userId,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/insertUserSession returned no row/);
    await expect(
      insertEmailVerificationToken(executor, {
        userId,
        tokenHash: `hash-${randomUUID()}`,
        email: "player@example.com",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/insertEmailVerificationToken returned no row/);
    await expect(insertGuestSession(executor, guestFixture())).rejects.toThrow(
      /insertGuestSession returned no row/,
    );
    await expect(insertMatch(executor, matchFixture())).rejects.toThrow(
      /insertMatch returned no row/,
    );
    await expect(
      insertMatchEvent(executor, {
        matchId: randomUUID(),
        sequence: 1,
        commandId: randomUUID(),
        type: "move",
        actorType: "user",
        actorId: userId,
        payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" } },
        stateHash: "hash-1",
      }),
    ).rejects.toThrow(/insertMatchEvent returned no row/);
    await expect(
      insertMatchConnectionEvent(executor, {
        matchId: randomUUID(),
        kind: "attached",
        actorType: "user",
        actorId: userId,
        socketId: "socket-a",
      }),
    ).rejects.toThrow(/insertMatchConnectionEvent returned no row/);
    await expect(
      upsertRating(executor, userId, {
        rating: 1200,
        gamesPlayed: 1,
        wins: 1,
        losses: 0,
        draws: 0,
        currentStreak: 1,
        bestStreak: 1,
      }),
    ).rejects.toThrow(/upsertRating wrote no row/);
    await expect(
      insertRatingAdjustment(executor, {
        userId,
        adminUserId: randomUUID(),
        auditId: randomUUID(),
        ratingBefore: 1500,
        ratingAfter: 1400,
        delta: -100,
        reason: "Rolling back a rating gained from a disconnection exploit.",
      }),
    ).rejects.toThrow(/insertRatingAdjustment returned no row/);
    await expect(
      insertAuditRecord(executor, {
        action: "user-suspended",
        adminUserId: null,
        targetType: "user",
        targetId: userId,
        before: { status: "active" },
        after: { status: "suspended" },
        reason: "Suspended while the report is investigated.",
      }),
    ).rejects.toThrow(/insertAuditRecord returned no row/);
    await expect(
      insertAchievement(executor, {
        code: "first-victory",
        name: "First Victory",
        description: "Win your first match.",
        badgeAsset: "bronze",
      }),
    ).rejects.toThrow(/insertAchievement returned no row/);
    await expect(
      insertRelease(executor, {
        version: "1.9.0",
        channel: "stable",
        notes: "Notes for 1.9.0",
        publishedAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow(/insertRelease returned no row/);
  });

  it("reads every total as nothing rather than as a number it did not receive", async () => {
    const executor = executorAnsweringNothing();
    const since = new Date("2026-07-26T00:00:00.000Z");

    expect(await countMatchEvents(executor, randomUUID())).toBe(0);
    expect(await countAuditRecords(executor)).toBe(0);
    expect(await countActiveSessions(executor, actor.actorId, since)).toBe(0);
    expect(await countActiveActors(executor, since)).toEqual({ accounts: 0, guests: 0 });
    expect(await countCompletedMatchesForActor(executor, actor)).toEqual({ played: 0, wins: 0 });
    expect(await countCasualResults(executor, actor.actorId)).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      played: 0,
    });
    expect(await summariseMatches(executor, since)).toEqual({
      active: 0,
      completed: 0,
      aborted: 0,
      byEndReason: [],
    });
    expect(await summarisePairings(executor, since)).toEqual({
      pairings: 0,
      averageWaitMs: null,
    });
  });
});
