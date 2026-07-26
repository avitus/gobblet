import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router";
import { HistoryScreen } from "../src/screens/HistoryScreen";
import { ProfileScreen } from "../src/screens/ProfileScreen";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { useSessionStore } from "../src/session/store";
import { DEFAULT_SETTINGS, useSettingsStore } from "../src/settings/store";
import { SoundProvider } from "../src/sound/provider";
import type { SoundCue, SoundEngine } from "@gobblet/game-ui";
import { DARK_ACTOR_ID, LIGHT_ACTOR_ID, MATCH_ID } from "./helpers/match";
import { renderWithProviders } from "./helpers/render";

const ME = {
  account: {
    userId: LIGHT_ACTOR_ID,
    username: "ada",
    email: "ada@example.com",
    emailVerified: true,
    status: "active",
    role: "player",
    createdAt: "2026-01-05T10:00:00.000Z",
  },
  profile: {
    avatarUrl: null,
    countryCode: "GB",
    presetMessagesMuted: false,
    reactionsMuted: false,
    gameSoundMuted: false,
    reducedMotion: false,
  },
  casual: { wins: 3, losses: 1, draws: 2, played: 6 },
  ranked: {
    rating: 1240,
    wins: 5,
    losses: 4,
    draws: 1,
    played: 10,
    currentStreak: 2,
    bestStreak: 3,
  },
  rank: 12,
};

const ACHIEVEMENTS = {
  achievements: [
    {
      code: "first-victory",
      name: "First Victory",
      description: "Win your first match.",
      badge: "bronze",
      ruleVersion: 1,
      earnedAt: "2026-07-20T09:08:00.000Z",
      matchId: MATCH_ID,
    },
    {
      code: "century-club",
      name: "Century Club",
      description: "Complete one hundred matches.",
      badge: "gold",
      ruleVersion: 1,
      earnedAt: null,
      matchId: null,
    },
  ],
};

const HISTORY = {
  matches: [
    {
      matchId: MATCH_ID,
      mode: "ranked",
      timeControlSeconds: 300,
      status: "completed",
      result: { outcome: "light", reason: "line" },
      players: {
        light: {
          actorId: LIGHT_ACTOR_ID,
          actorType: "user",
          displayName: "ada",
          isGuest: false,
          rating: 1240,
        },
        dark: {
          actorId: DARK_ACTOR_ID,
          actorType: "user",
          displayName: "linus",
          isGuest: false,
          rating: 1210,
        },
      },
      moveCount: 14,
      createdAt: "2026-07-20T09:00:00.000Z",
      startedAt: "2026-07-20T09:00:01.000Z",
      endedAt: "2026-07-20T09:08:00.000Z",
      side: "light",
      outcome: "win",
      ratingDelta: 12,
    },
    {
      matchId: "88888888-8888-4888-8888-888888888888",
      mode: "casual",
      timeControlSeconds: 600,
      status: "active",
      result: null,
      players: {
        light: {
          actorId: DARK_ACTOR_ID,
          actorType: "user",
          displayName: "linus",
          isGuest: false,
          rating: null,
        },
        dark: {
          actorId: LIGHT_ACTOR_ID,
          actorType: "user",
          displayName: "ada",
          isGuest: false,
          rating: null,
        },
      },
      moveCount: 3,
      createdAt: "2026-07-21T09:00:00.000Z",
      startedAt: "2026-07-21T09:00:01.000Z",
      endedAt: null,
      side: "dark",
      outcome: null,
      ratingDelta: null,
    },
  ],
};

/** The reduced-motion query the design system asks about (appendix P5.4). */
function stubMatchMedia(reducedMotion: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function signIn(kind: "guest" | "account" = "account"): void {
  useSessionStore.getState().signedIn({
    token: "session-token",
    kind,
    displayName: kind === "account" ? "ada" : "Guest 1234",
    username: kind === "account" ? "ada" : null,
  });
}

describe("the match history screen", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
  });

  it("asks for a session first", () => {
    renderWithProviders(<HistoryScreen />);

    expect(screen.getByText(/Start a session/)).toBeInTheDocument();
  });

  it("lists the matches newest first, and links to one still running", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: { "GET /v1/me/matches": { body: HISTORY } },
      sessionToken: () => "session-token",
    });

    const table = await screen.findByTestId("history-table");
    expect(table).toHaveTextContent("ranked");
    expect(table).toHaveTextContent("won by line");
    expect(screen.getByRole("link", { name: "resume" })).toHaveAttribute(
      "href",
      "/match/88888888-8888-4888-8888-888888888888",
    );
  });

  it("shows the seat played, the opponent, the moves and the rating change", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: { "GET /v1/me/matches": { body: HISTORY } },
    });

    const row = await screen.findByTestId(`history-row-${MATCH_ID}`);
    expect(row).toHaveTextContent("light");
    expect(row).toHaveTextContent("linus");
    expect(row).toHaveTextContent("14");
    expect(screen.getByTestId(`history-rating-${MATCH_ID}`)).toHaveTextContent("+12");
  });

  it("shows no rating change for a casual match", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: { "GET /v1/me/matches": { body: HISTORY } },
    });

    await screen.findByTestId("history-table");
    expect(
      screen.getByTestId("history-rating-88888888-8888-4888-8888-888888888888"),
    ).toHaveTextContent("-");
  });

  it("names a status that has no result of its own", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: {
        "GET /v1/me/matches": {
          body: {
            matches: [
              {
                ...HISTORY.matches[0],
                status: "aborted",
                result: null,
                endedAt: null,
              },
            ],
          },
        },
      },
    });

    expect(await screen.findByTestId("history-table")).toHaveTextContent("aborted");
  });

  it("names a draw as a draw", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: {
        "GET /v1/me/matches": {
          body: {
            matches: [
              {
                ...HISTORY.matches[0],
                result: { outcome: "draw", reason: "repetition" },
                outcome: "draw",
                ratingDelta: 0,
              },
            ],
          },
        },
      },
    });

    expect(await screen.findByTestId("history-table")).toHaveTextContent("draw");
  });

  it("says so when there is nothing to list", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: { "GET /v1/me/matches": { body: { matches: [] } } },
    });

    expect(await screen.findByTestId("history-empty")).toBeInTheDocument();
  });

  it("reports a failure instead of an empty table", async () => {
    signIn();
    renderWithProviders(<HistoryScreen />, {
      routes: {
        "GET /v1/me/matches": {
          status: 503,
          body: {
            error: {
              code: "dependency_unavailable",
              message: "The database is away",
              requestId: "r",
            },
          },
        },
      },
    });

    expect(await screen.findByText("The database is away")).toBeInTheDocument();
  });
});

describe("the settings screen", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("changes a volume and keeps it", async () => {
    renderWithProviders(<SettingsScreen />);

    fireEvent.change(screen.getByLabelText("Master"), { target: { value: "0.3" } });

    await waitFor(() => {
      expect(useSettingsStore.getState().masterVolume).toBeCloseTo(0.3, 6);
    });
    expect(window.localStorage.getItem("gobblet.settings.v1")).toContain("0.3");
  });

  it("mutes everything and disables the individual volumes", async () => {
    renderWithProviders(<SettingsScreen />);

    await userEvent.click(screen.getByLabelText("Mute everything"));

    expect(useSettingsStore.getState().soundMuted).toBe(true);
    expect(screen.getByLabelText("Game")).toBeDisabled();
  });

  it("mutes each communication channel on its own, and keeps it locally", async () => {
    renderWithProviders(<SettingsScreen />);

    await userEvent.click(screen.getByLabelText("Mute preset messages"));

    expect(useSettingsStore.getState().presetMessagesMuted).toBe(true);
    expect(useSettingsStore.getState().reactionsMuted).toBe(false);
    expect(window.localStorage.getItem("gobblet.settings.v1")).toContain(
      '"presetMessagesMuted":true',
    );

    await userEvent.click(screen.getByLabelText("Mute reactions"));
    expect(useSettingsStore.getState().reactionsMuted).toBe(true);
  });

  it("plays a test sound through the engine", async () => {
    const played: SoundCue[] = [];
    const engine: SoundEngine = {
      play: (cue) => {
        played.push(cue);
      },
      applySettings: () => undefined,
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };

    renderWithProviders(
      <SoundProvider engine={engine}>
        <SettingsScreen />
      </SoundProvider>,
    );

    await userEvent.click(screen.getByTestId("test-sound"));
    expect(played).toEqual(["placement"]);
  });

  it("changes the game and communication volumes on their own", async () => {
    renderWithProviders(<SettingsScreen />);

    fireEvent.change(screen.getByLabelText("Game"), { target: { value: "0.4" } });
    fireEvent.change(screen.getByLabelText("Communication"), { target: { value: "0.2" } });

    await waitFor(() => {
      expect(useSettingsStore.getState().gameVolume).toBeCloseTo(0.4, 6);
    });
    expect(useSettingsStore.getState().communicationVolume).toBeCloseTo(0.2, 6);
    expect(useSettingsStore.getState().masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
  });

  it("repeats what the system asks of motion while it follows the system", async () => {
    stubMatchMedia(true);
    renderWithProviders(<SettingsScreen />);

    expect(screen.getByText("The system asks for reduced motion.")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId("motion"), "full");
    expect(screen.queryByText("The system asks for reduced motion.")).not.toBeInTheDocument();
  });

  it("chooses a rendering tier and a motion preference", async () => {
    renderWithProviders(<SettingsScreen />);

    await userEvent.selectOptions(screen.getByTestId("render-tier"), "flat");
    await userEvent.selectOptions(screen.getByTestId("motion"), "reduced");

    expect(useSettingsStore.getState().renderTier).toBe("flat");
    expect(useSettingsStore.getState().motion).toBe("reduced");
  });

  it("restores the defaults", async () => {
    useSettingsStore.getState().update({ masterVolume: 0.1, renderTier: "flat" });
    renderWithProviders(<SettingsScreen />);

    await userEvent.click(screen.getByTestId("reset-settings"));

    expect(useSettingsStore.getState().masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(useSettingsStore.getState().renderTier).toBe(DEFAULT_SETTINGS.renderTier);
  });
});

describe("the profile screen", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
  });

  it("asks for a session first", () => {
    renderWithProviders(<ProfileScreen />);

    expect(screen.getByText(/Start a session/)).toBeInTheDocument();
  });

  it("tells a guest that a profile needs an account", () => {
    signIn("guest");
    renderWithProviders(<ProfileScreen />);

    expect(screen.getByText(/A guest has no profile/)).toBeInTheDocument();
  });

  it("shows the record the server holds", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: { "GET /v1/me/achievements": { body: ACHIEVEMENTS }, "GET /v1/me": { body: ME } },
    });

    expect(await screen.findByTestId("own-profile")).toHaveTextContent("verified");
    expect(screen.getByTestId("own-ranked")).toHaveTextContent("1240 rating, 5W 4L 1D");
    expect(screen.getByTestId("own-rank")).toHaveTextContent("#12 all time");
  });

  it("lists the whole achievement catalogue, earned or not", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": { body: ME },
      },
    });

    expect(await screen.findByTestId("achievement-first-victory")).toHaveAttribute(
      "data-earned",
      "true",
    );
    expect(screen.getByTestId("achievement-century-club")).toHaveAttribute("data-earned", "false");
    expect(screen.getByTestId("achievement-century-club")).toHaveTextContent("not yet");
  });

  it("reports achievements the server could not read", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me": { body: ME },
        "GET /v1/me/achievements": {
          status: 503,
          body: {
            error: {
              code: "dependency_unavailable",
              message: "No achievements today",
              requestId: "r",
            },
          },
        },
      },
    });

    expect(await screen.findByText("No achievements today")).toBeInTheDocument();
  });

  it("says when no rank has been earned yet", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": { body: { ...ME, rank: null } },
      },
    });

    expect(await screen.findByTestId("own-rank")).toHaveTextContent("unranked");
  });

  it("collects every account setting into one patch", async () => {
    signIn();
    const { calls } = renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": { body: ME },
        "PATCH /v1/me/profile": { body: ME },
      },
    });

    await screen.findByTestId("own-profile");
    await userEvent.click(screen.getByLabelText("Mute preset messages"));
    await userEvent.click(screen.getByLabelText("Mute reactions"));
    await userEvent.click(screen.getByLabelText("Mute game sounds"));
    await userEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      expect(calls).toContain("PATCH /v1/me/profile");
    });
  });

  it("reports a profile the server could not read", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": {
          status: 503,
          body: {
            error: {
              code: "dependency_unavailable",
              message: "The database is away",
              requestId: "r",
            },
          },
        },
      },
    });

    expect(await screen.findByText("The database is away")).toBeInTheDocument();
  });

  it("says when there is no ranked record and no verified email yet", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": {
          body: { ...ME, ranked: null, account: { ...ME.account, emailVerified: false } },
        },
      },
    });

    expect(await screen.findByTestId("own-ranked")).toHaveTextContent("no ranked matches yet");
    expect(screen.getByTestId("own-profile")).toHaveTextContent("unverified");
  });

  it("removes a country code the player emptied", async () => {
    signIn();
    const { sent } = renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": { body: ME },
        "PATCH /v1/me/profile": { body: { ...ME, profile: { ...ME.profile, countryCode: null } } },
      },
    });

    await screen.findByTestId("own-profile");
    await userEvent.clear(screen.getByTestId("country-code"));
    expect(screen.getByTestId("country-code")).toHaveValue("");
    await userEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      expect(sent.filter((entry) => entry.key === "PATCH /v1/me/profile")).toEqual([
        { key: "PATCH /v1/me/profile", body: { countryCode: null } },
      ]);
    });
  });

  it("reports a public profile that could not be read", async () => {
    signIn();
    renderWithProviders(
      <Routes>
        <Route path="/profile/:username" element={<ProfileScreen />} />
      </Routes>,
      {
        initialPath: "/profile/ghost",
        routes: {
          "GET /v1/profiles/ghost": {
            status: 404,
            body: {
              error: { code: "not_found", message: "No such player", requestId: "r" },
            },
          },
        },
      },
    );

    expect(await screen.findByText("No such player")).toBeInTheDocument();
  });

  it("shows the rating of a player who has one", async () => {
    signIn();
    renderWithProviders(
      <Routes>
        <Route path="/profile/:username" element={<ProfileScreen />} />
      </Routes>,
      {
        initialPath: "/profile/linus",
        routes: {
          "GET /v1/profiles/linus": {
            body: {
              username: "linus",
              avatarUrl: null,
              countryCode: null,
              memberSince: "2025-11",
              casual: { wins: 1, losses: 2, draws: 0, played: 3 },
              ranked: {
                rating: 1310,
                wins: 7,
                losses: 3,
                draws: 0,
                played: 10,
                currentStreak: 1,
                bestStreak: 4,
              },
              rank: 3,
              badges: [
                {
                  code: "uncovered",
                  name: "Uncovered",
                  badge: "gold",
                  earnedAt: "2026-07-19T12:00:00.000Z",
                },
                {
                  code: "first-victory",
                  name: "First Victory",
                  badge: "bronze",
                  earnedAt: "2026-07-18T12:00:00.000Z",
                },
              ],
              recentMatches: [HISTORY.matches[0]],
            },
          },
        },
      },
    );

    const profile = await screen.findByTestId("public-profile");
    expect(profile).toHaveTextContent("1310 rating, 7W 3L 0D");
    expect(profile).toHaveTextContent("not given");
    expect(screen.getByTestId("public-rank")).toHaveTextContent("#3 all time");
    expect(screen.getByTestId("badge-uncovered")).toHaveAttribute("data-tier", "gold");
    expect(screen.getByTestId(`recent-${MATCH_ID}`)).toHaveTextContent("as light");
    expect(screen.getByTestId(`recent-${MATCH_ID}`)).toHaveTextContent("14 moves");
  });

  it("saves only what the player changed", async () => {
    signIn();
    const { calls } = renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": { body: ME },
        "PATCH /v1/me/profile": {
          body: { ...ME, profile: { ...ME.profile, reducedMotion: true } },
        },
      },
    });

    await screen.findByTestId("own-profile");
    expect(screen.getByTestId("save-profile")).toBeDisabled();

    await userEvent.click(screen.getByLabelText("Reduce motion"));
    await userEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      expect(calls).toContain("PATCH /v1/me/profile");
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("reports a save the server refused", async () => {
    signIn();
    renderWithProviders(<ProfileScreen />, {
      routes: {
        "GET /v1/me/achievements": { body: ACHIEVEMENTS },
        "GET /v1/me": { body: ME },
        "PATCH /v1/me/profile": {
          status: 422,
          body: {
            error: {
              code: "validation_failed",
              message: "That country code is unknown",
              requestId: "r",
            },
          },
        },
      },
    });

    await screen.findByTestId("own-profile");
    await userEvent.clear(screen.getByTestId("country-code"));
    await userEvent.type(screen.getByTestId("country-code"), "zz");
    expect(screen.getByTestId("country-code")).toHaveValue("ZZ");
    await userEvent.click(screen.getByTestId("save-profile"));

    expect(await screen.findByText("That country code is unknown")).toBeInTheDocument();
  });

  it("shows another player's public profile", async () => {
    signIn();
    renderWithProviders(
      <Routes>
        <Route path="/profile/:username" element={<ProfileScreen />} />
      </Routes>,
      {
        initialPath: "/profile/linus",
        routes: {
          "GET /v1/profiles/linus": {
            body: {
              username: "linus",
              avatarUrl: null,
              countryCode: "FI",
              memberSince: "2025-11",
              casual: { wins: 1, losses: 2, draws: 0, played: 3 },
              ranked: null,
              rank: null,
              badges: [],
              recentMatches: [],
            },
          },
        },
      },
    );

    const profile = await screen.findByTestId("public-profile");
    expect(profile).toHaveTextContent("2025-11");
    expect(profile).toHaveTextContent("FI");
    expect(profile).toHaveTextContent("no ranked matches yet");
    expect(screen.getByTestId("public-rank")).toHaveTextContent("unranked");
    expect(screen.getByTestId("no-badges")).toBeInTheDocument();
    expect(screen.getByTestId("no-recent-matches")).toBeInTheDocument();
  });
});
