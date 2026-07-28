import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { useMatchChannel } from "../src/match/use-match-channel";
import { LIGHT_ACTOR_ID, MATCH_ID, SERVER_TIME, makeSnapshot } from "./helpers/match";
import { FakeTransport } from "./helpers/transport";

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

const OPENING = { kind: "reserve", reserveStack: 0, to: "r1c1" } as const;

function Harness({ matchId }: Readonly<{ matchId: string | null }>): React.JSX.Element {
  const channel = useMatchChannel(matchId);
  return (
    <div>
      <span data-testid="phase">{channel.state.phase}</span>
      <span data-testid="version">{channel.state.snapshot?.version ?? "none"}</span>
      <span data-testid="active">{channel.view?.activePlayer ?? "none"}</span>
      <span data-testid="locked">{channel.inputLocked ? "locked" : "open"}</span>
      <span data-testid="notice">{channel.state.notice ?? ""}</span>
      <span data-testid="pending">{channel.state.pending?.commandId ?? "none"}</span>
      <button type="button" data-testid="move" onClick={() => channel.submitMove(OPENING)}>
        move
      </button>
      <button type="button" data-testid="resign" onClick={() => channel.resign()}>
        resign
      </button>
      <button type="button" data-testid="dismiss" onClick={channel.dismissNotice}>
        dismiss
      </button>
      <button
        type="button"
        data-testid="select"
        onClick={() => channel.select({ player: "light", kind: "reserve", reserveStack: 0 })}
      >
        select
      </button>
      <span data-testid="selection">{channel.state.selection?.kind ?? "none"}</span>
    </div>
  );
}

function mount(matchId: string | null = MATCH_ID, options: { connected?: boolean } = {}) {
  const transport = new FakeTransport();
  if (options.connected === true) {
    transport.connected = true;
  }
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => "session-token",
    transport,
    now: () => SERVER_TIME,
  });

  const { unmount } = render(
    <SocketProvider socket={socket}>
      <Harness matchId={matchId} />
    </SocketProvider>,
  );

  return { transport, socket, unmount };
}

async function settle(transport: FakeTransport, snapshotVersion = 0): Promise<void> {
  await act(async () => {
    transport.answer("session:authenticate", { ok: true, session: READY });
    await Promise.resolve();
  });
  await act(async () => {
    transport.answerAll("match:sync", {
      ok: true,
      snapshot: makeSnapshot({ version: snapshotVersion }),
    });
    await Promise.resolve();
  });
}

describe("useMatchChannel", () => {
  it("authenticates, synchronises and opens the board", async () => {
    const { transport } = mount();

    expect(await screen.findByTestId("phase")).toHaveTextContent("authenticating");
    await settle(transport);

    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("version")).toHaveTextContent("0");
    expect(screen.getByTestId("locked")).toHaveTextContent("open");
  });

  it("shows a pending move as a preview and locks the board until it is answered", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("move"));
    });

    expect(screen.getByTestId("locked")).toHaveTextContent("locked");
    expect(screen.getByTestId("active")).toHaveTextContent("dark");
    expect(screen.getByTestId("version")).toHaveTextContent("0");

    const [payload] = transport.payloadsFor("match:move") as [{ commandId: string }];
    await act(async () => {
      transport.answer("match:move", { ok: true, commandId: payload.commandId, newVersion: 1 });
      await Promise.resolve();
    });

    expect(screen.getByTestId("locked")).toHaveTextContent("open");
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("returns the piece and explains a rejection", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("move"));
    });
    const [payload] = transport.payloadsFor("match:move") as [{ commandId: string }];

    await act(async () => {
      transport.answer("match:move", {
        ok: false,
        commandId: payload.commandId,
        reason: "not-your-turn",
        snapshot: makeSnapshot({ version: 2 }),
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("It was not your turn");
    expect(screen.getByTestId("version")).toHaveTextContent("2");
    expect(screen.getByTestId("active")).toHaveTextContent("light");

    await act(async () => {
      await userEvent.click(screen.getByTestId("dismiss"));
    });
    expect(screen.getByTestId("notice")).toHaveTextContent("");
  });

  it("keeps the command pending when the acknowledgement never arrives and retries it once reconnected", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("move"));
    });
    const [first] = transport.payloadsFor("match:move") as [{ commandId: string }];

    await act(async () => {
      transport.answer("match:move", { ok: "nonsense" });
      await Promise.resolve();
    });
    expect(screen.getByTestId("pending")).toHaveTextContent(first.commandId);

    await act(async () => {
      transport.fire("connect");
      await Promise.resolve();
    });
    await settle(transport);

    const commandIds = (transport.payloadsFor("match:move") as { commandId: string }[]).map(
      (entry) => entry.commandId,
    );
    expect(commandIds).toEqual([first.commandId, first.commandId]);
  });

  it("does not retry a command the board has moved past", async () => {
    // Production told every player "The board had already moved on" after a
    // reconnection: the retry was decided from state captured before the fresh
    // snapshot arrived, so a command the board had passed was sent anyway and the
    // rejection it earned was shown to the player as if their move had been refused.
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("move"));
    });
    const [first] = transport.payloadsFor("match:move") as [{ commandId: string }];

    await act(async () => {
      transport.answer("match:move", { ok: "nonsense" });
      await Promise.resolve();
    });
    expect(screen.getByTestId("pending")).toHaveTextContent(first.commandId);

    await act(async () => {
      transport.fire("connect");
      await Promise.resolve();
    });
    // The snapshot the server answers with is two versions on, so this command is
    // either already played or no longer playable. Either way, resending it asks a
    // question that has been answered.
    await settle(transport, 2);

    const commandIds = (transport.payloadsFor("match:move") as { commandId: string }[]).map(
      (entry) => entry.commandId,
    );
    expect(commandIds).toEqual([first.commandId]);
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
    expect(screen.getByTestId("notice")).not.toHaveTextContent("board had already moved on");
  });

  it("retries an unacknowledged resignation once the connection returns", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("resign"));
    });
    const [first] = transport.payloadsFor("match:resign") as [{ commandId: string }];

    await act(async () => {
      transport.answer("match:resign", { ok: "nonsense" });
      await Promise.resolve();
    });
    expect(screen.getByTestId("pending")).toHaveTextContent(first.commandId);

    await act(async () => {
      transport.fire("connect");
      await Promise.resolve();
    });
    await settle(transport);

    expect(
      (transport.payloadsFor("match:resign") as { commandId: string }[]).map((e) => e.commandId),
    ).toEqual([first.commandId, first.commandId]);
  });

  it("asks for a snapshot when a broadcast skips a version", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      transport.fire("match:move-committed", {
        matchId: MATCH_ID,
        version: 4,
        move: OPENING,
        activePlayer: "dark",
        actor: "light",
        clocks: makeSnapshot().clocks,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transport.payloadsFor("match:sync").length).toBe(2);
    });

    await act(async () => {
      transport.answer("match:sync", { ok: true, snapshot: makeSnapshot({ version: 4 }) });
      await Promise.resolve();
    });
    expect(screen.getByTestId("version")).toHaveTextContent("4");
  });

  it("applies a committed move, a clock tick and the end of the match", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      transport.fire("match:move-committed", {
        matchId: MATCH_ID,
        version: 1,
        move: OPENING,
        activePlayer: "dark",
        actor: "light",
        clocks: {
          lightRemainingMs: 298_000,
          darkRemainingMs: 300_000,
          turnStartedAt: SERVER_TIME + 2000,
          serverTime: SERVER_TIME + 2000,
        },
      });
      transport.fire("match:clock-sync", {
        matchId: MATCH_ID,
        version: 1,
        activePlayer: "dark",
        lightRemainingMs: 298_000,
        darkRemainingMs: 295_000,
        serverTime: SERVER_TIME + 7000,
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("version")).toHaveTextContent("1");
    expect(screen.getByTestId("active")).toHaveTextContent("dark");

    await act(async () => {
      transport.fire("match:ended", {
        matchId: MATCH_ID,
        version: 2,
        result: "light",
        reason: "line",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transport.payloadsFor("match:sync").length).toBe(2);
    });
  });

  it("submits a resignation with the held version", async () => {
    const { transport } = mount();
    await settle(transport, 3);

    await act(async () => {
      await userEvent.click(screen.getByTestId("resign"));
    });

    expect(transport.payloadsFor("match:resign")).toEqual([
      {
        commandId: expect.any(String),
        matchId: MATCH_ID,
        expectedVersion: 3,
        sentAtClient: SERVER_TIME,
        payload: {},
      },
    ]);
  });

  it("refuses input that arrives while a command is outstanding", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("move"));
      await userEvent.click(screen.getByTestId("move"));
      await userEvent.click(screen.getByTestId("resign"));
    });

    expect(transport.payloadsFor("match:move")).toHaveLength(1);
    expect(transport.payloadsFor("match:resign")).toHaveLength(0);
  });

  it("says so when the handshake is refused", async () => {
    const { transport } = mount();

    await act(async () => {
      transport.answer("session:authenticate", {
        ok: false,
        error: { code: "unsupported_client", message: "Too old", action: "update-client" },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("lost");
    expect(screen.getByTestId("notice")).toHaveTextContent("The connection was refused");
  });

  it("says so when the match is not available", async () => {
    const { transport } = mount();

    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    await act(async () => {
      transport.answer("match:sync", { ok: false, reason: "not-authorized" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("lost");
    expect(screen.getByTestId("notice")).toHaveTextContent("no longer available");
  });

  it("reports a snapshot request that could not be read", async () => {
    const { transport } = mount();

    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    await act(async () => {
      transport.answer("match:sync", { ok: true });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("could not be refreshed");
  });

  it("holds no match when none was named, and reports what the socket loses", async () => {
    const { transport } = mount(null);

    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    expect(transport.payloadsFor("match:sync")).toHaveLength(0);
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");

    await act(async () => {
      transport.fire("disconnect", "transport close");
      await Promise.resolve();
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("reconnecting");

    await act(async () => {
      transport.fire("match:snapshot", { matchId: MATCH_ID });
      await Promise.resolve();
    });
    expect(screen.getByTestId("notice")).toHaveTextContent("unreadable");
  });

  it("reports a recoverable error and a fatal one", async () => {
    const { transport } = mount(null);

    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      transport.fire("error:recoverable", {
        code: "validation_failed",
        message: "The queue request is not valid",
        retryable: true,
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId("notice")).toHaveTextContent("The queue request is not valid");

    await act(async () => {
      transport.fire("error:fatal", {
        code: "account_suspended",
        message: "This account is suspended",
        action: "contact-support",
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("lost");
    expect(screen.getByTestId("notice")).toHaveTextContent("This account is suspended");
  });

  it("takes the snapshot a pairing carried", async () => {
    const { transport } = mount(null);

    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      transport.fire("match:found", {
        matchId: MATCH_ID,
        mode: "casual",
        timeControlSeconds: 300,
        yourColor: "light",
        opponent: { actorType: "guest", displayName: "Guest 1234", rating: null },
        waitedMs: 400,
        snapshot: makeSnapshot({ version: 0 }),
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("version")).toHaveTextContent("0");
  });

  it("opens itself when it mounts on a connection that is already up", async () => {
    const { transport } = mount(MATCH_ID, { connected: true });

    await settle(transport);
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
  });

  it("takes a snapshot the server pushed on its own", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      transport.fire("match:snapshot", makeSnapshot({ version: 6 }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("version")).toHaveTextContent("6");
  });

  it("shows a reconnection attempt as such", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      transport.fire("reconnect_attempt", 2);
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("reconnecting");
  });

  it("holds the selection the board reports", async () => {
    const { transport } = mount();
    await settle(transport);

    await act(async () => {
      await userEvent.click(screen.getByTestId("select"));
    });

    expect(screen.getByTestId("selection")).toHaveTextContent("reserve");
  });

  it("drops a handshake that finishes after the view is gone", async () => {
    const { transport, unmount } = mount();

    unmount();
    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });

    expect(transport.payloadsFor("match:sync")).toHaveLength(0);
  });

  it("refuses to work outside a provider", () => {
    expect(() => render(<Harness matchId={null} />)).toThrow("outside a SocketProvider");
  });
});
