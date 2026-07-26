import { SERVER_TO_CLIENT_EVENTS } from "@gobblet/protocol";
import type { SoundCue, SoundEngine } from "@gobblet/game-ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { ApiProvider } from "../src/api/provider";
import { appendFeedItem, describeFeedItem } from "../src/match/communication";
import type { FeedItem } from "../src/match/communication";
import { SocketProvider } from "../src/match/provider";
import { MatchSocket } from "../src/match/socket";
import { MatchScreen } from "../src/screens/MatchScreen";
import { SoundProvider } from "../src/sound/provider";
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
import { FakeTransport } from "./helpers/transport";

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

const played: SoundCue[] = [];

const ENGINE: SoundEngine = {
  play: (cue) => {
    played.push(cue);
  },
  applySettings: () => undefined,
  resume: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

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
      <SoundProvider engine={ENGINE}>
        <SocketProvider socket={socket}>
          <MemoryRouter initialEntries={[`/match/${MATCH_ID}`]}>
            <Routes>
              <Route path="/match/:matchId" element={<MatchScreen />} />
            </Routes>
          </MemoryRouter>
        </SocketProvider>
      </SoundProvider>
    </ApiProvider>,
  );

  return { transport, socket };
}

async function openMatch(transport: FakeTransport): Promise<void> {
  await act(async () => {
    transport.connect();
    await Promise.resolve();
  });
  await act(async () => {
    transport.fire(SERVER_TO_CLIENT_EVENTS.sessionReady, READY);
    transport.answerAll("session:authenticate", { ok: true, session: READY });
    await Promise.resolve();
  });
  await act(async () => {
    transport.answerAll("match:sync", { ok: true, snapshot: makeSnapshot() });
    await Promise.resolve();
  });
  await act(async () => {
    transport.answerAll("match:mute-state", { ok: true });
    await Promise.resolve();
  });
}

async function relay(transport: FakeTransport, event: string, payload: unknown): Promise<void> {
  await act(async () => {
    transport.fire(event, payload);
    await Promise.resolve();
  });
}

function presetMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchId: MATCH_ID,
    from: "dark",
    actorId: DARK_ACTOR_ID,
    sentAt: SERVER_TIME,
    messageKey: "good-luck",
    ...overrides,
  };
}

function reaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchId: MATCH_ID,
    from: "dark",
    actorId: DARK_ACTOR_ID,
    sentAt: SERVER_TIME,
    reactionKey: "applause",
    ...overrides,
  };
}

describe("the communication feed", () => {
  it("keeps only the most recent exchanges, oldest first", () => {
    const item = (id: string): FeedItem => ({
      id,
      from: "light",
      mine: true,
      body: { kind: "message", messageKey: "thanks" },
    });
    const feed = ["1", "2", "3", "4", "5"].reduce<readonly FeedItem[]>(
      (current, id) => appendFeedItem(current, item(id)),
      [],
    );

    expect(feed.map((entry) => entry.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("reads a message as its phrase and a reaction as its name", () => {
    expect(
      describeFeedItem({
        id: "1",
        from: "dark",
        mine: false,
        body: { kind: "message", messageKey: "well-played" },
      }),
    ).toBe("Well played.");
    expect(
      describeFeedItem({
        id: "2",
        from: "dark",
        mine: false,
        body: { kind: "reaction", reactionKey: "tap" },
      }),
    ).toBe("Wooden-piece tap");
  });
});

describe("communication in a match", () => {
  beforeEach(() => {
    played.length = 0;
    useSessionStore.getState().signedOut();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().update({ renderTier: "flat" });
    vi.spyOn(performance, "now").mockReturnValue(1_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().reset();
  });

  it("sends the key of the phrase, never the words", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("message-nice-move"));

    await waitFor(() => {
      expect(transport.payloadsFor("match:preset-message")).toEqual([
        { matchId: MATCH_ID, messageKey: "nice-move" },
      ]);
    });
  });

  it("shows the opponent's phrase and its own echo, and names each sender", async () => {
    const { transport } = mount();
    await openMatch(transport);

    expect(screen.getByTestId("communication-empty")).toBeInTheDocument();
    await relay(transport, SERVER_TO_CLIENT_EVENTS.matchPresetMessage, presetMessage());
    await relay(
      transport,
      SERVER_TO_CLIENT_EVENTS.matchPresetMessage,
      presetMessage({ from: "light", actorId: LIGHT_ACTOR_ID, messageKey: "thanks" }),
    );

    const feed = screen.getByTestId("communication-feed");
    expect(feed).toHaveTextContent("Guest 1234Good luck.");
    expect(feed).toHaveTextContent("YouThanks.");
  });

  it("plays the reaction sound for a reaction that arrives", async () => {
    const { transport } = mount();
    await openMatch(transport);
    played.length = 0;

    await relay(transport, SERVER_TO_CLIENT_EVENTS.matchReaction, reaction());

    expect(played).toEqual(["reaction"]);
    expect(screen.getByTestId("communication-feed")).toHaveTextContent("Applause");
  });

  it("ignores communication that belongs to another match", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await relay(
      transport,
      SERVER_TO_CLIENT_EVENTS.matchPresetMessage,
      presetMessage({ matchId: "44444444-4444-4444-8444-444444444444" }),
    );
    await relay(
      transport,
      SERVER_TO_CLIENT_EVENTS.matchReaction,
      reaction({ matchId: "44444444-4444-4444-8444-444444444444" }),
    );

    expect(screen.getByTestId("communication-empty")).toBeInTheDocument();
    expect(played).not.toContain("reaction");
  });

  it("reports a refusal to the player who tried to send", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("reaction-smile"));
    await act(async () => {
      transport.answer("match:reaction", { ok: false, reason: "not-participant" });
      await Promise.resolve();
    });

    expect(await screen.findByTestId("communication-notice")).toHaveTextContent(
      "Only the two players may send",
    );
  });

  it("reports an acknowledgement the server never sent in a readable shape", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("message-oops"));
    await act(async () => {
      transport.answer("match:preset-message", { ok: "maybe" });
      await Promise.resolve();
    });

    expect(await screen.findByTestId("communication-notice")).toHaveTextContent(
      "That was not acknowledged",
    );
  });

  it("dismisses a refusal the player has read", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(await screen.findByTestId("message-good-game"));
    await act(async () => {
      transport.answer("match:preset-message", { ok: false, reason: "invalid-payload" });
      await Promise.resolve();
    });
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("communication-notice")).not.toBeInTheDocument();
  });

  it("mutes the message channel on its own", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(screen.getByLabelText("Mute their messages"));
    await act(async () => {
      transport.answerAll("match:mute-state", { ok: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transport.payloadsFor("match:mute-state").at(-1)).toEqual({
        matchId: MATCH_ID,
        presetMessagesMuted: true,
        reactionsMuted: false,
      });
    });
  });

  it("says nothing when a mute acknowledgement is unreadable", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(screen.getByLabelText("Mute their reactions"));
    await act(async () => {
      transport.answerAll("match:mute-state", { muted: "sometimes" });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("communication-notice")).not.toBeInTheDocument();
  });

  it("tells the server what to withhold, and remembers it locally", async () => {
    const { transport } = mount();
    await openMatch(transport);

    await userEvent.click(screen.getByLabelText("Mute their reactions"));
    await act(async () => {
      transport.answerAll("match:mute-state", { ok: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transport.payloadsFor("match:mute-state").at(-1)).toEqual({
        matchId: MATCH_ID,
        presetMessagesMuted: false,
        reactionsMuted: true,
      });
    });
    expect(useSettingsStore.getState().reactionsMuted).toBe(true);
  });

  it("tells a new connection the same preference, since the server re-seeds it", async () => {
    useSettingsStore.getState().update({ presetMessagesMuted: true });
    const { transport } = mount();
    await openMatch(transport);
    const before = transport.payloadsFor("match:mute-state").length;

    await act(async () => {
      transport.disconnect();
      transport.connect();
      await Promise.resolve();
    });
    await act(async () => {
      transport.answerAll("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transport.payloadsFor("match:mute-state").length).toBeGreaterThan(before);
    });
    expect(transport.payloadsFor("match:mute-state").at(-1)).toEqual({
      matchId: MATCH_ID,
      presetMessagesMuted: true,
      reactionsMuted: false,
    });
  });

  it("says nothing about a mute the server refuses, because the player did not ask", async () => {
    const { transport } = mount();
    await act(async () => {
      transport.connect();
      await Promise.resolve();
    });
    await act(async () => {
      transport.fire(SERVER_TO_CLIENT_EVENTS.sessionReady, READY);
      transport.answerAll("session:authenticate", { ok: true, session: READY });
      await Promise.resolve();
    });
    await act(async () => {
      transport.answerAll("match:sync", { ok: true, snapshot: makeSnapshot() });
      await Promise.resolve();
    });

    await act(async () => {
      transport.answerAll("match:mute-state", { ok: false, reason: "not-authorized" });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("communication-notice")).not.toBeInTheDocument();
  });
});
