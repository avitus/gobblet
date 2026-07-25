/**
 * `localStorage` throws rather than degrading in a few real situations: Safari's
 * private mode, a blocked third-party context, and a full quota. The client
 * treats storage as a cache it can lose, so every failure becomes "no value".
 */
export type KeyValueStore = Readonly<{
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
}>;

export function createLocalStore(): KeyValueStore {
  return {
    get: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A player with storage disabled keeps working for this tab only.
      }
    },
    remove: (key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing to do: the value was already unreachable.
      }
    },
  };
}

export function createMemoryStore(initial: Readonly<Record<string, string>> = {}): KeyValueStore {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}
