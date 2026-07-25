import type { Player, PlayerCode } from "./types";

export const PLAYERS: readonly [Player, Player] = ["light", "dark"];

export const PLAYER_CODES: Readonly<Record<Player, PlayerCode>> = {
  light: "L",
  dark: "D",
};

export const PLAYER_BY_CODE: Readonly<Record<PlayerCode, Player>> = {
  L: "light",
  D: "dark",
};

export function isPlayer(value: unknown): value is Player {
  return value === "light" || value === "dark";
}

export function otherPlayer(player: Player): Player {
  return player === "light" ? "dark" : "light";
}
