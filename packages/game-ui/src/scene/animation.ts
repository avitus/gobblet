/**
 * The animation catalogue of section 13.4 with the durations appendix P5.10
 * fixes. Reduced motion replaces every movement with one short cross-fade, and no
 * animation ever gates a state change: the snapshot applies the moment it arrives.
 */
export const ANIMATIONS = Object.freeze({
  hover: 90,
  selectionLift: 90,
  boardMove: 220,
  reserveMove: 220,
  gobbleDescent: 260,
  reveal: 260,
  winningLine: 400,
  timeout: 400,
  resignation: 400,
  matchFound: 600,
  ratingChange: 400,
} as const);

export type AnimationName = keyof typeof ANIMATIONS;

export const REDUCED_MOTION_CROSSFADE_MS = 80;

export type MotionPreference = "full" | "reduced";

/** The duration to use for an animation, given the motion the player asked for. */
export function animationDurationMs(name: AnimationName, motion: MotionPreference): number {
  return motion === "reduced" ? REDUCED_MOTION_CROSSFADE_MS : ANIMATIONS[name];
}

/**
 * Shortens an animation when the client is behind. Catching up shows the newest
 * state sooner rather than queueing what is already stale (section 13.4).
 */
export function catchUpDurationMs(
  name: AnimationName,
  motion: MotionPreference,
  queuedTransitions: number,
): number {
  const base = animationDurationMs(name, motion);
  if (queuedTransitions <= 1) {
    return base;
  }
  return queuedTransitions >= 4 ? 0 : Math.round(base / queuedTransitions);
}

/** Eases a normalised progress value; linear under reduced motion. */
export function easeProgress(progress: number, motion: MotionPreference): number {
  const clamped = Math.min(1, Math.max(0, progress));
  if (motion === "reduced") {
    return clamped;
  }
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}
