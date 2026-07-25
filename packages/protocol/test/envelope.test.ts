import { describe, expect, it } from "vitest";
import {
  commandAckSchema,
  commandEnvelopeHeaderSchema,
  commandEnvelopeMetadataSchema,
  matchMoveCommandSchema,
  matchResignCommandSchema,
  type MatchMoveCommand,
} from "../src/index";
import { COMMAND_ID, MATCH_ID, buildSnapshot } from "./helpers/fixtures";

const validMoveCommand: MatchMoveCommand = {
  commandId: COMMAND_ID,
  matchId: MATCH_ID,
  expectedVersion: 17,
  sentAtClient: 1753392000000,
  payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" } },
};

describe("matchMoveCommandSchema", () => {
  it("accepts a valid move envelope", () => {
    expect(matchMoveCommandSchema.parse(validMoveCommand)).toEqual(validMoveCommand);
  });

  it("accepts expectedVersion zero", () => {
    expect(
      matchMoveCommandSchema.safeParse({ ...validMoveCommand, expectedVersion: 0 }).success,
    ).toBe(true);
  });

  it("rejects a commandId that is not a uuid", () => {
    expect(
      matchMoveCommandSchema.safeParse({ ...validMoveCommand, commandId: "cmd-1" }).success,
    ).toBe(false);
  });

  it("rejects a negative or fractional expectedVersion", () => {
    expect(
      matchMoveCommandSchema.safeParse({ ...validMoveCommand, expectedVersion: -1 }).success,
    ).toBe(false);
    expect(
      matchMoveCommandSchema.safeParse({ ...validMoveCommand, expectedVersion: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive sentAtClient", () => {
    expect(matchMoveCommandSchema.safeParse({ ...validMoveCommand, sentAtClient: 0 }).success).toBe(
      false,
    );
  });

  it("rejects unknown fields on the envelope and inside the payload", () => {
    expect(
      matchMoveCommandSchema.safeParse({ ...validMoveCommand, clientClaimedVersion: 18 }).success,
    ).toBe(false);
    expect(
      matchMoveCommandSchema.safeParse({
        ...validMoveCommand,
        payload: { move: validMoveCommand.payload.move, hint: true },
      }).success,
    ).toBe(false);
  });

  it("rejects a missing payload", () => {
    const { payload: _payload, ...withoutPayload } = validMoveCommand;

    expect(matchMoveCommandSchema.safeParse(withoutPayload).success).toBe(false);
  });
});

describe("matchResignCommandSchema", () => {
  it("accepts an empty payload and rejects payload fields", () => {
    const resign = { ...validMoveCommand, payload: {} };

    expect(matchResignCommandSchema.parse(resign)).toEqual(resign);
    expect(
      matchResignCommandSchema.safeParse({ ...resign, payload: { confirm: true } }).success,
    ).toBe(false);
  });
});

describe("commandEnvelopeMetadataSchema", () => {
  it("validates envelope metadata without a payload", () => {
    const { payload: _payload, ...metadata } = validMoveCommand;

    expect(commandEnvelopeMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(commandEnvelopeMetadataSchema.safeParse(validMoveCommand).success).toBe(false);
  });
});

describe("commandAckSchema", () => {
  it("parses the success branch", () => {
    const ack = { ok: true, commandId: COMMAND_ID, newVersion: 18 };

    expect(commandAckSchema.parse(ack)).toEqual(ack);
  });

  it("parses the rejection branch with a snapshot", () => {
    const ack = {
      ok: false,
      commandId: COMMAND_ID,
      reason: "stale-version",
      snapshot: buildSnapshot(),
    };

    expect(commandAckSchema.parse(ack)).toEqual(ack);
  });

  it("keeps the snapshot optional", () => {
    const ack = { ok: false, commandId: COMMAND_ID, reason: "not-authorized" };

    expect(commandAckSchema.parse(ack)).toEqual(ack);
  });

  it("rejects an unknown reason code", () => {
    expect(
      commandAckSchema.safeParse({ ok: false, commandId: COMMAND_ID, reason: "server-busy" })
        .success,
    ).toBe(false);
  });

  it("rejects a rejection that carries a success field and a success that carries a reason", () => {
    expect(
      commandAckSchema.safeParse({
        ok: false,
        commandId: COMMAND_ID,
        reason: "illegal-move",
        newVersion: 18,
      }).success,
    ).toBe(false);
    expect(
      commandAckSchema.safeParse({
        ok: true,
        commandId: COMMAND_ID,
        newVersion: 18,
        reason: "illegal-move",
      }).success,
    ).toBe(false);
  });

  it("narrows on the ok discriminant", () => {
    const ack = commandAckSchema.parse({ ok: true, commandId: COMMAND_ID, newVersion: 18 });

    expect(ack.ok ? ack.newVersion : ack.reason).toBe(18);
  });
});

describe("commandEnvelopeHeaderSchema", () => {
  it("reads the metadata of a command that carries a payload", () => {
    const header = {
      commandId: COMMAND_ID,
      matchId: MATCH_ID,
      expectedVersion: 17,
      sentAtClient: 1753392003250,
    };

    expect(commandEnvelopeHeaderSchema.parse({ ...header, payload: { move: "anything" } })).toEqual(
      header,
    );
  });

  it("still requires every metadata field", () => {
    expect(
      commandEnvelopeHeaderSchema.safeParse({
        matchId: MATCH_ID,
        expectedVersion: 17,
        sentAtClient: 1753392003250,
      }).success,
    ).toBe(false);
  });
});
