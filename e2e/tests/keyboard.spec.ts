import { expect, test, type Page } from "@playwright/test";
import { pairGuests } from "../helpers/match";

async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
}

async function tabTo(page: Page, testId: string): Promise<void> {
  for (let step = 0; step < 40; step += 1) {
    if ((await focusedTestId(page)) === testId) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Tab never reached ${testId}; it stopped on ${String(await focusedTestId(page))}`,
  );
}

/**
 * Section 13.3 and appendix P5.15: a whole move by keyboard alone, with the focus
 * ring following the cursor.
 */
test("a move is played with the keyboard alone", async ({ browser }) => {
  const match = await pairGuests(browser, ["Sophie", "Maryam"]);

  try {
    const page = match.light.page;
    await page.getByTestId("reserve-light-0").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("reserve-light-0")).toHaveAttribute("data-selected", "true");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("square-r1c1")).toHaveAttribute("data-cursor", "true");
    expect(await focusedTestId(page)).toBe("square-r1c1");

    await page.keyboard.press("Enter");

    for (const other of match.pages) {
      await expect(other.getByTestId("square-r1c1")).toHaveAttribute("data-owner", "light");
      await expect(other.getByTestId("square-r1c1")).toHaveAttribute("data-size", "4");
    }

    await expect(match.dark.page.getByTestId("player-dark")).toHaveAttribute(
      "data-to-move",
      "true",
    );
  } finally {
    await match.close();
  }
});

test("Escape cancels a selection made with the pointer", async ({ browser }) => {
  const match = await pairGuests(browser, ["Karen", "Radia"]);

  try {
    const page = match.light.page;
    await page.getByTestId("reserve-light-0").click();
    await expect(page.getByTestId("reserve-light-0")).toHaveAttribute("data-selected", "true");

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("reserve-light-0")).toHaveAttribute("data-selected", "false");
    await expect(page.getByTestId("square-r1c1")).toHaveAttribute("data-destination", "false");
  } finally {
    await match.close();
  }
});

test("Tab visits the movable pieces", async ({ browser, browserName }) => {
  // Safari's engine only tabs to a button when macOS full keyboard access is on, which
  // is a system preference and not something the client can set. The tab order itself
  // is held by the unit suite; here it is proven in the engine that offers it.
  test.skip(browserName === "webkit", "WebKit tabs to buttons only with full keyboard access");

  const match = await pairGuests(browser, ["Anita", "Jean"]);

  try {
    const page = match.light.page;
    await tabTo(page, "reserve-light-0");
    await page.keyboard.press("Tab");

    expect(await focusedTestId(page)).toBe("reserve-light-1");
    await expect(page.getByTestId("reserve-dark-0")).toBeDisabled();
  } finally {
    await match.close();
  }
});
