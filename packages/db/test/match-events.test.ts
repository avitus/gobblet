import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  countMatchEvents,
  findEventByCommandId,
  findLatestMoveEvent,
  hasRevealedAndBlockedMove,
  insertMatch,
  insertMatchEvent,
  listMatchEvents,
} from "../src/index";
import type { DatabaseHandle, MatchRow } from "../src/index";
import { matchFixture } from "./helpers/fixtures";
import { expectQueryToFail, setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;
let match: MatchRow;

beforeAll(async () => {
  handle = await setupTestDatabase();
  await truncateAll(handle);
  match = await insertMatch(handle.db, matchFixture());
});

afterEach(async () => {
  await truncateAll(handle);
  match = await insertMatch(handle.db, matchFixture());
});

afterAll(async () => {
  await handle.close();
});

function eventFixture(sequence: number, commandId: string | null) {
  return {
    matchId: match.id,
    sequence,
    commandId,
    type: "move" as const,
    actorType: "guest" as const,
    actorId: match.lightPlayerId,
    payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" } },
    stateHash: `hash-${String(sequence)}`,
  };
}

describe("match event log", () => {
  it("appends events in sequence order", async () => {
    await insertMatchEvent(handle.db, eventFixture(1, randomUUID()));
    await insertMatchEvent(handle.db, eventFixture(2, randomUUID()));

    const events = await listMatchEvents(handle.db, match.id);

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(await countMatchEvents(handle.db, match.id)).toBe(2);
  });

  it("rejects a duplicate sequence for the same match", async () => {
    await insertMatchEvent(handle.db, eventFixture(1, randomUUID()));

    const failure = await expectQueryToFail(() =>
      insertMatchEvent(handle.db, eventFixture(1, randomUUID())),
    );

    expect(failure).toEqual({ code: "23505", constraint: "match_events_match_sequence_key" });
  });

  it("rejects a repeated command id for the same match", async () => {
    const commandId = randomUUID();
    await insertMatchEvent(handle.db, eventFixture(1, commandId));

    const failure = await expectQueryToFail(() =>
      insertMatchEvent(handle.db, eventFixture(2, commandId)),
    );

    expect(failure).toEqual({ code: "23505", constraint: "match_events_match_command_key" });
  });

  it("allows the same command id in a different match", async () => {
    const commandId = randomUUID();
    const other = await insertMatch(handle.db, matchFixture());
    await insertMatchEvent(handle.db, eventFixture(1, commandId));

    const inserted = await insertMatchEvent(handle.db, {
      ...eventFixture(1, commandId),
      matchId: other.id,
    });

    expect(inserted.matchId).toBe(other.id);
  });

  it("allows many events without a command id", async () => {
    await insertMatchEvent(handle.db, { ...eventFixture(1, null), type: "match-created" });
    await insertMatchEvent(handle.db, { ...eventFixture(2, null), type: "timeout" });

    expect(await countMatchEvents(handle.db, match.id)).toBe(2);
  });

  it("finds the event of an already applied command", async () => {
    const commandId = randomUUID();
    await insertMatchEvent(handle.db, eventFixture(1, commandId));

    const found = await findEventByCommandId(handle.db, match.id, commandId);

    expect(found?.commandId).toBe(commandId);
    expect(await findEventByCommandId(handle.db, match.id, randomUUID())).toBeUndefined();
  });

  it("finds the move a snapshot calls the last one, ignoring events that were not moves", async () => {
    await insertMatchEvent(handle.db, eventFixture(1, randomUUID()));
    await insertMatchEvent(handle.db, eventFixture(2, randomUUID()));
    await insertMatchEvent(handle.db, { ...eventFixture(3, null), type: "timeout" });

    expect((await findLatestMoveEvent(handle.db, match.id))?.sequence).toBe(2);
  });

  it("finds no last move in a match where nobody has moved yet", async () => {
    await insertMatchEvent(handle.db, { ...eventFixture(1, null), type: "match-created" });

    expect(await findLatestMoveEvent(handle.db, match.id)).toBeUndefined();
  });

  it("counts zero events for a match without history", async () => {
    const other = await insertMatch(handle.db, matchFixture());

    expect(await countMatchEvents(handle.db, other.id)).toBe(0);
    expect(await listMatchEvents(handle.db, other.id)).toEqual([]);
  });

  it("marks no move as a reveal and block unless it was one", async () => {
    await insertMatchEvent(handle.db, eventFixture(1, randomUUID()));

    expect(await hasRevealedAndBlockedMove(handle.db, match.id, match.lightPlayerId)).toBe(false);
  });

  it("remembers a move that revealed an opponent line and blocked it, per actor", async () => {
    await insertMatchEvent(handle.db, {
      ...eventFixture(1, randomUUID()),
      actorId: match.lightPlayerId,
      revealedAndBlocked: true,
    });
    await insertMatchEvent(handle.db, {
      ...eventFixture(2, randomUUID()),
      actorId: match.darkPlayerId,
    });

    expect(await hasRevealedAndBlockedMove(handle.db, match.id, match.lightPlayerId)).toBe(true);
    expect(await hasRevealedAndBlockedMove(handle.db, match.id, match.darkPlayerId)).toBe(false);
  });

  it("does not carry the fact across matches", async () => {
    const other = await insertMatch(handle.db, matchFixture());
    await insertMatchEvent(handle.db, {
      ...eventFixture(1, randomUUID()),
      revealedAndBlocked: true,
    });

    expect(await hasRevealedAndBlockedMove(handle.db, other.id, match.lightPlayerId)).toBe(false);
  });
});
