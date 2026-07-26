import type { PlayerMatchSummary, PlayerResult } from "@gobblet/protocol";

/** A summary belongs to one player, so its result is told from the seat they held. */
const OUTCOME_WORDS: Readonly<Record<PlayerResult, string>> = Object.freeze({
  win: "won",
  loss: "lost",
  draw: "draw",
});

export function describePlayerResult(match: PlayerMatchSummary): string {
  if (match.result === null || match.outcome === null) {
    return match.status;
  }
  return match.outcome === "draw"
    ? "draw"
    : `${OUTCOME_WORDS[match.outcome]} by ${match.result.reason.replace("-", " ")}`;
}

/** A rating moves only in a ranked match, so a casual summary shows no change. */
export function describeRatingDelta(delta: number | null): string {
  return delta === null ? "-" : `${delta >= 0 ? "+" : ""}${String(delta)}`;
}
