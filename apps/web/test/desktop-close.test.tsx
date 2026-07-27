import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { ApiProvider } from "../src/api/provider";
import type { DesktopWindow } from "../src/desktop/bridge";
import { installCloseGuard } from "../src/desktop/close-guard";
import { useCloseGuard } from "../src/desktop/useCloseGuard";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { MatchScreen } from "../src/screens/MatchScreen";
import { LIGHT_ACTOR_ID, MATCH_ID, SERVER_TIME, makeSnapshot } from "./helpers/match";
import { fakeFetch, testQueryClient } from "./helpers/render";
import { FakeTransport } from "./helpers/transport";

/**
 * Closing the window during a match asks first, and confirming resigns before the
 * window goes (spec section 5.4, appendix P8.9). The interception is client code, so
 * it is driven here with a fake window rather than in Rust.
 */

type Scene = Readonly<{
  window: DesktopWindow;
  requestClose: () => Promise<void>;
  closed: () => number;
}>;

function fakeWindow(): Scene {
  let handler: (() => Promise<void>) | null = null;
  let closes = 0;
  return {
    window: {
      onCloseRequested: (next) => {
        handler = next;
        return Promise.resolve(() => {
          handler = null;
        });
      },
      close: () => {
        closes += 1;
        return Promise.resolve();
      },
    },
    requestClose: async () => {
      await handler?.();
    },
    closed: () => closes,
  };
}

describe("the close guard on its own", () => {
  it("closes at once when there is no match to lose", async () => {
    const scene = fakeWindow();
    const confirm = vi.fn(() => Promise.resolve(true));

    await installCloseGuard({
      window: scene.window,
      inMatch: () => false,
      confirm,
      resign: () => Promise.resolve(),
    });
    await scene.requestClose();

    expect(confirm).not.toHaveBeenCalled();
    expect(scene.closed()).toBe(1);
  });

  it("keeps the window open when the player says keep playing", async () => {
    const scene = fakeWindow();
    const resign = vi.fn(() => Promise.resolve());

    await installCloseGuard({
      window: scene.window,
      inMatch: () => true,
      confirm: () => Promise.resolve(false),
      resign,
    });
    await scene.requestClose();

    expect(resign).not.toHaveBeenCalled();
    expect(scene.closed()).toBe(0);
  });

  it("waits for the resignation before the window goes", async () => {
    const scene = fakeWindow();
    const order: string[] = [];

    await installCloseGuard({
      window: {
        onCloseRequested: scene.window.onCloseRequested,
        close: () => {
          order.push("closed");
          return scene.window.close();
        },
      },
      inMatch: () => true,
      confirm: () => Promise.resolve(true),
      resign: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("resigned");
            resolve();
          }, 0);
        }),
    });
    await scene.requestClose();

    expect(order).toEqual(["resigned", "closed"]);
  });

  it("still closes when the resignation is not acknowledged", async () => {
    const scene = fakeWindow();

    await installCloseGuard({
      window: scene.window,
      inMatch: () => true,
      confirm: () => Promise.resolve(true),
      resign: () => Promise.reject(new Error("the socket is gone")),
    });
    await scene.requestClose();

    expect(scene.closed()).toBe(1);
  });
});

function Harness({ window: desktopWindow }: { window: DesktopWindow }): React.JSX.Element {
  useCloseGuard({
    inMatch: true,
    confirm: () => Promise.resolve(false),
    resign: () => Promise.resolve(),
    window: desktopWindow,
  });
  return <div data-testid="harness" />;
}

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

async function openMatch(desktopWindow: DesktopWindow): Promise<FakeTransport> {
  const transport = new FakeTransport();
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => "session-token",
    transport,
    now: () => SERVER_TIME,
  });
  const { fetch: fetchImpl } = fakeFetch({});

  render(
    <ApiProvider
      client={new ApiClient({ baseUrl: "http://server.test", fetch: fetchImpl })}
      queryClient={testQueryClient()}
    >
      <SocketProvider socket={socket}>
        <MemoryRouter initialEntries={[`/match/${MATCH_ID}`]}>
          <Routes>
            <Route path="/match/:matchId" element={<MatchScreen desktopWindow={desktopWindow} />} />
          </Routes>
        </MemoryRouter>
      </SocketProvider>
    </ApiProvider>,
  );

  await act(async () => {
    transport.fire(SERVER_TO_CLIENT_EVENTS.sessionReady, READY);
    transport.answer("session:authenticate", { ok: true, session: READY });
    await Promise.resolve();
  });
  await act(async () => {
    transport.answerAll("match:sync", { ok: true, snapshot: makeSnapshot() });
    await Promise.resolve();
  });
  return transport;
}

describe("registering the guard", () => {
  it("takes down a listener that finished registering after the screen closed", async () => {
    const unlisten = vi.fn();
    const slowWindow: DesktopWindow = {
      onCloseRequested: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(unlisten), 0);
        }),
      close: () => Promise.resolve(),
    };

    const view = render(<Harness window={slowWindow} />);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("the close guard in the match screen", () => {
  it("asks the player, resigns and closes", async () => {
    const scene = fakeWindow();
    const transport = await openMatch(scene.window);

    void scene.requestClose();
    await userEvent.click(await screen.findByTestId("quit-resign"));
    await act(async () => {
      transport.answerAll("match:resign", { ok: true, version: 1, commandId: "c" });
      await Promise.resolve();
    });

    expect(transport.payloadsFor("match:resign")).toHaveLength(1);
    await waitFor(() => {
      expect(scene.closed()).toBe(1);
    });
  });

  it("keeps the player in the match when the question is dismissed", async () => {
    const scene = fakeWindow();
    const transport = await openMatch(scene.window);

    void scene.requestClose();
    await userEvent.click(await screen.findByTestId("quit-cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("quit-dialog")).not.toBeInTheDocument();
    });
    expect(transport.payloadsFor("match:resign")).toHaveLength(0);
    expect(scene.closed()).toBe(0);
  });
});
