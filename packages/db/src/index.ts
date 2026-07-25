export { checkDatabaseConnection, createDatabase } from "./client";
export type { Database, DatabaseHandle, DatabaseOptions } from "./client";
export type { DatabaseExecutor, Transaction } from "./executor";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate";

export {
  actorTypeEnum,
  emailVerificationTokens,
  guestSessions,
  matchEndReasonEnum,
  matchEventTypeEnum,
  matchEvents,
  matchModeEnum,
  matchResultEnum,
  matchStatusEnum,
  matches,
  playerSideEnum,
  profiles,
  userSessions,
  userStatusEnum,
  users,
} from "./schema";
export type {
  EmailVerificationTokenRow,
  GuestSessionRow,
  MatchEventRow,
  MatchRow,
  NewEmailVerificationTokenRow,
  NewGuestSessionRow,
  NewMatchEventRow,
  NewMatchRow,
  NewProfileRow,
  NewUserRow,
  NewUserSessionRow,
  ProfileRow,
  UserRow,
  UserSessionRow,
} from "./schema";

export {
  findMatchById,
  insertMatch,
  listMatchesForActor,
  listUnfinishedMatches,
  lockMatchForUpdate,
  reassignMatchParticipation,
  updateMatchState,
} from "./repositories/matches";
export type { MatchStatePatch } from "./repositories/matches";

export {
  USERS_EMAIL_CONSTRAINT,
  USERS_USERNAME_CONSTRAINT,
  countCasualResults,
  findProfileByUserId,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  insertProfile,
  insertUser,
  markEmailVerified,
  setUserSuspension,
  touchUser,
  uniqueUserConflict,
  updateProfile,
} from "./repositories/users";
export type {
  CasualRecordRow,
  ProfilePatch,
  SuspensionPatch,
  UniqueUserField,
} from "./repositories/users";

export {
  findUserSessionByTokenHash,
  insertUserSession,
  revokeUserSession,
  revokeUserSessions,
  touchUserSession,
} from "./repositories/user-sessions";

export {
  consumeEmailVerificationToken,
  findEmailVerificationToken,
  insertEmailVerificationToken,
} from "./repositories/email-verification";

export {
  countMatchEvents,
  findEventByCommandId,
  findLatestMoveEvent,
  insertMatchEvent,
  listMatchEvents,
} from "./repositories/match-events";

export {
  claimGuestSession,
  findGuestSessionById,
  findGuestSessionByTokenHash,
  insertGuestSession,
  touchGuestSession,
} from "./repositories/guest-sessions";
