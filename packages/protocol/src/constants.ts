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

/** Account status from docs/product-spec.md section 15.1. */
export const USER_STATUSES = Object.freeze(["active", "suspended", "deleted"] as const);

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Why a requested username cannot be used, for `POST /v1/usernames/check`. */
export const USERNAME_UNAVAILABLE_REASONS = Object.freeze([
  "invalid",
  "reserved",
  "taken",
] as const);

/**
 * Names that must not become a player identity because they read as authority or
 * as a system surface.
 */
export const RESERVED_USERNAMES: readonly string[] = Object.freeze([
  "admin",
  "administrator",
  "api",
  "gobblet",
  "guest",
  "help",
  "me",
  "mod",
  "moderator",
  "official",
  "owner",
  "root",
  "staff",
  "support",
  "system",
  "unknown",
]);

/** Why a `queue:join` or `queue:leave` was refused (docs/protocol.md section 8.1). */
export const QUEUE_REJECTION_REASONS = Object.freeze([
  "not-authorized",
  "ineligible",
  "already-in-match",
  "not-queued",
  "queue-closed",
] as const);

/** The lifecycle of a rematch offer (docs/product-spec.md section 4.5). */
export const REMATCH_STATES = Object.freeze([
  "offered",
  "accepted",
  "declined",
  "expired",
  "cancelled",
] as const);

export const REMATCH_REJECTION_REASONS = Object.freeze([
  "not-authorized",
  "not-participant",
  "match-not-ended",
  "already-offered",
  "no-offer",
  "opponent-gone",
  "ineligible",
] as const);

/**
 * The eight phrases of docs/product-spec.md section 12.1. The wire carries the key
 * and the client owns the words, so a phrase can be translated without a server
 * change and nothing a player types can ever reach an opponent.
 */
export const PRESET_MESSAGE_KEYS = Object.freeze([
  "good-luck",
  "good-game",
  "nice-move",
  "well-played",
  "one-moment",
  "thanks",
  "oops",
  "rematch",
] as const);

/** The five reactions of section 12.2; `tap` is the wooden-piece tap. */
export const REACTION_KEYS = Object.freeze([
  "applause",
  "surprise",
  "thinking",
  "smile",
  "tap",
] as const);

/**
 * Why a message, a reaction or a mute change was refused. An unknown key is a
 * validation failure, which is also reported on `error:recoverable`
 * (docs/adr/0026-communication-is-relayed-never-stored.md, appendix P6.4).
 */
export const COMMUNICATION_REJECTION_REASONS = Object.freeze([
  "invalid-payload",
  "not-authorized",
  "not-participant",
] as const);

/** The achievements of section 11.4, in the order a profile lists them. */
export const ACHIEVEMENT_CODES = Object.freeze([
  "first-victory",
  "getting-started",
  "contender",
  "on-a-roll",
  "century-club",
  "time-keeper",
  "uncovered",
  "four-ways",
] as const);

/**
 * A badge is a tier the client renders from design tokens rather than an image
 * (appendix P6.8), and it is what section 15.7's `badge_asset` column holds.
 */
export const ACHIEVEMENT_BADGE_TIERS = Object.freeze(["bronze", "silver", "gold"] as const);

/**
 * Stored with every award so a later rule change can be told from the original
 * evaluation (section 15.7).
 */
export const ACHIEVEMENT_RULE_VERSION = 1;

/** The four boards of section 11.3. */
export const LEADERBOARD_PERIODS = Object.freeze([
  "daily",
  "weekly",
  "monthly",
  "all-time",
] as const);

/** Section 11.3: the first page is the top hundred, and no page may exceed it. */
export const LEADERBOARD_PAGE_SIZE = 100;

/** How many recent matches a public profile shows (appendix P6.12). */
export const PROFILE_RECENT_MATCH_COUNT = 5;

/**
 * What an account may do beyond playing. An administrator is an ordinary account
 * carrying the `admin` role, not a second kind of credential
 * (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */
export const USER_ROLES = Object.freeze(["player", "admin"] as const);

/** Every administrative mutation, as the audit log names it (section 14.4). */
export const AUDIT_ACTIONS = Object.freeze([
  "user-suspended",
  "user-unsuspended",
  "rating-adjusted",
  "achievement-created",
  "achievement-updated",
  "role-granted",
  "release-published",
  "release-paused",
  "release-resumed",
  "release-promoted",
] as const);

export const AUDIT_TARGET_TYPES = Object.freeze(["user", "achievement", "release"] as const);

/** Section 16 pages the administrative lists; a page may not exceed this. */
export const ADMIN_PAGE_SIZE = 50;

/**
 * The events of section 17.1. The list is closed, so a property bag can never
 * carry the free-form data that section forbids
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */
export const ANALYTICS_EVENT_NAMES = Object.freeze([
  "app-launched",
  "render-tier-selected",
  "setting-changed",
  "guest-created",
  "sign-up-completed",
  "signed-in",
  "queue-joined",
  "match-found",
  "match-started",
  "match-completed",
  "rematch-requested",
  "rematch-accepted",
  "desktop-update-completed",
] as const);

/**
 * The subset a browser may report about itself. Everything else is a server fact,
 * so a client cannot announce a match it did not finish.
 */
export const CLIENT_ANALYTICS_EVENT_NAMES = Object.freeze([
  "app-launched",
  "render-tier-selected",
  "setting-changed",
  "desktop-update-completed",
] as const);

/** Where a client runs, for the desktop adoption figures of section 17.3. */
export const CLIENT_PLATFORMS = Object.freeze(["web", "desktop"] as const);

/** Section 17.1 tracks the authentication method; this product has one (ADR-0017). */
export const AUTH_METHODS = Object.freeze(["password"] as const);

/**
 * Mirrors the render tiers of `@gobblet/game-ui`, which protocol must not depend on
 * (docs/architecture.md section 6). A test in the client fails if the two drift.
 */
export const CLIENT_RENDER_TIERS = Object.freeze(["full", "reduced", "flat"] as const);

/** The settings a change may be reported for, from the settings screen of Phase 5. */
export const CLIENT_SETTING_NAMES = Object.freeze([
  "render-tier",
  "sound-muted",
  "reduced-motion",
  "preset-messages-muted",
  "reactions-muted",
] as const);

/** How a client learned about a rendering tier: from detection or from a choice. */
export const RENDER_TIER_SOURCES = Object.freeze(["detected", "chosen"] as const);

/** Whether a desktop update finished (Phase 8 emits these; the schema exists now). */
export const UPDATE_OUTCOMES = Object.freeze(["success", "failure"] as const);

/**
 * The release channels of section 22.3: stable is what a download page offers, beta
 * is the staged channel a release is proved in before it is promoted
 * (docs/adr/0034-updates-are-asked-of-our-own-server.md).
 */
export const RELEASE_CHANNELS = Object.freeze(["stable", "beta"] as const);

/**
 * The platforms a desktop artifact is built for, spelled the way Tauri's updater
 * asks for them, so the manifest is a translation of rows and not of names.
 */
export const UPDATE_TARGETS = Object.freeze([
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
] as const);

/** The steps of a desktop release, in the order the workflow runs them. */
export const RELEASE_BUILD_STEPS = Object.freeze([
  "bundle",
  "sign",
  "notarize",
  "publish",
] as const);

/** How a release step ended. A failure of `sign` or `notarize` is a paging alert. */
export const BUILD_OUTCOMES = Object.freeze(["succeeded", "failed"] as const);

/** Section 5.4 limits: notes are shown to a player, so they are bounded. */
export const RELEASE_NOTES_MAX_LENGTH = 4000;

/** Section 17.1 payload limits: a page may batch, but not without bound. */
export const TELEMETRY_BATCH_MAX = 20;
export const TELEMETRY_MESSAGE_MAX_LENGTH = 300;
export const TELEMETRY_STACK_MAX_LENGTH = 4000;

/** How the colours of a match were decided (docs/product-spec.md section 9.4). */
export const COLOR_ASSIGNMENTS = Object.freeze(["random", "alternated"] as const);

/** How long a rematch offer stands before it expires (docs/product-spec.md section 4.5). */
export const REMATCH_OFFER_MS = 30_000;

/** A player's result in a rated match, as stored in the rating audit. */
export const RATING_OUTCOMES = Object.freeze(["win", "loss", "draw"] as const);

/** How a match summary reads to one of its participants (spec section 11.2). */
export const PLAYER_RESULTS = Object.freeze(["win", "loss", "draw"] as const);

/**
 * Elo parameters fixed by docs/product-spec.md sections 2.6 and 10. They live here
 * because the rating audit stores the formula version alongside every change, and a
 * client may need to explain a delta it is shown.
 */
export const STARTING_RATING = 1200;
export const ELO_K_FACTOR = 32;
export const RATING_FORMULA_VERSION = 1;
export const MINIMUM_RATING = 0;

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
export type UserStatus = (typeof USER_STATUSES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type ClientAnalyticsEventName = (typeof CLIENT_ANALYTICS_EVENT_NAMES)[number];
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];
export type AuthMethod = (typeof AUTH_METHODS)[number];
export type ClientRenderTier = (typeof CLIENT_RENDER_TIERS)[number];
export type ClientSettingName = (typeof CLIENT_SETTING_NAMES)[number];
export type RenderTierSource = (typeof RENDER_TIER_SOURCES)[number];
export type UpdateOutcome = (typeof UPDATE_OUTCOMES)[number];
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
export type UpdateTarget = (typeof UPDATE_TARGETS)[number];
export type ReleaseBuildStep = (typeof RELEASE_BUILD_STEPS)[number];
export type BuildOutcome = (typeof BUILD_OUTCOMES)[number];
export type UsernameUnavailableReason = (typeof USERNAME_UNAVAILABLE_REASONS)[number];
export type QueueRejectionReason = (typeof QUEUE_REJECTION_REASONS)[number];
export type RematchState = (typeof REMATCH_STATES)[number];
export type RematchRejectionReason = (typeof REMATCH_REJECTION_REASONS)[number];
export type PresetMessageKey = (typeof PRESET_MESSAGE_KEYS)[number];
export type ReactionKey = (typeof REACTION_KEYS)[number];
export type CommunicationRejectionReason = (typeof COMMUNICATION_REJECTION_REASONS)[number];
export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number];
export type AchievementBadgeTier = (typeof ACHIEVEMENT_BADGE_TIERS)[number];
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];
export type ColorAssignment = (typeof COLOR_ASSIGNMENTS)[number];
export type RatingOutcome = (typeof RATING_OUTCOMES)[number];
export type PlayerResult = (typeof PLAYER_RESULTS)[number];
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

export function isUserStatus(value: unknown): value is UserStatus {
  return isMemberOf(USER_STATUSES, value);
}

export function isUserRole(value: unknown): value is UserRole {
  return isMemberOf(USER_ROLES, value);
}

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return isMemberOf(ANALYTICS_EVENT_NAMES, value);
}

export function isCommandRejectionReason(value: unknown): value is CommandRejectionReason {
  return isMemberOf(COMMAND_REJECTION_REASONS, value);
}

export function isRematchState(value: unknown): value is RematchState {
  return isMemberOf(REMATCH_STATES, value);
}

export function isColorAssignment(value: unknown): value is ColorAssignment {
  return isMemberOf(COLOR_ASSIGNMENTS, value);
}

export function isPresetMessageKey(value: unknown): value is PresetMessageKey {
  return isMemberOf(PRESET_MESSAGE_KEYS, value);
}

export function isReactionKey(value: unknown): value is ReactionKey {
  return isMemberOf(REACTION_KEYS, value);
}

export function isAchievementCode(value: unknown): value is AchievementCode {
  return isMemberOf(ACHIEVEMENT_CODES, value);
}

export function isLeaderboardPeriod(value: unknown): value is LeaderboardPeriod {
  return isMemberOf(LEADERBOARD_PERIODS, value);
}
