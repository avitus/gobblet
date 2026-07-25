import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import type { Database, DatabaseHandle } from "@gobblet/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GuestService } from "../src/guests/service";
import { AttemptLimiter } from "../src/identity/rate-limit";
import { IdentityService } from "../src/identity/service";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const config: ServerConfig = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal",
});

const PASSWORD = "correct-horse-7";

const credentials = {
  email: "ada@example.com",
  password: PASSWORD,
  username: "ada",
} as const;

let handle: DatabaseHandle;
let clock: TestClock;
let identity: IdentityService;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
});

/** Reads a `count(*)::int` result without asserting a shape onto the driver row. */
function countOf(rows: readonly Record<string, unknown>[]): number {
  return Number(rows[0]?.count ?? -1);
}

/** A database whose every transaction fails for a reason that is not a conflict. */
function brokenDatabase(): Database {
  return {
    transaction: (): Promise<never> => Promise.reject(new Error("connection lost")),
  } as unknown as Database;
}

/**
 * A database that consumes every verification token just before a transaction
 * opens, which is the interleaving two simultaneous verifications produce.
 */
function racingDatabase(db: Database): Database {
  return new Proxy(db, {
    get(target, property, receiver): unknown {
      if (property !== "transaction") {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return async (work: unknown): Promise<unknown> => {
        await db.execute("update email_verification_tokens set consumed_at = now()");
        return (target.transaction as (job: unknown) => Promise<unknown>)(work);
      };
    },
  });
}

describe("IdentityService", () => {
  it("reads the wall clock when no clock is supplied", async () => {
    const service = new IdentityService({ db: handle.db, config });

    const result = await service.register(credentials);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Date(result.value.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("does not hide a failure that is not a uniqueness conflict", async () => {
    const service = new IdentityService({ db: brokenDatabase(), config, now: clock.now });

    await expect(service.register(credentials)).rejects.toThrow("connection lost");
    await expect(service.claimGuest(randomUUID(), credentials)).rejects.toThrow("connection lost");
  });

  it("lets only one of two simultaneous verifications consume the token", async () => {
    const registered = await identity.register(credentials);
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }
    const token = registered.value.emailVerification?.token ?? "";

    const [first, second] = await Promise.all([
      identity.verifyEmail(token),
      identity.verifyEmail(token),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const refused = first.ok ? second : first;
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("already-used");
    }
  });

  it("treats a token consumed after it was read as already used", async () => {
    const registered = await identity.register(credentials);
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }
    const racing = new IdentityService({
      db: racingDatabase(handle.db),
      config,
      now: clock.now,
    });

    const result = await racing.verifyEmail(registered.value.emailVerification?.token ?? "");

    expect(result).toEqual({ ok: false, reason: "already-used" });
  });

  it("keeps the verification token out of a production claim", async () => {
    const productionConfig = loadServerConfig({
      APP_ENV: "production",
      NODE_ENV: "production",
      LOG_LEVEL: "fatal",
    });
    const guests = new GuestService({ db: handle.db, config: productionConfig, now: clock.now });
    const guest = await guests.createGuest("guest-to-claim");
    const production = new IdentityService({
      db: handle.db,
      config: productionConfig,
      now: clock.now,
    });

    const result = await production.claimGuest(guest.guestId, credentials);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.emailVerification).toBeUndefined();
      expect(result.value.claimedMatches).toBe(0);
    }
  });

  it("creates one account when two claims race for one guest session", async () => {
    const guests = new GuestService({ db: handle.db, config, now: clock.now });
    const guest = await guests.createGuest("guest-to-claim");

    const [first, second] = await Promise.all([
      identity.claimGuest(guest.guestId, credentials),
      identity.claimGuest(guest.guestId, {
        email: "grace@example.com",
        password: PASSWORD,
        username: "grace",
      }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const refused = first.ok ? second : first;
    if (refused.ok) {
      throw new Error("expected one claim to be refused");
    }
    expect(refused.reason).toBe("already-claimed");
    // The losing claim is rolled back whole: it holds neither the email address
    // it asked for nor the username.
    const users = await handle.db.execute("select count(*)::int as count from users");
    expect(countOf(users.rows)).toBe(1);
  });

  it("reports nothing for an account that does not exist", async () => {
    expect(await identity.accountFlags(randomUUID())).toBeNull();
    expect(await identity.getMe(randomUUID())).toBeNull();
    expect(await identity.publicProfile("nobody")).toBeNull();
  });

  it("reports the flags a match gate reads", async () => {
    const registered = await identity.register(credentials);
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }

    expect(await identity.accountFlags(registered.value.account.userId)).toEqual({
      status: "active",
      emailVerified: false,
    });
    await identity.verifyEmail(registered.value.emailVerification?.token ?? "");
    expect(await identity.accountFlags(registered.value.account.userId)).toEqual({
      status: "active",
      emailVerified: true,
    });
  });
});

describe("AttemptLimiter", () => {
  it("allows attempts up to the limit and then reports the wait", () => {
    const clockValues = new TestClock(1_000);
    const limiter = new AttemptLimiter({ limit: 2, windowMs: 60_000, now: clockValues.now });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const blocked = limiter.check("a");

    expect(blocked).toEqual({ allowed: false, retryAfter: 60 });
  });

  it("starts a new window once the old one has passed", () => {
    const clockValues = new TestClock(1_000);
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 60_000, now: clockValues.now });
    limiter.check("a");

    clockValues.advance(60_001);

    expect(limiter.check("a").allowed).toBe(true);
  });

  it("forgets the windows of keys that are no longer limited", () => {
    const clockValues = new TestClock(1_000);
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 60_000, now: clockValues.now });
    limiter.check("stale");

    clockValues.advance(60_001);
    // A different key: the stale window is dropped by the eviction pass, not by
    // being looked up again.
    limiter.check("other");
    clockValues.advance(-60_001);

    expect(limiter.check("stale").allowed).toBe(true);
  });

  it("hands the budget back to a caller that succeeded", () => {
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check("a");

    limiter.forgive("a");

    expect(limiter.check("a").allowed).toBe(true);
  });
});
