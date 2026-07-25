import { describe, expect, it } from "vitest";
import {
  ACTOR_TYPES,
  CLIENT_TO_SERVER_EVENTS,
  COMMAND_REJECTION_REASONS,
  MATCH_END_REASONS,
  MATCH_RESULTS,
  MATCH_STATUSES,
  PROTOCOL_VERSION,
  SERVER_TO_CLIENT_EVENTS,
  TIME_CONTROL_SECONDS,
  isActorType,
  isCommandRejectionReason,
  isMatchEndReason,
  isMatchMode,
  isMatchResultOutcome,
  isMatchStatus,
  isTimeControlSeconds,
} from "../src/index";

describe("event catalogue", () => {
  it("carries every documented client to server event name", () => {
    expect(Object.values(CLIENT_TO_SERVER_EVENTS)).toEqual([
      "session:authenticate",
      "queue:join",
      "queue:leave",
      "match:sync",
      "match:move",
      "match:resign",
      "match:rematch-request",
      "match:rematch-respond",
      "match:preset-message",
      "match:reaction",
      "match:mute-state",
      "presence:heartbeat",
    ]);
  });

  it("carries every documented server to client event name", () => {
    expect(Object.values(SERVER_TO_CLIENT_EVENTS)).toEqual([
      "session:ready",
      "queue:status",
      "match:found",
      "match:snapshot",
      "match:move-committed",
      "match:clock-sync",
      "match:ended",
      "match:rematch-status",
      "match:preset-message",
      "match:reaction",
      "error:recoverable",
      "error:fatal",
    ]);
  });

  it("is frozen so a consumer cannot rewrite an event name", () => {
    expect(Object.isFrozen(CLIENT_TO_SERVER_EVENTS)).toBe(true);
    expect(Object.isFrozen(SERVER_TO_CLIENT_EVENTS)).toBe(true);
    expect(Object.isFrozen(COMMAND_REJECTION_REASONS)).toBe(true);
    expect(Object.isFrozen(TIME_CONTROL_SECONDS)).toBe(true);
  });
});

describe("enumerations", () => {
  it("exposes the documented members", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(TIME_CONTROL_SECONDS).toEqual([180, 300, 600, 900]);
    expect(MATCH_STATUSES).toEqual(["queued", "active", "completed", "aborted"]);
    expect(MATCH_RESULTS).toEqual(["light", "dark", "draw"]);
    expect(MATCH_END_REASONS).toEqual([
      "line",
      "revealed-line",
      "timeout",
      "resignation",
      "repetition",
      "admin",
    ]);
    expect(ACTOR_TYPES).toEqual(["user", "guest"]);
    expect(COMMAND_REJECTION_REASONS).toEqual([
      "stale-version",
      "not-your-turn",
      "illegal-move",
      "match-ended",
      "not-authorized",
      "clock-expired",
      "duplicate-command",
    ]);
  });
});

describe("guards", () => {
  it("accepts members and rejects anything else", () => {
    expect(isTimeControlSeconds(300)).toBe(true);
    expect(isTimeControlSeconds(60)).toBe(false);
    expect(isTimeControlSeconds("300")).toBe(false);
    expect(isMatchMode("ranked")).toBe(true);
    expect(isMatchMode("blitz")).toBe(false);
    expect(isMatchStatus("active")).toBe(true);
    expect(isMatchStatus("in_progress")).toBe(false);
    expect(isMatchResultOutcome("draw")).toBe(true);
    expect(isMatchResultOutcome("stalemate")).toBe(false);
    expect(isMatchEndReason("revealed-line")).toBe(true);
    expect(isMatchEndReason("agreement")).toBe(false);
    expect(isActorType("guest")).toBe(true);
    expect(isActorType("admin")).toBe(false);
    expect(isCommandRejectionReason("duplicate-command")).toBe(true);
    expect(isCommandRejectionReason("server-busy")).toBe(false);
    expect(isCommandRejectionReason(undefined)).toBe(false);
  });
});
