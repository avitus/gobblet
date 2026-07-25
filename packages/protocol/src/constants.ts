/**
 * Closed enumerations and the socket event catalogue defined by docs/protocol.md
 * sections 6, 8, 10 and 11.
 */

export const PROTOCOL_VERSION = 1;

export const TIME_CONTROL_SECONDS = Object.freeze([180, 300, 600, 900] as const);

export const MATCH_MODES = Object.freeze(["casual", "ranked"] as const);

export const MATCH_STATUSES = Object.freeze(["queued", "active", "completed", "aborted"] as const);

export const MATCH_RESULTS = Object.freeze(["light", "dark", "draw"] as const);

export const MATCH_END_REASONS = Object.freeze([
  "line",
  "revealed-line",
  "timeout",
  "resignation",
  "repetition",
  "admin",
] as const);

export const ACTOR_TYPES = Object.freeze(["user", "guest"] as const);

export const COMMAND_REJECTION_REASONS = Object.freeze([
  "stale-version",
  "not-your-turn",
  "illegal-move",
  "match-ended",
  "not-authorized",
  "clock-expired",
  "duplicate-command",
] as const);

/** HTTP problem codes from docs/protocol.md section 10.1. */
export const HTTP_ERROR_CODES = Object.freeze([
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
  "dependency_unavailable",
] as const);

export const FATAL_ERROR_ACTIONS = Object.freeze([
  "reauthenticate",
  "update-client",
  "contact-support",
] as const);

/**
 * Mirrors `appEnvValues` in `@gobblet/config`, which protocol must not depend on
 * (docs/architecture.md section 6). A test in `@gobblet/config` fails if the two drift.
 */
export const APP_ENVIRONMENTS = Object.freeze(["local", "staging", "production"] as const);

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 24;

export const CLIENT_TO_SERVER_EVENTS = Object.freeze({
  sessionAuthenticate: "session:authenticate",
  queueJoin: "queue:join",
  queueLeave: "queue:leave",
  matchSync: "match:sync",
  matchMove: "match:move",
  matchResign: "match:resign",
  matchRematchRequest: "match:rematch-request",
  matchRematchRespond: "match:rematch-respond",
  matchPresetMessage: "match:preset-message",
  matchReaction: "match:reaction",
  matchMuteState: "match:mute-state",
  presenceHeartbeat: "presence:heartbeat",
} as const);

export const SERVER_TO_CLIENT_EVENTS = Object.freeze({
  sessionReady: "session:ready",
  queueStatus: "queue:status",
  matchFound: "match:found",
  matchSnapshot: "match:snapshot",
  matchMoveCommitted: "match:move-committed",
  matchClockSync: "match:clock-sync",
  matchEnded: "match:ended",
  matchRematchStatus: "match:rematch-status",
  matchPresetMessage: "match:preset-message",
  matchReaction: "match:reaction",
  errorRecoverable: "error:recoverable",
  errorFatal: "error:fatal",
} as const);

export type TimeControlSeconds = (typeof TIME_CONTROL_SECONDS)[number];
export type MatchMode = (typeof MATCH_MODES)[number];
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export type MatchResultOutcome = (typeof MATCH_RESULTS)[number];
export type MatchEndReason = (typeof MATCH_END_REASONS)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type CommandRejectionReason = (typeof COMMAND_REJECTION_REASONS)[number];
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];
export type FatalErrorAction = (typeof FATAL_ERROR_ACTIONS)[number];
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export type ClientToServerEventKey = keyof typeof CLIENT_TO_SERVER_EVENTS;
export type ClientToServerEventName = (typeof CLIENT_TO_SERVER_EVENTS)[ClientToServerEventKey];
export type ServerToClientEventKey = keyof typeof SERVER_TO_CLIENT_EVENTS;
export type ServerToClientEventName = (typeof SERVER_TO_CLIENT_EVENTS)[ServerToClientEventKey];

function isMemberOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isTimeControlSeconds(value: unknown): value is TimeControlSeconds {
  return typeof value === "number" && (TIME_CONTROL_SECONDS as readonly number[]).includes(value);
}

export function isMatchMode(value: unknown): value is MatchMode {
  return isMemberOf(MATCH_MODES, value);
}

export function isMatchStatus(value: unknown): value is MatchStatus {
  return isMemberOf(MATCH_STATUSES, value);
}

export function isMatchResultOutcome(value: unknown): value is MatchResultOutcome {
  return isMemberOf(MATCH_RESULTS, value);
}

export function isMatchEndReason(value: unknown): value is MatchEndReason {
  return isMemberOf(MATCH_END_REASONS, value);
}

export function isActorType(value: unknown): value is ActorType {
  return isMemberOf(ACTOR_TYPES, value);
}

export function isCommandRejectionReason(value: unknown): value is CommandRejectionReason {
  return isMemberOf(COMMAND_REJECTION_REASONS, value);
}
