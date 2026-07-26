import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { useRematch } from "../src/match/use-rematch";
import { DARK_ACTOR_ID, LIGHT_ACTOR_ID, MATCH_ID, SERVER_TIME } from "./helpers/match";
import { FakeTransport } from "./helpers/transport";

const NEXT_MATCH_ID = "55555555-5555-4555-8555-555555555555";

function offered(requestedBy: string) {
  return {
    matchId: MATCH_ID,
    state: "offered",
    requestedBy,
    expiresAt: SERVER_TIME + 30_000,
    nextMatchId: null,
  };
}

function Harness({ matchId }: Readonly<{ matchId: string | null }>): React.JSX.Element {
  const rematch = useRematch(matchId, LIGHT_ACTOR_ID);
  return (
    <div>
      <span data-testid="state">{rematch.status?.state ?? "none"}</span>
      <span data-testid="mine">{rematch.offeredByMe ? "mine" : "theirs"}</span>
      <span data-testid="next">{rematch.nextMatchId ?? "none"}</span>
      <span data-testid="notice">{rematch.notice ?? ""}</span>
      <span data-testid="pending">{rematch.pending ? "pending" : "idle"}</span>
      <button type="button" data-testid="offer" onClick={rematch.offer}>
        offer
      </button>
      <button
        type="button"
        data-testid="accept"
        onClick={() => {
          rematch.respond(true);
        }}
      >
        accept
      </button>
      <button
        type="button"
        data-testid="decline"
        onClick={() => {
          rematch.respond(false);
        }}
      >
        decline
      </button>
    </div>
  );
}

function mount(matchId: string | null = MATCH_ID) {
  const transport = new FakeTransport();
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => "session-token",
    transport,
    now: () => SERVER_TIME,
  });

  const view = render(
    <SocketProvider socket={socket}>
      <Harness matchId={matchId} />
    </SocketProvider>,
  );

  return { transport, view, socket };
}

describe("rematch offers", () => {
  it("offers a rematch and waits for the answer", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("offer"));
    expect(screen.getByTestId("pending")).toHaveTextContent("pending");

    await act(async () => {
      transport.answer("match:rematch-request", { ok: true, status: offered(LIGHT_ACTOR_ID) });
      await Promise.resolve();
    });

    expect(screen.getByTestId("pending")).toHaveTextContent("idle");

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, offered(LIGHT_ACTOR_ID));
    });

    expect(screen.getByTestId("state")).toHaveTextContent("offered");
    expect(screen.getByTestId("mine")).toHaveTextContent("mine");
  });

  it("recognises an offer that came from the opponent", () => {
    const { transport } = mount();

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, offered(DARK_ACTOR_ID));
    });

    expect(screen.getByTestId("mine")).toHaveTextContent("theirs");
  });

  it("answers an offer and follows the accepted match", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("accept"));
    await act(async () => {
      transport.answer("match:rematch-respond", {
        ok: true,
        status: {
          matchId: MATCH_ID,
          state: "accepted",
          requestedBy: DARK_ACTOR_ID,
          expiresAt: SERVER_TIME + 30_000,
          nextMatchId: NEXT_MATCH_ID,
        },
      });
      await Promise.resolve();
    });

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "accepted",
        requestedBy: DARK_ACTOR_ID,
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: NEXT_MATCH_ID,
      });
    });

    expect(screen.getByTestId("next")).toHaveTextContent(NEXT_MATCH_ID);
  });

  it("declines without following anything", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("decline"));
    await act(async () => {
      transport.answer("match:rematch-respond", {
        ok: true,
        status: {
          matchId: MATCH_ID,
          state: "declined",
          requestedBy: DARK_ACTOR_ID,
          expiresAt: SERVER_TIME + 30_000,
          nextMatchId: null,
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("next")).toHaveTextContent("none");
  });

  it("explains a refusal", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("offer"));
    await act(async () => {
      transport.answer("match:rematch-request", { ok: false, reason: "opponent-gone" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("opponent has left");
  });

  it("explains a refusal to answer an offer", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("accept"));
    await act(async () => {
      transport.answer("match:rematch-respond", { ok: false, reason: "no-offer" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("no offer to answer");
  });

  it("reports an offer that was never acknowledged", async () => {
    const { transport } = mount();

    await userEvent.click(screen.getByTestId("offer"));
    await act(async () => {
      transport.answer("match:rematch-request", { ok: "sure" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("notice")).toHaveTextContent("not acknowledged");
    expect(screen.getByTestId("pending")).toHaveTextContent("idle");
  });

  it("ignores a status that belongs to another match", () => {
    const { transport } = mount();

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        ...offered(LIGHT_ACTOR_ID),
        matchId: NEXT_MATCH_ID,
      });
    });

    expect(screen.getByTestId("state")).toHaveTextContent("none");
  });

  it("does nothing at all without a finished match", async () => {
    const { transport } = mount(null);

    await userEvent.click(screen.getByTestId("offer"));

    expect(transport.payloadsFor("match:rematch-request")).toHaveLength(0);
    expect(screen.getByTestId("pending")).toHaveTextContent("idle");
  });

  it("forgets the previous offer when the match changes", async () => {
    const { transport, view, socket } = mount();

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, offered(LIGHT_ACTOR_ID));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("offered");

    await act(async () => {
      view.rerender(
        <SocketProvider socket={socket}>
          <Harness matchId={NEXT_MATCH_ID} />
        </SocketProvider>,
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId("state")).toHaveTextContent("none");
  });
});
