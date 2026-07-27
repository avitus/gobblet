import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The adapters that reach the shell. They are trivial by design (ADR-0033), and
 * this is where that is proved: each Tauri module is faked, so the mapping from our
 * ports to their functions is exercised without a window.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@tauri-apps/api/core");
  vi.doUnmock("@tauri-apps/api/window");
  vi.doUnmock("@tauri-apps/plugin-updater");
  vi.doUnmock("@tauri-apps/plugin-process");
});

describe("the credential-store adapter", () => {
  it("calls the three commands the Rust side registers", async () => {
    const invoke = vi.fn((command: string) =>
      Promise.resolve(command === "session_token_read" ? "held" : null),
    );
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const { loadKeyring } = await import("../src/desktop/bridge");

    const keyring = await loadKeyring();
    expect(await keyring.read()).toBe("held");
    await keyring.write("fresh");
    await keyring.clear();

    expect(invoke.mock.calls).toEqual([
      ["session_token_read"],
      ["session_token_write", { token: "fresh" }],
      ["session_token_delete"],
    ]);
  });
});

describe("the window adapter", () => {
  it("prevents the close, hands it to the caller, and destroys on request", async () => {
    const registry: { handler?: (event: { preventDefault: () => void }) => void } = {};
    const unlisten = vi.fn();
    const destroy = vi.fn(() => Promise.resolve());
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        onCloseRequested: (handler: (event: { preventDefault: () => void }) => void) => {
          registry.handler = handler;
          return Promise.resolve(unlisten);
        },
        destroy,
      }),
    }));
    const { loadWindow } = await import("../src/desktop/bridge");

    const handled: string[] = [];
    const window = await loadWindow();
    const stop = await window.onCloseRequested(() => {
      handled.push("asked");
      return Promise.resolve();
    });
    const prevented = vi.fn();
    registry.handler?.({ preventDefault: prevented });
    await window.close();
    stop();

    expect(prevented).toHaveBeenCalledTimes(1);
    expect(handled).toEqual(["asked"]);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("the updater adapter", () => {
  it("answers nothing when the plugin says there is no update", async () => {
    vi.doMock("@tauri-apps/plugin-updater", () => ({ check: () => Promise.resolve(null) }));
    vi.doMock("@tauri-apps/plugin-process", () => ({ relaunch: () => Promise.resolve() }));
    const { loadUpdater } = await import("../src/desktop/bridge");

    expect(await (await loadUpdater()).check()).toBeNull();
  });

  it("hands back the version and an install that the plugin performs", async () => {
    const downloadAndInstall = vi.fn(() => Promise.resolve());
    const relaunch = vi.fn(() => Promise.resolve());
    vi.doMock("@tauri-apps/plugin-updater", () => ({
      check: () => Promise.resolve({ version: "2.0.0", downloadAndInstall }),
    }));
    vi.doMock("@tauri-apps/plugin-process", () => ({ relaunch }));
    const { loadUpdater } = await import("../src/desktop/bridge");

    const updater = await loadUpdater();
    const update = await updater.check();
    await update?.install();
    await updater.relaunch();

    expect(update?.version).toBe("2.0.0");
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("the availability check", () => {
  it("is false in a browser", async () => {
    const { desktopBridgeAvailable } = await import("../src/desktop/bridge");

    expect(desktopBridgeAvailable()).toBe(false);
  });
});

/**
 * The two places the shell is loaded for real rather than injected: the update
 * prompt in the shell and the close guard in the match screen. Both are mounted
 * here against faked Tauri modules, so the loading itself is covered and a browser
 * is proved to load nothing.
 */

function pretendDesktop(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("loading the shell from the components", () => {
  afterEach(() => {
    if ("__TAURI_INTERNALS__" in window) {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  it("starts the update client from the plugin when the shell is present", async () => {
    pretendDesktop();
    const check = vi.fn(() => Promise.resolve(null));
    vi.doMock("@tauri-apps/plugin-updater", () => ({ check }));
    vi.doMock("@tauri-apps/plugin-process", () => ({ relaunch: () => Promise.resolve() }));
    const { DesktopUpdates } = await import("../src/desktop/DesktopUpdates");

    render(<DesktopUpdates />);
    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("update-dialog")).not.toBeInTheDocument();
  });

  it("gives up quietly when the update plugin cannot be loaded", async () => {
    pretendDesktop();
    vi.doMock("@tauri-apps/plugin-updater", () => {
      throw new Error("no plugin in this build");
    });
    vi.doMock("@tauri-apps/plugin-process", () => ({ relaunch: () => Promise.resolve() }));
    const { DesktopUpdates } = await import("../src/desktop/DesktopUpdates");

    render(<DesktopUpdates />);
    await flush();

    expect(screen.queryByTestId("update-dialog")).not.toBeInTheDocument();
  });

  it("does not start anything the window has already been closed on", async () => {
    pretendDesktop();
    const check = vi.fn(() => Promise.resolve(null));
    vi.doMock("@tauri-apps/plugin-updater", () => ({ check }));
    vi.doMock("@tauri-apps/plugin-process", () => ({ relaunch: () => Promise.resolve() }));
    const { DesktopUpdates } = await import("../src/desktop/DesktopUpdates");

    render(<DesktopUpdates />).unmount();
    await flush();

    expect(check).not.toHaveBeenCalled();
  });
});

describe("loading the window from the close guard", () => {
  afterEach(() => {
    if ("__TAURI_INTERNALS__" in window) {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  async function harness(): Promise<{
    Screen: () => React.JSX.Element;
    unlisten: ReturnType<typeof vi.fn>;
    registered: () => boolean;
  }> {
    const unlisten = vi.fn();
    let handler: unknown = null;
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        onCloseRequested: (next: unknown) => {
          handler = next;
          return Promise.resolve(unlisten);
        },
        destroy: () => Promise.resolve(),
      }),
    }));
    const { useCloseGuard } = await import("../src/desktop/useCloseGuard");
    const Screen = (): React.JSX.Element => {
      useCloseGuard({
        inMatch: true,
        confirm: () => Promise.resolve(true),
        resign: () => Promise.resolve(),
      });
      return <div data-testid="screen" />;
    };
    return { Screen, unlisten, registered: () => handler !== null };
  }

  it("registers on the real window and takes the listener down again", async () => {
    pretendDesktop();
    const { Screen, unlisten, registered } = await harness();

    const view = render(<Screen />);
    await waitFor(() => {
      expect(registered()).toBe(true);
    });
    view.unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not register at all when the screen has gone before the load returns", async () => {
    pretendDesktop();
    const { Screen, unlisten, registered } = await harness();

    render(<Screen />).unmount();
    await flush();

    expect(registered()).toBe(false);
    expect(unlisten).not.toHaveBeenCalled();
  });

  it("registers nothing in a browser", async () => {
    const { Screen, registered } = await harness();

    render(<Screen />);
    await flush();

    expect(registered()).toBe(false);
  });

  it("gives up quietly when the window module cannot be loaded", async () => {
    pretendDesktop();
    vi.doMock("@tauri-apps/api/window", () => {
      throw new Error("no window module in this build");
    });
    const { useCloseGuard } = await import("../src/desktop/useCloseGuard");
    const Screen = (): React.JSX.Element => {
      useCloseGuard({
        inMatch: false,
        confirm: () => Promise.resolve(false),
        resign: () => Promise.resolve(),
      });
      return <div data-testid="screen" />;
    };

    render(<Screen />);
    await flush();

    expect(screen.getByTestId("screen")).toBeInTheDocument();
  });
});
