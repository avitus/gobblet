import { adoptSessionStorage } from "../session/store";
import { loadKeyring } from "./bridge";
import { isDesktop } from "./host";
import { createKeyringStore, readStoredToken } from "./keyring-store";

/**
 * The one asynchronous step before the first render (ADR-0033): on the desktop the
 * session lives in the credential store, which answers with a promise, so it is
 * read here and the session store is pointed at it. A credential store that will
 * not answer leaves the player signed out rather than leaving the window empty.
 */
export async function hydrateDesktopSession(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    const bridge = await loadKeyring();
    const hydrated = await readStoredToken(bridge);
    adoptSessionStorage(createKeyringStore({ bridge, hydrated }));
  } catch {
    // The browser store stays in place, which is a sign-in rather than a failure.
  }
}
