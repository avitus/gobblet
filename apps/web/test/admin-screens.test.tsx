import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router";
import { AdminAchievementsScreen } from "../src/admin/AdminAchievementsScreen";
import { AdminAuditScreen } from "../src/admin/AdminAuditScreen";
import { AdminGate } from "../src/admin/AdminGate";
import { AdminMatchScreen } from "../src/admin/AdminMatchScreen";
import { AdminMatchesScreen } from "../src/admin/AdminMatchesScreen";
import { AdminOverviewScreen } from "../src/admin/AdminOverviewScreen";
import { AdminUserScreen } from "../src/admin/AdminUserScreen";
import { AdminUsersScreen } from "../src/admin/AdminUsersScreen";
import { AppShell } from "../src/app/AppShell";
import { useSessionStore } from "../src/session/store";
import { DARK_ACTOR_ID, LIGHT_ACTOR_ID, MATCH_ID } from "./helpers/match";
import { renderWithProviders } from "./helpers/render";
import type { RouteTable } from "./helpers/render";

/**
 * The gated dashboard of appendix P7.1. Every screen here is a reader over the
 * administrative routes; the role comes from the account the server returns, and
 * a reader without it sees what the address would give anyone.
 */

const OTHER_USER_ID = "9d3b0f52-3f30-4d0e-8b2b-0f5f2a4c7a01";

function me(role: "player" | "admin"): unknown {
  return {
    account: {
      userId: LIGHT_ACTOR_ID,
      username: "ada",
      email: "ada@example.com",
      emailVerified: true,
      status: "active",
      role,
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
    casual: { wins: 0, losses: 0, draws: 0, played: 0 },
    ranked: null,
    rank: null,
  };
}

const PLAYER_GRACE = {
  actorId: OTHER_USER_ID,
  actorType: "user",
  displayName: "Grace",
  isGuest: false,
  rating: 1240,
};

const PLAYER_ADA = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  rating: 1200,
};

const METRICS = {
  generatedAt: "2026-07-26T12:00:00.000Z",
  windowHours: 24,
  deployment: { appVersion: "0.1.0", gitSha: "abc1234", appEnv: "test", uptimeSeconds: 7_260 },
  health: {
    ready: true,
    checks: [
      { name: "database", ok: true },
      { name: "migrations", ok: true },
    ],
  },
  activity: { dailyActiveAccounts: 7, dailyActiveGuests: 3, dailyActiveUsers: 10 },
  matches: {
    active: 2,
    completed: 8,
    aborted: 1,
    completionRate: 0.8,
    abandonmentRate: 0.1,
    byEndReason: [{ reason: "line", count: 6 }],
  },
  matchmaking: {
    queueDepth: [{ mode: "ranked", timeControlSeconds: 300, waiting: 1 }],
    averageWaitMs: 4_200,
    pairings: 5,
  },
  sockets: { connected: 4 },
  errors: {
    total: 3,
    recent: [
      {
        code: "rate_limited",
        route: "POST /v1/auth/sign-in",
        count: 2,
        lastSeenAt: "2026-07-26T11:59:02.000Z",
      },
    ],
  },
  clientVersions: [],
};

const USER_SUMMARY = {
  userId: OTHER_USER_ID,
  username: "grace",
  status: "active",
  role: "player",
  emailVerified: true,
  rating: 1240,
  createdAt: "2026-02-01T09:00:00.000Z",
  lastSeenAt: "2026-07-26T08:00:00.000Z",
};

const USER_DETAIL = {
  user: USER_SUMMARY,
  email: "grace@example.com",
  displayName: "Grace",
  suspendedAt: null,
  suspendedReason: null,
  casual: { wins: 2, losses: 1, draws: 0, played: 3 },
  ranked: {
    rating: 1240,
    wins: 5,
    losses: 3,
    draws: 1,
    played: 9,
    currentStreak: 2,
    bestStreak: 4,
    ratedAt: "2026-07-25T20:00:00.000Z",
  },
  recentMatches: [
    {
      matchId: MATCH_ID,
      mode: "ranked",
      timeControlSeconds: 300,
      status: "completed",
      result: { outcome: "light", reason: "line" },
      players: {
        light: PLAYER_GRACE,
        dark: PLAYER_ADA,
      },
      moveCount: 21,
      createdAt: "2026-07-25T19:40:00.000Z",
      startedAt: "2026-07-25T19:41:00.000Z",
      endedAt: "2026-07-25T19:52:00.000Z",
      side: "light",
      outcome: "win",
      ratingDelta: 15,
    },
  ],
  moderation: [],
  activeSessions: 1,
};

const SUSPENDED_DETAIL = {
  ...USER_DETAIL,
  user: { ...USER_SUMMARY, status: "suspended" },
  suspendedAt: "2026-07-26T12:05:00.000Z",
  suspendedReason: "abusive messages",
  moderation: [
    {
      action: "user-suspended",
      adminUsername: "ada",
      reason: "abusive messages",
      createdAt: "2026-07-26T12:05:00.000Z",
    },
  ],
};

const MATCH_DETAIL = {
  match: {
    matchId: MATCH_ID,
    mode: "ranked",
    timeControlSeconds: 300,
    status: "active",
    result: null,
    players: {
      light: PLAYER_GRACE,
      dark: { ...PLAYER_ADA, actorId: DARK_ACTOR_ID },
    },
    moveCount: 3,
    createdAt: "2026-07-26T11:00:00.000Z",
    startedAt: "2026-07-26T11:00:05.000Z",
    endedAt: null,
  },
  version: 4,
  clocks: {
    lightRemainingMs: 240_000,
    darkRemainingMs: 251_000,
    turnStartedAt: 1_785_063_840_000,
    serverTime: 1_785_063_860_000,
  },
  events: [
    {
      sequence: 1,
      type: "match.started",
      actorType: null,
      actorId: null,
      commandId: null,
      payload: null,
      stateHash: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      revealedAndBlocked: false,
      createdAt: "2026-07-26T11:00:05.000Z",
    },
    {
      sequence: 2,
      type: "move.applied",
      actorType: "account",
      actorId: OTHER_USER_ID,
      commandId: MATCH_ID,
      payload: { to: { row: 1, column: 1 } },
      stateHash: "1a2b3c4d5e6f708192a3b4c5d6e7f809",
      revealedAndBlocked: true,
      createdAt: "2026-07-26T11:00:40.000Z",
    },
  ],
  connections: [
    {
      kind: "attached",
      actorType: "account",
      actorId: OTHER_USER_ID,
      socketId: "socket-1",
      reason: null,
      createdAt: "2026-07-26T11:00:04.000Z",
    },
  ],
};

const ACHIEVEMENTS = {
  achievements: [
    {
      achievementId: "5f9d2b1e-7c44-4a09-9d90-3c9f5d1e8a10",
      code: "first-victory",
      name: "First Victory",
      description: "Win your first match.",
      badge: "bronze",
      ruleVersion: 1,
      enabled: true,
      awarded: 12,
      updatedAt: "2026-07-01T08:00:00.000Z",
    },
  ],
};

const AUDIT_PAGE_ONE = {
  entries: [
    {
      auditId: "3f2a4c8d-1b6e-4a52-9c0d-7e8f1a2b3c4d",
      action: "user-suspended",
      adminUserId: LIGHT_ACTOR_ID,
      adminUsername: "ada",
      targetType: "user",
      targetId: OTHER_USER_ID,
      targetLabel: "grace",
      before: { status: "active" },
      after: { status: "suspended" },
      reason: "abusive messages",
      createdAt: "2026-07-26T12:05:00.000Z",
    },
  ],
  nextCursor: "cursor-two",
};

const AUDIT_PAGE_TWO = {
  entries: [
    {
      auditId: "8b7c6d5e-4f3a-4291-8d0c-1e2f3a4b5c6d",
      action: "role-granted",
      adminUserId: null,
      adminUsername: null,
      targetType: "user",
      targetId: LIGHT_ACTOR_ID,
      targetLabel: null,
      before: null,
      after: { role: "admin" },
      reason: "bootstrapping the first administrator",
      createdAt: "2026-07-20T09:00:00.000Z",
    },
  ],
  nextCursor: null,
};

function signIn(kind: "guest" | "account" = "account"): void {
  useSessionStore.getState().signedIn({
    token: "session-token",
    kind,
    displayName: "ada",
    username: kind === "account" ? "ada" : null,
  });
}

function renderAdmin(
  ui: React.ReactNode,
  routes: RouteTable,
  initialPath = "/admin",
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(ui, {
    routes,
    initialPath,
    sessionToken: () => "session-token",
  });
}

describe("the administration gate", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
  });

  it("gives a signed-out reader what the address would give anyone", async () => {
    renderAdmin(
      <Routes>
        <Route path="/admin" element={<AdminGate />}>
          <Route index element={<p>the dashboard</p>} />
        </Route>
      </Routes>,
      {},
    );

    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByText("the dashboard")).not.toBeInTheDocument();
  });

  it("gives a player the same answer, and asks the server nothing else", async () => {
    signIn();
    const { calls } = renderAdmin(
      <Routes>
        <Route path="/admin" element={<AdminGate />}>
          <Route index element={<p>the dashboard</p>} />
        </Route>
      </Routes>,
      { "GET /v1/me": { body: me("player") } },
    );

    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
    expect(calls.filter((call) => call.includes("/v1/admin"))).toEqual([]);
  });

  it("waits rather than guessing while the account is being read", () => {
    signIn();
    renderAdmin(
      <Routes>
        <Route path="/admin" element={<AdminGate />}>
          <Route index element={<p>the dashboard</p>} />
        </Route>
      </Routes>,
      { "GET /v1/me": { body: me("admin") } },
    );

    expect(screen.getByText("Checking your account")).toBeInTheDocument();
  });

  it("treats an account it cannot read as one without the role", async () => {
    signIn();
    renderAdmin(
      <Routes>
        <Route path="/admin" element={<AdminGate />}>
          <Route index element={<p>the dashboard</p>} />
        </Route>
      </Routes>,
      {
        "GET /v1/me": {
          status: 401,
          body: { error: { code: "unauthenticated", message: "no", requestId: "test" } },
        },
      },
    );

    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
  });

  it("shows the sections to an administrator", async () => {
    signIn();
    renderAdmin(
      <Routes>
        <Route path="/admin" element={<AdminGate />}>
          <Route index element={<p>the dashboard</p>} />
        </Route>
      </Routes>,
      { "GET /v1/me": { body: me("admin") } },
    );

    expect(await screen.findByTestId("admin-dashboard")).toBeInTheDocument();
    expect(screen.getByText("the dashboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/admin/audit");
  });

  it("offers the dashboard in the header to an administrator only", async () => {
    signIn();
    const player = renderAdmin(<AppShell />, { "GET /v1/me": { body: me("player") } }, "/");
    await waitFor(() => {
      expect(player.calls).toContain("GET /v1/me");
    });
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    player.unmount();

    renderAdmin(<AppShell />, { "GET /v1/me": { body: me("admin") } }, "/");
    expect(await screen.findByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });
});

describe("the overview", () => {
  beforeEach(() => {
    signIn();
  });

  it("reads the deployment, the players, the matches and what has failed", async () => {
    renderAdmin(<AdminOverviewScreen />, { "GET /v1/admin/metrics": { body: METRICS } });

    expect(await screen.findByTestId("admin-overview")).toBeInTheDocument();
    expect(screen.getByTestId("overview-ready")).toHaveTextContent("ready");
    expect(screen.getByText("2h 1m")).toBeInTheDocument();
    expect(screen.getByTestId("overview-dau")).toHaveTextContent("10");
    expect(screen.getByTestId("overview-completion")).toHaveTextContent("80%");
    expect(screen.getByText("4.2s")).toBeInTheDocument();
    expect(screen.getByTestId("overview-errors")).toHaveTextContent("3");
    expect(
      within(screen.getByTestId("overview-recent-errors")).getByText("rate_limited"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("overview-clients-empty")).toBeInTheDocument();
  });

  it("says a rate is not yet known rather than showing a misleading zero", async () => {
    renderAdmin(<AdminOverviewScreen />, {
      "GET /v1/admin/metrics": {
        body: {
          ...METRICS,
          deployment: { ...METRICS.deployment, uptimeSeconds: 120 },
          health: { ready: false, checks: [{ name: "database", ok: false }] },
          matches: { ...METRICS.matches, completionRate: null, abandonmentRate: null },
          matchmaking: { ...METRICS.matchmaking, averageWaitMs: null },
          errors: { total: 0, recent: [] },
          clientVersions: [{ platform: "web", version: "0.1.0", sessions: 4 }],
        },
      },
    });

    expect(await screen.findByTestId("overview-completion")).toHaveTextContent("not yet");
    expect(screen.getByTestId("overview-ready")).toHaveTextContent("not ready");
    expect(screen.getByText("failing")).toBeInTheDocument();
    expect(screen.getByText("2m")).toBeInTheDocument();
    expect(screen.getByTestId("overview-errors-empty")).toBeInTheDocument();
    expect(screen.getByText("web 0.1.0")).toBeInTheDocument();
  });

  it("says so when the deployment cannot be read", async () => {
    renderAdmin(<AdminOverviewScreen />, {
      "GET /v1/admin/metrics": {
        status: 503,
        body: {
          error: {
            code: "dependency_unavailable",
            message: "the database is away",
            requestId: "test",
          },
        },
      },
    });

    expect(await screen.findByText("the database is away")).toBeInTheDocument();
  });

  it("waits while the summary is being computed", () => {
    renderAdmin(<AdminOverviewScreen />, { "GET /v1/admin/metrics": { body: METRICS } });

    expect(screen.getByText("Reading the deployment")).toBeInTheDocument();
  });
});

describe("account search", () => {
  beforeEach(() => {
    signIn();
  });

  it("lists what matched and links to each account", async () => {
    renderAdmin(<AdminUsersScreen />, {
      "GET /v1/admin/users": { body: { users: [USER_SUMMARY], nextCursor: null } },
    });

    const table = await screen.findByTestId("admin-users-table");
    expect(within(table).getByRole("link", { name: "grace" })).toHaveAttribute(
      "href",
      `/admin/users/${OTHER_USER_ID}`,
    );
    expect(within(table).getByText("1240")).toBeInTheDocument();
    expect(within(table).getByText("verified")).toBeInTheDocument();
  });

  it("asks the server for the term and the status that were typed", async () => {
    const { calls } = renderAdmin(<AdminUsersScreen />, {
      "GET /v1/admin/users": { body: { users: [], nextCursor: null } },
    });

    await screen.findByTestId("admin-users-empty");
    await userEvent.type(screen.getByTestId("admin-user-search"), "gra");
    await userEvent.selectOptions(screen.getByTestId("admin-user-status"), "suspended");
    await userEvent.click(screen.getByTestId("admin-user-search-submit"));

    await waitFor(() => {
      expect(calls.filter((call) => call === "GET /v1/admin/users")).toHaveLength(2);
    });
  });

  it("asks for everything when the form is left empty", async () => {
    const { calls } = renderAdmin(<AdminUsersScreen />, {
      "GET /v1/admin/users": {
        body: {
          users: [{ ...USER_SUMMARY, status: "suspended", emailVerified: false }],
          nextCursor: null,
        },
      },
    });

    const table = await screen.findByTestId("admin-users-table");
    expect(within(table).getByText("suspended")).toBeInTheDocument();
    expect(within(table).getByText("unverified")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("admin-user-search-submit"));

    await waitFor(() => {
      expect(calls.filter((call) => call === "GET /v1/admin/users")).toHaveLength(1);
    });
  });

  it("shows another page only when the server offered one", async () => {
    let page = 0;
    renderAdmin(<AdminUsersScreen />, {
      "GET /v1/admin/users": () => {
        page += 1;
        return page === 1
          ? { body: { users: [USER_SUMMARY], nextCursor: "cursor-two" } }
          : {
              body: {
                users: [{ ...USER_SUMMARY, userId: LIGHT_ACTOR_ID, username: "ada", rating: null }],
                nextCursor: null,
              },
            };
      },
    });

    await userEvent.click(await screen.findByTestId("admin-users-more"));

    expect(await screen.findByTestId("admin-user-row-ada")).toBeInTheDocument();
    expect(screen.getByText("unrated")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-users-more")).not.toBeInTheDocument();
  });

  it("says so when the search fails", async () => {
    renderAdmin(<AdminUsersScreen />, {
      "GET /v1/admin/users": {
        status: 403,
        body: { error: { code: "forbidden", message: "not an administrator", requestId: "test" } },
      },
    });

    expect(await screen.findByText("not an administrator")).toBeInTheDocument();
  });
});

describe("one account", () => {
  beforeEach(() => {
    signIn();
  });

  function renderDetail(routes: RouteTable): ReturnType<typeof renderWithProviders> {
    return renderAdmin(
      <Routes>
        <Route path="/admin/users/:userId" element={<AdminUserScreen />} />
      </Routes>,
      routes,
      `/admin/users/${OTHER_USER_ID}`,
    );
  }

  it("shows the address on this page, the record and the matches", async () => {
    renderDetail({ [`GET /v1/admin/users/${OTHER_USER_ID}`]: { body: USER_DETAIL } });

    expect(await screen.findByTestId("admin-user-email")).toHaveTextContent("grace@example.com");
    expect(screen.getByTestId("admin-user-rating")).toHaveTextContent("1240 after 9");
    expect(screen.getByTestId("admin-user-sessions")).toHaveTextContent("1");
    expect(within(screen.getByTestId("admin-user-matches")).getByText("ada")).toBeInTheDocument();
    expect(screen.getByTestId("admin-moderation-empty")).toBeInTheDocument();
  });

  it("suspends only once a reason has been given, and shows what followed", async () => {
    let detail: unknown = USER_DETAIL;
    const { sent } = renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: () => ({ body: detail }),
      [`POST /v1/admin/users/${OTHER_USER_ID}/suspend`]: () => {
        detail = SUSPENDED_DETAIL;
        return { body: SUSPENDED_DETAIL };
      },
    });

    const suspend = await screen.findByTestId("admin-suspend");
    expect(suspend).toBeDisabled();

    await userEvent.type(screen.getByTestId("admin-reason"), "abusive messages");
    expect(suspend).toBeEnabled();
    await userEvent.click(suspend);

    expect(await screen.findByTestId("admin-reinstate")).toBeInTheDocument();
    expect(screen.getByTestId("admin-user-suspended-reason")).toHaveTextContent("abusive messages");
    expect(
      within(screen.getByTestId("admin-moderation")).getByText("user-suspended"),
    ).toBeInTheDocument();
    expect(sent.find((request) => request.key.endsWith("/suspend"))?.body).toEqual({
      reason: "abusive messages",
    });
  });

  it("reinstates a suspended account", async () => {
    let detail: unknown = SUSPENDED_DETAIL;
    const { sent } = renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: () => ({ body: detail }),
      [`POST /v1/admin/users/${OTHER_USER_ID}/reinstate`]: () => {
        detail = USER_DETAIL;
        return { body: USER_DETAIL };
      },
    });

    await userEvent.type(await screen.findByTestId("admin-reason"), "appeal upheld");
    await userEvent.click(screen.getByTestId("admin-reinstate"));

    expect(await screen.findByTestId("admin-suspend")).toBeInTheDocument();
    expect(sent.find((request) => request.key.endsWith("/reinstate"))?.body).toEqual({
      reason: "appeal upheld",
    });
  });

  it("corrects a rating, and refuses to when there is none", async () => {
    const { sent } = renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: { body: USER_DETAIL },
      [`POST /v1/admin/users/${OTHER_USER_ID}/rating`]: {
        body: {
          userId: OTHER_USER_ID,
          ratingBefore: 1240,
          ratingAfter: 1300,
          adjustedAt: "2026-07-26T12:10:00.000Z",
        },
      },
    });

    await userEvent.type(await screen.findByTestId("admin-reason"), "corrected after a fault");
    await userEvent.clear(screen.getByTestId("admin-rating"));
    await userEvent.type(screen.getByTestId("admin-rating"), "1300");
    await userEvent.click(screen.getByTestId("admin-correct-rating"));

    await waitFor(() => {
      expect(sent.find((request) => request.key.endsWith("/rating"))?.body).toEqual({
        rating: 1300,
        reason: "corrected after a fault",
      });
    });
  });

  it("has nothing to correct until the account has played ranked", async () => {
    renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: {
        body: { ...USER_DETAIL, ranked: null, recentMatches: [] },
      },
    });

    expect(await screen.findByTestId("admin-correct-rating")).toBeDisabled();
    expect(screen.getByTestId("admin-user-rating")).toHaveTextContent("unrated");
    expect(screen.getByTestId("admin-user-matches-empty")).toBeInTheDocument();
  });

  it("says why a change was refused", async () => {
    renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: { body: USER_DETAIL },
      [`POST /v1/admin/users/${OTHER_USER_ID}/suspend`]: {
        status: 409,
        body: { error: { code: "conflict", message: "already suspended", requestId: "test" } },
      },
    });

    await userEvent.type(await screen.findByTestId("admin-reason"), "abusive messages");
    await userEvent.click(screen.getByTestId("admin-suspend"));

    expect(await screen.findByText("already suspended")).toBeInTheDocument();
  });

  it("says so when the address names no account", () => {
    renderAdmin(
      <Routes>
        <Route path="/admin/users" element={<AdminUserScreen />} />
      </Routes>,
      {},
      "/admin/users",
    );

    expect(screen.getByText("That address names no account.")).toBeInTheDocument();
  });

  it("names the opponent from the seat this account held", async () => {
    renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: {
        body: {
          ...USER_DETAIL,
          user: { ...USER_SUMMARY, emailVerified: false },
          moderation: [
            {
              action: "role-granted",
              adminUsername: null,
              reason: "bootstrapping the first administrator",
              createdAt: "2026-07-20T09:00:00.000Z",
            },
          ],
          recentMatches: [
            { ...USER_DETAIL.recentMatches[0], side: "dark", outcome: "loss", ratingDelta: -12 },
          ],
        },
      },
    });

    const matches = await screen.findByTestId("admin-user-matches");
    expect(within(matches).getByText("Grace")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("admin-moderation")).getByText("the console"),
    ).toBeInTheDocument();
  });

  it("waits while the account is read, and says so when it cannot be", async () => {
    const pending = renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: { body: USER_DETAIL },
    });
    expect(screen.getByText("Reading the account")).toBeInTheDocument();
    pending.unmount();

    renderDetail({
      [`GET /v1/admin/users/${OTHER_USER_ID}`]: {
        status: 404,
        body: { error: { code: "not_found", message: "no such account", requestId: "test" } },
      },
    });
    expect(await screen.findByText("no such account")).toBeInTheDocument();
  });
});

describe("matches", () => {
  beforeEach(() => {
    signIn();
  });

  it("lists what is being played and links to one", async () => {
    renderAdmin(<AdminMatchesScreen />, {
      "GET /v1/admin/matches": {
        body: {
          matches: [
            {
              matchId: MATCH_ID,
              mode: "ranked",
              status: "active",
              timeControlSeconds: 300,
              version: 4,
              lightDisplayName: "Grace",
              darkDisplayName: "ada",
              startedAt: "2026-07-26T11:00:05.000Z",
            },
            {
              matchId: OTHER_USER_ID,
              mode: "casual",
              status: "queued",
              timeControlSeconds: 600,
              version: 0,
              lightDisplayName: "Guest 1234",
              darkDisplayName: "Guest 5678",
              startedAt: null,
            },
          ],
        },
      },
    });

    const table = await screen.findByTestId("admin-matches-table");
    expect(within(table).getByRole("link", { name: MATCH_ID.slice(0, 8) })).toHaveAttribute(
      "href",
      `/admin/matches/${MATCH_ID}`,
    );
    expect(within(table).getByText("11:00:05")).toBeInTheDocument();
    expect(within(table).getByText("not started")).toBeInTheDocument();
    expect(within(table).getByText("10m")).toBeInTheDocument();
  });

  it("says when nothing is being played, and when it cannot ask", async () => {
    const empty = renderAdmin(<AdminMatchesScreen />, {
      "GET /v1/admin/matches": { body: { matches: [] } },
    });
    expect(screen.getByText("Reading the running matches")).toBeInTheDocument();
    expect(await screen.findByTestId("admin-matches-empty")).toBeInTheDocument();
    empty.unmount();

    renderAdmin(<AdminMatchesScreen />, {
      "GET /v1/admin/matches": {
        status: 500,
        body: {
          error: { code: "internal_error", message: "the runtime is unwell", requestId: "test" },
        },
      },
    });
    expect(await screen.findByText("the runtime is unwell")).toBeInTheDocument();
  });

  it("shows one match with its events and the sockets that attached", async () => {
    renderAdmin(
      <Routes>
        <Route path="/admin/matches/:matchId" element={<AdminMatchScreen />} />
      </Routes>,
      { [`GET /v1/admin/matches/${MATCH_ID}`]: { body: MATCH_DETAIL } },
      `/admin/matches/${MATCH_ID}`,
    );

    expect(await screen.findByTestId("admin-match-detail")).toBeInTheDocument();
    expect(screen.getByTestId("admin-match-version")).toHaveTextContent("4");
    expect(screen.getByTestId("admin-match-result")).toHaveTextContent("unfinished");
    expect(screen.getByText("240s / 251s")).toBeInTheDocument();
    const events = screen.getByTestId("admin-match-events");
    expect(within(events).getByText("server")).toBeInTheDocument();
    expect(within(events).getByText('{"to":{"row":1,"column":1}}')).toBeInTheDocument();
    expect(
      within(screen.getByTestId("admin-match-connections")).getByText("attached"),
    ).toBeInTheDocument();
  });

  it("shows a finished match, and a match nothing attached to", async () => {
    renderAdmin(
      <Routes>
        <Route path="/admin/matches/:matchId" element={<AdminMatchScreen />} />
      </Routes>,
      {
        [`GET /v1/admin/matches/${MATCH_ID}`]: {
          body: {
            ...MATCH_DETAIL,
            match: {
              ...MATCH_DETAIL.match,
              status: "completed",
              result: { outcome: "light", reason: "resignation" },
              endedAt: "2026-07-26T11:10:00.000Z",
            },
            connections: [],
          },
        },
      },
      `/admin/matches/${MATCH_ID}`,
    );

    expect(await screen.findByTestId("admin-match-result")).toHaveTextContent(
      "light by resignation",
    );
    expect(screen.getByTestId("admin-match-connections-empty")).toBeInTheDocument();
  });

  it("says so when the address names no match", () => {
    renderAdmin(
      <Routes>
        <Route path="/admin/matches" element={<AdminMatchScreen />} />
      </Routes>,
      {},
      "/admin/matches",
    );

    expect(screen.getByText("That address names no match.")).toBeInTheDocument();
  });

  it("waits while the match is read, and says so when it cannot be", async () => {
    const pending = renderAdmin(
      <Routes>
        <Route path="/admin/matches/:matchId" element={<AdminMatchScreen />} />
      </Routes>,
      { [`GET /v1/admin/matches/${MATCH_ID}`]: { body: MATCH_DETAIL } },
      `/admin/matches/${MATCH_ID}`,
    );
    expect(screen.getByText("Reading the match")).toBeInTheDocument();
    pending.unmount();

    renderAdmin(
      <Routes>
        <Route path="/admin/matches/:matchId" element={<AdminMatchScreen />} />
      </Routes>,
      {
        [`GET /v1/admin/matches/${MATCH_ID}`]: {
          status: 404,
          body: { error: { code: "not_found", message: "no such match", requestId: "test" } },
        },
      },
      `/admin/matches/${MATCH_ID}`,
    );
    expect(await screen.findByText("no such match")).toBeInTheDocument();
  });
});

describe("the achievement catalogue", () => {
  beforeEach(() => {
    signIn();
  });

  it("lists what is offered and how often it has been earned", async () => {
    renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": { body: ACHIEVEMENTS },
    });

    const table = await screen.findByTestId("admin-achievements-table");
    expect(within(table).getByText("First Victory")).toBeInTheDocument();
    expect(within(table).getByText("12")).toBeInTheDocument();
    expect(within(table).getByText("enabled")).toBeInTheDocument();
  });

  it("changes an entry with the reason that becomes the audit record", async () => {
    const { sent } = renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": { body: ACHIEVEMENTS },
      [`PATCH /v1/admin/achievements/${ACHIEVEMENTS.achievements[0]?.achievementId ?? ""}`]: {
        body: { ...ACHIEVEMENTS.achievements[0], enabled: false },
      },
    });

    await userEvent.click(await screen.findByTestId("admin-achievement-edit-first-victory"));
    await userEvent.click(screen.getByTestId("admin-achievement-edit-first-victory"));
    expect(screen.queryByTestId("achievement-name")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("admin-achievement-edit-first-victory"));
    await userEvent.clear(screen.getByTestId("achievement-name"));
    await userEvent.type(screen.getByTestId("achievement-name"), "First Win");
    await userEvent.clear(screen.getByTestId("achievement-description"));
    await userEvent.type(screen.getByTestId("achievement-description"), "Win one match.");
    await userEvent.selectOptions(screen.getByTestId("achievement-badge"), "silver");
    await userEvent.click(screen.getByLabelText("Offered to players"));

    const save = screen.getByTestId("achievement-save");
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByTestId("achievement-reason"), "renamed for clarity");
    await userEvent.click(save);

    await waitFor(() => {
      expect(sent.find((request) => request.key.startsWith("PATCH"))?.body).toEqual({
        name: "First Win",
        description: "Win one match.",
        badge: "silver",
        enabled: false,
        reason: "renamed for clarity",
      });
    });
    expect(screen.queryByTestId("achievement-save")).not.toBeInTheDocument();
  });

  it("offers a code the server has a rule for, and nothing else", async () => {
    const { sent } = renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": { body: ACHIEVEMENTS },
      "POST /v1/admin/achievements": {
        body: {
          ...ACHIEVEMENTS.achievements[0],
          achievementId: "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
          code: "getting-started",
          name: "Getting Started",
        },
      },
    });

    const codes = await screen.findByTestId("achievement-create-code");
    expect(within(codes).queryByRole("option", { name: "first-victory" })).not.toBeInTheDocument();
    await userEvent.selectOptions(codes, "century-club");
    await userEvent.type(screen.getByTestId("achievement-create-reason"), "offering it again");
    await userEvent.click(screen.getByTestId("achievement-create"));

    await waitFor(() => {
      expect(sent.find((request) => request.key === "POST /v1/admin/achievements")?.body).toEqual({
        code: "century-club",
        name: "Century Club",
        description: "Complete one hundred matches.",
        badge: "gold",
        reason: "offering it again",
      });
    });
  });

  it("says why an edit was refused, and shows an entry that is no longer offered", async () => {
    const achievementId = ACHIEVEMENTS.achievements[0]?.achievementId ?? "";
    renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": {
        body: { achievements: [{ ...ACHIEVEMENTS.achievements[0], enabled: false }] },
      },
      [`PATCH /v1/admin/achievements/${achievementId}`]: {
        status: 422,
        body: {
          error: { code: "validation_failed", message: "nothing changed", requestId: "test" },
        },
      },
    });

    expect(await screen.findByText("disabled")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("admin-achievement-edit-first-victory"));
    await userEvent.type(screen.getByTestId("achievement-reason"), "renamed for clarity");
    await userEvent.click(screen.getByTestId("achievement-save"));

    expect(await screen.findByText("nothing changed")).toBeInTheDocument();
  });

  it("says why a creation was refused", async () => {
    renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": { body: ACHIEVEMENTS },
      "POST /v1/admin/achievements": {
        status: 409,
        body: {
          error: { code: "conflict", message: "that code is already offered", requestId: "test" },
        },
      },
    });

    await userEvent.type(
      await screen.findByTestId("achievement-create-reason"),
      "offering it again",
    );
    await userEvent.click(screen.getByTestId("achievement-create"));

    expect(await screen.findByText("that code is already offered")).toBeInTheDocument();
  });

  it("offers nothing to create once every code is listed", async () => {
    const { ACHIEVEMENT_CATALOGUE } = await import("@gobblet/protocol");
    renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": {
        body: {
          achievements: ACHIEVEMENT_CATALOGUE.map((entry, index) => ({
            ...entry,
            achievementId: `0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c${String(index).padStart(2, "0")}`,
            enabled: true,
            awarded: 0,
            updatedAt: "2026-07-01T08:00:00.000Z",
          })),
        },
      },
    });

    await screen.findByTestId("admin-achievements-table");
    expect(screen.queryByTestId("achievement-create")).not.toBeInTheDocument();
  });

  it("waits while the catalogue is read, and says so when it cannot be", async () => {
    const pending = renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": { body: ACHIEVEMENTS },
    });
    expect(screen.getByText("Reading the catalogue")).toBeInTheDocument();
    pending.unmount();

    renderAdmin(<AdminAchievementsScreen />, {
      "GET /v1/admin/achievements": {
        status: 403,
        body: { error: { code: "forbidden", message: "not an administrator", requestId: "test" } },
      },
    });
    expect(await screen.findByText("not an administrator")).toBeInTheDocument();
  });
});

describe("the audit log", () => {
  beforeEach(() => {
    signIn();
  });

  it("shows every change newest first, with what it changed", async () => {
    let page = 0;
    renderAdmin(<AdminAuditScreen />, {
      "GET /v1/admin/audit": () => {
        page += 1;
        return { body: page === 1 ? AUDIT_PAGE_ONE : AUDIT_PAGE_TWO };
      },
    });

    const table = await screen.findByTestId("admin-audit-table");
    expect(within(table).getByText("user-suspended")).toBeInTheDocument();
    expect(within(table).getByText("grace")).toBeInTheDocument();
    expect(within(table).getByText('{"status":"suspended"}')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("admin-audit-more"));

    expect(await screen.findByText("role-granted")).toBeInTheDocument();
    expect(screen.getByText("the console")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText(LIGHT_ACTOR_ID.slice(0, 8))).toBeInTheDocument();
    expect(screen.queryByTestId("admin-audit-more")).not.toBeInTheDocument();
  });

  it("says when nothing has been done, and when it cannot ask", async () => {
    const empty = renderAdmin(<AdminAuditScreen />, {
      "GET /v1/admin/audit": { body: { entries: [], nextCursor: null } },
    });
    expect(screen.getByText("Reading the audit log")).toBeInTheDocument();
    expect(await screen.findByTestId("admin-audit-empty")).toBeInTheDocument();
    empty.unmount();

    renderAdmin(<AdminAuditScreen />, {
      "GET /v1/admin/audit": {
        status: 403,
        body: { error: { code: "forbidden", message: "not an administrator", requestId: "test" } },
      },
    });
    expect(await screen.findByText("not an administrator")).toBeInTheDocument();
  });
});
