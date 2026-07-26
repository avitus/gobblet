import { expect, test } from "@playwright/test";
import { pairGuests } from "../helpers/match";

/**
 * Section 12 in a browser: the eight phrases and five reactions arrive as keys, a
 * muted channel is withheld by the server, and nothing is kept anywhere
 * (docs/adr/0026-communication-is-relayed-never-stored.md).
 */
test("a preset message and a reaction reach the opponent, and a mute stops them", async ({
  browser,
}) => {
  const match = await pairGuests(browser, ["Ada", "Grace"]);

  try {
    const sender = match.light.page.getByTestId("communication-feed");
    const listener = match.dark.page.getByTestId("communication-feed");
    for (const feed of [sender, listener]) {
      await expect(feed).toBeVisible();
      await expect(feed.getByTestId("communication-empty")).toBeVisible();
    }

    await match.light.page.getByTestId("message-good-luck").click();
    await expect(sender).toContainText("You");
    await expect(sender).toContainText("Good luck.");
    await expect(listener).toContainText(match.light.displayName);
    await expect(listener).toContainText("Good luck.");

    await match.dark.page.getByTestId("reaction-applause").click();
    await expect(sender).toContainText("Applause");
    await expect(listener).toContainText("Applause");

    // Dark stops hearing phrases, and the server is what withholds them.
    await match.dark.page.getByLabel("Mute their messages").click();
    await expect(match.dark.page.getByLabel("Mute their messages")).toBeChecked();

    await match.light.page.getByTestId("message-nice-move").click();
    await expect(sender).toContainText("Nice move.");
    // Nothing arrives, proved by a short expected timeout rather than a sleep.
    await expect(listener).not.toContainText("Nice move.", { timeout: 2_000 });

    // Reactions were not muted, so that channel still carries.
    await match.light.page.getByTestId("reaction-smile").click();
    await expect(listener).toContainText("Smile");

    // A reload proves the exchange was stored nowhere: the feed comes back empty.
    await match.dark.page.reload();
    await expect(match.dark.page.getByTestId("communication-empty")).toBeVisible();
    // The mute is the player's own setting, so it survives the reload.
    await expect(match.dark.page.getByLabel("Mute their messages")).toBeChecked();
  } finally {
    await match.close();
  }
});
