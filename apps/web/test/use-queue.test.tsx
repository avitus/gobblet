import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { useQueue } from "../src/match/use-queue";
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

const STATUS = {
  mode: "casual",
  timeControlSeconds: 300,
  rating: 1200,
  waitingMs: 4_000,
  ratingWindow: null,
  depth: 2,
  serverTime: SERVER_TIME,
};

const FOUND = {
  matchId: MATCH_ID,
  mode: "casual",
  timeControlSeconds: 300,
  yourColor: "light",
  opponent: { actorType: "guest", displayName: "Guest 1234", rating: null },
  waitedMs: 4_200,
  snapshot: makeSnapshot(),
};

function Harness(): React.JSX.Element {
  const queue = useQueue();
  return (
    <div>
      <span data-testid="phase">{queue.phase}</span>
      <span data-testid="depth">{queue.status?.depth ?? "none"}</span>
      <span data-testid="found">{queue.found?.matchId ?? "none"}</span>
      <span data-testid="notice">{queue.notice ?? ""}</span>
      <button
        type="button"
        data-testid="join"
        onClick={() => {
          queue.join({ mode: "casual", timeControlSeconds: 300 });
        }}
      >
        join
      </button>
      <button type="button" data-testid="leave" onClick={queue.leave}>
        leave
      </button>
    </div>
  );
}

function mount() {
  const transport = new FakeTransport();
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => "session-token",
    transport,
    now: () => SERVER_TIME,
  });

  render(
    <SocketProvider socket={socket}>
      <Harness />
    </SocketProvider>,
  );

  return { transport };
}

async function authenticate(transport: FakeTransport): Promise<void> {
  await act(async () => {
    transport.answer("session:authenticate", { ok: true, session: READY });
    await Promise.resolve();
  });
}

describe("the matchmaking queue", () => {
  it("waits after a join is acknowledged as queued", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    expect(screen.getByTestId("phase")).toHaveTextContent("joining");

    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "queued", status: STATUS });
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("waiting");
    expect(screen.getByTestId("depth")).toHaveTextContent("2");
  });

  it("takes a later status update while waiting", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "queued", status: STATUS });
      await Promise.resolve();
    });

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.queueStatus, { ...STATUS, depth: 5 });
    });

    expect(screen.getByTestId("depth")).toHaveTextContent("5");
  });

  it("reports a match the moment the announcement arrives", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchFound, FOUND);
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("matched");
    expect(screen.getByTestId("found")).toHaveTextContent(MATCH_ID);

    // A late acknowledgement of the same join must not send the player back to waiting.
    await act(async () => {
      transport.answer("queue:join", { state: "queued", status: STATUS });
      await Promise.resolve();
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("matched");
  });

  it("accepts an acknowledgement that already names a match", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "matched", matchId: MATCH_ID });
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("matched");
  });

  it("explains a refusal in the player's terms", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "refused", reason: "ineligible" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("refused");
    expect(screen.getByTestId("notice")).toHaveTextContent("verified email");
  });

  it("reports a join that was never acknowledged", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "nonsense" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(screen.getByTestId("notice")).toHaveTextContent("could not be started");
  });

  it("leaves the queue at once and tolerates a stale acknowledgement", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "queued", status: STATUS });
      await Promise.resolve();
    });

    await userEvent.click(screen.getByTestId("leave"));
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");

    await act(async () => {
      transport.answer("queue:leave", { ok: false, reason: "not-queued" });
      await Promise.resolve();
    });
    expect(screen.getByTestId("notice")).toHaveTextContent("");
  });

  it("explains a refused leave that was not merely late", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("leave"));
    await act(async () => {
      transport.answer("queue:leave", { ok: false, reason: "not-authorized" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("Sign in again");
    expect(transport).toBeDefined();
  });

  it("reports a leave that was never acknowledged", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("leave"));
    await act(async () => {
      transport.answer("queue:leave", { ok: "maybe" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("could not be stopped");
  });

  it("stops the search when the connection drops", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("join"));
    await authenticate(transport);
    await act(async () => {
      transport.answer("queue:join", { state: "queued", status: STATUS });
      await Promise.resolve();
    });

    act(() => {
      transport.disconnect();
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(screen.getByTestId("notice")).toHaveTextContent("connection dropped");
  });

  it("passes a recoverable error on, and a fatal one clears the search", () => {
    const { transport } = mount();

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.errorRecoverable, {
        code: "queue_busy",
        message: "The queue is busy",
        retryable: true,
      });
    });
    expect(screen.getByTestId("notice")).toHaveTextContent("The queue is busy");

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.errorFatal, {
        code: "version_unsupported",
        message: "This client is too old",
        action: "update-client",
      });
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(screen.getByTestId("notice")).toHaveTextContent("too old");
  });
});
