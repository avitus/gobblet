import { expect, test, type Page } from "@playwright/test";
import { pairGuests } from "../helpers/match";

/**
 * Counts the commands a page sends from inside it, because the socket is already open
 * by the time a match exists. The canvas and the keyboard stops laid over it both
 * answer a pointer, and a gesture that submits twice looks right on the board while
 * telling the player their move was refused (docs/adr/0025).
 */
async function countCommands(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    // Typed as a property rather than a method, so the reference carries no `this`.
    const socket = WebSocket.prototype as unknown as {
      send: (this: WebSocket, data: string) => void;
    };
    const original = socket.send;
    const counter = { sent: 0 };
    (window as unknown as { __commands: { sent: number } }).__commands = counter;
    socket.send = function patched(this: WebSocket, data: string) {
      if (typeof data === "string" && data.includes("match:move")) {
        counter.sent += 1;
      }
      original.call(this, data);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { __commands: { sent: number } }).__commands.sent);
}

/**
 * Docs/adr/0025: in the WebGL tiers the canvas owns the pointer, and the keyboard
 * stops laid over it are placed where the camera projects each square. A pointer
 * gesture must therefore act on the piece and the square the player sees, which no
 * unit test can prove: it needs a graphics context and a real hit test. Two review
 * defects hid here, so this specification stays.
 */

/**
 * Waits until React Three Fiber has measured the container and sized the canvas,
 * because a hit test converts page coordinates using that size. Frames, not sleeps.
 */
async function waitForCanvas(page: Page): Promise<void> {
  await expect(page.getByTestId("board-scene")).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    return canvas !== null && canvas.width > 400;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * Clicks the canvas where a stop is placed. `fraction` walks down the stop, so a
 * reserve piece is struck on its body rather than in the air above it.
 */
async function clickWhereDrawn(page: Page, testId: string, fraction = 0.5): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) {
    throw new Error(`${testId} is not laid out`);
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * fraction);
}

const EMPTY = /empty$/;

test("a pointer gesture on the canvas acts on the piece and square it points at", async ({
  browser,
}) => {
  // The runner has no GPU, so Chromium rasterises this scene in software: every hit
  // test and every accessible name is read from a canvas drawn on the CPU, which took
  // 66s, then 78s, then more than the default 90s as the suite grew. The engine is
  // what is slow here, not the client, so the budget is tripled rather than the proof
  // weakened.
  test.slow();

  const match = await pairGuests(browser, ["Grace", "Alan"], { renderTier: "full" });

  try {
    for (const page of match.pages) {
      await waitForCanvas(page);
    }

    const lightCommands = await countCommands(match.light.page);
    const light = match.light.page;
    await clickWhereDrawn(light, "scene-reserve-light-0", 0.7);
    await expect(light.getByTestId("scene-square-r0c2")).toHaveAttribute("data-highlight", "legal");

    await clickWhereDrawn(light, "scene-square-r0c2");
    for (const page of match.pages) {
      await expect(page.getByTestId("scene-square-r0c2")).toHaveAccessibleName(
        "Square r0c2, light largest",
      );
      for (const neighbour of ["r0c1", "r0c3", "r1c2"]) {
        await expect(page.getByTestId(`scene-square-${neighbour}`)).toHaveAccessibleName(EMPTY);
      }
    }
    await expect(light.getByTestId("scene-square-r0c2")).toHaveAttribute("data-cursor", "true");

    const dark = match.dark.page;
    await clickWhereDrawn(dark, "scene-reserve-dark-1", 0.7);
    await clickWhereDrawn(dark, "scene-square-r3c1");
    for (const page of match.pages) {
      await expect(page.getByTestId("scene-square-r3c1")).toHaveAccessibleName(
        "Square r3c1, dark largest",
      );
      await expect(page.getByTestId("scene-square-r3c0")).toHaveAccessibleName(EMPTY);
    }

    await clickWhereDrawn(light, "scene-square-r0c2", 0.7);
    await expect(light.getByTestId("scene-square-r0c2")).toBeFocused();
    await expect(light.getByTestId("scene-square-r1c1")).toHaveAttribute("data-highlight", "legal");

    await clickWhereDrawn(light, "scene-square-r1c1");
    for (const page of match.pages) {
      await expect(page.getByTestId("scene-square-r1c1")).toHaveAccessibleName(
        "Square r1c1, light largest",
      );
      await expect(page.getByTestId("scene-square-r0c2")).toHaveAccessibleName(EMPTY);
    }

    // Light has played twice. A second command for the same gesture carries the
    // version from before the first one, which the server rejects as stale, and the
    // player is told their move was not played while the board shows that it was.
    expect(await lightCommands()).toBe(2);
    await expect(light.getByTestId("match-notice")).toHaveCount(0);
  } finally {
    await match.close();
  }
});
