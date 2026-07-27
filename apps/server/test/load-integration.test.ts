import { loadServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapServer } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { formatLoadReport, judgeLoad, runLoad } from "../src/ops/load";
import { createSocketLoadPort, pairSeats } from "../src/ops/load-socket";
import { openLoadTarget, tcpPort } from "../src/ops/load-target";
import type { SocketPortOptions } from "../src/ops/load-socket";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The transport half of the load harness, against a real server: real guests, real
 * matchmaking, real sockets, real persistence. Two matches is not the load target and
 * the report says so; what this proves is that the harness measures what it claims
 * to, so a run at scale on a host means something (appendix P9.2).
 */

const env = {
  APP_ENV: "local" as const,
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal" as const,
  DATABASE_URL: TEST_DATABASE_URL,
};

let handle: DatabaseHandle;
let server: BootstrappedServer | null = null;
let url = "";

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  server = await bootstrapServer({ config: loadServerConfig(env) });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  url = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await server?.close();
  server = null;
});

function port(overrides: Partial<SocketPortOptions> = {}) {
  return createSocketLoadPort({
    baseUrl: url,
    clientVersion: "0.1.0",
    appEnv: "local",
    mode: "casual",
    timeControlSeconds: 300,
    ...overrides,
  });
}

describe("pairing the two clients", () => {
  it("returns each seat by its colour", () => {
    const seats = [
      { color: "dark" as const, matchId: "m1", index: 1 },
      { color: "light" as const, matchId: "m1", index: 0 },
    ];

    expect(pairSeats(seats)).toEqual({ light: seats[1], dark: seats[0] });
  });

  it("refuses two clients seated as the same colour", () => {
    const seats = [
      { color: "light" as const, matchId: "m1" },
      { color: "light" as const, matchId: "m1" },
    ];

    expect(() => pairSeats(seats)).toThrow("the two clients were not seated as opposite colours");
  });

  it("refuses a pair the queue split across two matches, which would measure nothing", () => {
    const seats = [
      { color: "light" as const, matchId: "m1" },
      { color: "dark" as const, matchId: "m2" },
    ];

    expect(() => pairSeats(seats)).toThrow("the two clients were paired into different matches");
  });
});

describe("the load harness against a running server", () => {
  it("plays concurrent matches, losing no move and completing none twice", async () => {
    const summary = await runLoad(port(), {
      matches: 2,
      movesPerMatch: 6,
      waveSize: 2,
      seed: 20_260_727,
    });
    const verdict = judgeLoad(summary);

    expect(summary.matchesFailed).toBe(0);
    expect(summary.matchesOpened).toBe(2);
    expect(summary.clients).toBe(4);
    expect(summary.movesAccepted).toBe(12);
    expect(summary.movesRejected).toBe(0);
    expect(summary.lostMoves).toBe(0);
    expect(summary.duplicateCompletions).toBe(0);
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 60_000);

  it("reports honestly that this run is far below the scale section 20.8 asks for", async () => {
    const summary = await runLoad(port(), { matches: 1, movesPerMatch: 2, waveSize: 1, seed: 11 });

    expect(judgeLoad(summary).atSpecifiedScale).toBe(false);
    expect(formatLoadReport(summary, judgeLoad(summary))).toContain(
      "does not prove the target at its stated scale",
    );
  }, 60_000);

  it("plays to a result when the plan is long enough, and completes each match once", async () => {
    const summary = await runLoad(port(), {
      matches: 1,
      movesPerMatch: 300,
      waveSize: 1,
      seed: 4,
    });

    expect(summary.matchesFinished).toBe(1);
    expect(summary.duplicateCompletions).toBe(0);
    expect(summary.lostMoves).toBe(0);
  }, 120_000);
});

describe("when the run cannot happen", () => {
  it("fails when nothing is listening, rather than reporting a pass", async () => {
    const summary = await runLoad(port({ baseUrl: "http://127.0.0.1:1" }), {
      matches: 1,
      movesPerMatch: 1,
      waveSize: 1,
      seed: 1,
    });

    expect(summary.matchesFailed).toBe(1);
    expect(judgeLoad(summary).ok).toBe(false);
  }, 60_000);

  it("fails when the server refuses to make a guest", async () => {
    const refusing = port({
      fetch: () => Promise.resolve(new Response("", { status: 503 })),
    });

    await expect(refusing.openMatch(0)).rejects.toThrow("guest creation answered 503");
  }, 60_000);

  it("fails when the socket cannot connect, even though the guest was made", async () => {
    const guest = {
      guestId: "00000000-0000-4000-8000-000000000001",
      displayName: "guest",
      sessionToken: "a-session-token",
      expiresAt: new Date().toISOString(),
    };
    const dead = port({
      baseUrl: "http://127.0.0.1:1",
      fetch: () => Promise.resolve(Response.json(guest)),
    });

    await expect(dead.openMatch(0)).rejects.toThrow(/xhr poll error|websocket error|ECONNREFUSED/);
  }, 60_000);

  it("fails when the socket does not answer inside the budget", async () => {
    await expect(port({ timeoutMs: 1 }).openMatch(0)).rejects.toThrow(/timed out/);
  }, 60_000);

  it("gives up when the queue never pairs, as the ranked queue does for guests", async () => {
    await expect(port({ timeoutMs: 750, mode: "ranked" }).openMatch(0)).rejects.toThrow(
      /timed out waiting to be paired/,
    );
  }, 60_000);

  it("reports a rejection rather than treating it as an acknowledgement", async () => {
    const match = await port().openMatch(0);

    try {
      const stale = await match.submit(
        "light",
        { kind: "reserve", reserveStack: 0, to: "r0c0" },
        {
          commandId: "00000000-0000-4000-8000-000000000002",
          matchId: match.matchId,
          expectedVersion: 7,
        },
      );

      expect(stale.ok).toBe(false);
      expect(stale.newVersion).toBeNull();
      expect(stale.reason).toBe("stale-version");
    } finally {
      await match.close();
    }
  }, 60_000);

  it("measures with a monotonic clock rather than the wall clock", () => {
    const first = port().now();
    const second = port().now();

    expect(second).toBeGreaterThanOrEqual(first);
    expect(first).toBeLessThan(Date.now());
  });
});

describe("where the run points", () => {
  it("uses the host it was given, and starts nothing", async () => {
    const target = await openLoadTarget({
      baseUrl: "https://gobblet.example",
      appVersion: "9.9.9",
      gitSha: "testsha",
    });

    expect(target.baseUrl).toBe("https://gobblet.example");
    expect(target.description).toBe("https://gobblet.example");
    await expect(target.stop()).resolves.toBeUndefined();
  });

  it("starts a server of its own when no host was named, so the gate needs no deployment", async () => {
    const target = await openLoadTarget({ appVersion: "9.9.9", gitSha: "testsha" });

    try {
      expect(target.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(target.description).toContain("a server this run started");

      const summary = await runLoad(
        createSocketLoadPort({
          baseUrl: target.baseUrl,
          clientVersion: "0.1.0",
          appEnv: "local",
          mode: "casual",
          timeControlSeconds: 300,
        }),
        { matches: 1, movesPerMatch: 2, waveSize: 1, seed: 3 },
      );

      expect(judgeLoad(summary).failures).toEqual([]);
    } finally {
      await target.stop();
    }
  }, 120_000);

  it("stops rather than guess when the server did not take a TCP port", () => {
    expect(() => tcpPort(null)).toThrow("the load server did not take a TCP port");
    expect(() => tcpPort("/tmp/gobblet.sock")).toThrow("the load server did not take a TCP port");
    expect(tcpPort({ port: 4100 })).toBe(4100);
  });

  it("stops the server it started, so a gate run leaves no port held", async () => {
    const target = await openLoadTarget({ appVersion: "9.9.9", gitSha: "testsha" });
    await target.stop();

    await expect(fetch(`${target.baseUrl}/health/live`)).rejects.toThrow();
  }, 120_000);
});
