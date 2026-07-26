import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiClient } from "../src/api/client";
import { ApiProvider } from "../src/api/provider";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { PlayScreen } from "../src/screens/PlayScreen";
import { useSessionStore } from "../src/session/store";
import { LIGHT_ACTOR_ID, MATCH_ID, SERVER_TIME, makeSnapshot } from "./helpers/match";
import { FakeTransport } from "./helpers/transport";
import { fakeFetch, testQueryClient } from "./helpers/render";

const CONFIG = {
  appEnv: "local",
  appVersion: "1.0.0",
  minSupportedClientVersion: "0.1.0",
  modes: ["casual", "ranked"],
  timeControlsSeconds: [180, 300, 600, 900],
};

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

const VERIFIED_ME = {
  account: {
    userId: LIGHT_ACTOR_ID,
    username: "ada",
    email: "ada@example.com",
    emailVerified: true,
    status: "active",
    createdAt: "2026-01-05T10:00:00.000Z",
  },
  profile: {
    avatarUrl: null,
    countryCode: null,
    presetMessagesMuted: false,
    reactionsMuted: false,
    gameSoundMuted: false,
    reducedMotion: false,
  },
  casual: { wins: 3, losses: 1, draws: 0, played: 4 },
  ranked: null,
};

function mount(routes: Record<string, { status?: number; body?: unknown }> = {}) {
  const transport = new FakeTransport();
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => "session-token",
    transport,
    now: () => SERVER_TIME,
  });
  const { fetch: fetchImpl } = fakeFetch({
    "GET /v1/config": { body: CONFIG },
    ...routes,
  });

  render(
    <ApiProvider
      client={new ApiClient({ baseUrl: "http://server.test", fetch: fetchImpl })}
      queryClient={testQueryClient()}
    >
      <SocketProvider socket={socket}>
        <MemoryRouter initialEntries={["/play"]}>
          <Routes>
            <Route path="/play" element={<PlayScreen />} />
            <Route path="/match/:matchId" element={<div data-testid="match">match</div>} />
          </Routes>
        </MemoryRouter>
      </SocketProvider>
    </ApiProvider>,
  );

  return { transport };
}

describe("the play screen", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
  });

  it("asks for a session before it offers a queue", async () => {
    mount();

    expect(screen.getByTestId("need-session")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("need-session"));
    expect(screen.queryByTestId("join-queue")).not.toBeInTheDocument();
  });

  it("offers the clocks the server published", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    mount();

    const clock = await screen.findByTestId("time-control");
    expect(clock).toHaveValue("300");
    await userEvent.selectOptions(clock, "900");
    expect(clock).toHaveValue("900");
  });

  it("refuses ranked play to a guest", () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    mount();

    void userEvent.selectOptions(screen.getByTestId("mode"), "ranked");
    expect(screen.getByText(/verified email address/)).toBeInTheDocument();
  });

  it("keeps its own clock list and reports the failure when the config cannot be read", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    mount({
      "GET /v1/config": {
        status: 503,
        body: {
          error: {
            code: "dependency_unavailable",
            message: "The server is starting",
            requestId: "r",
          },
        },
      },
    });

    expect(await screen.findByText("The server is starting")).toBeInTheDocument();
    expect(screen.getByTestId("time-control")).toHaveValue("300");
  });

  it("returns to casual when the player changes their mind", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    mount();

    const mode = await screen.findByTestId("mode");
    await userEvent.selectOptions(mode, "ranked");
    await userEvent.selectOptions(mode, "casual");

    expect(mode).toHaveValue("casual");
    expect(screen.getByTestId("join-queue")).toBeEnabled();
  });

  it("allows ranked play to a verified account", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "account",
      displayName: "ada",
      username: "ada",
    });
    mount({ "GET /v1/me": { body: VERIFIED_ME } });

    await userEvent.selectOptions(await screen.findByTestId("mode"), "ranked");
    expect(screen.getByTestId("join-queue")).toBeEnabled();
    expect(await screen.findByText("available")).toBeInTheDocument();
  });

  it("joins a queue, waits, and follows the match that is found", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    const { transport } = mount();

    await userEvent.click(await screen.findByTestId("join-queue"));
    await act(async () => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.sessionReady, READY);
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    await act(async () => {
      transport.answer("queue:join", {
        state: "queued",
        status: {
          mode: "casual",
          timeControlSeconds: 300,
          rating: 1200,
          waitingMs: 3_000,
          ratingWindow: null,
          depth: 1,
          serverTime: SERVER_TIME,
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("queue-status")).toHaveTextContent("3 s");
    expect(screen.getByTestId("leave-queue")).toBeInTheDocument();

    act(() => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchFound, {
        matchId: MATCH_ID,
        mode: "casual",
        timeControlSeconds: 300,
        yourColor: "light",
        opponent: { actorType: "guest", displayName: "Guest 5678", rating: null },
        waitedMs: 3_400,
        snapshot: makeSnapshot(),
      });
    });

    expect(await screen.findByTestId("match")).toBeInTheDocument();
  });

  it("stops searching when the player asks it to", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    const { transport } = mount();

    await userEvent.click(await screen.findByTestId("join-queue"));
    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    await act(async () => {
      transport.answer("queue:join", {
        state: "queued",
        status: {
          mode: "casual",
          timeControlSeconds: 300,
          rating: 1200,
          waitingMs: 0,
          ratingWindow: { minimum: 1100, maximum: 1300 },
          depth: 1,
          serverTime: SERVER_TIME,
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("queue-status")).toHaveTextContent("1100 to 1300");

    await userEvent.click(screen.getByTestId("leave-queue"));
    await act(async () => {
      transport.answer("queue:leave", { ok: true });
      await Promise.resolve();
    });

    expect(screen.getByTestId("join-queue")).toBeInTheDocument();
  });

  it("says why a queue refused the player", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });
    const { transport } = mount();

    await userEvent.click(await screen.findByTestId("join-queue"));
    await act(async () => {
      transport.answer("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    await act(async () => {
      transport.answer("queue:join", { state: "refused", reason: "already-in-match" });
      await Promise.resolve();
    });

    expect(screen.getByTestId("queue-notice")).toHaveTextContent("already in a match");
  });
});
