import { expect, type Browser, type Page } from "@playwright/test";
import {
  openContext,
  startAccount,
  startGuest,
  type ContextOptions,
  type Credentials,
  type Player,
} from "./session";

export type Seat = "light" | "dark";

export type Seated = Player & Readonly<{ seat: Seat; displayName: string }>;

export type PairedMatch = Readonly<{
  matchId: string;
  light: Seated;
  dark: Seated;
  pages: readonly Page[];
  close: () => Promise<void>;
}>;

/** A move as a player performs it: lift something, then choose a square. */
export type ScriptedMove = Readonly<
  { seat: Seat; to: string } & ({ reserveStack: 0 | 1 | 2 } | { from: string })
>;

function pieceOrigin(move: ScriptedMove): string {
  return "from" in move
    ? `square-${move.from}`
    : `reserve-${move.seat}-${String(move.reserveStack)}`;
}

/**
 * Two guests queue for the same casual clock and are paired by the server. Which
 * colour each context receives is the server's choice, so the seats are read back
 * from the match screen rather than assumed.
 */
export async function pairGuests(
  browser: Browser,
  names: readonly [string, string],
  options: ContextOptions = {},
): Promise<PairedMatch> {
  const players = await Promise.all([openContext(browser, options), openContext(browser, options)]);

  await Promise.all(
    players.map((player, index) => startGuest(player.page, names[index] ?? "guest")),
  );

  return queueTogether(players, names, "casual");
}

/**
 * Two verified accounts queue for the same ranked clock. Only an account may play a
 * ranked match, which is what rates it, boards it and can earn a badge (section 11).
 */
export async function pairAccounts(
  browser: Browser,
  accounts: readonly [Credentials, Credentials],
  options: ContextOptions = {},
): Promise<PairedMatch> {
  const players = await Promise.all([openContext(browser, options), openContext(browser, options)]);

  for (const [index, player] of players.entries()) {
    // One registration at a time: a username is claimed by whoever asks first.
    await startAccount(player.page, accounts[index] ?? accounts[0]);
  }

  return queueTogether(
    players,
    accounts.map((account) => account.username),
    "ranked",
  );
}

async function queueTogether(
  players: readonly Player[],
  names: readonly string[],
  mode: "casual" | "ranked",
): Promise<PairedMatch> {
  for (const player of players) {
    await player.page.getByRole("link", { name: "Play" }).click();
    // Asserted before it is used: an unactionable control would otherwise be
    // waited on until the whole specification times out, with nothing to read.
    await expect(player.page.getByTestId("mode")).toBeEnabled();
    await player.page.getByTestId("mode").selectOption(mode);
    await expect(player.page.getByTestId("join-queue")).toBeEnabled();
  }
  for (const player of players) {
    await player.page.getByTestId("join-queue").click();
  }

  await Promise.all(players.map((player) => player.page.waitForURL(/\/match\/[0-9a-f-]+$/)));
  await Promise.all(
    players.map((player) => expect(player.page.getByTestId("match-screen")).toBeVisible()),
  );

  const seats = await Promise.all(players.map((player) => seatOf(player.page)));
  const seated: Seated[] = players.map((player, index) => ({
    ...player,
    seat: seats[index] ?? "light",
    displayName: names[index] ?? "guest",
  }));

  const light = seated.find((player) => player.seat === "light");
  const dark = seated.find((player) => player.seat === "dark");
  if (light === undefined || dark === undefined) {
    throw new Error(`The server seated both contexts as ${seats.join(" and ")}`);
  }

  const matchId = new URL(light.page.url()).pathname.split("/").pop() ?? "";
  expect(matchId).not.toBe("");
  expect(new URL(dark.page.url()).pathname).toContain(matchId);

  return {
    matchId,
    light,
    dark,
    pages: [light.page, dark.page],
    close: async (): Promise<void> => {
      await Promise.all(seated.map((player) => player.context.close()));
    },
  };
}

/** The seat a context holds, taken from the panel the client marks as the player's. */
async function seatOf(page: Page): Promise<Seat> {
  const light = page.getByTestId("player-light");
  await expect(light).toBeVisible();
  return (await light.getByText("you", { exact: true }).count()) > 0 ? "light" : "dark";
}

/**
 * Performs one move and waits until both clients show the server's answer, which is
 * the only state the client trusts (docs/adr/0020). No test ever sleeps.
 */
export async function play(match: PairedMatch, move: ScriptedMove): Promise<void> {
  const mover = move.seat === "light" ? match.light : match.dark;

  await mover.page.getByTestId(pieceOrigin(move)).click();
  await mover.page.getByTestId(`square-${move.to}`).click();

  for (const page of match.pages) {
    await expect(page.getByTestId(`square-${move.to}`)).toHaveAttribute("data-owner", move.seat);
  }
}

export async function playScript(
  match: PairedMatch,
  script: readonly ScriptedMove[],
): Promise<void> {
  for (const move of script) {
    await play(match, move);
  }
}

/**
 * Light takes row zero from the reserve while dark builds row three, so light wins by
 * a line on the seventh move. The shortest complete match the rules allow.
 */
export const LIGHT_WINS_ROW_ZERO: readonly ScriptedMove[] = Object.freeze([
  { seat: "light", reserveStack: 0, to: "r0c0" },
  { seat: "dark", reserveStack: 0, to: "r3c0" },
  { seat: "light", reserveStack: 1, to: "r0c1" },
  { seat: "dark", reserveStack: 1, to: "r3c1" },
  { seat: "light", reserveStack: 2, to: "r0c2" },
  { seat: "dark", reserveStack: 2, to: "r3c2" },
  { seat: "light", reserveStack: 0, to: "r0c3" },
]);

/**
 * Light covers a dark size three on `r0c0` while dark completes the rest of row zero,
 * so lifting the cover would reveal a dark line of four (specification section 2.7).
 */
export const LIGHT_COVERS_A_DARK_LINE: readonly ScriptedMove[] = Object.freeze([
  { seat: "light", reserveStack: 0, to: "r1c0" },
  { seat: "dark", reserveStack: 0, to: "r2c0" },
  { seat: "light", reserveStack: 1, to: "r1c1" },
  { seat: "dark", reserveStack: 0, to: "r0c0" },
  { seat: "light", from: "r1c0", to: "r0c0" },
  { seat: "dark", reserveStack: 1, to: "r0c1" },
  { seat: "light", reserveStack: 2, to: "r3c3" },
  { seat: "dark", reserveStack: 2, to: "r0c2" },
  { seat: "light", reserveStack: 0, to: "r3c0" },
  { seat: "dark", reserveStack: 0, to: "r0c3" },
]);
