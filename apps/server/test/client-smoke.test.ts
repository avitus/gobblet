import { describe, expect, it } from "vitest";

import { formatClientReport, runClientSmoke } from "../src/ops/client-smoke";

const SHELL = '<!doctype html><script type="module" src="/assets/index-abc123.js"></script>';

type Reply = Readonly<{ status?: number; headers?: Record<string, string>; body?: string }>;

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString();
}

function serve(replies: Record<string, Reply | "unreachable">): typeof globalThis.fetch {
  return (input) => {
    const url = urlOf(input);
    const reply = replies[url];
    if (reply === undefined || reply === "unreachable") {
      return Promise.reject(new Error(`no route to ${url}`));
    }
    return Promise.resolve(
      new Response(reply.body ?? "", {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  };
}

const ORIGIN = "https://client.example";

describe("the client check", () => {
  it("passes when the page revalidates and the code it names is served", async () => {
    const report = await runClientSmoke({
      baseUrl: `${ORIGIN}/`,
      fetch: serve({
        [ORIGIN]: { headers: { "cache-control": "no-cache" }, body: SHELL },
        [`${ORIGIN}/assets/index-abc123.js`]: { body: "export {};" },
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      "the page loads",
      "the page is revalidated",
      "the code it names is served",
    ]);
    expect(formatClientReport(report)).toContain("client check passed");
  });

  it("uses the ambient fetch and the caller's timeout when it is given one", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (input) => {
      seen.push(urlOf(input));
      return Promise.resolve(
        new Response(urlOf(input).endsWith(".js") ? "export {};" : SHELL, {
          headers: { "cache-control": "no-cache" },
        }),
      );
    };

    try {
      const report = await runClientSmoke({ baseUrl: ORIGIN, timeoutMs: 500 });
      expect(report.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }

    expect(seen).toEqual([ORIGIN, `${ORIGIN}/assets/index-abc123.js`]);
  });

  it("fails when the page carries no cache directive, so a browser may keep an old client", async () => {
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: serve({
        [ORIGIN]: { body: SHELL },
        [`${ORIGIN}/assets/index-abc123.js`]: { body: "export {};" },
      }),
    });

    expect(report.ok).toBe(false);
    expect(formatClientReport(report)).toContain("no cache-control");
  });

  it.each(["no-store", "max-age=0, must-revalidate", "No-Cache"])(
    "accepts %s, which also makes a browser ask first",
    async (directive) => {
      const report = await runClientSmoke({
        baseUrl: ORIGIN,
        fetch: serve({
          [ORIGIN]: { headers: { "cache-control": directive }, body: SHELL },
          [`${ORIGIN}/assets/index-abc123.js`]: { body: "export {};" },
        }),
      });

      expect(report.ok).toBe(true);
    },
  );

  it("reports a failure that is not an error at all", async () => {
    // A transport can fail with anything, and the report says so rather than failing
    // while describing the failure.
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "connection reset";
      },
    });

    expect(formatClientReport(report)).toContain("connection reset");
  });

  it("reports a failure that is not an error when fetching the code", async () => {
    let first = true;
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: () => {
        if (first) {
          first = false;
          return Promise.resolve(new Response(SHELL, { headers: { "cache-control": "no-cache" } }));
        }
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "connection reset";
      },
    });

    expect(report.ok).toBe(false);
    expect(formatClientReport(report)).toContain("connection reset");
  });

  it("fails when the page does not answer", async () => {
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: serve({ [ORIGIN]: { status: 502 } }),
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(formatClientReport(report)).toContain("answered 502");
  });

  it("fails when the origin cannot be reached", async () => {
    const report = await runClientSmoke({ baseUrl: ORIGIN, fetch: serve({}) });

    expect(report.ok).toBe(false);
    expect(formatClientReport(report)).toContain("no route to");
  });

  it("fails when the page names no script, because then it runs nothing", async () => {
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: serve({
        [ORIGIN]: { headers: { "cache-control": "no-cache" }, body: "<!doctype html><body>" },
      }),
    });

    expect(report.ok).toBe(false);
    expect(formatClientReport(report)).toContain("names no script");
  });

  it("fails when the page names code the deployment does not have", async () => {
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: serve({
        [ORIGIN]: { headers: { "cache-control": "no-cache" }, body: SHELL },
        [`${ORIGIN}/assets/index-abc123.js`]: { status: 404 },
      }),
    });

    expect(report.ok).toBe(false);
    expect(formatClientReport(report)).toContain("answered 404");
    expect(formatClientReport(report)).toContain("client check failed");
  });

  it("reports the asset it could not fetch when the request itself fails", async () => {
    const report = await runClientSmoke({
      baseUrl: ORIGIN,
      fetch: serve({
        [ORIGIN]: { headers: { "cache-control": "no-cache" }, body: SHELL },
        [`${ORIGIN}/assets/index-abc123.js`]: "unreachable",
      }),
    });

    expect(report.ok).toBe(false);
    expect(formatClientReport(report)).toContain("no route to");
  });
});
