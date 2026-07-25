import { STARTING_RATING } from "@gobblet/protocol";
import type { MatchMode, RatingWindow, TimeControl } from "@gobblet/protocol";
import type { Actor } from "../match/snapshot";

/**
 * The pairing rules of docs/product-spec.md section 9, as pure functions over a
 * list of waiting players. Keeping them separate from the queue means the window
 * arithmetic can be checked at exact second boundaries without any timers
 * (docs/adr/0018-in-process-matchmaking-and-rematch-offers.md).
 */

export const INITIAL_WINDOW = 100;
export const WINDOW_STEP = 50;
export const WINDOW_STEP_INTERVAL_MS = 10_000;
export const MAXIMUM_WINDOW = 400;
export const UNBOUNDED_AFTER_MS = 60_000;

export type QueueKeyFields = Readonly<{ mode: MatchMode; timeControlSeconds: TimeControl }>;

export type QueueEntry = Readonly<{
  actor: Actor;
  displayName: string;
  /** The stored rating, or `null` for a guest and for an account with no ranked result. */
  rating: number | null;
  joinedAt: number;
}>;

export type Pairing = Readonly<{
  first: QueueEntry;
  second: QueueEntry;
  /** The longer of the two waits, which is what the pair actually waited for. */
  waitedMs: number;
}>;

export function queueKeyOf(key: QueueKeyFields): string {
  return `${key.mode}:${String(key.timeControlSeconds)}`;
}

/** Guests and unrated accounts are ordered as 1200 (spec section 9.3). */
export function orderingRating(entry: QueueEntry): number {
  return entry.rating ?? STARTING_RATING;
}

/**
 * The half-width of a ranked search after a given wait: ±100, widening by 50 every
 * ten seconds to a maximum of ±400. `null` means no limit, which section 9.2
 * allows after a minute so nobody waits indefinitely.
 */
export function windowHalfWidth(waitedMs: number): number | null {
  if (waitedMs >= UNBOUNDED_AFTER_MS) {
    return null;
  }
  const steps = Math.floor(Math.max(0, waitedMs) / WINDOW_STEP_INTERVAL_MS);
  return Math.min(MAXIMUM_WINDOW, INITIAL_WINDOW + steps * WINDOW_STEP);
}

/**
 * The window a player is searching in. Casual has none: section 9.3 asks for the
 * shortest possible wait, so rating orders the candidates but never excludes one
 * (appendix P4).
 */
export function ratingWindowFor(
  mode: MatchMode,
  entry: QueueEntry,
  now: number,
): RatingWindow | null {
  if (mode === "casual") {
    return null;
  }
  const halfWidth = windowHalfWidth(now - entry.joinedAt);
  if (halfWidth === null) {
    return null;
  }
  const rating = orderingRating(entry);
  return { minimum: rating - halfWidth, maximum: rating + halfWidth };
}

function withinWindow(entry: QueueEntry, candidate: QueueEntry, mode: MatchMode, now: number) {
  const window = ratingWindowFor(mode, entry, now);
  if (!window) {
    return true;
  }
  const rating = orderingRating(candidate);
  return rating >= window.minimum && rating <= window.maximum;
}

/**
 * Both players must accept each other: a wide search cannot drag in an opponent
 * who has only just started looking, which would give the newcomer a mismatch it
 * never asked for.
 */
export function areCompatible(
  first: QueueEntry,
  second: QueueEntry,
  mode: MatchMode,
  now: number,
): boolean {
  if (first.actor.actorId === second.actor.actorId) {
    return false;
  }
  return withinWindow(first, second, mode, now) && withinWindow(second, first, mode, now);
}

/**
 * The next pair to seat, or `null` when nobody is compatible yet. The longest
 * waiting player is served first, and among its candidates the closest rating
 * wins, with the longer wait breaking a tie.
 */
export function findPairing(
  entries: readonly QueueEntry[],
  mode: MatchMode,
  now: number,
): Pairing | null {
  const waiting = [...entries].sort((a, b) => a.joinedAt - b.joinedAt);

  for (const [index, first] of waiting.entries()) {
    let best: QueueEntry | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of waiting.slice(index + 1)) {
      if (!areCompatible(first, candidate, mode, now)) {
        continue;
      }
      const distance = Math.abs(orderingRating(first) - orderingRating(candidate));
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (best) {
      return { first, second: best, waitedMs: Math.max(0, now - first.joinedAt) };
    }
  }

  return null;
}
