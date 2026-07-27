import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  countCasualResults,
  findProfileByUserId,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  insertMatch,
  insertProfile,
  insertUser,
  markEmailVerified,
  setUserRole,
  setUserSuspension,
  touchUser,
  uniqueUserConflict,
  updateProfile,
} from "../src/index";
import type { DatabaseHandle, UserRow } from "../src/index";
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

async function createUser(overrides: Parameters<typeof userFixture>[0] = {}): Promise<UserRow> {
  return insertUser(handle.db, userFixture(overrides));
}

describe("users", () => {
  it("stores an account and finds it by id, email and username", async () => {
    const user = await createUser({ username: "Ada" });

    expect(user.status).toBe("active");
    expect(user.emailVerifiedAt).toBeNull();
    expect(await findUserById(handle.db, user.id)).toMatchObject({ username: "Ada" });
    expect(await findUserByEmail(handle.db, "ada@example.com")).toMatchObject({ id: user.id });
    expect(await findUserByUsername(handle.db, "ada")).toMatchObject({ id: user.id });
  });

  it("returns nothing for an unknown account", async () => {
    expect(await findUserById(handle.db, randomUUID())).toBeUndefined();
    expect(await findUserByEmail(handle.db, "nobody@example.com")).toBeUndefined();
    expect(await findUserByUsername(handle.db, "nobody")).toBeUndefined();
  });

  it("keeps one account per email address", async () => {
    await createUser({ username: "ada" });

    const failure = await expectQueryToFail(() =>
      insertUser(handle.db, userFixture({ username: "grace", email: "ada@example.com" })),
    );

    expect(failure).toEqual({ code: "23505", constraint: "users_email_key" });
  });

  it("keeps usernames unique on their normalised form", async () => {
    await createUser({ username: "Ada" });

    const failure = await expectQueryToFail(() =>
      insertUser(
        handle.db,
        userFixture({
          username: "ADA",
          usernameNormalized: "ada",
          email: "other@example.com",
        }),
      ),
    );

    expect(failure).toEqual({ code: "23505", constraint: "users_username_normalized_key" });
  });

  it("records email verification and the last seen time", async () => {
    const user = await createUser();
    const verifiedAt = new Date(Date.now() + 1_000);
    const seenAt = new Date(Date.now() + 2_000);

    await markEmailVerified(handle.db, user.id, verifiedAt);
    await touchUser(handle.db, user.id, seenAt);

    const reloaded = await findUserById(handle.db, user.id);
    expect(reloaded?.emailVerifiedAt?.getTime()).toBe(verifiedAt.getTime());
    expect(reloaded?.lastSeenAt.getTime()).toBe(seenAt.getTime());
  });

  it("suspends and reinstates an account", async () => {
    const user = await createUser();
    const suspendedAt = new Date();

    const suspended = await setUserSuspension(handle.db, user.id, {
      status: "suspended",
      suspendedAt,
      suspendedReason: "abuse",
    });
    expect(suspended.status).toBe("suspended");
    expect(suspended.suspendedReason).toBe("abuse");

    const reinstated = await setUserSuspension(handle.db, user.id, {
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
    });
    expect(reinstated.status).toBe("active");
    expect(reinstated.suspendedAt).toBeNull();
  });

  it("fails loudly when suspending an account that does not exist", async () => {
    await expect(
      setUserSuspension(handle.db, randomUUID(), {
        status: "suspended",
        suspendedAt: new Date(),
        suspendedReason: null,
      }),
    ).rejects.toThrow(/found no user/);
  });

  it("grants the administrative role, and fails loudly for an account that does not exist", async () => {
    const user = await createUser();

    expect((await setUserRole(handle.db, user.id, "admin")).role).toBe("admin");
    await expect(setUserRole(handle.db, randomUUID(), "admin")).rejects.toThrow(/found no user/);
  });
});

describe("uniqueUserConflict", () => {
  it("names the field a unique violation was about", () => {
    expect(uniqueUserConflict({ code: "23505", constraint: "users_email_key" })).toBe("email");
    expect(uniqueUserConflict({ code: "23505", constraint: "users_username_normalized_key" })).toBe(
      "username",
    );
  });

  it("looks through the wrapper the driver error arrives in", () => {
    const wrapped = new Error("insert failed", {
      cause: { code: "23505", constraint: "users_email_key" },
    });

    expect(uniqueUserConflict(wrapped)).toBe("email");
  });

  it("returns null for anything else, so unrelated errors keep propagating", () => {
    expect(uniqueUserConflict(null)).toBeNull();
    expect(uniqueUserConflict("boom")).toBeNull();
    expect(uniqueUserConflict(new Error("boom"))).toBeNull();
    expect(
      uniqueUserConflict({ code: "23503", constraint: "profiles_user_id_users_id_fk" }),
    ).toBeNull();
    expect(uniqueUserConflict({ code: "23505", constraint: "matches_pkey" })).toBeNull();
  });
});

describe("profiles", () => {
  it("creates a profile with every preference off", async () => {
    const user = await createUser();

    const profile = await insertProfile(handle.db, { userId: user.id });

    expect(profile).toMatchObject({
      avatarUrl: null,
      countryCode: null,
      presetMessagesMuted: false,
      reactionsMuted: false,
      gameSoundMuted: false,
      reducedMotion: false,
    });
    expect(await findProfileByUserId(handle.db, user.id)).toMatchObject({ userId: user.id });
  });

  it("applies a partial patch and leaves the rest alone", async () => {
    const user = await createUser();
    await insertProfile(handle.db, { userId: user.id, countryCode: "GB" });

    const updated = await updateProfile(handle.db, user.id, {
      avatarUrl: "https://cdn.example.com/a.png",
      reducedMotion: true,
    });

    expect(updated.avatarUrl).toBe("https://cdn.example.com/a.png");
    expect(updated.countryCode).toBe("GB");
    expect(updated.reducedMotion).toBe(true);
    expect(updated.reactionsMuted).toBe(false);
  });

  it("clears an optional field when the patch says null", async () => {
    const user = await createUser();
    await insertProfile(handle.db, { userId: user.id, countryCode: "GB" });

    const updated = await updateProfile(handle.db, user.id, { countryCode: null });

    expect(updated.countryCode).toBeNull();
  });

  it("fails loudly when the profile does not exist", async () => {
    await expect(updateProfile(handle.db, randomUUID(), { reducedMotion: true })).rejects.toThrow(
      /found no profile/,
    );
  });

  it("refuses a profile without an account", async () => {
    const failure = await expectQueryToFail(() =>
      insertProfile(handle.db, { userId: randomUUID() }),
    );

    expect(failure.code).toBe("23503");
  });

  it("disappears with the account it belongs to", async () => {
    const user = await createUser();
    await insertProfile(handle.db, { userId: user.id });

    await handle.db.execute(`delete from users where id = '${user.id}'`);

    expect(await findProfileByUserId(handle.db, user.id)).toBeUndefined();
  });
});

describe("countCasualResults", () => {
  it("counts nothing for an account that has not finished a match", async () => {
    const user = await createUser();

    expect(await countCasualResults(handle.db, user.id)).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      played: 0,
    });
  });

  it("counts wins, losses and draws from both sides of the board", async () => {
    const user = await createUser();
    const opponent = randomUUID();

    await insertMatch(
      handle.db,
      matchFixture({
        lightPlayerType: "user",
        lightPlayerId: user.id,
        darkPlayerId: opponent,
        status: "completed",
        result: "light",
        endReason: "line",
      }),
    );
    await insertMatch(
      handle.db,
      matchFixture({
        darkPlayerType: "user",
        darkPlayerId: user.id,
        lightPlayerId: opponent,
        status: "completed",
        result: "dark",
        endReason: "resignation",
      }),
    );
    await insertMatch(
      handle.db,
      matchFixture({
        lightPlayerType: "user",
        lightPlayerId: user.id,
        darkPlayerId: opponent,
        status: "completed",
        result: "dark",
        endReason: "timeout",
      }),
    );
    await insertMatch(
      handle.db,
      matchFixture({
        darkPlayerType: "user",
        darkPlayerId: user.id,
        lightPlayerId: opponent,
        status: "completed",
        result: "draw",
        endReason: "repetition",
      }),
    );

    expect(await countCasualResults(handle.db, user.id)).toEqual({
      wins: 2,
      losses: 1,
      draws: 1,
      played: 4,
    });
  });

  it("ignores unfinished matches, ranked matches and other players", async () => {
    const user = await createUser();

    await insertMatch(
      handle.db,
      matchFixture({ lightPlayerType: "user", lightPlayerId: user.id, status: "active" }),
    );
    await insertMatch(
      handle.db,
      matchFixture({
        lightPlayerType: "user",
        lightPlayerId: user.id,
        mode: "ranked",
        status: "completed",
        result: "light",
        endReason: "line",
      }),
    );
    await insertMatch(
      handle.db,
      matchFixture({ status: "completed", result: "light", endReason: "line" }),
    );

    expect(await countCasualResults(handle.db, user.id)).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      played: 0,
    });
  });

  it("does not count a guest whose id happens to match the account id", async () => {
    const user = await createUser();

    await insertMatch(
      handle.db,
      matchFixture({
        lightPlayerType: "guest",
        lightPlayerId: user.id,
        status: "completed",
        result: "light",
        endReason: "line",
      }),
    );

    expect(await countCasualResults(handle.db, user.id)).toMatchObject({ played: 0 });
  });
});
