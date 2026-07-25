import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  consumeEmailVerificationToken,
  findEmailVerificationToken,
  findUserSessionByTokenHash,
  insertEmailVerificationToken,
  insertUser,
  insertUserSession,
  revokeUserSession,
  revokeUserSessions,
  touchUserSession,
} from "../src/index";
import type { DatabaseHandle, UserRow } from "../src/index";
import { userFixture } from "./helpers/fixtures";
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

const DAY_MS = 24 * 60 * 60 * 1000;

async function createUser(): Promise<UserRow> {
  return insertUser(handle.db, userFixture());
}

function sessionFixture(userId: string, tokenHash = `hash-${randomUUID()}`) {
  return { userId, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) };
}

describe("user sessions", () => {
  it("stores a session and finds it by token hash", async () => {
    const user = await createUser();
    const fixture = sessionFixture(user.id);

    const inserted = await insertUserSession(handle.db, fixture);

    expect(inserted.revokedAt).toBeNull();
    expect(await findUserSessionByTokenHash(handle.db, fixture.tokenHash)).toMatchObject({
      id: inserted.id,
      userId: user.id,
    });
  });

  it("returns nothing for an unknown token", async () => {
    expect(await findUserSessionByTokenHash(handle.db, "missing")).toBeUndefined();
  });

  it("keeps token hashes unique across accounts", async () => {
    const first = await createUser();
    const second = await createUser();
    const shared = `hash-${randomUUID()}`;
    await insertUserSession(handle.db, sessionFixture(first.id, shared));

    const failure = await expectQueryToFail(() =>
      insertUserSession(handle.db, sessionFixture(second.id, shared)),
    );

    expect(failure).toEqual({ code: "23505", constraint: "user_sessions_token_hash_key" });
  });

  it("refuses a session for an account that does not exist", async () => {
    const failure = await expectQueryToFail(() =>
      insertUserSession(handle.db, sessionFixture(randomUUID())),
    );

    expect(failure.code).toBe("23503");
  });

  it("records the last seen timestamp", async () => {
    const user = await createUser();
    const inserted = await insertUserSession(handle.db, sessionFixture(user.id));
    const seenAt = new Date(Date.now() + 5_000);

    await touchUserSession(handle.db, inserted.id, seenAt);

    const reloaded = await findUserSessionByTokenHash(handle.db, inserted.tokenHash);
    expect(reloaded?.lastSeenAt.getTime()).toBe(seenAt.getTime());
  });

  it("revokes one session and leaves the first revocation time in place", async () => {
    const user = await createUser();
    const inserted = await insertUserSession(handle.db, sessionFixture(user.id));
    const first = new Date(Date.now() - 1_000);

    await revokeUserSession(handle.db, inserted.id, first);
    await revokeUserSession(handle.db, inserted.id, new Date());

    const reloaded = await findUserSessionByTokenHash(handle.db, inserted.tokenHash);
    expect(reloaded?.revokedAt?.getTime()).toBe(first.getTime());
  });

  it("revokes every live session of one account and reports the count", async () => {
    const user = await createUser();
    const other = await createUser();
    const live = await insertUserSession(handle.db, sessionFixture(user.id));
    const second = await insertUserSession(handle.db, sessionFixture(user.id));
    const untouched = await insertUserSession(handle.db, sessionFixture(other.id));
    await revokeUserSession(handle.db, second.id, new Date(Date.now() - 5_000));

    const revoked = await revokeUserSessions(handle.db, user.id, new Date());

    expect(revoked).toBe(1);
    expect((await findUserSessionByTokenHash(handle.db, live.tokenHash))?.revokedAt).not.toBeNull();
    expect(
      (await findUserSessionByTokenHash(handle.db, untouched.tokenHash))?.revokedAt,
    ).toBeNull();
  });

  it("disappears with the account it belongs to", async () => {
    const user = await createUser();
    const inserted = await insertUserSession(handle.db, sessionFixture(user.id));

    await handle.db.execute(`delete from users where id = '${user.id}'`);

    expect(await findUserSessionByTokenHash(handle.db, inserted.tokenHash)).toBeUndefined();
  });
});

describe("email verification tokens", () => {
  it("stores a token against the address it was issued for", async () => {
    const user = await createUser();
    const tokenHash = `hash-${randomUUID()}`;

    const inserted = await insertEmailVerificationToken(handle.db, {
      userId: user.id,
      tokenHash,
      email: user.email,
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    expect(inserted.consumedAt).toBeNull();
    expect(await findEmailVerificationToken(handle.db, tokenHash)).toMatchObject({
      id: inserted.id,
      email: user.email,
    });
  });

  it("returns nothing for an unknown token", async () => {
    expect(await findEmailVerificationToken(handle.db, "missing")).toBeUndefined();
  });

  it("can be consumed exactly once", async () => {
    const user = await createUser();
    const inserted = await insertEmailVerificationToken(handle.db, {
      userId: user.id,
      tokenHash: `hash-${randomUUID()}`,
      email: user.email,
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    expect(await consumeEmailVerificationToken(handle.db, inserted.id, new Date())).toBe(true);
    expect(await consumeEmailVerificationToken(handle.db, inserted.id, new Date())).toBe(false);
  });

  it("reports false for a token that does not exist", async () => {
    expect(await consumeEmailVerificationToken(handle.db, randomUUID(), new Date())).toBe(false);
  });

  it("keeps token hashes unique", async () => {
    const user = await createUser();
    const tokenHash = `hash-${randomUUID()}`;
    const values = {
      userId: user.id,
      tokenHash,
      email: user.email,
      expiresAt: new Date(Date.now() + DAY_MS),
    };
    await insertEmailVerificationToken(handle.db, values);

    const failure = await expectQueryToFail(() => insertEmailVerificationToken(handle.db, values));

    expect(failure).toEqual({
      code: "23505",
      constraint: "email_verification_tokens_token_hash_key",
    });
  });
});
