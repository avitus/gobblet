import { isDesktop } from "./host";

/**
 * The only module that names a Tauri package. Everything else in the client takes
 * one of these ports as an argument, so the desktop paths are ordinary units to
 * test and the browser bundle never loads a shell module: each import here is
 * dynamic and only reached behind `isDesktop()`.
 */

export type KeyringBridge = Readonly<{
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  clear: () => Promise<void>;
}>;

export type DesktopWindow = Readonly<{
  onCloseRequested: (handler: () => Promise<void>) => Promise<() => void>;
  close: () => Promise<void>;
}>;

export type DownloadedUpdate = Readonly<{
  version: string;
  install: () => Promise<void>;
}>;

export type UpdaterBridge = Readonly<{
  check: () => Promise<DownloadedUpdate | null>;
  relaunch: () => Promise<void>;
}>;

export async function loadKeyring(): Promise<KeyringBridge> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    read: () => invoke<string | null>("session_token_read"),
    write: (token) => invoke("session_token_write", { token }),
    clear: () => invoke("session_token_delete"),
  };
}

export async function loadWindow(): Promise<DesktopWindow> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  return {
    onCloseRequested: async (handler) => {
      const unlisten = await current.onCloseRequested((event) => {
        // Preventing here is what turns a close into a question; the handler
        // closes the window itself once the player has answered.
        event.preventDefault();
        void handler();
      });
      return unlisten;
    },
    close: () => current.destroy(),
  };
}

export async function loadUpdater(): Promise<UpdaterBridge> {
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  return {
    check: async () => {
      const update = await check();
      if (update === null) {
        return null;
      }
      return {
        version: update.version,
        install: () => update.downloadAndInstall(),
      };
    },
    relaunch,
  };
}

/** Nothing to load in a browser, which is what the callers check first. */
export function desktopBridgeAvailable(): boolean {
  return isDesktop();
}
