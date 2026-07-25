import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../src/app/routes";
import { useSessionStore } from "../src/session/store";
import { renderWithProviders } from "./helpers/render";

const CONFIG = {
  appEnv: "local",
  appVersion: "1.0.0",
  minSupportedClientVersion: "0.1.0",
  modes: ["casual", "ranked"],
  timeControlsSeconds: [180, 300, 600, 900],
};

const ACCOUNT = {
  userId: "11111111-1111-4111-8111-111111111111",
  username: "ada",
  email: "ada@example.com",
  emailVerified: false,
  status: "active",
  createdAt: "2026-07-25T10:00:00.000Z",
};

const SESSION = { sessionToken: "session-token", expiresAt: "2026-08-25T10:00:00.000Z" };

const ME = {
  account: { ...ACCOUNT, emailVerified: true },
  profile: {
    avatarUrl: null,
    countryCode: null,
    presetMessagesMuted: false,
    reactionsMuted: false,
    gameSoundMuted: false,
    reducedMotion: false,
  },
  casual: { wins: 3, losses: 1, draws: 0, played: 4 },
  ranked: {
    rating: 1216,
    wins: 1,
    losses: 0,
    draws: 0,
    played: 1,
    currentStreak: 1,
    bestStreak: 1,
  },
};

beforeEach(() => {
  useSessionStore.getState().signedOut();
});

describe("home screen", () => {
  it("offers a guest session and remembers it", async () => {
    renderWithProviders(<AppRoutes />, {
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/guests": {
          status: 201,
          body: {
            guestId: "22222222-2222-4222-8222-222222222222",
            displayName: "Guest Fox",
            sessionToken: "guest-token",
            expiresAt: "2026-07-26T10:00:00.000Z",
          },
        },
      },
    });

    await userEvent.click(await screen.findByTestId("play-as-guest"));

    await waitFor(() => {
      expect(useSessionStore.getState().session?.token).toBe("guest-token");
    });
    expect(await screen.findByTestId("identity-name")).toHaveTextContent("Guest Fox");
  });

  it("reports a refused guest session", async () => {
    renderWithProviders(<AppRoutes />, {
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/guests": {
          status: 503,
          body: {
            error: {
              code: "dependency_unavailable",
              message: "The database is unavailable",
              requestId: "req-3",
            },
          },
        },
      },
    });

    await userEvent.click(await screen.findByTestId("play-as-guest"));

    expect(await screen.findByRole("alert")).toHaveTextContent("The database is unavailable");
  });

  it("says so when an account has played no ranked match", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "account",
      displayName: "ada",
      username: "ada",
    });

    renderWithProviders(<AppRoutes />, {
      routes: {
        "GET /v1/config": { body: CONFIG },
        "GET /v1/me": { body: { ...ME, ranked: null } },
      },
    });

    expect(await screen.findByText("no ranked matches yet")).toBeInTheDocument();
  });

  it("shows the server document", async () => {
    renderWithProviders(<AppRoutes />, { routes: { "GET /v1/config": { body: CONFIG } } });

    expect(await screen.findByText("3 min, 5 min, 10 min, 15 min")).toBeInTheDocument();
  });

  it("reports an unreachable server without breaking the page", async () => {
    renderWithProviders(<AppRoutes />, {
      routes: { "GET /v1/config": { status: 503, body: {} } },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("status 503");
  });

  it("shows the account record and asks an unverified account to verify", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "account",
      displayName: "ada",
      username: "ada",
    });

    renderWithProviders(<AppRoutes />, {
      routes: {
        "GET /v1/config": { body: CONFIG },
        "GET /v1/me": { body: { ...ME, account: { ...ACCOUNT, emailVerified: false } } },
      },
    });

    expect(await screen.findByTestId("account-record")).toHaveTextContent("1216 rating");
    expect(screen.getByText("Email not verified")).toBeInTheDocument();
  });
});

describe("sign in", () => {
  it("refuses to send credentials that cannot be valid", async () => {
    const { calls } = renderWithProviders(<AppRoutes />, {
      initialPath: "/sign-in",
      routes: { "GET /v1/config": { body: CONFIG } },
    });

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByTestId("sign-in-submit"));

    expect(await screen.findByRole("status")).toHaveTextContent("Enter the email address");
    expect(calls).not.toContain("POST /v1/auth/sign-in");
  });

  it("stores the session and returns to the lobby", async () => {
    renderWithProviders(<AppRoutes />, {
      initialPath: "/sign-in",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "GET /v1/me": { body: ME },
        "POST /v1/auth/sign-in": { body: { account: ACCOUNT, session: SESSION } },
      },
    });

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse 1");
    await userEvent.click(screen.getByTestId("sign-in-submit"));

    await waitFor(() => {
      expect(useSessionStore.getState().session?.token).toBe("session-token");
    });
    expect(await screen.findByTestId("account-record")).toBeInTheDocument();
  });

  it("shows the server's reason for a refusal", async () => {
    renderWithProviders(<AppRoutes />, {
      initialPath: "/sign-in",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/auth/sign-in": {
          status: 401,
          body: {
            error: {
              code: "unauthenticated",
              message: "Email or password is incorrect",
              requestId: "req-1",
            },
          },
        },
      },
    });

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse 1");
    await userEvent.click(screen.getByTestId("sign-in-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");
  });
});

describe("registration", () => {
  it("validates each field with the shared rules before sending anything", async () => {
    const { calls } = renderWithProviders(<AppRoutes />, {
      initialPath: "/register",
      routes: { "GET /v1/config": { body: CONFIG } },
    });

    await userEvent.type(screen.getByLabelText("Email"), "nope");
    await userEvent.type(screen.getByLabelText("Username"), "1bad");
    await userEvent.type(screen.getByLabelText("Password"), "tiny");
    await userEvent.click(screen.getByTestId("register-submit"));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText(/start with a letter/)).toBeInTheDocument();
    expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument();
    expect(calls).not.toContain("POST /v1/auth/register");
  });

  it("reports an unavailable username when the field loses focus", async () => {
    renderWithProviders(<AppRoutes />, {
      initialPath: "/register",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/usernames/check": {
          body: { username: "ada", available: false, reason: "taken" },
        },
      },
    });

    await userEvent.type(screen.getByLabelText("Username"), "ada");
    await userEvent.tab();

    expect(await screen.findByText(/username is unavailable \(taken\)/)).toBeInTheDocument();
  });

  it("registers, then carries the verification token to the verification screen", async () => {
    renderWithProviders(<AppRoutes />, {
      initialPath: "/register",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/auth/register": {
          status: 201,
          body: {
            account: ACCOUNT,
            session: SESSION,
            emailVerification: { token: "verify-me", expiresAt: "2026-07-26T10:00:00.000Z" },
          },
        },
      },
    });

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Username"), "ada");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse 1");
    await userEvent.click(screen.getByTestId("register-submit"));

    expect(await screen.findByLabelText("Verification token")).toHaveValue("verify-me");
  });

  it("claims the guest session instead of registering a second account", async () => {
    useSessionStore.getState().signedIn({
      token: "guest-token",
      kind: "guest",
      displayName: "Guest Fox",
      username: null,
    });

    const { calls } = renderWithProviders(<AppRoutes />, {
      initialPath: "/register",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/guests/claim": {
          body: { account: ACCOUNT, session: SESSION, claimedMatches: 2 },
        },
      },
    });

    expect(screen.getByRole("heading", { name: "Keep your guest history" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Username"), "ada");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse 1");
    await userEvent.click(screen.getByTestId("register-submit"));

    await waitFor(() => {
      expect(calls).toContain("POST /v1/guests/claim");
    });
    expect(useSessionStore.getState().session?.kind).toBe("account");
  });
});

describe("verification", () => {
  it("verifies a pasted token and goes back to the lobby", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "account",
      displayName: "ada",
      username: "ada",
    });

    const { calls } = renderWithProviders(<AppRoutes />, {
      initialPath: "/verify-email",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "GET /v1/me": { body: ME },
        "POST /v1/auth/verify-email": { status: 204 },
      },
    });

    await userEvent.type(screen.getByLabelText("Verification token"), "  pasted-token  ");
    await userEvent.click(screen.getByTestId("verify-submit"));

    await waitFor(() => {
      expect(calls).toContain("POST /v1/auth/verify-email");
    });
    expect(await screen.findByTestId("account-record")).toBeInTheDocument();
  });

  it("keeps an empty submission to itself", async () => {
    const { calls } = renderWithProviders(<AppRoutes />, {
      initialPath: "/verify-email",
      routes: { "GET /v1/config": { body: CONFIG } },
    });

    await userEvent.click(screen.getByTestId("verify-submit"));

    expect(calls).not.toContain("POST /v1/auth/verify-email");
  });

  it("shows the server's refusal", async () => {
    const { calls } = renderWithProviders(<AppRoutes />, {
      initialPath: "/verify-email",
      routes: {
        "GET /v1/config": { body: CONFIG },
        "POST /v1/auth/verify-email": {
          status: 400,
          body: {
            error: {
              code: "validation_failed",
              message: "That token is not valid",
              requestId: "req-2",
            },
          },
        },
      },
    });

    await userEvent.type(screen.getByLabelText("Verification token"), "wrong");
    await userEvent.click(screen.getByTestId("verify-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("That token is not valid");
    expect(calls).toContain("POST /v1/auth/verify-email");
  });
});

describe("shell", () => {
  it("signs out, forgets the session and returns to the lobby", async () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "account",
      displayName: "ada",
      username: "ada",
    });

    const { calls } = renderWithProviders(<AppRoutes />, {
      routes: {
        "GET /v1/config": { body: CONFIG },
        "GET /v1/me": { body: ME },
        "POST /v1/auth/sign-out": { status: 204 },
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(useSessionStore.getState().session).toBeNull();
    });
    expect(calls).toContain("POST /v1/auth/sign-out");
    expect(await screen.findByTestId("play-as-guest")).toBeInTheDocument();
  });

  it("answers an unknown address", async () => {
    renderWithProviders(<AppRoutes />, {
      initialPath: "/nowhere",
      routes: { "GET /v1/config": { body: CONFIG } },
    });

    expect(await screen.findByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
  });
});
