import { expect, test, type Locator, type Page } from "@playwright/test";
import { LIGHT_WINS_ROW_ZERO, pairAccounts, playScript } from "../helpers/match";
import { newCredentials } from "../helpers/session";

const RANK = /^#(\d+) all time$/;

async function rankOn(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? "";
  const matched = RANK.exec(text);
  expect(matched, `${testId} reads "${text}"`).not.toBeNull();
  return Number(matched?.[1]);
}

async function cell(row: Locator, index: number): Promise<number> {
  return Number(await row.locator("td").nth(index).innerText());
}

/**
 * Section 11 in a browser: a ranked win moves both ratings, the board is computed
 * from them at read time (docs/adr/0028-leaderboards-are-read-time-queries.md), and
 * the first win earns its badge in the same transaction that ended the match
 * (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
 */
test("a ranked win rates both accounts, boards them in order and awards the first badge", async ({
  browser,
}) => {
  // Which account takes which seat is the server's choice, so the winner is read
  // back from the match rather than assumed.
  const match = await pairAccounts(browser, [newCredentials("ada"), newCredentials("grace")]);
  const names = { light: match.light.displayName, dark: match.dark.displayName };

  try {
    await expect(match.light.page.getByTestId("match-mode")).toHaveText("ranked");

    await playScript(match, LIGHT_WINS_ROW_ZERO);
    await expect(match.light.page.getByTestId("result-dialog")).toContainText("You won");
    await expect(match.dark.page.getByTestId("result-dialog")).toContainText("You lost");
    // The result is a modal dialog, so both players leave it before reading anything.
    for (const page of match.pages) {
      await page.getByRole("button", { name: "Back to play" }).click();
      await expect(page.getByTestId("result-dialog")).toBeHidden();
    }

    await match.light.page.getByRole("link", { name: "Profile" }).click();
    await expect(match.light.page.getByTestId("own-rank")).toHaveText(RANK);
    await expect(match.light.page.getByTestId("own-ranked")).toContainText("1W 0L 0D");
    await expect(match.light.page.getByTestId("achievement-first-victory")).toHaveAttribute(
      "data-earned",
      "true",
    );
    await expect(match.light.page.getByTestId("achievement-contender")).toHaveAttribute(
      "data-earned",
      "false",
    );

    await match.light.page.getByRole("link", { name: "History" }).click();
    const played = match.light.page.getByTestId(`history-row-${match.matchId}`);
    await expect(played).toContainText("won by line");
    await expect(played).toContainText(names.dark);
    await expect(match.light.page.getByTestId(`history-rating-${match.matchId}`)).toHaveText(
      /^\+[0-9]+$/,
    );

    await match.light.page.getByRole("link", { name: "Leaderboard" }).click();
    const winnerRow = match.light.page.getByTestId(`leaderboard-row-${names.light}`);
    const loserRow = match.light.page.getByTestId(`leaderboard-row-${names.dark}`);
    await expect(winnerRow).toHaveAttribute("data-you", "true");
    await expect(loserRow).toHaveAttribute("data-you", "false");

    // The winner stands above the loser because the rating says so, and the rank in
    // the row is the same number the profile showed.
    const [winnerRank, loserRank] = [await cell(winnerRow, 0), await cell(loserRow, 0)];
    expect(winnerRank).toBeLessThan(loserRank);
    expect(await cell(winnerRow, 2)).toBeGreaterThan(1200);
    expect(await cell(loserRow, 2)).toBeLessThan(1200);
    expect(await cell(winnerRow, 3)).toBe(1);
    expect(await cell(winnerRow, 4)).toBe(1);

    await match.light.page.getByRole("link", { name: "Profile" }).click();
    expect(await rankOn(match.light.page, "own-rank")).toBe(winnerRank);

    // The same board, read for a shorter period, still holds the match just played.
    await match.light.page.getByRole("link", { name: "Leaderboard" }).click();
    await match.light.page.getByTestId("period-daily").click();
    await expect(match.light.page.getByTestId(`leaderboard-row-${names.light}`)).toBeVisible();

    // A loss earns nothing, and the loser's own row is marked on the same board.
    await match.dark.page.getByRole("link", { name: "Profile" }).click();
    expect(await rankOn(match.dark.page, "own-rank")).toBe(loserRank);
    await expect(match.dark.page.getByTestId("achievement-first-victory")).toHaveAttribute(
      "data-earned",
      "false",
    );

    await match.dark.page.getByRole("link", { name: "Leaderboard" }).click();
    await expect(match.dark.page.getByTestId(`leaderboard-row-${names.dark}`)).toHaveAttribute(
      "data-you",
      "true",
    );

    // The winner's public profile carries the badge, the rank and the match itself.
    await match.dark.page.getByRole("link", { name: names.light, exact: true }).click();
    expect(await rankOn(match.dark.page, "public-rank")).toBe(winnerRank);
    await expect(match.dark.page.getByTestId("badge-first-victory")).toContainText("First Victory");
    await expect(match.dark.page.getByTestId(`recent-${match.matchId}`)).toContainText(
      "won by line",
    );
  } finally {
    await match.close();
  }
});
