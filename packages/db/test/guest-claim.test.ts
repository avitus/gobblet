import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  claimGuestSession,
  findGuestSessionById,
  insertGuestSession,
  insertMatch,
  insertUser,
  listMatchesForActor,
  reassignMatchParticipation,
} from "../src/index";
import type { DatabaseHandle } from "../src/index";
import { guestFixture, matchFixture, userFixture } from "./helpers/fixtures";
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

describe("claimGuestSession", () => {
  it("attaches the guest session to the account exactly once", async () => {
    const user = await insertUser(handle.db, userFixture());
    const guest = await insertGuestSession(handle.db, guestFixture());
    const claimedAt = new Date();

    expect(await claimGuestSession(handle.db, guest.id, user.id, claimedAt)).toBe(true);
    expect(await claimGuestSession(handle.db, guest.id, user.id, new Date())).toBe(false);

    const reloaded = await findGuestSessionById(handle.db, guest.id);
    expect(reloaded?.claimedByUserId).toBe(user.id);
    expect(reloaded?.claimedAt?.getTime()).toBe(claimedAt.getTime());
  });

  it("refuses a guest session that another account already claimed", async () => {
    const first = await insertUser(handle.db, userFixture());
    const second = await insertUser(handle.db, userFixture());
    const guest = await insertGuestSession(handle.db, guestFixture());
    await claimGuestSession(handle.db, guest.id, first.id, new Date());

    expect(await claimGuestSession(handle.db, guest.id, second.id, new Date())).toBe(false);
    expect((await findGuestSessionById(handle.db, guest.id))?.claimedByUserId).toBe(first.id);
  });

  it("reports false for a guest session that does not exist", async () => {
    const user = await insertUser(handle.db, userFixture());

    expect(await claimGuestSession(handle.db, randomUUID(), user.id, new Date())).toBe(false);
  });

  it("keeps the account link, and survives the account being removed", async () => {
    const user = await insertUser(handle.db, userFixture());
    const guest = await insertGuestSession(handle.db, guestFixture());
    await claimGuestSession(handle.db, guest.id, user.id, new Date());

    await handle.db.execute(`delete from users where id = '${user.id}'`);

    const reloaded = await findGuestSessionById(handle.db, guest.id);
    expect(reloaded?.claimedByUserId).toBeNull();
  });
});

describe("reassignMatchParticipation", () => {
  it("moves the guest's matches to the account on both sides of the board", async () => {
    const user = await insertUser(handle.db, userFixture());
    const guestId = randomUUID();
    const asLight = await insertMatch(
      handle.db,
      matchFixture({ lightPlayerId: guestId, lightDisplayName: "guest-7f21" }),
    );
    const asDark = await insertMatch(handle.db, matchFixture({ darkPlayerId: guestId }));
    const unrelated = await insertMatch(handle.db, matchFixture());

    const moved = await reassignMatchParticipation(
      handle.db,
      { actorType: "guest", actorId: guestId },
      { actorType: "user", actorId: user.id },
    );

    expect(moved).toBe(2);
    const owned = await listMatchesForActor(handle.db, { actorType: "user", actorId: user.id });
    expect(owned.map((row) => row.id).sort()).toEqual([asLight.id, asDark.id].sort());
    expect(
      await listMatchesForActor(handle.db, { actorType: "guest", actorId: guestId }),
    ).toHaveLength(0);
    expect(
      (
        await listMatchesForActor(handle.db, {
          actorType: "guest",
          actorId: unrelated.lightPlayerId,
        })
      ).length,
    ).toBe(1);
  });

  it("keeps the display name the opponent saw at the table", async () => {
    const user = await insertUser(handle.db, userFixture({ username: "ada" }));
    const guestId = randomUUID();
    await insertMatch(
      handle.db,
      matchFixture({ lightPlayerId: guestId, lightDisplayName: "guest-7f21" }),
    );

    await reassignMatchParticipation(
      handle.db,
      { actorType: "guest", actorId: guestId },
      { actorType: "user", actorId: user.id },
    );

    const [match] = await listMatchesForActor(handle.db, { actorType: "user", actorId: user.id });
    expect(match?.lightDisplayName).toBe("guest-7f21");
  });

  it("counts a match once when the guest somehow played both sides", async () => {
    const user = await insertUser(handle.db, userFixture());
    const guestId = randomUUID();
    await insertMatch(handle.db, matchFixture({ lightPlayerId: guestId, darkPlayerId: guestId }));

    const moved = await reassignMatchParticipation(
      handle.db,
      { actorType: "guest", actorId: guestId },
      { actorType: "user", actorId: user.id },
    );

    expect(moved).toBe(1);
  });

  it("moves nothing for a guest with no history", async () => {
    const user = await insertUser(handle.db, userFixture());

    expect(
      await reassignMatchParticipation(
        handle.db,
        { actorType: "guest", actorId: randomUUID() },
        { actorType: "user", actorId: user.id },
      ),
    ).toBe(0);
  });
});
