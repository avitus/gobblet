import type { KeyValueStore } from "../storage/local-store";
import type { KeyringBridge } from "./bridge";

/**
 * The session record, which is the bearer token and the name beside it, in the
 * operating system's credential store rather than in a file the shell could read
 * (spec section 19.2, appendix P8.2). One installation holds one session, so the
 * key the caller passes is not used: there is a single entry. The credential
 * store is asynchronous and the session store is not, so the value is read once
 * before the first render and every write afterwards is sent through in the
 * background: a failed write costs the player a sign-in on the next launch, which
 * is what "storage is a cache" has always meant in this client.
 */

export type KeyringStoreOptions = Readonly<{
  bridge: KeyringBridge;
  /** The value read before mount, so the first render already has the session. */
  hydrated: string | null;
  /** Where a write failure goes; the default swallows it like the browser store. */
  onFailure?: (error: unknown) => void;
}>;

export function createKeyringStore(options: KeyringStoreOptions): KeyValueStore {
  let held = options.hydrated;
  const failed = (error: unknown): void => {
    options.onFailure?.(error);
  };

  return {
    get: () => held,
    set: (_key, value) => {
      held = value;
      options.bridge.write(value).catch(failed);
    },
    remove: () => {
      held = null;
      options.bridge.clear().catch(failed);
    },
  };
}

/**
 * The one read before mount. A credential store that refuses to answer is a
 * player who has to sign in again, not a client that fails to start.
 */
export async function readStoredToken(bridge: KeyringBridge): Promise<string | null> {
  try {
    return await bridge.read();
  } catch {
    return null;
  }
}
