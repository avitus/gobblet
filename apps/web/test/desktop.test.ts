import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyringBridge } from "../src/desktop/bridge";
import { hostPlatform, isDesktop } from "../src/desktop/host";
import { hydrateDesktopSession } from "../src/desktop/hydrate";
import { createKeyringStore, readStoredToken } from "../src/desktop/keyring-store";
import { useSessionStore } from "../src/session/store";
import type { StoredSession } from "../src/session/store";

/**
 * The host predicate and the credential store behind it (ADR-0033, appendix P8.2):
 * the same bundle, one branch, and a session that is read once before the first
 * render because the credential store answers with a promise.
 */

const SESSION: StoredSession = {
  token: "opaque-bearer-token",
  kind: "account",
  displayName: "ada",
  username: "ada",
};

function fakeKeyring(initial: string | null = null): KeyringBridge & { held: string | null } {
  const state = { held: initial };
  return {
    get held() {
      return state.held;
    },
    read: () => Promise.resolve(state.held),
    write: (token) => {
      state.held = token;
      return Promise.resolve();
    },
    clear: () => {
      state.held = null;
      return Promise.resolve();
    },
  };
}

function pretendDesktop(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: { invoke: () => Promise.resolve(null) },
    configurable: true,
  });
}

afterEach(() => {
  if ("__TAURI_INTERNALS__" in window) {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
  useSessionStore.getState().signedOut();
  vi.restoreAllMocks();
});

describe("the host predicate", () => {
  it("is false in a browser and true when the shell is present", () => {
    expect(isDesktop()).toBe(false);
    expect(hostPlatform()).toBe("web");

    pretendDesktop();

    expect(isDesktop()).toBe(true);
    expect(hostPlatform()).toBe("desktop");
  });
});

describe("the credential store as the session's home", () => {
  it("answers from what was read before mount, then writes through", async () => {
    const bridge = fakeKeyring();
    const store = createKeyringStore({ bridge, hydrated: JSON.stringify(SESSION) });

    expect(store.get("gobblet.session.v1")).toBe(JSON.stringify(SESSION));

    store.set("gobblet.session.v1", "written");
    await Promise.resolve();

    expect(store.get("gobblet.session.v1")).toBe("written");
    expect(bridge.held).toBe("written");
  });

  it("forgets the session on both sides when the player signs out", async () => {
    const bridge = fakeKeyring(JSON.stringify(SESSION));
    const store = createKeyringStore({ bridge, hydrated: JSON.stringify(SESSION) });

    store.remove("gobblet.session.v1");
    await Promise.resolve();

    expect(store.get("gobblet.session.v1")).toBeNull();
    expect(bridge.held).toBeNull();
  });

  it("reports a write the operating system refused instead of losing it silently", async () => {
    const failures: unknown[] = [];
    const store = createKeyringStore({
      bridge: {
        read: () => Promise.resolve(null),
        write: () => Promise.reject(new Error("the keychain is locked")),
        clear: () => Promise.reject(new Error("the keychain is locked")),
      },
      hydrated: null,
      onFailure: (error) => failures.push(error),
    });

    store.set("gobblet.session.v1", "written");
    store.remove("gobblet.session.v1");
    await Promise.resolve();
    await Promise.resolve();

    // The window keeps working with the value it holds; only the next launch loses it.
    expect(store.get("gobblet.session.v1")).toBeNull();
    expect(failures).toHaveLength(2);
  });

  it("treats a credential store that will not answer as nobody signed in", async () => {
    const token = await readStoredToken({
      read: () => Promise.reject(new Error("no keychain on this machine")),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    });

    expect(token).toBeNull();
  });
});

describe("hydration before the first render", () => {
  it("does nothing at all in a browser", async () => {
    window.localStorage.setItem("gobblet.session.v1", JSON.stringify(SESSION));

    await hydrateDesktopSession();

    expect(useSessionStore.getState().session).toBeNull();
  });

  it("adopts what the credential store holds, so the first render is signed in", async () => {
    pretendDesktop();
    const invoke = vi.fn((command: string) =>
      command === "session_token_read"
        ? Promise.resolve(JSON.stringify(SESSION))
        : Promise.resolve(null),
    );
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));

    await hydrateDesktopSession();

    expect(useSessionStore.getState().session).toEqual(SESSION);
    expect(invoke).toHaveBeenCalledWith("session_token_read");
  });

  it("leaves the player signed out when the shell cannot be reached", async () => {
    pretendDesktop();
    vi.doMock("@tauri-apps/api/core", () => {
      throw new Error("the shell is not there");
    });

    await hydrateDesktopSession();

    expect(useSessionStore.getState().session).toBeNull();
  });
});
