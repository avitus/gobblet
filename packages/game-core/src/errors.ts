import type { InvariantViolation, TransitionViolation } from "./types";

export class GameCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameCoreError";
  }
}

/** Thrown when a produced or supplied game state breaks a structural invariant. */
export class GameCoreInvariantError extends GameCoreError {
  readonly violations: readonly InvariantViolation[];

  constructor(violations: readonly InvariantViolation[]) {
    super(`Game state invariants violated: ${violations.map((v) => v.code).join(", ")}`);
    this.name = "GameCoreInvariantError";
    this.violations = violations;
  }
}

/** Thrown when a state transition breaks a turn or ply invariant. */
export class GameCoreTransitionError extends GameCoreError {
  readonly violations: readonly TransitionViolation[];

  constructor(violations: readonly TransitionViolation[]) {
    super(`Game state transition invalid: ${violations.map((v) => v.code).join(", ")}`);
    this.name = "GameCoreTransitionError";
    this.violations = violations;
  }
}

/** Thrown when serialized game state cannot be read back. */
export class GameCoreSerializationError extends GameCoreError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid serialized game state at ${path}: ${message}`);
    this.name = "GameCoreSerializationError";
    this.path = path;
  }
}
