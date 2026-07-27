import type { DesktopWindow } from "./bridge";

/**
 * Closing the window during a match asks first (spec section 5.4, appendix P8.9).
 * Confirming resigns and waits for the acknowledgement, so the opponent sees a
 * resignation rather than a disconnection; dismissing leaves the player in the
 * match. With no match to lose the close is not intercepted at all.
 */

export type CloseGuardOptions = Readonly<{
  window: DesktopWindow;
  /** True while a match this player is seated in is still running. */
  inMatch: () => boolean;
  /** Asks the player, and answers whether quitting should resign. */
  confirm: () => Promise<boolean>;
  /** Sends `match:resign` and resolves when the server has acknowledged it. */
  resign: () => Promise<void>;
}>;

export function installCloseGuard(options: CloseGuardOptions): Promise<() => void> {
  return options.window.onCloseRequested(async () => {
    if (!options.inMatch()) {
      await options.window.close();
      return;
    }
    if (!(await options.confirm())) {
      return;
    }
    try {
      await options.resign();
    } catch {
      // The resignation did not land. The window still closes, because the player
      // asked twice by then, and the server ends an abandoned match on its own.
    }
    await options.window.close();
  });
}
