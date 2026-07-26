import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiProvider } from "../src/api/provider";
import { COMPLETED_MATCH_QUERY_KEYS, queryKeys } from "../src/api/queries";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { MatchScreen } from "../src/screens/MatchScreen";
import { useSessionStore } from "../src/session/store";
import { useSettingsStore } from "../src/settings/store";
import { LIGHT_ACTOR_ID, MATCH_ID, SERVER_TIME, makeSnapshot } from "./helpers/match";
import { FakeTransport } from "./helpers/transport";
import { fakeFetch, testQueryClient } from "./helpers/render";
import { ApiClient } from "../src/api/client";

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

function mount(path = `/match/${MATCH_ID}`) {
  const transport = new FakeTransport();
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => "session-token",
    transport,
    now: () => SERVER_TIME,
  });
  const { fetch: fetchImpl, calls } = fakeFetch({});
  const client = new ApiClient({ baseUrl: "http://server.test", fetch: fetchImpl });
  const queryClient: QueryClient = testQueryClient();

  render(
    <ApiProvider client={client} queryClient={queryClient}>
      <SocketProvider socket={socket}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/match/:matchId" element={<MatchScreen />} />
            <Route path="/match" element={<MatchScreen />} />
            <Route path="/" element={<div data-testid="home">home</div>} />
          </Routes>
        </MemoryRouter>
      </SocketProvider>
    </ApiProvider>,
  );

  return { transport, socket, queryClient, calls };
}

async function openMatch(
  transport: FakeTransport,
  snapshot = makeSnapshot(),
  options: { announce?: boolean } = {},
): Promise<void> {
  await act(async () => {
    // The gateway announces the session before it answers, and the seat comes from
    // that announcement, so the order matters here as much as it does in production.
    if (options.announce !== false) {
      transport.fire(SERVER_TO_CLIENT_EVENTS.sessionReady, READY);
    }
    transport.answer("session:authenticate", { ok: true, session: READY });
    await Promise.resolve();
  });
  await act(async () => {
    transport.answerAll("match:sync", { ok: true, snapshot });
    await Promise.resolve();
  });
}

describe("the match screen", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().update({ renderTier: "flat" });
    // A frozen monotonic clock keeps the displayed time predictable; the ticking
    // itself is proved in packages/game-ui/test/use-clock-display.test.tsx.
    vi.spyOn(performance, "now").mockReturnValue(1_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for the snapshot before it draws anything", () => {
    mount();

    expect(screen.getByText("Opening the match")).toBeInTheDocument();
  });

  it("draws the board, both clocks and the local seat", async () => {
    const { transport } = mount();
    await openMatch(transport);

    expect(await screen.findByTestId("match-screen")).toBeInTheDocument();
    expect(screen.getByTestId("flat-board")).toBeInTheDocument();
    expect(screen.getByTestId("clock-light")).toHaveTextContent("5:00");
    expect(screen.getByTestId("clock-dark")).toHaveTextContent("5:00");
    expect(screen.getByTestId("player-light")).toHaveAttribute("data-to-move", "true");
    expect(screen.getByTestId("player-light")).toHaveTextContent("you");
    expect(screen.getByTestId("match-mode")).toHaveTextContent("casual");
  });

  it("submits a move the player makes on the board", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("reserve-light-0"));
    await userEvent.click(screen.getByTestId("square-r1c1"));

    await waitFor(() => {
      expect(transport.payloadsFor("match:move")).toHaveLength(1);
    });
    expect(transport.payloadsFor("match:move")[0]).toMatchObject({
      matchId: MATCH_ID,
      expectedVersion: 0,
      payload: { move: { kind: "reserve", reserveStack: 0, to: "r1c1" } },
    });
  });

  it("locks the board while a command waits for its answer", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("reserve-light-0"));
    await userEvent.click(screen.getByTestId("square-r1c1"));

    await waitFor(() => {
      expect(screen.getByTestId("reserve-light-1")).toBeDisabled();
    });
  });

  it("shows the rejection reason and lets the player dismiss it", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("reserve-light-0"));
    await userEvent.click(screen.getByTestId("square-r1c1"));

    const sent = transport.payloadsFor("match:move")[0] as { commandId: string };
    await act(async () => {
      transport.answer("match:move", {
        ok: false,
        commandId: sent.commandId,
        reason: "not-your-turn",
      });
      await Promise.resolve();
    });

    const notice = await screen.findByTestId("match-notice");
    expect(notice).toHaveTextContent("not your turn");

    await act(async () => {
      transport.answerAll("match:sync", { ok: true, snapshot: makeSnapshot() });
      await Promise.resolve();
    });
    await userEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByTestId("match-notice")).not.toBeInTheDocument();
  });

  it("resigns when the player asks to", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("resign"));

    await waitFor(() => {
      expect(transport.payloadsFor("match:resign")).toHaveLength(1);
    });
  });

  it("marks the connection as reconnecting and freezes the board", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.disconnect();
    });

    expect(await screen.findByTestId("reconnecting")).toBeInTheDocument();
    expect(screen.getByTestId("reserve-light-0")).toBeDisabled();
  });

  it("shows the result and offers a rematch", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "line",
      });
    });

    expect(await screen.findByTestId("result-dialog")).toHaveTextContent("You won");
    expect(screen.getByTestId("result-reason")).toHaveTextContent("four in a line");
    expect(screen.queryByTestId("resign")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("rematch"));
    await waitFor(() => {
      expect(transport.payloadsFor("match:rematch-request")).toHaveLength(1);
    });
  });

  it("drops the account's cached facts when the match ends", async () => {
    const { transport, queryClient } = mount();
    await openMatch(transport);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "line",
      });
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(COMPLETED_MATCH_QUERY_KEYS.length);
    });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.me,
      queryKeys.matchHistory,
      queryKeys.achievements,
      queryKeys.leaderboards,
    ]);
  });

  it("shows the rating movement of a ranked result", async () => {
    const { transport } = mount();
    await openMatch(transport, makeSnapshot({ mode: "ranked" }));

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "dark",
        reason: "resignation",
        ratings: {
          light: {
            before: 1200,
            after: 1188,
            delta: -12,
            opponentBefore: 1210,
            outcome: "loss",
            formulaVersion: 1,
          },
          dark: {
            before: 1210,
            after: 1222,
            delta: 12,
            opponentBefore: 1200,
            outcome: "win",
            formulaVersion: 1,
          },
        },
      });
    });

    expect(await screen.findByTestId("result-ratings")).toHaveTextContent("ada 1188 (-12)");
    expect(screen.getByTestId("result-ratings")).toHaveTextContent("Guest 1234 1222 (+12)");
    expect(screen.getByTestId("result-dialog")).toHaveTextContent("You lost");
  });

  it("answers an offer the opponent made", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "draw",
        reason: "repetition",
      });
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "offered",
        requestedBy: "33333333-3333-4333-8333-333333333333",
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: null,
      });
    });

    expect(await screen.findByTestId("rematch")).toHaveTextContent("Accept rematch");
    await userEvent.click(screen.getByTestId("decline-rematch"));

    await waitFor(() => {
      expect(transport.payloadsFor("match:rematch-respond")).toEqual([
        { matchId: MATCH_ID, accept: false },
      ]);
    });
  });

  it("leaves the match when the player goes back to play", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "line",
      });
    });

    await userEvent.click(await screen.findByTestId("leave-match"));
    expect(await screen.findByTestId("home")).toBeInTheDocument();
  });

  it("seats an onlooker with no controls at all", async () => {
    const { transport } = mount();
    await openMatch(
      transport,
      makeSnapshot({
        players: {
          ...makeSnapshot().players,
          light: {
            ...makeSnapshot().players.light,
            actorId: "77777777-7777-4777-8777-777777777777",
          },
        },
      }),
    );

    expect(await screen.findByTestId("match-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("resign")).not.toBeInTheDocument();
    expect(screen.getByTestId("reserve-light-0")).toBeDisabled();
  });

  it("accepts an offer the opponent made and follows the new match", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "line",
      });
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "offered",
        requestedBy: "33333333-3333-4333-8333-333333333333",
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: null,
      });
    });

    await userEvent.click(await screen.findByTestId("rematch"));
    await act(async () => {
      transport.answer("match:rematch-respond", { ok: true });
      await Promise.resolve();
    });

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "accepted",
        requestedBy: "33333333-3333-4333-8333-333333333333",
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: "99999999-9999-4999-8999-999999999999",
      });
    });

    await waitFor(() => {
      expect(transport.payloadsFor("match:sync").at(-1)).toEqual({
        matchId: "99999999-9999-4999-8999-999999999999",
      });
    });
  });

  it("reports how an offer of its own ended", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "timeout",
      });
    });
    await userEvent.click(await screen.findByTestId("rematch"));
    await act(async () => {
      transport.answer("match:rematch-request", { ok: false, reason: "opponent-gone" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("result-dialog")).toHaveTextContent("Your opponent has left");

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "offered",
        requestedBy: LIGHT_ACTOR_ID,
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: null,
      });
    });
    expect(await screen.findByTestId("rematch-waiting")).toBeInTheDocument();

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "declined",
        requestedBy: LIGHT_ACTOR_ID,
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: null,
      });
    });
    expect(screen.getByTestId("result-dialog")).toHaveTextContent("Your opponent declined");

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchRematchStatus, {
        matchId: MATCH_ID,
        state: "expired",
        requestedBy: LIGHT_ACTOR_ID,
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: null,
      });
    });
    expect(screen.getByTestId("result-dialog")).toHaveTextContent("The offer expired");
  });

  it("names the winner of a match it only watched", async () => {
    const { transport } = mount();
    await openMatch(
      transport,
      makeSnapshot({
        players: {
          ...makeSnapshot().players,
          light: {
            ...makeSnapshot().players.light,
            actorId: "77777777-7777-4777-8777-777777777777",
          },
        },
      }),
    );

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "dark",
        reason: "admin",
      });
    });

    expect(await screen.findByTestId("result-dialog")).toHaveTextContent("Dark won");
    expect(screen.queryByTestId("rematch")).not.toBeInTheDocument();
  });

  it("calls a draw a draw", async () => {
    const { transport } = mount();
    await openMatch(transport);

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "draw",
        reason: "revealed-line",
      });
    });

    expect(await screen.findByTestId("result-dialog")).toHaveTextContent("A draw");
  });

  it("names a light win it only watched", async () => {
    const { transport } = mount();
    await openMatch(transport, makeSnapshot(), { announce: false });

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "line",
      });
    });

    expect(await screen.findByTestId("result-dialog")).toHaveTextContent("Light won");
  });

  it("marks a clock that is nearly out", async () => {
    const { transport } = mount();
    await openMatch(
      transport,
      makeSnapshot({
        clocks: {
          lightRemainingMs: 8_400,
          darkRemainingMs: 120_000,
          turnStartedAt: SERVER_TIME,
          serverTime: SERVER_TIME,
        },
      }),
    );

    expect(await screen.findByTestId("clock-light")).toHaveAttribute("data-low", "true");
    expect(screen.getByTestId("clock-light")).toHaveTextContent("0:08.4");
    expect(screen.getByTestId("clock-dark")).toHaveAttribute("data-low", "false");
  });

  it("refuses an address that does not name a match", () => {
    mount("/match");

    expect(screen.getByText("This address does not name a match")).toBeInTheDocument();
  });

  it("repeats a fatal error rather than its own guess", async () => {
    const { transport } = mount();

    await act(async () => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.errorFatal, {
        code: "account_suspended",
        message: "This account is suspended",
        action: "contact-support",
      });
      await Promise.resolve();
    });

    expect(await screen.findByText("This account is suspended")).toBeInTheDocument();
  });

  it("reports a connection the server refused", async () => {
    const { transport } = mount();

    await act(async () => {
      transport.answer("session:authenticate", { ok: false, reason: "invalid-token" });
      await Promise.resolve();
    });

    expect(await screen.findByText("The connection was refused")).toBeInTheDocument();
  });
});
