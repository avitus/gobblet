import { createInitialGame, toSerializableGameState } from "@gobblet/game-core";
import { describe, expect, it } from "vitest";
import { matchSnapshotSchema } from "../src/index";
import { buildSnapshot } from "./helpers/fixtures";

describe("matchSnapshotSchema", () => {
  it("accepts a snapshot carrying an initial engine state", () => {
    const snapshot = buildSnapshot();

    expect(matchSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("accepts a completed snapshot with a result and a last move", () => {
    const snapshot = buildSnapshot({
      status: "completed",
      state: toSerializableGameState(createInitialGame("dark")),
      activePlayer: "dark",
      result: { outcome: "light", reason: "line" },
      lastMove: { move: { kind: "board", from: "r0c0", to: "r0c1" }, version: 18 },
      clocks: {
        lightRemainingMs: 0,
        darkRemainingMs: 187500,
        turnStartedAt: null,
        serverTime: 1753392003250,
      },
    });

    expect(matchSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("rejects a snapshot whose state is empty", () => {
    expect(matchSnapshotSchema.safeParse({ ...buildSnapshot(), state: {} }).success).toBe(false);
  });

  it("rejects a snapshot with no state at all", () => {
    const { state: _state, ...withoutState } = buildSnapshot();

    expect(matchSnapshotSchema.safeParse(withoutState).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(
      matchSnapshotSchema.safeParse({ ...buildSnapshot(), status: "in_progress" }).success,
    ).toBe(false);
  });

  it("rejects an unsupported time control", () => {
    expect(
      matchSnapshotSchema.safeParse({ ...buildSnapshot(), timeControlSeconds: 60 }).success,
    ).toBe(false);
    expect(
      matchSnapshotSchema.safeParse({ ...buildSnapshot(), timeControlSeconds: 5 }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(matchSnapshotSchema.safeParse({ ...buildSnapshot(), ratingChange: 8 }).success).toBe(
      false,
    );
  });

  it("rejects a guest rating that is not null or an integer", () => {
    const snapshot = buildSnapshot();

    expect(
      matchSnapshotSchema.safeParse({
        ...snapshot,
        players: { ...snapshot.players, light: { ...snapshot.players.light, rating: 1243.5 } },
      }).success,
    ).toBe(false);
  });

  it("rejects a negative remaining clock", () => {
    const snapshot = buildSnapshot();

    expect(
      matchSnapshotSchema.safeParse({
        ...snapshot,
        clocks: { ...snapshot.clocks, lightRemainingMs: -1 },
      }).success,
    ).toBe(false);
  });
});
