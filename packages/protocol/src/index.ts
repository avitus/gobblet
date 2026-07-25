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
  FATAL_ERROR_ACTIONS,
  MATCH_END_REASONS,
  MATCH_MODES,
  MATCH_RESULTS,
  MATCH_STATUSES,
  PROTOCOL_VERSION,
  SERVER_TO_CLIENT_EVENTS,
  TIME_CONTROL_SECONDS,
  isActorType,
  isCommandRejectionReason,
  isMatchEndReason,
  isMatchMode,
  isMatchResultOutcome,
  isMatchStatus,
  isTimeControlSeconds,
} from "./constants";

export type {
  ActorType,
  AppEnvironment,
  ClientToServerEventKey,
  ClientToServerEventName,
  CommandRejectionReason,
  FatalErrorAction,
  MatchEndReason,
  MatchMode,
  MatchResultOutcome,
  MatchStatus,
  ServerToClientEventKey,
  ServerToClientEventName,
  TimeControlSeconds,
} from "./constants";

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

export { sessionAuthenticateSchema, sessionReadySchema } from "./session";

export type { SessionAuthenticate, SessionReady } from "./session";

export {
  fatalErrorSchema,
  matchClockSyncEventSchema,
  matchEndedEventSchema,
  matchMoveCommittedEventSchema,
  matchSnapshotEventSchema,
  matchSyncRequestSchema,
  recoverableErrorSchema,
} from "./events";

export type {
  FatalError,
  MatchClockSyncEvent,
  MatchEndedEvent,
  MatchMoveCommittedEvent,
  MatchSnapshotEvent,
  MatchSyncRequest,
  RecoverableError,
} from "./events";

export {
  createDevMatchRequestSchema,
  createDevMatchResponseSchema,
  createGuestRequestSchema,
  createGuestResponseSchema,
  devMatchParticipantSchema,
  matchSummarySchema,
} from "./http";

export type {
  CreateDevMatchRequest,
  CreateDevMatchResponse,
  CreateGuestRequest,
  CreateGuestResponse,
  DevMatchParticipant,
  MatchSummary,
} from "./http";
