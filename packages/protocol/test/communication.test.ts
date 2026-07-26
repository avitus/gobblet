import { describe, expect, it } from "vitest";
import {
  COMMUNICATION_REJECTION_REASONS,
  PRESET_MESSAGE_KEYS,
  REACTION_KEYS,
  communicationAckSchema,
  isPresetMessageKey,
  isReactionKey,
  muteStateRequestSchema,
  muteStateSchema,
  presetMessageEventSchema,
  presetMessageRequestSchema,
  reactionEventSchema,
  reactionRequestSchema,
  type PresetMessageEvent,
} from "../src/index";
import { LIGHT_ACTOR_ID, MATCH_ID } from "./helpers/fixtures";

const messageEvent: PresetMessageEvent = {
  matchId: MATCH_ID,
  from: "light",
  actorId: LIGHT_ACTOR_ID,
  sentAt: 1_784_980_800_000,
  messageKey: "good-game",
};

describe("the communication vocabulary", () => {
  it("offers the eight phrases and five reactions of section 12", () => {
    expect(PRESET_MESSAGE_KEYS).toHaveLength(8);
    expect(REACTION_KEYS).toHaveLength(5);
    expect(new Set(PRESET_MESSAGE_KEYS).size).toBe(PRESET_MESSAGE_KEYS.length);
    expect(new Set(REACTION_KEYS).size).toBe(REACTION_KEYS.length);
  });

  it("carries keys rather than words, so nothing a player typed can travel", () => {
    for (const key of [...PRESET_MESSAGE_KEYS, ...REACTION_KEYS]) {
      expect(key).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });

  it("recognises its own members and nothing else", () => {
    expect(isPresetMessageKey("good-luck")).toBe(true);
    expect(isPresetMessageKey("Good luck.")).toBe(false);
    expect(isPresetMessageKey(7)).toBe(false);
    expect(isReactionKey("tap")).toBe(true);
    expect(isReactionKey("shout")).toBe(false);
  });
});

describe("communication requests", () => {
  it("accepts a known key for a match", () => {
    expect(presetMessageRequestSchema.parse({ matchId: MATCH_ID, messageKey: "oops" })).toEqual({
      matchId: MATCH_ID,
      messageKey: "oops",
    });
    expect(reactionRequestSchema.parse({ matchId: MATCH_ID, reactionKey: "applause" })).toEqual({
      matchId: MATCH_ID,
      reactionKey: "applause",
    });
  });

  it("rejects an unknown key, free text and an unknown field", () => {
    expect(
      presetMessageRequestSchema.safeParse({ matchId: MATCH_ID, messageKey: "get-lost" }).success,
    ).toBe(false);
    expect(
      presetMessageRequestSchema.safeParse({ matchId: MATCH_ID, messageKey: "oops", text: "hi" })
        .success,
    ).toBe(false);
    expect(
      reactionRequestSchema.safeParse({ matchId: MATCH_ID, reactionKey: "smile", emoji: "x" })
        .success,
    ).toBe(false);
  });

  it("rejects a request with no match, because only a participant may send", () => {
    expect(presetMessageRequestSchema.safeParse({ messageKey: "thanks" }).success).toBe(false);
  });
});

describe("mute state", () => {
  it("carries both channels independently, as section 12.3 requires", () => {
    const state = { presetMessagesMuted: true, reactionsMuted: false };

    expect(muteStateSchema.parse(state)).toEqual(state);
    expect(muteStateRequestSchema.parse({ ...state, matchId: MATCH_ID })).toEqual({
      ...state,
      matchId: MATCH_ID,
    });
  });

  it("has no single muted flag and no sound field, because sound never travels", () => {
    expect(muteStateSchema.safeParse({ muted: true }).success).toBe(false);
    expect(
      muteStateSchema.safeParse({
        presetMessagesMuted: false,
        reactionsMuted: false,
        gameSoundMuted: true,
      }).success,
    ).toBe(false);
  });

  it("requires both channels, so a partial update cannot leave one undefined", () => {
    expect(muteStateSchema.safeParse({ presetMessagesMuted: true }).success).toBe(false);
  });
});

describe("communication events", () => {
  it("names the seat and the actor, so a client can tell its own echo apart", () => {
    expect(presetMessageEventSchema.parse(messageEvent)).toEqual(messageEvent);
    const reaction = { ...messageEvent, messageKey: undefined, reactionKey: "surprise" };
    delete (reaction as { messageKey?: unknown }).messageKey;

    expect(reactionEventSchema.parse(reaction)).toEqual(reaction);
  });

  it("rejects an event that mixes the two channels", () => {
    expect(
      reactionEventSchema.safeParse({ ...messageEvent, reactionKey: "surprise" }).success,
    ).toBe(false);
  });
});

describe("communicationAckSchema", () => {
  it("acknowledges success without a payload", () => {
    expect(communicationAckSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(communicationAckSchema.safeParse({ ok: true, delivered: 1 }).success).toBe(false);
  });

  it("refuses with one of the documented reasons only", () => {
    for (const reason of COMMUNICATION_REJECTION_REASONS) {
      expect(communicationAckSchema.parse({ ok: false, reason })).toEqual({ ok: false, reason });
    }
    expect(communicationAckSchema.safeParse({ ok: false, reason: "muted" }).success).toBe(false);
    expect(communicationAckSchema.safeParse({ ok: false }).success).toBe(false);
  });

  it("does not carry an unknown-key reason, which is a validation failure instead", () => {
    expect(COMMUNICATION_REJECTION_REASONS).not.toContain("unknown-key");
  });
});
