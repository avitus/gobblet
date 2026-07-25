import { describe, expect, it } from "vitest";
import { createSessionStore, useSessionStore, sessionToken } from "../src/session/store";
import { storedSessionFromAccount, storedSessionFromGuest } from "../src/session/apply-auth";
import { createSettingsStore, DEFAULT_SETTINGS, readSettings } from "../src/settings/store";
import { createMemoryStore } from "../src/storage/local-store";
import { createLocalStore } from "../src/storage/local-store";

const ACCOUNT = {
  userId: "11111111-1111-4111-8111-111111111111",
  username: "ada",
  email: "ada@example.com",
  emailVerified: false,
  status: "active" as const,
  createdAt: "2026-07-25T10:00:00.000Z",
};

const ISSUED = { sessionToken: "token-1", expiresAt: "2026-08-25T10:00:00.000Z" };

describe("session store", () => {
  it("starts empty and remembers a sign-in", () => {
    const storage = createMemoryStore();
    const store = createSessionStore(storage);

    expect(store.getState().session).toBeNull();

    store.getState().signedIn(storedSessionFromAccount(ACCOUNT, ISSUED));

    expect(store.getState().session).toEqual({
      token: "token-1",
      kind: "account",
      displayName: "ada",
      username: "ada",
    });
    expect(createSessionStore(storage).getState().session?.token).toBe("token-1");
  });

  it("remembers a guest session", () => {
    const store = createSessionStore(createMemoryStore());

    store.getState().signedIn(
      storedSessionFromGuest({
        guestId: "22222222-2222-4222-8222-222222222222",
        displayName: "Guest Fox",
        sessionToken: "guest-token",
        expiresAt: "2026-07-26T10:00:00.000Z",
      }),
    );

    expect(store.getState().session).toEqual({
      token: "guest-token",
      kind: "guest",
      displayName: "Guest Fox",
      username: null,
    });
  });

  it("forgets everything on sign-out", () => {
    const storage = createMemoryStore();
    const store = createSessionStore(storage);
    store.getState().signedIn(storedSessionFromAccount(ACCOUNT, ISSUED));

    store.getState().signedOut();

    expect(store.getState().session).toBeNull();
    expect(storage.get("gobblet.session.v1")).toBeNull();
  });

  it("takes the display name from the server's view of the actor", () => {
    const store = createSessionStore(createMemoryStore());
    store.getState().signedIn(storedSessionFromAccount(ACCOUNT, ISSUED));

    store.getState().actorResolved({
      actorId: ACCOUNT.userId,
      actorType: "user",
      displayName: "Ada L",
      isGuest: false,
      serverTime: 1_700_000_000_000,
      features: [],
    });

    expect(store.getState().session?.displayName).toBe("Ada L");
    expect(store.getState().actor?.actorType).toBe("user");

    store.getState().actorLost();
    expect(store.getState().actor).toBeNull();
  });

  it("keeps a resolved actor even with no stored session", () => {
    const store = createSessionStore(createMemoryStore());

    store.getState().actorResolved({
      actorId: ACCOUNT.userId,
      actorType: "guest",
      displayName: "Guest Fox",
      isGuest: true,
      serverTime: 1,
      features: [],
    });

    expect(store.getState().session).toBeNull();
    expect(store.getState().actor?.isGuest).toBe(true);
  });

  it("ignores a stored value that is not a session", () => {
    for (const raw of ["not json", '"a string"', "{}", '{"token":1}', '{"token":"t","kind":"x"}']) {
      const store = createSessionStore(createMemoryStore({ "gobblet.session.v1": raw }));
      expect(store.getState().session).toBeNull();
    }
  });

  it("reads a stored session without a username", () => {
    const store = createSessionStore(
      createMemoryStore({
        "gobblet.session.v1": JSON.stringify({
          token: "t",
          kind: "guest",
          displayName: "Guest Fox",
        }),
      }),
    );

    expect(store.getState().session?.username).toBeNull();
  });

  it("exposes the token of the application store", () => {
    expect(sessionToken()).toBeNull();

    useSessionStore.getState().signedIn(storedSessionFromAccount(ACCOUNT, ISSUED));
    expect(sessionToken()).toBe("token-1");

    useSessionStore.getState().signedOut();
  });
});

describe("settings store", () => {
  it("starts from the defaults", () => {
    expect(createSettingsStore(createMemoryStore()).getState().masterVolume).toBe(
      DEFAULT_SETTINGS.masterVolume,
    );
  });

  it("persists a change and reloads it", () => {
    const storage = createMemoryStore();
    const store = createSettingsStore(storage);

    store.getState().update({ gameVolume: 0.2, motion: "reduced" });

    expect(store.getState().gameVolume).toBe(0.2);
    const reloaded = createSettingsStore(storage).getState();
    expect(reloaded.gameVolume).toBe(0.2);
    expect(reloaded.motion).toBe("reduced");
  });

  it("resets to the defaults", () => {
    const storage = createMemoryStore();
    const store = createSettingsStore(storage);
    store.getState().update({ soundMuted: true, renderTier: "flat" });

    store.getState().reset();

    expect(store.getState().soundMuted).toBe(false);
    expect(store.getState().renderTier).toBe("auto");
  });

  it("clamps and repairs stored values instead of trusting them", () => {
    const settings = readSettings(
      createMemoryStore({
        "gobblet.settings.v1": JSON.stringify({
          masterVolume: 4,
          gameVolume: -1,
          communicationVolume: "loud",
          soundMuted: "yes",
          motion: "sideways",
          renderTier: "ultra",
        }),
      }),
    );

    expect(settings).toEqual({
      masterVolume: 1,
      gameVolume: 0,
      communicationVolume: DEFAULT_SETTINGS.communicationVolume,
      soundMuted: false,
      motion: "system",
      renderTier: "auto",
    });
  });

  it("falls back to the defaults for anything unreadable", () => {
    expect(readSettings(createMemoryStore({ "gobblet.settings.v1": "{oops" }))).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(readSettings(createMemoryStore({ "gobblet.settings.v1": "42" }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("honours an explicit motion and tier choice", () => {
    const settings = readSettings(
      createMemoryStore({
        "gobblet.settings.v1": JSON.stringify({ motion: "full", renderTier: "reduced" }),
      }),
    );

    expect(settings.motion).toBe("full");
    expect(settings.renderTier).toBe("reduced");
  });
});

describe("local store", () => {
  it("reads and writes the browser storage", () => {
    const store = createLocalStore();

    store.set("k", "v");
    expect(store.get("k")).toBe("v");

    store.remove("k");
    expect(store.get("k")).toBeNull();
  });

  it("survives storage that throws", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });

    const store = createLocalStore();
    expect(store.get("k")).toBeNull();
    expect(() => {
      store.set("k", "v");
    }).not.toThrow();
    expect(() => {
      store.remove("k");
    }).not.toThrow();

    if (original) {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});
