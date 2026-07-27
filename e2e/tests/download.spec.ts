import { createDatabase, findUserByUsername, setUserRole } from "@gobblet/db";
import { clearReleases, withAdvisoryLock } from "@gobblet/db/testing";
import { normalizeUsername } from "@gobblet/protocol";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { API_URL, DATABASE_URL } from "../setup/environment";
import { newCredentials, openContext, startAccount } from "../helpers/session";

/**
 * The download page of section 24 in a browser. A player who has no desktop build
 * yet is told so; once a release is published through the administrative API, the
 * same page offers exactly the artifacts that were recorded, with the digest a
 * careful person would check (appendix P8.13).
 */

const VERSION = "9.4.2";

/**
 * The release catalogue is one list for the whole server, so the browser projects
 * cannot each keep their own. They take turns over it instead, and each turn starts
 * from an empty catalogue: without this, a second browser reads the release the
 * first one published and never sees the empty state it is here to prove.
 */
const CATALOGUE_LOCK = 0x600b1e7;

const ARTIFACTS = [
  {
    target: "darwin-aarch64",
    url: `https://downloads.example.com/${VERSION}/mac/Gobblet.app.tar.gz`,
    downloadUrl: `https://downloads.example.com/${VERSION}/mac/Gobblet.dmg`,
    signature: "dGhlIHNpZ25hdHVyZQ==",
    sizeBytes: 8_400_000,
    sha256: "a".repeat(64),
  },
  {
    target: "windows-x86_64",
    url: `https://downloads.example.com/${VERSION}/win/Gobblet-setup.exe`,
    downloadUrl: `https://downloads.example.com/${VERSION}/win/Gobblet-setup.exe`,
    signature: "dGhlIHNpZ25hdHVyZQ==",
    sizeBytes: 7_100_000,
    sha256: "b".repeat(64),
  },
] as const;

function catalogueDatabase() {
  return createDatabase({
    connectionString: DATABASE_URL,
    poolMax: 1,
    applicationName: "gobblet-e2e-download",
  });
}

async function adminToken(username: string, token: string): Promise<string> {
  const handle = catalogueDatabase();
  try {
    const user = await findUserByUsername(handle.db, normalizeUsername(username));
    if (!user) {
      throw new Error(`No account is called ${username}`);
    }
    await setUserRole(handle.db, user.id, "admin");
  } finally {
    await handle.close();
  }
  return token;
}

test("the page says so plainly when there is no build, and lists one when there is", async ({
  browser,
  request,
}) => {
  const catalogue = catalogueDatabase();
  const player = await openContext(browser);

  try {
    await withAdvisoryLock(DATABASE_URL, CATALOGUE_LOCK, async () => {
      await clearReleases(catalogue.db);
      await playTheDownloadPage(player, request);
    });
  } finally {
    await player.context.close();
    await catalogue.close();
  }
});

async function playTheDownloadPage(
  player: Awaited<ReturnType<typeof openContext>>,
  request: APIRequestContext,
): Promise<void> {
  const credentials = newCredentials("ada");
  await startAccount(player.page, credentials);

  await player.page.getByRole("link", { name: "Download" }).click();
  await expect(player.page.getByTestId("download-none")).toBeVisible();

  // The release the workflow would record, made the same way: an administrator
  // calling the same route (docs/adr/0034-updates-are-asked-of-our-own-server.md).
  const session = await player.page.evaluate(() => {
    const raw = window.localStorage.getItem("gobblet.session.v1");
    return raw === null ? null : (JSON.parse(raw) as { token?: string }).token;
  });
  expect(session).toBeTruthy();
  const token = await adminToken(credentials.username, session as string);

  const published = await request.post(`${API_URL}/v1/admin/releases`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      version: VERSION,
      channel: "stable",
      notes: "The pieces gobble faster.",
      artifacts: ARTIFACTS,
      reason: "The browser suite publishes a release to read it back",
    },
  });
  expect(published.status()).toBe(200);

  await player.page.reload();
  await expect(player.page.getByTestId("download-list")).toBeVisible();
  await expect(player.page.getByTestId("download-darwin-aarch64")).toBeVisible();
  await expect(player.page.getByTestId("download-link-windows-x86_64")).toHaveAttribute(
    "href",
    ARTIFACTS[1].downloadUrl,
  );
  await expect(player.page.getByTestId("digest-darwin-aarch64")).toContainText(ARTIFACTS[0].sha256);
  await expect(player.page.getByTestId("download-notes")).toHaveText("The pieces gobble faster.");
  // The platform that was not built is named rather than silently absent.
  await expect(player.page.getByTestId("download-missing")).toContainText("Intel");
}
