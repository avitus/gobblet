/**
 * `@gobblet/game-ui` renders a match: the board scene, its flat fallback, the
 * interaction layer above both, the clock display and the sound engine. It holds no
 * match state and no rule of its own; rules come from `@gobblet/game-core` and
 * state from the caller (docs/adr/0020, docs/adr/0023).
 */

export { BoardView } from "./BoardView";
export type { BoardViewProps } from "./BoardView";

export { FlatBoard } from "./flat/FlatBoard";
export type { FlatBoardProps } from "./flat/FlatBoard";

export { BoardScene } from "./scene/BoardScene";
export type { BoardSceneProps } from "./scene/BoardScene";

export { buildBoardModel, findDestination, sameOrigin } from "./interaction/board-model";
export type {
  BoardModel,
  Destination,
  Origin,
  VisibleReserveStack,
  VisibleSquare,
} from "./interaction/board-model";

export { handleBoardKey, useBoardInteraction } from "./interaction/use-board-interaction";
export type {
  BoardInteraction,
  BoardInteractionOptions,
  BoardKeyboardEvent,
} from "./interaction/use-board-interaction";

export {
  ANIMATIONS,
  REDUCED_MOTION_CROSSFADE_MS,
  animationDurationMs,
  catchUpDurationMs,
  easeProgress,
} from "./scene/animation";
export type { AnimationName, MotionPreference } from "./scene/animation";

export {
  CAMERA_AZIMUTH_LIMIT_DEGREES,
  CAMERA_BASE_DISTANCE,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_POLAR_DEGREES,
  DEFAULT_ORBIT,
  clampOrbit,
  nudgeOrbit,
  placeCamera,
} from "./scene/camera";
export type { CameraOrbit, CameraPlacement } from "./scene/camera";

export { describeScene } from "./scene/description";
export type { PieceNode, SceneDescription, SquareNode } from "./scene/description";

export {
  BOARD_THICKNESS,
  PIECE_DIMENSIONS,
  SELECTION_LIFT,
  SQUARE_PITCH,
  lift,
  reservePosition,
  squarePosition,
} from "./scene/layout";
export type { Vector3 } from "./scene/layout";

export { LOW_TIME_THRESHOLD_MS, displayedClocks, formatClock, isLowTime } from "./clock";
export type { ClockReading, DisplayedClocks } from "./clock";

export { useClockDisplay } from "./use-clock-display";
export type { ClockDisplayInput, ClockDisplayOptions } from "./use-clock-display";

export { SILENT_ENGINE, SOUND_CUES, createSoundEngine } from "./sound/engine";
export type {
  AudioContextLike,
  SoundChannel,
  SoundCue,
  SoundEngine,
  SoundEngineOptions,
  SoundSettings,
} from "./sound/engine";

export {
  RENDER_TIERS,
  UNKNOWN_CAPABILITIES,
  detectCapabilities,
  downgradeTier,
  resolveTier,
  tierSettings,
} from "./tier";
export type { Capabilities, RenderTier, RenderTierPreference, TierSettings } from "./tier";
