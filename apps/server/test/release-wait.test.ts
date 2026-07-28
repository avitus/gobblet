import { describe, expect, it, vi } from "vitest";
import { awaitRelease, formatAwaitRelease } from "../src/ops/release";

/**
 * What separates a deploy that worked from a deploy that was reported as working:
 * the version answering has to be the version released, and waiting for it must end.
 */

/** A version string, a status to answer with, a body to answer with, or a failure. */
type Answer = string | Error | Readonly<{ status: number }> | Readonly<{ body: unknown }>;

/** A fresh Response every call, because a body can only be read once. */
function serving(...answers: Answer[]): typeof globalThis.fetch {
  const queue = [...answers];
  return () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    if (typeof next === "string") {
      return Promise.resolve(Response.json({ status: "ok", appVersion: next }));
    }
    if (next !== undefined && "status" in next) {
      return Promise.resolve(new Response("nope", { status: next.status }));
    }
    return Promise.resolve(Response.json(next?.body ?? {}));
  };
}

function clock(): { now: () => number; wait: (ms: number) => Promise<void> } {
  let current = 0;
  return {
    now: () => current,
    wait: (ms: number) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

describe("awaitRelease and the commit it released", () => {
  it("keeps waiting while the package version matches but the commit does not", async () => {
    // The package version is the same string for every commit that does not change it,
    // so on its own it is satisfied by the container this release is replacing.
    const time = clock();
    const target = (): Promise<Response> =>
      Promise.resolve(Response.json({ appVersion: "1.4.0", gitSha: "old" }));

    const result = await awaitRelease({
      baseUrl: "https://example.com",
      version: "1.4.0",
      gitSha: "new",
      timeoutMs: 20_000,
      fetch: target,
      ...time,
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe("serving 1.4.0 at old");
  });

  it("returns when both the version and the commit are the ones released", async () => {
    const time = clock();
    const answers = [
      Response.json({ appVersion: "1.4.0", gitSha: "old" }),
      Response.json({ appVersion: "1.4.0", gitSha: "new" }),
    ];

    const result = await awaitRelease({
      baseUrl: "https://example.com",
      version: "1.4.0",
      gitSha: "new",
      timeoutMs: 20_000,
      fetch: () => Promise.resolve(answers.shift() ?? Response.json({})),
      ...time,
    });

    expect(result).toMatchObject({ ok: true, attempts: 2, detail: "1.4.0 at new" });
  });

  it("refuses an address without a scheme instead of retrying it until the timeout", async () => {
    const time = clock();
    const target = vi.fn();

    const result = await awaitRelease({
      baseUrl: "gobblet-production.up.railway.app",
      version: "1.4.0",
      timeoutMs: 300_000,
      fetch: target,
      ...time,
    });

    expect(result).toEqual({
      ok: false,
      attempts: 0,
      waitedMs: 0,
      detail:
        "baseUrl must be an absolute URL including the scheme, for example https://gobblet-production.up.railway.app",
    });
    expect(target).not.toHaveBeenCalled();
  });

  it("reads a body that is not an object as nothing serving yet", async () => {
    // A proxy in front of the deployment can answer 200 with something that is not the
    // health document at all.
    const time = clock();
    const result = await awaitRelease({
      baseUrl: "https://example.com",
      version: "1.4.0",
      gitSha: "new",
      timeoutMs: 12_000,
      fetch: () => Promise.resolve(Response.json("gateway starting")),
      ...time,
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe("serving unknown");
  });

  it("says what each attempt found, so a wait of minutes is visibly a wait", async () => {
    const time = clock();
    const seen: string[] = [];
    const answers = [
      Response.json({ appVersion: "1.3.0", gitSha: "old" }),
      Response.json({ appVersion: "1.4.0", gitSha: "new" }),
    ];

    await awaitRelease({
      baseUrl: "https://example.com",
      version: "1.4.0",
      gitSha: "new",
      timeoutMs: 20_000,
      fetch: () => Promise.resolve(answers.shift() ?? Response.json({})),
      onAttempt: (attempt, detail) => {
        seen.push(`${String(attempt)}: ${detail}`);
      },
      ...time,
    });

    expect(seen).toEqual(["1: serving 1.3.0 at old"]);
  });
});

describe("awaitRelease", () => {
  it("returns as soon as the released version is the one serving", async () => {
    const time = clock();
    const target = serving("1.4.0");

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 60_000,
      fetch: target,
      now: time.now,
      wait: time.wait,
    });

    expect(result).toEqual({ ok: true, attempts: 1, waitedMs: 0, detail: "1.4.0" });
  });

  it("keeps checking while the old version is still answering", async () => {
    const time = clock();
    const target = serving("1.3.0", "1.3.0", "1.4.0");

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 60_000,
      fetch: target,
      now: time.now,
      wait: time.wait,
      pollMs: 1_000,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.waitedMs).toBe(2_000);
  });

  it("tolerates a container that is not up yet", async () => {
    const time = clock();
    const target = serving(new Error("connect ECONNREFUSED"), "1.4.0");

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 60_000,
      fetch: target,
      now: time.now,
      wait: time.wait,
      pollMs: 1_000,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("gives up inside the timeout, and says what it kept finding", async () => {
    const time = clock();
    const target = serving("1.3.0");

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 3_000,
      fetch: target,
      now: time.now,
      wait: time.wait,
      pollMs: 1_000,
    });

    // The budget is spent, and one last check happens on the deadline itself.
    expect(result).toEqual({
      ok: false,
      attempts: 4,
      waitedMs: 3_000,
      detail: "serving 1.3.0",
    });
  });

  it("reports the status of a health endpoint that refuses", async () => {
    const time = clock();
    const target = serving({ status: 502 });

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 1_000,
      fetch: target,
      now: time.now,
      wait: time.wait,
      pollMs: 1_000,
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe("answered 502");
  });

  it("reports a body without a version rather than trusting it", async () => {
    const time = clock();
    const target = serving({ body: { status: "ok" } });

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 1_000,
      fetch: target,
      now: time.now,
      wait: time.wait,
      pollMs: 1_000,
    });

    expect(result.detail).toBe("serving unknown");
  });

  it("names something that is not an error at all", async () => {
    const time = clock();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- fetch can reject with anything, and the report must still say something
    const rejects: typeof globalThis.fetch = () => Promise.reject("just a string");

    const result = await awaitRelease({
      baseUrl: "https://api.example.com",
      version: "1.4.0",
      timeoutMs: 1_000,
      fetch: rejects,
      now: time.now,
      wait: time.wait,
      pollMs: 1_000,
    });

    expect(result.detail).toBe("just a string");
  });

  it("asks the liveness endpoint of the base url it was given, trailing slash or not", async () => {
    const asked: string[] = [];
    const fetch: typeof globalThis.fetch = (input) => {
      asked.push(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
      return Promise.resolve(Response.json({ appVersion: "1.4.0" }));
    };
    const time = clock();

    for (const baseUrl of ["https://api.example.com", "https://api.example.com/"]) {
      await awaitRelease({
        baseUrl,
        version: "1.4.0",
        timeoutMs: 1_000,
        fetch,
        now: time.now,
        wait: time.wait,
      });
    }

    expect(asked).toEqual([
      "https://api.example.com/health/live",
      "https://api.example.com/health/live",
    ]);
  });

  it("uses the runtime's own fetch, clock and timer when none is injected", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", serving("1.3.0", "1.4.0"));
    try {
      const pending = awaitRelease({
        baseUrl: "https://api.example.com",
        version: "1.4.0",
        timeoutMs: 60_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(await pending).toMatchObject({ ok: true, attempts: 2, waitedMs: 5_000 });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe("the report", () => {
  it("says how long the wait took", () => {
    expect(
      formatAwaitRelease("1.4.0", { ok: true, attempts: 3, waitedMs: 12_500, detail: "1.4.0" }),
    ).toBe("1.4.0 is serving after 12.5s and 3 checks");
  });

  it("counts one check as one check", () => {
    expect(
      formatAwaitRelease("1.4.0", { ok: false, attempts: 1, waitedMs: 0, detail: "fetch failed" }),
    ).toBe("1.4.0 is not serving after 0.0s and 1 check: fetch failed");
  });

  it("says what was found instead", () => {
    expect(
      formatAwaitRelease("1.4.0", {
        ok: false,
        attempts: 2,
        waitedMs: 5_000,
        detail: "serving 1.3.0",
      }),
    ).toBe("1.4.0 is not serving after 5.0s and 2 checks: serving 1.3.0");
  });
});
