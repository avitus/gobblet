import { expect, test } from "@playwright/test";
import { pairGuests, play } from "../helpers/match";

/**
 * Section 7.4 and section 13.3: a dropped connection freezes the board and says so,
 * and the match continues from the server's state when the socket returns. The
 * client never invents state while it is disconnected (docs/adr/0020).
 */
test("a dropped connection freezes the board and recovers", async ({ browser }) => {
  const match = await pairGuests(browser, ["Rosalind", "Dorothy"]);

  try {
    await play(match, { seat: "light", reserveStack: 0, to: "r0c0" });

    await match.dark.context.setOffline(true);
    await expect(match.dark.page.getByTestId("reconnecting")).toBeVisible();
    await expect(match.dark.page.getByTestId("match-phase")).not.toHaveText("ready");
    await expect(match.dark.page.getByTestId("reserve-dark-0")).toBeDisabled();

    await match.dark.context.setOffline(false);
    await expect(match.dark.page.getByTestId("reconnecting")).toBeHidden();
    await expect(match.dark.page.getByTestId("match-phase")).toHaveText("ready");
    await expect(match.dark.page.getByTestId("square-r0c0")).toHaveAttribute("data-owner", "light");

    await play(match, { seat: "dark", reserveStack: 0, to: "r3c3" });
    await expect(match.light.page.getByTestId("match-version")).toHaveText("2");
  } finally {
    await match.close();
  }
});

test("reloading the page restores the match from the server", async ({ browser }) => {
  const match = await pairGuests(browser, ["Hedy", "Joan"]);

  try {
    await play(match, { seat: "light", reserveStack: 0, to: "r2c2" });

    await match.light.page.reload();

    await expect(match.light.page.getByTestId("match-screen")).toBeVisible();
    await expect(match.light.page.getByTestId("square-r2c2")).toHaveAttribute(
      "data-owner",
      "light",
    );
    await expect(match.light.page.getByTestId("match-version")).toHaveText("1");
    await expect(match.light.page.getByTestId("player-dark")).toHaveAttribute(
      "data-to-move",
      "true",
    );
  } finally {
    await match.close();
  }
});
