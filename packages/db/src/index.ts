export { checkDatabaseConnection, createDatabase } from "./client";
export type { Database, DatabaseHandle, DatabaseOptions } from "./client";
export type { DatabaseExecutor, Transaction } from "./executor";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate";

export {
  achievements,
  actorTypeEnum,
  auditActionEnum,
  auditLog,
  auditTargetTypeEnum,
  colorAssignmentEnum,
  connectionEventKindEnum,
  emailVerificationTokens,
  guestSessions,
  matchConnectionEvents,
  matchEndReasonEnum,
  matchEventTypeEnum,
  matchEvents,
  matchModeEnum,
  matchResultEnum,
  matchStatusEnum,
  matches,
  playerSideEnum,
  profiles,
  ratingAdjustments,
  ratingChanges,
  ratingOutcomeEnum,
  ratings,
  userAchievements,
  userRoleEnum,
  userSessions,
  userStatusEnum,
  users,
} from "./schema";
export type {
  AchievementRow,
  AuditLogRow,
  EmailVerificationTokenRow,
  GuestSessionRow,
  MatchConnectionEventRow,
  MatchEventRow,
  MatchRow,
  NewAchievementRow,
  NewAuditLogRow,
  NewEmailVerificationTokenRow,
  NewGuestSessionRow,
  NewMatchConnectionEventRow,
  NewMatchEventRow,
  NewMatchRow,
  NewProfileRow,
  NewRatingAdjustmentRow,
  NewRatingChangeRow,
  NewRatingRow,
  NewUserAchievementRow,
  NewUserRow,
  NewUserSessionRow,
  ProfileRow,
  RatingAdjustmentRow,
  RatingChangeRow,
  RatingRow,
  UserAchievementRow,
  UserRow,
  UserSessionRow,
} from "./schema";

export {
  awardAchievements,
  findAchievementByCode,
  insertAchievement,
  listAchievementProgress,
  listAchievementsForAdmin,
  listEnabledAchievements,
  updateAchievement,
} from "./repositories/achievements";
export type {
  AchievementAdminRow,
  AchievementPatch,
  AchievementProgressRow,
} from "./repositories/achievements";

export {
  countActiveActors,
  countActiveSessions,
  searchUsers,
  summariseMatches,
  summarisePairings,
} from "./repositories/admin";
export type {
  ActivitySummaryRow,
  AdminUserCursorRow,
  AdminUserRow,
  AdminUserSearchOptions,
  MatchOutcomeSummaryRow,
  PairingSummaryRow,
} from "./repositories/admin";

export {
  countAuditRecords,
  insertAuditRecord,
  listAuditRecords,
  listModerationHistory,
} from "./repositories/audit";
export type { AuditCursorRow, AuditEntryRow, AuditQueryOptions } from "./repositories/audit";

export {
  insertMatchConnectionEvent,
  listMatchConnectionEvents,
} from "./repositories/match-connections";

export {
  insertRatingAdjustment,
  listRatingAdjustmentsForUser,
  setRating,
} from "./repositories/rating-adjustments";

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
  setUserRole,
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
