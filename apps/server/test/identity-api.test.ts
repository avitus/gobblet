import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import { upsertRating } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import {
  ACHIEVEMENT_CATALOGUE,
  achievementsResponseSchema,
  authResponseSchema,
  checkUsernameResponseSchema,
  claimGuestResponseSchema,
  createGuestResponseSchema,
  httpErrorBodySchema,
  matchHistoryResponseSchema,
  meResponseSchema,
  profileSettingsSchema,
  publicProfileSchema,
} from "@gobblet/protocol";
import type { AuthResponse, CreateGuestResponse } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { adminServiceFixture, releaseServiceFixture } from "./helpers/admin-service";
import { TestClock, envelope } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const config: ServerConfig = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal",
});

const credentials = {
  email: "ada@example.com",
  password: "correct-horse-7",
  username: "ada",
} as const;

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;
let guests: GuestService;
let identity: IdentityService;
let leaderboards: LeaderboardService;
let app: FastifyInstance;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  runtime = new MatchRuntime({ db: handle.db, now: clock.now });
  guests = new GuestService({ db: handle.db, config, now: clock.now });
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
  leaderboards = new LeaderboardService({ db: handle.db, now: clock.now });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests,
      identity,
      leaderboards,
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      releases: releaseServiceFixture({ db: handle.db, now: clock.now }),
      db: handle.db,
    },
    telemetry: createSilentTelemetry(),
    now: clock.now,
  });
});

afterEach(async () => {
  await app.close();
});

async function register(body: Record<string, unknown> = credentials): Promise<AuthResponse> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: body });
  expect(response.statusCode).toBe(201);
  return authResponseSchema.parse(response.json());
}

async function createGuest(): Promise<CreateGuestResponse> {
  const response = await app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  return createGuestResponseSchema.parse(response.json());
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("POST /v1/auth/register", () => {
  it("creates an account with a session and a verification handoff", async () => {
    const body = await register();

    expect(body.account).toMatchObject({
      username: "ada",
      email: "ada@example.com",
      emailVerified: false,
      status: "active",
    });
    expect(body.session.sessionToken.length).toBeGreaterThan(20);
    expect(new Date(body.session.expiresAt).getTime()).toBeGreaterThan(clock.now());
    expect(body.emailVerification?.token.length).toBeGreaterThan(20);
  });

  it("normalises the email and keeps the chosen capitalisation of the username", async () => {
    const body = await register({ ...credentials, email: " Ada@Example.COM ", username: " Ada " });

    expect(body.account.email).toBe("ada@example.com");
    expect(body.account.username).toBe("Ada");
  });

  it("rejects a weak password with the field that failed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { ...credentials, password: "password" },
    });

    expect(response.statusCode).toBe(400);
    const body = httpErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.map((detail) => detail.path)).toContain("password");
  });

  it("refuses a second account for the same email address", async () => {
    await register();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { ...credentials, username: "grace" },
    });

    expect(response.statusCode).toBe(409);
    const body = httpErrorBodySchema.parse(response.json());
    expect(body.error.details).toEqual([{ path: "email", issue: "already_taken" }]);
  });

  it("refuses a username that differs only by capitalisation", async () => {
    await register();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { ...credentials, email: "grace@example.com", username: "ADA" },
    });

    expect(response.statusCode).toBe(409);
    expect(httpErrorBodySchema.parse(response.json()).error.details).toEqual([
      { path: "username", issue: "already_taken" },
    ]);
  });

  it("holds the username when two registrations race for it", async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { ...credentials, email: "one@example.com" },
      }),
      app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { ...credentials, email: "two@example.com" },
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    const check = await app.inject({
      method: "POST",
      url: "/v1/usernames/check",
      payload: { username: "ada" },
    });
    expect(checkUsernameResponseSchema.parse(check.json())).toMatchObject({
      available: false,
      reason: "taken",
    });
  });

  it("throttles repeated registrations from one address", async () => {
    const responses = [];
    for (let index = 0; index < 12; index += 1) {
      responses.push(
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { ...credentials, email: `ada${index}@example.com`, username: `ada${index}` },
        }),
      );
    }

    expect(responses.filter((response) => response.statusCode === 429).length).toBeGreaterThan(0);
  });

  it("treats a request with no body as an invalid one", async () => {
    const register = await app.inject({ method: "POST", url: "/v1/auth/register" });
    const signIn = await app.inject({ method: "POST", url: "/v1/auth/sign-in" });
    const verify = await app.inject({ method: "POST", url: "/v1/auth/verify-email" });
    const username = await app.inject({ method: "POST", url: "/v1/usernames/check" });

    expect(register.statusCode).toBe(400);
    expect(signIn.statusCode).toBe(401);
    expect(verify.statusCode).toBe(400);
    expect(username.statusCode).toBe(400);
  });

  it("does not return the verification token in production", async () => {
    const productionConfig = loadServerConfig({
      APP_ENV: "production",
      NODE_ENV: "production",
      LOG_LEVEL: "fatal",
    });
    const productionIdentity = new IdentityService({
      db: handle.db,
      config: productionConfig,
      now: clock.now,
    });

    const result = await productionIdentity.register(credentials);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.emailVerification).toBeUndefined();
    }
  });
});

describe("POST /v1/auth/sign-in", () => {
  it("issues a new session for the right password", async () => {
    const registered = await register();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: "ADA@example.com", password: credentials.password },
    });

    expect(response.statusCode).toBe(200);
    const body = authResponseSchema.parse(response.json());
    expect(body.account.userId).toBe(registered.account.userId);
    expect(body.session.sessionToken).not.toBe(registered.session.sessionToken);
  });

  it("answers the same way for an unknown email and a wrong password", async () => {
    await register();

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: credentials.email, password: "wrong-horse-7" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: "nobody@example.com", password: credentials.password },
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: "not-an-email", password: "x" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({
      ...unknownEmail.json(),
      error: { ...unknownEmail.json().error, requestId: wrongPassword.json().error.requestId },
    });
  });

  it("refuses a suspended account and says so", async () => {
    const registered = await register();
    await identity.suspend(registered.account.userId, "abuse");

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: credentials.email, password: credentials.password },
    });

    expect(response.statusCode).toBe(403);
    expect(httpErrorBodySchema.parse(response.json()).error.details).toEqual([
      { path: "account", issue: "suspended" },
    ]);
  });

  it("throttles repeated attempts from one address", async () => {
    await register();

    const attempts = [];
    for (let index = 0; index < 12; index += 1) {
      attempts.push(
        await app.inject({
          method: "POST",
          url: "/v1/auth/sign-in",
          payload: { email: credentials.email, password: `wrong-horse-${index}` },
        }),
      );
    }

    const limited = attempts.filter((response) => response.statusCode === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0]?.headers["retry-after"]).toBeDefined();
    expect(httpErrorBodySchema.parse(limited[0]?.json()).error.code).toBe("rate_limited");
  });

  it("takes the number of attempts it allows from the configuration", async () => {
    await register();
    const strict = await buildApp({
      config: loadServerConfig({ LOG_LEVEL: "fatal", CREDENTIAL_ATTEMPT_LIMIT: "2" }),
      services: {
        runtime,
        guests,
        identity,
        leaderboards,
        admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
        releases: releaseServiceFixture({ db: handle.db, now: clock.now }),
        db: handle.db,
      },
      telemetry: createSilentTelemetry(),
      now: clock.now,
    });

    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await strict.inject({
        method: "POST",
        url: "/v1/auth/sign-in",
        payload: { email: credentials.email, password: `wrong-horse-${String(index)}` },
      });
      statuses.push(response.statusCode);
    }
    await strict.close();

    expect(statuses).toEqual([401, 401, 429]);
  });
});

describe("POST /v1/auth/sign-out", () => {
  it("makes the session token unusable", async () => {
    const registered = await register();
    const token = registered.session.sessionToken;

    const signOut = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: auth(token),
    });
    const afterSignOut = await app.inject({ method: "GET", url: "/v1/me", headers: auth(token) });

    expect(signOut.statusCode).toBe(204);
    expect(afterSignOut.statusCode).toBe(401);
  });

  it("requires a credential, and refuses a guest session", async () => {
    const guest = await createGuest();

    const anonymous = await app.inject({ method: "POST", url: "/v1/auth/sign-out" });
    const asGuest = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: auth(guest.sessionToken),
    });

    expect(anonymous.statusCode).toBe(401);
    expect(asGuest.statusCode).toBe(403);
  });
});

describe("POST /v1/auth/verify-email", () => {
  it("verifies once and refuses the same link afterwards", async () => {
    const registered = await register();
    const token = registered.emailVerification?.token ?? "";

    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().account.emailVerified).toBe(true);
    expect(second.statusCode).toBe(400);
    expect(httpErrorBodySchema.parse(second.json()).error.details).toEqual([
      { path: "token", issue: "already-used" },
    ]);
  });

  it("refuses an unknown token, an expired token and a malformed body", async () => {
    const registered = await register();
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: "not-a-token" },
    });

    clock.advance(4 * 24 * 60 * 60 * 1000);
    const expired = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: registered.emailVerification?.token ?? "" },
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: {},
    });

    expect(httpErrorBodySchema.parse(unknown.json()).error.details).toEqual([
      { path: "token", issue: "unknown-token" },
    ]);
    expect(httpErrorBodySchema.parse(expired.json()).error.details).toEqual([
      { path: "token", issue: "expired" },
    ]);
    expect(malformed.statusCode).toBe(400);
  });

  it("reports the verified state through the account view", async () => {
    const registered = await register();
    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: registered.emailVerification?.token ?? "" },
    });

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(registered.session.sessionToken),
    });

    expect(meResponseSchema.parse(me.json()).account.emailVerified).toBe(true);
  });
});

describe("GET /v1/me", () => {
  it("returns the account, its settings and an empty casual record", async () => {
    const registered = await register();

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(registered.session.sessionToken),
    });

    expect(response.statusCode).toBe(200);
    expect(meResponseSchema.parse(response.json())).toMatchObject({
      account: { username: "ada", email: "ada@example.com" },
      profile: { avatarUrl: null, countryCode: null, reducedMotion: false },
      casual: { wins: 0, losses: 0, draws: 0, played: 0 },
      // An account with no rating has no rank rather than an invented one (P6.11).
      rank: null,
    });
  });

  it("is readable while the account is suspended", async () => {
    const registered = await register();
    await identity.reinstate(registered.account.userId);
    const signedIn = authResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/sign-in",
          payload: { email: credentials.email, password: credentials.password },
        })
      ).json(),
    );
    await handle.db.execute(
      `update users set status = 'suspended' where id = '${registered.account.userId}'`,
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(signedIn.session.sessionToken),
    });

    expect(meResponseSchema.parse(response.json()).account.status).toBe("suspended");
  });

  it("refuses an anonymous caller and a guest session", async () => {
    const guest = await createGuest();

    expect((await app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: auth(guest.sessionToken) }))
        .statusCode,
    ).toBe(403);
  });

  it("refuses a session whose account has been deleted", async () => {
    const registered = await register();
    await handle.db.execute(
      `update users set status = 'deleted' where id = '${registered.account.userId}'`,
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(registered.session.sessionToken),
    });

    expect(response.statusCode).toBe(401);
  });

  it("reports a missing profile as an unknown account", async () => {
    const registered = await register();
    await handle.db.execute(`delete from profiles where user_id = '${registered.account.userId}'`);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(registered.session.sessionToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it("refuses an expired session", async () => {
    const registered = await register();
    clock.advance((config.userSessionTtlDays + 1) * 24 * 60 * 60 * 1000);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(registered.session.sessionToken),
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("PATCH /v1/me/profile", () => {
  it("applies a partial update and normalises what it stores", async () => {
    const registered = await register();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: auth(registered.session.sessionToken),
      payload: { countryCode: " gb ", reducedMotion: true },
    });

    expect(profileSettingsSchema.parse(response.json())).toMatchObject({
      countryCode: "GB",
      reducedMotion: true,
      avatarUrl: null,
    });
  });

  it("clears an avatar with an explicit null", async () => {
    const registered = await register();
    await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: auth(registered.session.sessionToken),
      payload: { avatarUrl: "https://cdn.example.com/a.png" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: auth(registered.session.sessionToken),
      payload: { avatarUrl: null },
    });

    expect(profileSettingsSchema.parse(response.json()).avatarUrl).toBeNull();
  });

  it("refuses an empty patch, a missing body, a plaintext avatar and a username change", async () => {
    const registered = await register();
    const headers = auth(registered.session.sessionToken);

    const empty = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers,
      payload: {},
    });
    const noBody = await app.inject({ method: "PATCH", url: "/v1/me/profile", headers });
    const insecure = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers,
      payload: { avatarUrl: "http://cdn.example.com/a.png" },
    });
    const rename = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers,
      payload: { username: "ada2" },
    });

    expect(empty.statusCode).toBe(400);
    expect(noBody.statusCode).toBe(400);
    expect(insecure.statusCode).toBe(400);
    expect(rename.statusCode).toBe(400);
  });

  it("requires an account", async () => {
    const guest = await createGuest();

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/me/profile",
          headers: auth(guest.sessionToken),
          payload: { reducedMotion: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/me/profile",
          payload: { reducedMotion: true },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("GET /v1/me/matches", () => {
  it("lists the matches of the calling account, and none for a fresh guest", async () => {
    const registered = await register();
    const opponent = await createGuest();
    await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: {
        actorType: "user",
        actorId: registered.account.userId,
        displayName: registered.account.username,
      },
      dark: {
        actorType: "guest",
        actorId: opponent.guestId,
        displayName: opponent.displayName,
      },
    });

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/matches",
      headers: auth(registered.session.sessionToken),
    });
    const theirs = await app.inject({
      method: "GET",
      url: "/v1/me/matches",
      headers: auth((await createGuest()).sessionToken),
    });

    expect(mine.statusCode).toBe(200);
    const history = matchHistoryResponseSchema.parse(mine.json());
    expect(history.matches).toHaveLength(1);
    expect(history.matches[0]?.players.light.displayName).toBe("ada");
    expect(matchHistoryResponseSchema.parse(theirs.json()).matches).toEqual([]);
  });

  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me/matches" })).statusCode).toBe(401);
  });
});

describe("POST /v1/usernames/check", () => {
  it("answers available for a free name", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/usernames/check",
      payload: { username: " Ada " },
    });

    expect(checkUsernameResponseSchema.parse(response.json())).toEqual({
      username: "Ada",
      available: true,
      reason: null,
    });
  });

  it("explains why a name cannot be used", async () => {
    await register();

    const taken = await app.inject({
      method: "POST",
      url: "/v1/usernames/check",
      payload: { username: "ADA" },
    });
    const reserved = await app.inject({
      method: "POST",
      url: "/v1/usernames/check",
      payload: { username: "Admin" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/usernames/check",
      payload: { username: "ad" },
    });

    expect(checkUsernameResponseSchema.parse(taken.json()).reason).toBe("taken");
    expect(checkUsernameResponseSchema.parse(reserved.json()).reason).toBe("reserved");
    expect(checkUsernameResponseSchema.parse(invalid.json()).reason).toBe("invalid");
  });

  it("rejects a malformed request body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/usernames/check",
      payload: { username: "" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /v1/guests/claim", () => {
  it("turns the calling guest session into an account", async () => {
    const guest = await createGuest();

    const response = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: credentials,
    });

    expect(response.statusCode).toBe(201);
    const body = claimGuestResponseSchema.parse(response.json());
    expect(body.account.username).toBe("ada");
    expect(body.claimedMatches).toBe(0);
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(body.session.sessionToken),
    });
    expect(me.statusCode).toBe(200);
  });

  it("keeps the guest token working as an account session", async () => {
    const guest = await createGuest();
    await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: credentials,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(guest.sessionToken),
    });

    expect(response.statusCode).toBe(200);
    expect(meResponseSchema.parse(response.json()).account.username).toBe("ada");
  });

  it("has nothing left to claim once the token is an account session", async () => {
    const guest = await createGuest();
    await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: credentials,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: { ...credentials, email: "grace@example.com", username: "grace" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses a claim whose guest session was claimed while the request was in flight", async () => {
    const owner = await register({
      email: "grace@example.com",
      password: "correct-horse-7",
      username: "grace",
    });
    const guest = await createGuest();
    // The winning claim commits between resolving this token and claiming it,
    // which is the interleaving the transactional check exists for.
    await handle.db.execute(
      `update guest_sessions set claimed_by_user_id = '${owner.account.userId}', claimed_at = now() where id = '${guest.guestId}'`,
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: credentials,
    });

    expect(response.statusCode).toBe(409);
    const body = httpErrorBodySchema.parse(response.json());
    expect(body.error.message).toBe("This guest session has already been claimed");
    expect(body.error.details).toEqual([{ path: "guest", issue: "already_claimed" }]);
  });

  it("refuses an email or a username that is already in use", async () => {
    await register();
    const guest = await createGuest();

    const email = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: { ...credentials, username: "grace" },
    });
    const username = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: { ...credentials, email: "grace@example.com" },
    });

    expect(httpErrorBodySchema.parse(email.json()).error.details).toEqual([
      { path: "email", issue: "already_taken" },
    ]);
    expect(httpErrorBodySchema.parse(username.json()).error.details).toEqual([
      { path: "username", issue: "already_taken" },
    ]);
  });

  it("requires a guest session, not an account session and not nothing", async () => {
    const registered = await register();

    const asUser = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(registered.session.sessionToken),
      payload: { ...credentials, email: "grace@example.com", username: "grace" },
    });
    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      payload: credentials,
    });

    expect(asUser.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
  });

  it("treats a claim with no body as an invalid one", async () => {
    const guest = await createGuest();

    const response = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a malformed claim", async () => {
    const guest = await createGuest();

    const response = await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: auth(guest.sessionToken),
      payload: { email: "ada@example.com" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/profiles/:username", () => {
  it("shows the public fields of a profile to anyone", async () => {
    const registered = await register();
    await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: auth(registered.session.sessionToken),
      payload: { countryCode: "gb", avatarUrl: "https://cdn.example.com/a.png" },
    });

    const response = await app.inject({ method: "GET", url: "/v1/profiles/ADA" });

    expect(response.statusCode).toBe(200);
    const profile = publicProfileSchema.parse(response.json());
    expect(profile).toEqual({
      username: "ada",
      avatarUrl: "https://cdn.example.com/a.png",
      countryCode: "GB",
      memberSince: new Date(clock.now()).toISOString().slice(0, 7),
      casual: { wins: 0, losses: 0, draws: 0, played: 0 },
      ranked: null,
      rank: null,
      badges: [],
      recentMatches: [],
    });
    expect(JSON.stringify(profile)).not.toContain("ada@example.com");
  });

  it("counts finished casual matches in the record", async () => {
    const registered = await register();
    const opponent = await createGuest();
    const snapshot = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: registered.account.userId, displayName: "ada" },
      dark: { actorType: "guest", actorId: opponent.guestId, displayName: opponent.displayName },
    });
    await runtime.applyResignCommand(
      { actorType: "guest", actorId: opponent.guestId },
      envelope(snapshot.matchId, 0),
    );

    const response = await app.inject({ method: "GET", url: "/v1/profiles/ada" });

    expect(publicProfileSchema.parse(response.json()).casual).toEqual({
      wins: 1,
      losses: 0,
      draws: 0,
      played: 1,
    });
  });

  it("has no page for an unknown account, a deleted one or one without settings", async () => {
    const registered = await register();
    const unknown = await app.inject({ method: "GET", url: "/v1/profiles/grace" });
    await handle.db.execute(`delete from profiles where user_id = '${registered.account.userId}'`);
    const withoutSettings = await app.inject({ method: "GET", url: "/v1/profiles/ada" });
    await handle.db.execute(
      `update users set status = 'deleted' where id = '${registered.account.userId}'`,
    );
    const deleted = await app.inject({ method: "GET", url: "/v1/profiles/ada" });

    expect(unknown.statusCode).toBe(404);
    expect(withoutSettings.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
  });

  it("still shows the page of a suspended account, without saying so", async () => {
    const registered = await register();
    await identity.suspend(registered.account.userId, "abuse");

    const response = await app.inject({ method: "GET", url: "/v1/profiles/ada" });

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toContain("suspended");
  });

  it("shows the badges, the all-time rank and the last five finished matches", async () => {
    const registered = await register();
    const opponent = await createGuest();
    for (let index = 0; index < 6; index += 1) {
      const snapshot = await runtime.createMatch({
        mode: "casual",
        timeControlSeconds: 300,
        light: { actorType: "user", actorId: registered.account.userId, displayName: "ada" },
        dark: { actorType: "guest", actorId: opponent.guestId, displayName: opponent.displayName },
      });
      clock.advance(1_000);
      await runtime.applyResignCommand(
        { actorType: "guest", actorId: opponent.guestId },
        envelope(snapshot.matchId, 0),
      );
    }

    const profile = publicProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/v1/profiles/ada" })).json(),
    );

    expect(profile.badges.map((badge) => badge.code)).toEqual(["first-victory"]);
    expect(profile.recentMatches).toHaveLength(5);
    expect(profile.recentMatches[0]).toMatchObject({
      side: "light",
      outcome: "win",
      ratingDelta: null,
      moveCount: 0,
    });
    // A casual win moves no rating, so the account still belongs to no board.
    expect(profile.rank).toBeNull();
  });

  it("shows the rank of a rated account", async () => {
    const registered = await register();
    await upsertRating(handle.db, registered.account.userId, {
      rating: 1300,
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      currentStreak: 1,
      bestStreak: 1,
    });

    const profile = publicProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/v1/profiles/ada" })).json(),
    );

    expect(profile.rank).toBe(1);
    expect(profile.ranked).toMatchObject({ rating: 1300, wins: 1 });
  });
});

describe("GET /v1/me/achievements", () => {
  it("answers the whole catalogue with what has been earned", async () => {
    const registered = await register();
    const opponent = await createGuest();
    const snapshot = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "user", actorId: registered.account.userId, displayName: "ada" },
      dark: { actorType: "guest", actorId: opponent.guestId, displayName: opponent.displayName },
    });
    await runtime.applyResignCommand(
      { actorType: "guest", actorId: opponent.guestId },
      envelope(snapshot.matchId, 0),
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/me/achievements",
      headers: auth(registered.session.sessionToken),
    });

    expect(response.statusCode).toBe(200);
    const body = achievementsResponseSchema.parse(response.json());
    expect(body.achievements).toHaveLength(ACHIEVEMENT_CATALOGUE.length);
    const earned = body.achievements.filter((entry) => entry.earnedAt !== null);
    expect(earned.map((entry) => entry.code)).toEqual(["first-victory"]);
    expect(earned[0]).toMatchObject({
      name: "First Victory",
      badge: "bronze",
      matchId: snapshot.matchId,
    });
    expect(body.achievements.find((entry) => entry.code === "four-ways")?.earnedAt).toBeNull();
  });

  it("requires an account, because a guest earns nothing", async () => {
    const guest = await createGuest();

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/me/achievements",
          headers: auth(guest.sessionToken),
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/me/achievements" })).statusCode).toBe(401);
  });

  it("withholds an achievement this protocol version does not name", async () => {
    const registered = await register();
    // The catalogue is seed data that no truncation clears, so the row is written
    // idempotently and removed again.
    await handle.db.execute(
      `insert into achievements (code, name, description, badge_asset, rule_version)
       values ('phase-seven-secret', 'Secret', 'Not yet named on the wire', 'gold', 1)
       on conflict (code) do nothing`,
    );

    const body = achievementsResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/me/achievements",
          headers: auth(registered.session.sessionToken),
        })
      ).json(),
    );
    await handle.db.execute(`delete from achievements where code = 'phase-seven-secret'`);

    expect(body.achievements).toHaveLength(ACHIEVEMENT_CATALOGUE.length);
  });
});

describe("suspension and match creation", () => {
  it("refuses to seat a suspended account", async () => {
    const registered = await register();
    const opponent = await createGuest();
    await identity.suspend(registered.account.userId, "abuse");

    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "casual",
        timeControlSeconds: 300,
        light: {
          actorType: "user",
          actorId: registered.account.userId,
          displayName: registered.account.username,
        },
        dark: {
          actorType: "guest",
          actorId: opponent.guestId,
          displayName: opponent.displayName,
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(httpErrorBodySchema.parse(response.json()).error.details).toEqual([
      { path: "light", issue: "suspended" },
    ]);
  });

  it("keeps a guest and an unverified account out of a ranked match", async () => {
    const registered = await register();
    const opponent = await createGuest();
    const seats = {
      light: {
        actorType: "user" as const,
        actorId: registered.account.userId,
        displayName: "ada",
      },
      dark: {
        actorType: "guest" as const,
        actorId: opponent.guestId,
        displayName: opponent.displayName,
      },
    };

    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: registered.emailVerification?.token ?? "" },
    });
    const guestRanked = await app.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: { mode: "ranked", timeControlSeconds: 300, ...seats },
    });
    const unverifiedOpponent = await register({
      email: "grace@example.com",
      password: "correct-horse-7",
      username: "grace",
    });
    const unverified = await app.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "ranked",
        timeControlSeconds: 300,
        light: seats.light,
        dark: {
          actorType: "user",
          actorId: unverifiedOpponent.account.userId,
          displayName: "grace",
        },
      },
    });

    expect(httpErrorBodySchema.parse(guestRanked.json()).error.details).toEqual([
      { path: "dark", issue: "guest-ranked" },
    ]);
    expect(httpErrorBodySchema.parse(unverified.json()).error.details).toEqual([
      { path: "dark", issue: "email-unverified" },
    ]);
  });

  it("seats two verified accounts in a ranked match", async () => {
    const first = await register();
    const second = await register({
      email: "grace@example.com",
      password: "correct-horse-7",
      username: "grace",
    });
    for (const account of [first, second]) {
      await app.inject({
        method: "POST",
        url: "/v1/auth/verify-email",
        payload: { token: account.emailVerification?.token ?? "" },
      });
    }

    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "ranked",
        timeControlSeconds: 300,
        light: { actorType: "user", actorId: first.account.userId, displayName: "ada" },
        dark: { actorType: "user", actorId: second.account.userId, displayName: "grace" },
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it("refuses a seat for an account that no longer exists", async () => {
    const registered = await register();
    const opponent = await createGuest();
    await handle.db.execute(
      `update users set status = 'deleted' where id = '${registered.account.userId}'`,
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "casual",
        timeControlSeconds: 300,
        light: { actorType: "user", actorId: registered.account.userId, displayName: "ada" },
        dark: {
          actorType: "guest",
          actorId: opponent.guestId,
          displayName: opponent.displayName,
        },
      },
    });

    expect(httpErrorBodySchema.parse(response.json()).error.details).toEqual([
      { path: "light", issue: "unknown-account" },
    ]);
  });

  it("seats the account again once it has been reinstated", async () => {
    const registered = await register();
    const opponent = await createGuest();
    await identity.suspend(registered.account.userId, "abuse");
    await identity.reinstate(registered.account.userId);

    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "casual",
        timeControlSeconds: 300,
        light: {
          actorType: "user",
          actorId: registered.account.userId,
          displayName: registered.account.username,
        },
        dark: {
          actorType: "guest",
          actorId: opponent.guestId,
          displayName: opponent.displayName,
        },
      },
    });

    expect(response.statusCode).toBe(201);
  });
});
