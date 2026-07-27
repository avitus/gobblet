import type { SessionReady } from "@gobblet/protocol";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createLocalStore, type KeyValueStore } from "../storage/local-store";

/**
 * What the client remembers between reloads: the opaque bearer token and enough
 * identity to render a header before the socket handshake answers. No match fact
 * is ever kept here (ADR-0020).
 */
export type StoredSession = Readonly<{
  token: string;
  kind: "guest" | "account";
  displayName: string;
  username: string | null;
}>;

export type SessionState = Readonly<{
  session: StoredSession | null;
  /** The server's own view of who this connection is, from `session:ready`. */
  actor: SessionReady | null;
  signedIn: (session: StoredSession) => void;
  signedOut: () => void;
  actorResolved: (actor: SessionReady) => void;
  actorLost: () => void;
}>;

const SESSION_STORAGE_NAME = "gobblet.session.v1";

function readStored(store: KeyValueStore): StoredSession | null {
  const raw = store.get(SESSION_STORAGE_NAME);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.token !== "string" ||
      (candidate.kind !== "guest" && candidate.kind !== "account") ||
      typeof candidate.displayName !== "string"
    ) {
      return null;
    }
    return {
      token: candidate.token,
      kind: candidate.kind,
      displayName: candidate.displayName,
      username: typeof candidate.username === "string" ? candidate.username : null,
    };
  } catch {
    return null;
  }
}

export function createSessionStore(
  store: KeyValueStore = createLocalStore(),
): UseBoundStore<StoreApi<SessionState>> {
  return create<SessionState>((set) => ({
    session: readStored(store),
    actor: null,
    signedIn: (session) => {
      store.set(SESSION_STORAGE_NAME, JSON.stringify(session));
      set({ session });
    },
    signedOut: () => {
      store.remove(SESSION_STORAGE_NAME);
      set({ session: null, actor: null });
    },
    actorResolved: (actor) => {
      set((current) =>
        current.session === null
          ? { actor }
          : {
              actor,
              session: { ...current.session, displayName: actor.displayName },
            },
      );
    },
    actorLost: () => {
      set({ actor: null });
    },
  }));
}

/**
 * The singleton reads through one indirection so the desktop can swap `localStorage`
 * for the credential store before the first render (ADR-0033) without every screen
 * having to be handed a store.
 */
let backing: KeyValueStore = createLocalStore();

export const useSessionStore = createSessionStore({
  get: (key) => backing.get(key),
  set: (key, value) => {
    backing.set(key, value);
  },
  remove: (key) => {
    backing.remove(key);
  },
});

/** Takes the given store as the session's home, and adopts what it already holds. */
export function adoptSessionStorage(store: KeyValueStore): void {
  backing = store;
  useSessionStore.setState({ session: readStored(store) });
}

export function sessionToken(): string | null {
  return useSessionStore.getState().session?.token ?? null;
}
