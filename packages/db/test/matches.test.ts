import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  checkDatabaseConnection,
  countCompletedMatchesForActor,
  findMatchById,
  findUnfinishedMatchForActor,
  insertMatch,
  listCompletedMatchesForActor,
  listMatchesForActor,
  listUnfinishedMatches,
  listWinningLineIdsForActorWins,
  lockMatchForUpdate,
  updateMatchState,
} from "../src/index";
import type { DatabaseHandle } from "../src/index";
import { matchFixture } from "./helpers/fixtures";
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

describe("match repository", () => {
  it("connects to the configured database", async () => {
    expect(await checkDatabaseConnection(handle.db)).toBe(true);
  });

  it("stores a new match as queued with full clocks", async () => {
    const inserted = await insertMatch(handle.db, matchFixture());

    expect(inserted.status).toBe("queued");
    expect(inserted.stateVersion).toBe(0);
    expect(inserted.moveCount).toBe(0);
    expect(inserted.lightRemainingMs).toBe(300_000);
    expect(inserted.turnStartedAt).toBeNull();
    expect(inserted.result).toBeNull();
    expect(inserted.endReason).toBeNull();

    const loaded = await findMatchById(handle.db, inserted.id);
    expect(loaded?.id).toBe(inserted.id);
  });

  it("returns undefined for an unknown match", async () => {
    expect(await findMatchById(handle.db, randomUUID())).toBeUndefined();
  });

  it("locks the match row inside a transaction", async () => {
    const inserted = await insertMatch(handle.db, matchFixture());

    const locked = await handle.db.transaction(async (tx) => lockMatchForUpdate(tx, inserted.id));

    expect(locked?.id).toBe(inserted.id);
    expect(
      await handle.db.transaction(async (tx) => lockMatchForUpdate(tx, randomUUID())),
    ).toBeUndefined();
  });

  it("writes state, clocks and terminal fields together", async () => {
    const inserted = await insertMatch(handle.db, matchFixture());
    const endedAt = new Date();

    const updated = await updateMatchState(handle.db, inserted.id, {
      gameState: { version: 1, ply: 4 },
      stateVersion: 4,
      activePlayer: "dark",
      lightRemainingMs: 280_000,
      darkRemainingMs: 291_000,
      turnStartedAt: null,
      lastClockCommitAt: endedAt,
      moveCount: 4,
      status: "completed",
      result: "light",
      endReason: "line",
      endedAt,
    });

    expect(updated.stateVersion).toBe(4);
    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("light");
    expect(updated.endReason).toBe("line");
    expect(updated.activePlayer).toBe("dark");
    expect(updated.endedAt?.getTime()).toBe(endedAt.getTime());
  });

  it("rejects an update for a match that does not exist", async () => {
    await expect(
      updateMatchState(handle.db, randomUUID(), {
        gameState: {},
        stateVersion: 1,
        activePlayer: "light",
        lightRemainingMs: 1,
        darkRemainingMs: 1,
        turnStartedAt: null,
        lastClockCommitAt: new Date(),
        moveCount: 1,
      }),
    ).rejects.toThrow(/found no match/);
  });

  it("lists only matches that still need the runtime", async () => {
    const queued = await insertMatch(handle.db, matchFixture());
    const active = await insertMatch(handle.db, matchFixture({ status: "active" }));
    await insertMatch(handle.db, matchFixture({ status: "completed", result: "draw" }));
    await insertMatch(handle.db, matchFixture({ status: "aborted" }));

    const unfinished = await listUnfinishedMatches(handle.db);

    expect(unfinished.map((row) => row.id).sort()).toEqual([queued.id, active.id].sort());
  });

  it("finds the one match an actor is still playing, from either seat", async () => {
    const light = randomUUID();
    const dark = randomUUID();
    const queued = await insertMatch(
      handle.db,
      matchFixture({ lightPlayerId: light, darkPlayerId: dark }),
    );

    expect(
      (await findUnfinishedMatchForActor(handle.db, { actorType: "guest", actorId: light }))?.id,
    ).toBe(queued.id);
    expect(
      (await findUnfinishedMatchForActor(handle.db, { actorType: "guest", actorId: dark }))?.id,
    ).toBe(queued.id);
  });

  it("finds nothing for an actor whose matches are all over, so matchmaking can queue them", async () => {
    const actorId = randomUUID();
    await insertMatch(
      handle.db,
      matchFixture({ lightPlayerId: actorId, status: "completed", result: "draw" }),
    );
    await insertMatch(handle.db, matchFixture({ darkPlayerId: actorId, status: "aborted" }));

    expect(
      await findUnfinishedMatchForActor(handle.db, { actorType: "guest", actorId }),
    ).toBeUndefined();
    expect(
      await findUnfinishedMatchForActor(handle.db, { actorType: "user", actorId: randomUUID() }),
    ).toBeUndefined();
  });

  it("lists matches of one actor on either side, newest first", async () => {
    const actorId = randomUUID();
    const asLight = await insertMatch(
      handle.db,
      matchFixture({ lightPlayerId: actorId, createdAt: new Date(Date.now() - 60_000) }),
    );
    const asDark = await insertMatch(handle.db, matchFixture({ darkPlayerId: actorId }));
    await insertMatch(handle.db, matchFixture());

    const rows = await listMatchesForActor(handle.db, { actorType: "guest", actorId });

    expect(rows.map((row) => row.id)).toEqual([asDark.id, asLight.id]);
  });

  it("honours the listing limit", async () => {
    const actorId = randomUUID();
    await insertMatch(handle.db, matchFixture({ lightPlayerId: actorId }));
    await insertMatch(handle.db, matchFixture({ lightPlayerId: actorId }));

    const rows = await listMatchesForActor(handle.db, { actorType: "guest", actorId }, 1);

    expect(rows).toHaveLength(1);
  });
});

describe("completion facts", () => {
  const actor = { actorType: "user" as const, actorId: randomUUID() };

  async function completed(overrides: Parameters<typeof matchFixture>[0] = {}) {
    return insertMatch(
      handle.db,
      matchFixture({
        status: "completed",
        lightPlayerType: actor.actorType,
        lightPlayerId: actor.actorId,
        ...overrides,
      }),
    );
  }

  it("records the lines that ended a match, so a win keeps its categories", async () => {
    const match = await completed();

    const updated = await updateMatchState(handle.db, match.id, {
      gameState: { version: 1, ply: 7 },
      stateVersion: 7,
      activePlayer: "dark",
      lightRemainingMs: 1000,
      darkRemainingMs: 2000,
      turnStartedAt: null,
      lastClockCommitAt: new Date(),
      moveCount: 7,
      result: "light",
      endReason: "line",
      winningLineIds: ["row-2", "diagonal-1"],
    });

    expect(updated.winningLineIds).toEqual(["row-2", "diagonal-1"]);
    expect((await findMatchById(handle.db, match.id))?.winningLineIds).toEqual([
      "row-2",
      "diagonal-1",
    ]);
  });

  it("counts completed matches in both modes and the wins among them", async () => {
    await completed({ mode: "casual", result: "light" });
    await completed({ mode: "ranked", result: "light" });
    await completed({ mode: "ranked", result: "dark" });
    await completed({ mode: "ranked", result: "draw" });
    await insertMatch(
      handle.db,
      matchFixture({
        status: "aborted",
        lightPlayerType: actor.actorType,
        lightPlayerId: actor.actorId,
      }),
    );
    await completed({ lightPlayerId: randomUUID(), result: "light" });

    expect(await countCompletedMatchesForActor(handle.db, actor)).toEqual({ played: 4, wins: 2 });
  });

  it("counts a win from either seat", async () => {
    await completed({
      lightPlayerId: randomUUID(),
      darkPlayerType: actor.actorType,
      darkPlayerId: actor.actorId,
      result: "dark",
    });

    expect(await countCompletedMatchesForActor(handle.db, actor)).toEqual({ played: 1, wins: 1 });
  });

  it("counts nothing for an actor who has finished no match", async () => {
    expect(
      await countCompletedMatchesForActor(handle.db, {
        actorType: "guest",
        actorId: randomUUID(),
      }),
    ).toEqual({ played: 0, wins: 0 });
  });

  it("collects the distinct lines an actor has won with, ignoring losses", async () => {
    await completed({ result: "light", winningLineIds: ["row-0", "column-1"] });
    await completed({ result: "light", winningLineIds: ["row-0"] });
    await completed({ result: "dark", winningLineIds: ["diagonal-0"] });
    await completed({ result: "draw" });

    expect(await listWinningLineIdsForActorWins(handle.db, actor)).toEqual(["column-1", "row-0"]);
  });

  it("lists only completed matches for a profile, newest ending first", async () => {
    const older = await completed({
      result: "light",
      endedAt: new Date("2026-07-24T10:00:00.000Z"),
    });
    const newer = await completed({
      result: "dark",
      endedAt: new Date("2026-07-25T10:00:00.000Z"),
    });
    await insertMatch(
      handle.db,
      matchFixture({
        status: "active",
        lightPlayerType: actor.actorType,
        lightPlayerId: actor.actorId,
      }),
    );

    const rows = await listCompletedMatchesForActor(handle.db, actor, 5);

    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(await listCompletedMatchesForActor(handle.db, actor, 1)).toHaveLength(1);
  });
});
