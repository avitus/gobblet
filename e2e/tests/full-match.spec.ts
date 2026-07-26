import { expect, test } from "@playwright/test";
import { LIGHT_WINS_ROW_ZERO, pairGuests, playScript } from "../helpers/match";

/**
 * The Phase 5 exit criterion: a complete match, played by two browsers against a
 * real server, ending in a decided result and a rematch (docs/adr/0021).
 */
test("two guests queue, play a whole match and take a rematch", async ({ browser }) => {
  const match = await pairGuests(browser, ["Ada", "Grace"]);

  try {
    await expect(match.light.page.getByTestId("match-mode")).toHaveText("casual");
    for (const page of match.pages) {
      await expect(page.getByTestId("player-light")).toContainText(match.light.displayName);
      await expect(page.getByTestId("player-dark")).toContainText(match.dark.displayName);
      await expect(page.getByTestId("clock-light")).toHaveText(/^[0-9]:[0-9]{2}$/);
    }

    await playScript(match, LIGHT_WINS_ROW_ZERO);

    const winner = match.light.page.getByTestId("result-dialog");
    const loser = match.dark.page.getByTestId("result-dialog");
    await expect(winner).toContainText("You won");
    await expect(loser).toContainText("You lost");
    await expect(match.light.page.getByTestId("result-reason")).toHaveText(
      "Decided by four in a line.",
    );

    await match.light.page.getByTestId("rematch").click();
    await expect(match.light.page.getByTestId("rematch-waiting")).toBeVisible();

    await expect(match.dark.page.getByTestId("rematch")).toHaveText("Accept rematch");
    await match.dark.page.getByTestId("rematch").click();

    for (const page of match.pages) {
      await page.waitForURL((url) => !url.pathname.endsWith(match.matchId));
      await expect(page.getByTestId("square-r0c0")).toHaveAttribute("data-owner", "empty");
      await expect(page.getByTestId("match-version")).toHaveText("0");
    }
  } finally {
    await match.close();
  }
});

test("a resignation ends the match for both players", async ({ browser }) => {
  const match = await pairGuests(browser, ["Alan", "Katherine"]);

  try {
    await match.dark.page.getByTestId("resign").click();

    await expect(match.dark.page.getByTestId("result-dialog")).toContainText("You lost");
    await expect(match.light.page.getByTestId("result-dialog")).toContainText("You won");
    await expect(match.light.page.getByTestId("result-reason")).toHaveText(
      "Decided by a resignation.",
    );
  } finally {
    await match.close();
  }
});
