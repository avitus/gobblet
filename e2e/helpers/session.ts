import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const SETTINGS_STORAGE_NAME = "gobblet.settings.v1";

export type Player = Readonly<{ context: BrowserContext; page: Page }>;

export type ContextOptions = Readonly<{
  /** `flat` by default: a DOM square is addressable in every engine (docs/adr/0023). */
  renderTier?: "auto" | "flat";
}>;

/**
 * A context whose settings are seeded before the client boots. Most specifications
 * play on the flat tier, which exercises the same interaction layer, the same
 * protocol and the same server as the WebGL tiers. `rendering.spec.ts` covers the
 * tier a browser picks for itself.
 */
export async function openContext(browser: Browser, options: ContextOptions = {}): Promise<Player> {
  const context = await browser.newContext();
  const settings = JSON.stringify({
    renderTier: options.renderTier ?? "flat",
    soundMuted: true,
  });
  await context.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [SETTINGS_STORAGE_NAME, settings] as const,
  );
  const page = await context.newPage();
  return { context, page };
}

export async function startGuest(page: Page, displayName: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("guest-name").fill(displayName);
  await page.getByTestId("play-as-guest").click();
  await expect(page.getByTestId("identity-name")).toHaveText(displayName);
}
