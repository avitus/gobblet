/**
 * `@gobblet/protocol` is the wire contract shared by the server and every client:
 * command envelopes, acknowledgements, snapshots, event names and HTTP payloads.
 *
 * See docs/protocol.md for the prose contract. Schemas validate shapes only; rule
 * logic lives in `@gobblet/game-core` and is never duplicated here.
 */

export {
  ACTOR_TYPES,
  APP_ENVIRONMENTS,
  CLIENT_TO_SERVER_EVENTS,
  COMMAND_REJECTION_REASONS,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  EMAIL_MAX_LENGTH,
  FATAL_ERROR_ACTIONS,
  HTTP_ERROR_CODES,
  MATCH_END_REASONS,
  MATCH_MODES,
  MATCH_RESULTS,
  MATCH_STATUSES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PROTOCOL_VERSION,
  RESERVED_USERNAMES,
  SERVER_TO_CLIENT_EVENTS,
  TIME_CONTROL_SECONDS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_UNAVAILABLE_REASONS,
  USER_STATUSES,
  isActorType,
  isCommandRejectionReason,
  isMatchEndReason,
  isMatchMode,
  isMatchResultOutcome,
  isMatchStatus,
  isTimeControlSeconds,
  isUserStatus,
} from "./constants";

export type {
  ActorType,
  AppEnvironment,
  ClientToServerEventKey,
  ClientToServerEventName,
  CommandRejectionReason,
  FatalErrorAction,
  HttpErrorCode,
  MatchEndReason,
  MatchMode,
  MatchResultOutcome,
  MatchStatus,
  ServerToClientEventKey,
  ServerToClientEventName,
  TimeControlSeconds,
  UserStatus,
  UsernameUnavailableReason,
} from "./constants";

export {
  avatarUrlSchema,
  countryCodeSchema,
  emailSchema,
  isReservedUsername,
  normalizeEmail,
  normalizeUsername,
  passwordSchema,
  usernameSchema,
} from "./identity";

export type { CountryCode, Email, Username } from "./identity";

export {
  accountSchema,
  authResponseSchema,
  casualRecordSchema,
  checkUsernameRequestSchema,
  checkUsernameResponseSchema,
  claimGuestRequestSchema,
  claimGuestResponseSchema,
  emailVerificationHandoffSchema,
  issuedSessionSchema,
  meResponseSchema,
  profileSettingsSchema,
  publicProfileSchema,
  registerRequestSchema,
  signInRequestSchema,
  updateProfileRequestSchema,
  verifyEmailRequestSchema,
} from "./account";

export type {
  Account,
  AuthResponse,
  CasualRecord,
  CheckUsernameRequest,
  CheckUsernameResponse,
  ClaimGuestRequest,
  ClaimGuestResponse,
  EmailVerificationHandoff,
  IssuedSession,
  MeResponse,
  ProfileSettings,
  PublicProfile,
  RegisterRequest,
  SignInRequest,
  UpdateProfileRequest,
  VerifyEmailRequest,
} from "./account";

export {
  boardMoveSchema,
  moveSchema,
  playerSchema,
  reserveMoveSchema,
  reserveStackIndexSchema,
  serializedGameStateSchema,
  squareSchema,
} from "./game-state";

export type {
  BoardMove,
  Move,
  Player,
  ReserveMove,
  ReserveStackIndex,
  SerializedGameState,
  Square,
} from "./game-state";

export {
  displayNameSchema,
  epochMillisSchema,
  isoTimestampSchema,
  matchVersionSchema,
  remainingMillisSchema,
  uuidSchema,
} from "./primitives";

export {
  matchClocksSchema,
  matchLastMoveSchema,
  matchPlayerSchema,
  matchPlayersSchema,
  matchResultSchema,
  matchSnapshotSchema,
  movePayloadSchema,
  resignPayloadSchema,
  timeControlSecondsSchema,
} from "./match";

export type {
  MatchClocks,
  MatchLastMove,
  MatchPlayer,
  MatchPlayers,
  MatchResult,
  MatchSnapshot,
  MovePayload,
  ResignPayload,
  TimeControl,
} from "./match";

export {
  commandAckRejectionSchema,
  commandAckSchema,
  commandAckSuccessSchema,
  commandEnvelopeHeaderSchema,
  commandEnvelopeMetadataSchema,
  commandEnvelopeSchema,
  matchMoveCommandSchema,
  matchResignCommandSchema,
} from "./envelope";

export type {
  CommandAck,
  CommandAckRejection,
  CommandAckSuccess,
  CommandEnvelope,
  CommandEnvelopeMetadata,
  MatchMoveCommand,
  MatchResignCommand,
} from "./envelope";

export {
  sessionAuthenticateAckSchema,
  sessionAuthenticateSchema,
  sessionReadySchema,
} from "./session";

export type { SessionAuthenticate, SessionAuthenticateAck, SessionReady } from "./session";

export {
  fatalErrorSchema,
  matchClockSyncEventSchema,
  matchEndedEventSchema,
  matchMoveCommittedEventSchema,
  matchSnapshotEventSchema,
  matchSyncAckSchema,
  matchSyncRequestSchema,
  recoverableErrorSchema,
} from "./events";

export type {
  FatalError,
  MatchClockSyncEvent,
  MatchEndedEvent,
  MatchMoveCommittedEvent,
  MatchSnapshotEvent,
  MatchSyncAck,
  MatchSyncRequest,
  RecoverableError,
} from "./events";

export {
  createDevMatchRequestSchema,
  createDevMatchResponseSchema,
  createGuestRequestSchema,
  createGuestResponseSchema,
  devMatchParticipantSchema,
  httpErrorBodySchema,
  httpErrorDetailSchema,
  httpErrorDetails,
  matchSummarySchema,
} from "./http";

export type {
  CreateDevMatchRequest,
  CreateDevMatchResponse,
  CreateGuestRequest,
  CreateGuestResponse,
  DevMatchParticipant,
  HttpErrorBody,
  HttpErrorDetail,
  MatchSummary,
} from "./http";
