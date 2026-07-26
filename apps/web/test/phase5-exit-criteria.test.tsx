import { applyMove, createInitialGame } from "@gobblet/game-core";
import type { GameState, Move } from "@gobblet/game-core";
import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import type { MatchSnapshot } from "@gobblet/protocol";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { ApiProvider } from "../src/api/provider";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { MatchScreen } from "../src/screens/MatchScreen";
import { useSessionStore } from "../src/session/store";
import { useSettingsStore } from "../src/settings/store";
import {
  DARK_ACTOR_ID,
  LIGHT_ACTOR_ID,
  MATCH_ID,
  SERVER_TIME,
  makeSnapshot,
} from "./helpers/match";
import { fakeFetch, testQueryClient } from "./helpers/render";
import { serializedAfter } from "./helpers/state";
import { FakeTransport } from "./helpers/transport";

/**
 * The Phase 5 exit criteria of specification section 20.5, held where the client can
 * hold them: a whole match played through the interface, the hidden-piece rule, the
 * refusal of anything the rules do not allow, and recovery from a snapshot.
 *
 * Two criteria are held elsewhere by their nature. "Playable in supported browsers"
 * is proved in Chromium and WebKit by `e2e/tests/full-match.spec.ts`, because jsdom
 * has neither an engine nor a layout. "Playable in the macOS and Windows shells" is
 * deferred to Phase 8 with the engine-level substitute recorded in appendix P5.1.
 */

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

const CLOCKS = Object.freeze({
  lightRemainingMs: 300_000,
  darkRemainingMs: 300_000,
  turnStartedAt: SERVER_TIME,
  serverTime: SERVER_TIME,
});

/** Light takes row zero from the reserve while dark builds row three. */
const SCRIPT: readonly (Move & Readonly<{ kind: "reserve" }>)[] = Object.freeze([
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "reserve", reserveStack: 0, to: "r3c0" },
  { kind: "reserve", reserveStack: 1, to: "r0c1" },
  { kind: "reserve", reserveStack: 1, to: "r3c1" },
  { kind: "reserve", reserveStack: 2, to: "r0c2" },
  { kind: "reserve", reserveStack: 2, to: "r3c2" },
  { kind: "reserve", reserveStack: 0, to: "r0c3" },
]);

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
  const { fetch: fetchImpl } = fakeFetch({});

  render(
    <ApiProvider
      client={new ApiClient({ baseUrl: "http://server.test", fetch: fetchImpl })}
      queryClient={testQueryClient()}
    >
      <SocketProvider socket={socket}>
        <MemoryRouter initialEntries={[`/match/${MATCH_ID}`]}>
          <Routes>
            <Route path="/match/:matchId" element={<MatchScreen />} />
            <Route path="/" element={<div data-testid="home">home</div>} />
          </Routes>
        </MemoryRouter>
      </SocketProvider>
    </ApiProvider>,
  );

  return { transport };
}

async function openMatch(transport: FakeTransport, snapshot = makeSnapshot()): Promise<void> {
  await act(async () => {
    transport.fire(SERVER_TO_CLIENT_EVENTS.sessionReady, READY);
    transport.answer("session:authenticate", { ok: true, session: READY });
    await Promise.resolve();
  });
  await act(async () => {
    transport.answerAll("match:sync", { ok: true, snapshot });
    await Promise.resolve();
  });
  await screen.findByTestId("match-screen");
}

/** The server's answer and its broadcast, in the order the gateway sends them. */
async function commit(
  transport: FakeTransport,
  state: GameState,
  move: Move,
  version: number,
): Promise<GameState> {
  const result = applyMove(state, move);
  if (!result.ok) {
    throw new Error(`the script must be legal: ${result.reason}`);
  }
  const actor = state.activePlayer;

  await act(async () => {
    transport.answerAll("match:move", { ok: true, commandId: lastCommandId(transport), version });
    transport.fire(SERVER_TO_CLIENT_EVENTS.matchMoveCommitted, {
      matchId: MATCH_ID,
      version,
      move,
      activePlayer: result.state.activePlayer,
      actor,
      clocks: CLOCKS,
    });
    await Promise.resolve();
  });

  return result.state;
}

function lastCommandId(transport: FakeTransport): string {
  const payloads = transport.payloadsFor("match:move");
  const last = payloads.at(-1) as { commandId?: string } | undefined;
  return last?.commandId ?? "";
}

describe("the Phase 5 exit criteria", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().update({ renderTier: "flat" });
    vi.spyOn(performance, "now").mockReturnValue(1_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plays a complete match through the ordinary interface", async () => {
    const { transport } = mount();
    await openMatch(transport);

    let state = createInitialGame("light");
    for (const [index, move] of SCRIPT.entries()) {
      const version = index + 1;
      if (state.activePlayer === "light") {
        await userEvent.click(
          screen.getByTestId(`reserve-light-${String(move.reserveStack ?? 0)}`),
        );
        await userEvent.click(screen.getByTestId(`square-${move.to}`));
        await waitFor(() => {
          expect(transport.payloadsFor("match:move")).toHaveLength(Math.ceil(version / 2));
        });
      }
      state = await commit(transport, state, move, version);
    }

    expect(screen.getByTestId("match-version")).toHaveTextContent("7");
    expect(screen.getByTestId("square-r0c3")).toHaveAttribute("data-owner", "light");

    await act(async () => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchEnded, {
        matchId: MATCH_ID,
        version: 7,
        result: "light",
        reason: "line",
        ratings: null,
      });
      await Promise.resolve();
    });

    expect(await screen.findByTestId("result-dialog")).toHaveTextContent("You won");
    expect(screen.getByTestId("result-reason")).toHaveTextContent("Decided by four in a line.");
  });

  it("never leaks a hidden piece", async () => {
    const { transport } = mount();
    await openMatch(
      transport,
      makeSnapshot({
        version: 5,
        state: serializedAfter(
          { kind: "reserve", reserveStack: 0, to: "r1c0" },
          { kind: "reserve", reserveStack: 0, to: "r2c0" },
          { kind: "reserve", reserveStack: 1, to: "r1c1" },
          { kind: "reserve", reserveStack: 0, to: "r0c0" },
          { kind: "board", from: "r1c0", to: "r0c0" },
        ),
        activePlayer: "dark",
      }),
    );

    const covered = screen.getByTestId("square-r0c0");
    expect(covered).toHaveAttribute("data-owner", "light");
    expect(covered).toHaveAccessibleName("Square r0c0, light largest, covering 1");
    expect(covered).toHaveTextContent("4");
    expect(screen.getByTestId("flat-board").textContent).not.toContain("dark");
  });

  it("offers no disallowed move through ordinary input", async () => {
    const { transport } = mount();
    await openMatch(
      transport,
      makeSnapshot({
        version: 1,
        state: serializedAfter({ kind: "reserve", reserveStack: 0, to: "r1c1" }),
        activePlayer: "dark",
      }),
    );

    // Not the local player's turn: nothing on the board can be pressed.
    expect(screen.getByTestId("reserve-light-0")).toBeDisabled();
    expect(screen.getByTestId("square-r0c0")).toBeDisabled();
    expect(screen.getByTestId("reserve-dark-0")).toBeDisabled();

    await act(async () => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchMoveCommitted, {
        matchId: MATCH_ID,
        version: 2,
        move: { kind: "reserve", reserveStack: 0, to: "r0c0" },
        activePlayer: "light",
        actor: "dark",
        clocks: CLOCKS,
      });
      await Promise.resolve();
    });

    // A piece from the reserve may only cover an opponent piece that completes a line
    // of three, and dark has none, so `r0c0` is not offered as a destination.
    await userEvent.click(screen.getByTestId("reserve-light-1"));
    expect(screen.getByTestId("square-r0c0")).toBeDisabled();
    expect(screen.getByTestId("square-r0c0")).toHaveAttribute("data-destination", "false");
    await userEvent.click(screen.getByTestId("square-r0c0"));
    expect(transport.payloadsFor("match:move")).toHaveLength(0);

    // One command may be outstanding, so the board refuses input until it is answered.
    await userEvent.click(screen.getByTestId("square-r2c2"));
    await waitFor(() => {
      expect(transport.payloadsFor("match:move")).toHaveLength(1);
    });
    expect(screen.getByTestId("reserve-light-0")).toBeDisabled();
    expect(screen.getByTestId("square-r3c3")).toBeDisabled();
  });

  it("renders the state a recovered snapshot names", async () => {
    const { transport } = mount();
    await openMatch(transport);

    // A committed move the client cannot place makes it ask for a snapshot instead.
    await act(async () => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.matchMoveCommitted, {
        matchId: MATCH_ID,
        version: 4,
        move: { kind: "reserve", reserveStack: 0, to: "r0c0" },
        activePlayer: "light",
        actor: "dark",
        clocks: CLOCKS,
      });
      await Promise.resolve();
    });

    const recovered: MatchSnapshot = makeSnapshot({
      version: 4,
      state: serializedAfter(
        { kind: "reserve", reserveStack: 0, to: "r1c0" },
        { kind: "reserve", reserveStack: 0, to: "r2c0" },
        { kind: "reserve", reserveStack: 1, to: "r1c1" },
        { kind: "reserve", reserveStack: 1, to: "r2c1" },
      ),
      activePlayer: "light",
      players: {
        light: {
          actorId: LIGHT_ACTOR_ID,
          actorType: "user",
          displayName: "ada",
          isGuest: false,
          rating: 1200,
        },
        dark: {
          actorId: DARK_ACTOR_ID,
          actorType: "guest",
          displayName: "Guest 1234",
          isGuest: true,
          rating: null,
        },
      },
    });

    await act(async () => {
      transport.answerAll("match:sync", { ok: true, snapshot: recovered });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("match-version")).toHaveTextContent("4");
    });
    expect(screen.getByTestId("square-r1c0")).toHaveAttribute("data-owner", "light");
    expect(screen.getByTestId("square-r2c1")).toHaveAttribute("data-owner", "dark");
    expect(screen.getByTestId("square-r0c0")).toHaveAttribute("data-owner", "empty");
    expect(screen.getByTestId("player-light")).toHaveAttribute("data-to-move", "true");
  });
});
