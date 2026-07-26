import { expect, test } from "@playwright/test";
import { grantAdminRole } from "../helpers/admin";
import { LIGHT_WINS_ROW_ZERO, pairAccounts, playScript } from "../helpers/match";
import { newCredentials, openContext, startAccount } from "../helpers/session";

/**
 * Section 16 in a browser. The dashboard is not a second application: it is a set of
 * gated routes inside the player client, and the gate is the role on the account
 * (docs/adr/0029-administration-is-a-role-on-the-account.md). A player who types the
 * address sees what the address would give them anyway.
 */

test("the dashboard is invisible and unreachable without the role", async ({ browser }) => {
  const player = await openContext(browser);

  try {
    await startAccount(player.page, newCredentials("ada"));

    await expect(player.page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await player.page.goto("/admin");
    await expect(player.page.getByText("Nothing here")).toBeVisible();
    await expect(player.page.getByTestId("admin-dashboard")).toHaveCount(0);

    // Nor is any inner address a way around the gate.
    await player.page.goto("/admin/audit");
    await expect(player.page.getByText("Nothing here")).toBeVisible();
    await expect(player.page.getByTestId("admin-audit-table")).toHaveCount(0);
  } finally {
    await player.context.close();
  }
});

test("an administrator reads the deployment, suspends an account and finds the record", async ({
  browser,
}) => {
  // A finished ranked match gives the dashboard something true to report.
  const accounts = [newCredentials("ada"), newCredentials("grace")] as const;
  const match = await pairAccounts(browser, accounts);
  const sysop = newCredentials("sysop");
  const admin = await openContext(browser);

  try {
    await playScript(match, LIGHT_WINS_ROW_ZERO);
    for (const page of match.pages) {
      await page.getByRole("button", { name: "Back to play" }).click();
    }

    await startAccount(admin.page, sysop);
    await grantAdminRole(sysop.username);
    // The role is read from the account, not from anything the browser is holding,
    // so the entrance appears on the next read rather than on the next sign-in.
    await admin.page.reload();

    const dashboard = admin.page.getByRole("link", { name: "Admin" });
    await expect(dashboard).toBeVisible();
    await dashboard.click();

    await expect(admin.page.getByTestId("admin-overview")).toBeVisible();
    await expect(admin.page.getByTestId("overview-ready")).toContainText("ready");
    await expect(admin.page.getByTestId("overview-dau")).not.toHaveText("0");

    await admin.page.getByRole("link", { name: "Accounts" }).click();
    await admin.page.getByTestId("admin-user-search").fill(accounts[0].username);
    await admin.page.getByTestId("admin-user-search-submit").click();

    const row = admin.page.getByTestId(`admin-user-row-${accounts[0].username}`);
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: accounts[0].username }).click();

    await expect(admin.page.getByTestId("admin-user-detail")).toBeVisible();
    await expect(admin.page.getByTestId("admin-user-email")).toHaveText(accounts[0].email);
    await expect(admin.page.getByTestId("admin-user-sessions")).not.toHaveText("0");

    // The reason is not a formality: the button is unusable without one.
    await expect(admin.page.getByTestId("admin-suspend")).toBeDisabled();
    await admin.page.getByTestId("admin-reason").fill("Abuse reported in three separate matches.");
    await admin.page.getByTestId("admin-suspend").click();

    await expect(admin.page.getByTestId("admin-user-suspended-reason")).toHaveText(
      "Abuse reported in three separate matches.",
    );
    await expect(admin.page.getByTestId("admin-moderation")).toContainText("user-suspended");
    // Suspension revokes what the player is holding, which the detail reports.
    await expect(admin.page.getByTestId("admin-user-sessions")).toHaveText("0");

    await admin.page.getByRole("link", { name: "Audit" }).click();
    const log = admin.page.getByTestId("admin-audit-table");
    await expect(log).toContainText("user-suspended");
    await expect(log).toContainText(accounts[0].username);
    await expect(log).toContainText("Abuse reported in three separate matches.");

    // The list is what is being played now, so this finished match is not in it; the
    // match itself is still inspectable by address, event log and all.
    await admin.page.getByRole("link", { name: "Matches" }).click();
    await expect(admin.page.getByTestId(`admin-match-row-${match.matchId}`)).toHaveCount(0);

    await admin.page.goto(`/admin/matches/${match.matchId}`);
    await expect(admin.page.getByTestId("admin-match-detail")).toBeVisible();
    await expect(admin.page.getByTestId("admin-match-result")).toHaveText("light by line");
    await expect(admin.page.getByTestId("admin-match-events")).toContainText("move");
  } finally {
    await admin.context.close();
    await match.close();
  }
});
