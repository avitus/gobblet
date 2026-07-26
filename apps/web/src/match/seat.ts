import type { MatchSnapshot, Player } from "@gobblet/protocol";

/**
 * Which side the connection plays, decided from the snapshot rather than from the
 * `match:found` announcement, so a reload or a direct link finds the same seat. An
 * onlooker gets `null`, and the board then offers no input.
 */
export function seatOf(snapshot: MatchSnapshot | null, actorId: string | null): Player | null {
  if (snapshot === null || actorId === null) {
    return null;
  }
  if (snapshot.players.light.actorId === actorId) {
    return "light";
  }
  return snapshot.players.dark.actorId === actorId ? "dark" : null;
}

export function opponentOf(seat: Player): Player {
  return seat === "light" ? "dark" : "light";
}
