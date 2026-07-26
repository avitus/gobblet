import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  insertMatch,
  insertMatchConnectionEvent,
  listMatchConnectionEvents,
  matches,
} from "../src/index";
import type { DatabaseHandle, MatchRow } from "../src/index";
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

async function createMatch(): Promise<MatchRow> {
  return insertMatch(handle.db, matchFixture({ status: "active" }));
}

describe("the connection history of a match", () => {
  it("reads in the order it happened", async () => {
    const match = await createMatch();
    const actorId = match.lightPlayerId;

    await insertMatchConnectionEvent(handle.db, {
      matchId: match.id,
      kind: "attached",
      actorType: "guest",
      actorId,
      socketId: "socket-a",
    });
    await insertMatchConnectionEvent(handle.db, {
      matchId: match.id,
      kind: "detached",
      actorType: "guest",
      actorId,
      socketId: "socket-a",
      reason: "transport close",
    });
    await insertMatchConnectionEvent(handle.db, {
      matchId: match.id,
      kind: "attached",
      actorType: "guest",
      actorId,
      socketId: "socket-b",
    });

    const history = await listMatchConnectionEvents(handle.db, match.id);
    expect(history.map((event) => [event.kind, event.socketId, event.reason])).toEqual([
      ["attached", "socket-a", null],
      ["detached", "socket-a", "transport close"],
      ["attached", "socket-b", null],
    ]);
  });

  it("belongs to one match only", async () => {
    const one = await createMatch();
    const other = await createMatch();
    await insertMatchConnectionEvent(handle.db, {
      matchId: one.id,
      kind: "attached",
      actorType: "guest",
      actorId: one.lightPlayerId,
      socketId: "socket-a",
    });

    expect(await listMatchConnectionEvents(handle.db, other.id)).toEqual([]);
  });

  it("goes away with the match it describes", async () => {
    const match = await createMatch();
    await insertMatchConnectionEvent(handle.db, {
      matchId: match.id,
      kind: "attached",
      actorType: "guest",
      actorId: match.lightPlayerId,
      socketId: "socket-a",
    });

    await handle.db.delete(matches).where(eq(matches.id, match.id));

    expect(await listMatchConnectionEvents(handle.db, match.id)).toEqual([]);
  });

  it("refuses an event for a match that does not exist", async () => {
    await expect(
      insertMatchConnectionEvent(handle.db, {
        matchId: randomUUID(),
        kind: "attached",
        actorType: "guest",
        actorId: randomUUID(),
        socketId: "socket-a",
      }),
    ).rejects.toThrow();
  });
});
