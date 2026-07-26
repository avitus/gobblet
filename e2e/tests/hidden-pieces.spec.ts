import { expect, test } from "@playwright/test";
import { LIGHT_COVERS_A_DARK_LINE, pairGuests, playScript } from "../helpers/match";

/**
 * Appendix P5.5: a covered piece is never drawn and never named, in either client,
 * although both clients hold it in the snapshot so they can compute the reveal
 * warning the rules require (specification section 2.7).
 */
test("a covered piece is neither drawn nor named", async ({ browser }) => {
  const match = await pairGuests(browser, ["Edsger", "Barbara"]);

  try {
    await playScript(match, LIGHT_COVERS_A_DARK_LINE.slice(0, 5));

    for (const page of match.pages) {
      const covered = page.getByTestId("square-r0c0");
      await expect(covered).toHaveAttribute("data-owner", "light");
      await expect(covered).toHaveAttribute("data-size", "4");
      await expect(covered).toHaveAccessibleName("Square r0c0, light largest, covering 1");
      await expect(covered).toHaveText("4");
      await expect(page.getByTestId("flat-board")).not.toContainText("dark large");
    }
  } finally {
    await match.close();
  }
});
