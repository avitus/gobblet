/** Structural version of {@link GameState}. Bump only with a documented migration. */
export const GAME_STATE_VERSION = 1;

/** Version prefix of canonical position keys, so stored keys stay comparable. */
export const POSITION_KEY_VERSION = "gp1";

/** Number of squares per side of the board. */
export const BOARD_DIMENSION = 4;

/** Number of squares in a winning line. */
export const LINE_LENGTH = 4;

/** Number of external stacks each player starts with. */
export const RESERVE_STACKS_PER_PLAYER = 3;

/** Pieces per external stack, one of each size. */
export const PIECES_PER_RESERVE_STACK = 4;

export const PIECES_PER_PLAYER = 12;

export const TOTAL_PIECES = 24;

/**
 * Visible opponent pieces required in a line before a reserve piece may cover
 * one of them (official defensive exception, docs/rules.md section 5).
 */
export const RESERVE_GOBBLE_THREAT_COUNT = 3;

/** Occurrences of the same canonical position that end the game in a draw. */
export const REPETITION_LIMIT = 3;
