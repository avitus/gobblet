import { describe, expect, it } from "vitest";
import { opponentOf, seatOf } from "../src/match/seat";
import { DARK_ACTOR_ID, LIGHT_ACTOR_ID, makeSnapshot } from "./helpers/match";

describe("the seat of a connection", () => {
  it("reads the seat from the snapshot rather than from the announcement", () => {
    const snapshot = makeSnapshot();

    expect(seatOf(snapshot, LIGHT_ACTOR_ID)).toBe("light");
    expect(seatOf(snapshot, DARK_ACTOR_ID)).toBe("dark");
  });

  it("seats an onlooker nowhere", () => {
    expect(seatOf(makeSnapshot(), "44444444-4444-4444-8444-444444444444")).toBeNull();
    expect(seatOf(makeSnapshot(), null)).toBeNull();
    expect(seatOf(null, LIGHT_ACTOR_ID)).toBeNull();
  });

  it("names the other side", () => {
    expect(opponentOf("light")).toBe("dark");
    expect(opponentOf("dark")).toBe("light");
  });
});
