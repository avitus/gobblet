export { checkDatabaseConnection, createDatabase } from "./client";
export type { Database, DatabaseHandle, DatabaseOptions } from "./client";
export type { DatabaseExecutor, Transaction } from "./executor";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate";

export {
  actorTypeEnum,
  guestSessions,
  matchEndReasonEnum,
  matchEventTypeEnum,
  matchEvents,
  matchModeEnum,
  matchResultEnum,
  matchStatusEnum,
  matches,
  playerSideEnum,
} from "./schema";
export type {
  GuestSessionRow,
  MatchEventRow,
  MatchRow,
  NewGuestSessionRow,
  NewMatchEventRow,
  NewMatchRow,
} from "./schema";

export {
  findMatchById,
  insertMatch,
  listMatchesForActor,
  listUnfinishedMatches,
  lockMatchForUpdate,
  updateMatchState,
} from "./repositories/matches";
export type { MatchStatePatch } from "./repositories/matches";

export {
  countMatchEvents,
  findEventByCommandId,
  insertMatchEvent,
  listMatchEvents,
} from "./repositories/match-events";

export {
  findGuestSessionById,
  findGuestSessionByTokenHash,
  insertGuestSession,
  touchGuestSession,
} from "./repositories/guest-sessions";
