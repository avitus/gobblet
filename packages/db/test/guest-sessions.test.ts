import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  findGuestSessionById,
  findGuestSessionByTokenHash,
  insertGuestSession,
  touchGuestSession,
} from "../src/index";
import type { DatabaseHandle } from "../src/index";
import { guestFixture } from "./helpers/fixtures";
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

describe("guest sessions", () => {
  it("stores a session and finds it by token hash", async () => {
    const fixture = guestFixture("ada");
    const inserted = await insertGuestSession(handle.db, fixture);

    expect(inserted.displayName).toBe("ada");
    expect(inserted.claimedByUserId).toBeNull();

    const found = await findGuestSessionByTokenHash(handle.db, fixture.tokenHash);
    expect(found?.id).toBe(inserted.id);
    expect(await findGuestSessionById(handle.db, inserted.id)).toMatchObject({
      displayName: "ada",
    });
  });

  it("keeps token hashes unique", async () => {
    const fixture = guestFixture();
    await insertGuestSession(handle.db, fixture);

    const failure = await expectQueryToFail(() => insertGuestSession(handle.db, fixture));

    expect(failure).toEqual({ code: "23505", constraint: "guest_sessions_token_hash_key" });
  });

  it("returns nothing for an unknown token or id", async () => {
    expect(await findGuestSessionByTokenHash(handle.db, "missing")).toBeUndefined();
    expect(await findGuestSessionById(handle.db, randomUUID())).toBeUndefined();
  });

  it("records the last seen timestamp", async () => {
    const inserted = await insertGuestSession(handle.db, guestFixture());
    const seenAt = new Date(Date.now() + 5_000);

    await touchGuestSession(handle.db, inserted.id, seenAt);

    const reloaded = await findGuestSessionById(handle.db, inserted.id);
    expect(reloaded?.lastSeenAt.getTime()).toBe(seenAt.getTime());
  });
});
