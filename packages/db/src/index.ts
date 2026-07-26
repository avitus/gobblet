export { checkDatabaseConnection, createDatabase } from "./client";
export type { Database, DatabaseHandle, DatabaseOptions } from "./client";
export type { DatabaseExecutor, Transaction } from "./executor";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate";

export {
  achievements,
  actorTypeEnum,
  colorAssignmentEnum,
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
  ratingChanges,
  ratingOutcomeEnum,
  ratings,
  userAchievements,
  userSessions,
  userStatusEnum,
  users,
} from "./schema";
export type {
  AchievementRow,
  EmailVerificationTokenRow,
  GuestSessionRow,
  MatchEventRow,
  MatchRow,
  NewAchievementRow,
  NewEmailVerificationTokenRow,
  NewGuestSessionRow,
  NewMatchEventRow,
  NewMatchRow,
  NewProfileRow,
  NewRatingChangeRow,
  NewRatingRow,
  NewUserAchievementRow,
  NewUserRow,
  NewUserSessionRow,
  ProfileRow,
  RatingChangeRow,
  RatingRow,
  UserAchievementRow,
  UserRow,
  UserSessionRow,
} from "./schema";

export {
  awardAchievements,
  listAchievementProgress,
  listEnabledAchievements,
} from "./repositories/achievements";
export type { AchievementProgressRow } from "./repositories/achievements";

export { readLeaderboardPage } from "./repositories/leaderboards";
export type {
  LeaderboardCursorRow,
  LeaderboardPage,
  LeaderboardQueryOptions,
  LeaderboardRow,
  LeaderboardWindow,
} from "./repositories/leaderboards";

export {
  countCompletedMatchesForActor,
  findMatchById,
  findUnfinishedMatchForActor,
  insertMatch,
  listCompletedMatchesForActor,
  listMatchesForActor,
  listUnfinishedMatches,
  listWinningLineIdsForActorWins,
  lockMatchForUpdate,
  reassignMatchParticipation,
  updateMatchState,
} from "./repositories/matches";
export type { CompletedMatchCounts, MatchStatePatch } from "./repositories/matches";

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
  hasRevealedAndBlockedMove,
  insertMatchEvent,
  listMatchEvents,
} from "./repositories/match-events";

export {
  findRating,
  findRatingDeltasForMatches,
  insertRatingChanges,
  listRatingChangesForMatch,
  listRatingChangesForUser,
  lockRatingsForUpdate,
  upsertRating,
} from "./repositories/ratings";
export type { RatingAggregatePatch } from "./repositories/ratings";

export {
  claimGuestSession,
  findGuestSessionById,
  findGuestSessionByTokenHash,
  insertGuestSession,
  touchGuestSession,
} from "./repositories/guest-sessions";
