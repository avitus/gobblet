import { PRESET_MESSAGE_KEYS, REACTION_KEYS } from "@gobblet/protocol";
import type {
  CommunicationRejectionReason,
  Player,
  PresetMessageKey,
  ReactionKey,
} from "@gobblet/protocol";

/**
 * The words behind the keys. The wire carries only the key
 * (docs/adr/0026-communication-is-relayed-never-stored.md), so the phrasing of
 * section 12.1 lives here, in the client that shows it.
 */
export const PRESET_MESSAGE_TEXT: Readonly<Record<PresetMessageKey, string>> = Object.freeze({
  "good-luck": "Good luck.",
  "good-game": "Good game.",
  "nice-move": "Nice move.",
  "well-played": "Well played.",
  "one-moment": "One moment.",
  thanks: "Thanks.",
  oops: "Oops.",
  rematch: "Rematch?",
});

/** Section 12.2 asks for icons without user-entered text, and names these five. */
export const REACTION_LABELS: Readonly<Record<ReactionKey, string>> = Object.freeze({
  applause: "Applause",
  surprise: "Surprise",
  thinking: "Thinking",
  smile: "Smile",
  tap: "Wooden-piece tap",
});

export const REACTION_GLYPHS: Readonly<Record<ReactionKey, string>> = Object.freeze({
  applause: "\u{1F44F}",
  surprise: "\u{1F62E}",
  thinking: "\u{1F914}",
  smile: "\u{1F642}",
  tap: "\u{1FAB5}",
});

export const PRESET_MESSAGE_ORDER: readonly PresetMessageKey[] = PRESET_MESSAGE_KEYS;
export const REACTION_ORDER: readonly ReactionKey[] = REACTION_KEYS;

export const COMMUNICATION_REFUSALS: Readonly<Record<CommunicationRejectionReason, string>> =
  Object.freeze({
    "invalid-payload": "That could not be sent",
    "not-authorized": "Sign in again to send",
    "not-participant": "Only the two players may send",
  });

/** The most recent exchanges shown at once, so the panel cannot grow without bound. */
export const COMMUNICATION_FEED_LIMIT = 4;

export type FeedItem = Readonly<{
  id: string;
  from: Player;
  /** True for the sender's own echo, which the server always delivers (ADR-0026). */
  mine: boolean;
  body:
    | Readonly<{ kind: "message"; messageKey: PresetMessageKey }>
    | Readonly<{ kind: "reaction"; reactionKey: ReactionKey }>;
}>;

/**
 * Adds one relayed item to the feed, oldest first. Communication is no part of the
 * match state and is stored nowhere, so this short list is the client's whole memory
 * of it (ADR-0026).
 */
export function appendFeedItem(feed: readonly FeedItem[], item: FeedItem): readonly FeedItem[] {
  return [...feed, item].slice(-COMMUNICATION_FEED_LIMIT);
}

/** What an item reads as, for the panel and for assistive technology. */
export function describeFeedItem(item: FeedItem): string {
  return item.body.kind === "message"
    ? PRESET_MESSAGE_TEXT[item.body.messageKey]
    : REACTION_LABELS[item.body.reactionKey];
}
