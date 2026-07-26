import { expect, test } from "@playwright/test";
import { LIGHT_COVERS_A_DARK_LINE, pairGuests, playScript } from "../helpers/match";

/**
 * Section 13.3: lifting a piece that would reveal an opponent line is warned about
 * but never forbidden. The warning is computed by the client from the snapshot, so
 * this specification proves the snapshot carries what the warning needs.
 */
test("lifting a cover that reveals a dark line is warned about, not refused", async ({
  browser,
}) => {
  const match = await pairGuests(browser, ["Grete", "Emmy"]);

  try {
    await playScript(match, LIGHT_COVERS_A_DARK_LINE);

    const page = match.light.page;
    await page.getByTestId("square-r0c0").click();

    const destination = page.getByTestId("square-r1c0");
    await expect(destination).toHaveAttribute("data-reveal-loss", "true");
    await expect(destination).toHaveAccessibleName("Square r1c0, empty, loses by reveal");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("square-r0c0")).toHaveAttribute("data-selected", "false");
    await expect(destination).toHaveAttribute("data-reveal-loss", "false");

    await page.getByTestId("square-r0c0").click();
    await destination.click();

    for (const other of match.pages) {
      await expect(other.getByTestId("result-dialog")).toBeVisible();
      await expect(other.getByTestId("result-reason")).toHaveText(
        "Decided by a line revealed by lifting a piece.",
      );
    }
    await expect(match.dark.page.getByTestId("result-dialog")).toContainText("You won");
  } finally {
    await match.close();
  }
});
