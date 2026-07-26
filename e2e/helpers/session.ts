import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const SETTINGS_STORAGE_NAME = "gobblet.settings.v1";

export type Player = Readonly<{ context: BrowserContext; page: Page }>;

export type ContextOptions = Readonly<{
  /** `flat` by default: a DOM square is addressable in every engine (docs/adr/0023). */
  renderTier?: "auto" | "full" | "reduced" | "flat";
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
  // Seeded once, not on every load: a setting the specification changes must
  // survive a reload, which is the client's own promise about them.
  await context.addInitScript(
    ([key, value]) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, value);
      }
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

export type Credentials = Readonly<{ username: string; email: string; password: string }>;

/**
 * Credentials no other run can collide with. A retry registers again, and the
 * suite's database survives between the two attempts.
 */
export function newCredentials(prefix: string): Credentials {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `${prefix}_${suffix}`;
  return { username, email: `${username}@example.test`, password: "correct-horse-battery-9" };
}

/**
 * A verified account, made through the screens a player uses. No mail is sent
 * outside production, so registration hands the token to the verification screen,
 * which is where ranked eligibility comes from (appendix P3).
 */
export async function startAccount(page: Page, credentials: Credentials): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByTestId("register-submit").click();

  await expect(page.getByTestId("verify-submit")).toBeVisible();
  await page.getByTestId("verify-submit").click();
  await expect(page.getByTestId("identity-name")).toHaveText(credentials.username);
}
