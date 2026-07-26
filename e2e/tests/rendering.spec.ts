import { expect, test } from "@playwright/test";
import { pairGuests } from "../helpers/match";

/**
 * Docs/adr/0023: the tier is chosen by capability, and a player may override it.
 * Whichever tier a browser picks, the board offers sixteen squares and a reachable
 * reserve, which is what the rest of the suite depends on.
 */
test("the client picks a tier the browser can draw and lets a player override it", async ({
  browser,
}) => {
  const match = await pairGuests(browser, ["Ida", "Mary"], { renderTier: "auto" });

  try {
    const page = match.light.page;
    const scene = page.getByTestId("board-scene");
    const usesWebGl = await scene.isVisible();

    if (usesWebGl) {
      await expect(scene).toHaveAttribute("data-tier", /full|reduced/);
      await expect(page.getByTestId("scene-square-r0c0")).toBeAttached();
      await expect(page.getByTestId("scene-reserve-light-0")).toBeEnabled();
    } else {
      await expect(page.getByTestId("flat-board")).toBeVisible();
    }
    await expect(page.getByRole("gridcell")).toHaveCount(16);

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByTestId("render-tier").selectOption("flat");
    await page.goBack();

    await expect(page.getByTestId("flat-board")).toBeVisible();
    await expect(page.getByTestId("reserve-light-0")).toBeEnabled();
  } finally {
    await match.close();
  }
});
