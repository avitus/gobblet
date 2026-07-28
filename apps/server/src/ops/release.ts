/**
 * `railway up --ci` returns when the build finishes, not when the new container is
 * the one answering, so a smoke test run straight afterwards can pass against the
 * version it was meant to replace. This waits for the released version to be the one
 * serving, and fails with what it found instead
 * (docs/adr/0043-railway-hosts-the-deployment.md).
 *
 * `fetch`, the clock and the wait are injected, so the whole thing is proved in a
 * test rather than against a deployment.
 */

export type AwaitReleaseOptions = Readonly<{
  baseUrl: string;
  version: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
  requestTimeoutMs?: number;
}>;

export type AwaitReleaseResult = Readonly<{
  ok: boolean;
  attempts: number;
  waitedMs: number;
  /** The last version seen, or what went wrong reaching it. */
  detail: string;
}>;

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/health/live`;
}

export async function awaitRelease(options: AwaitReleaseOptions): Promise<AwaitReleaseResult> {
  const call = options.fetch ?? globalThis.fetch;
  const now = options.now ?? ((): number => Date.now());
  const wait = options.wait ?? ((ms: number) => new Promise<void>((s) => setTimeout(s, ms)));
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const startedAt = now();
  let attempts = 0;
  let detail = "never answered";

  for (;;) {
    attempts += 1;
    try {
      const response = await call(endpoint(options.baseUrl), {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) {
        const body: unknown = await response.json();
        const serving =
          typeof body === "object" && body !== null && "appVersion" in body
            ? String((body as Record<string, unknown>).appVersion)
            : "unknown";
        if (serving === options.version) {
          return { ok: true, attempts, waitedMs: now() - startedAt, detail: serving };
        }
        detail = `serving ${serving}`;
      } else {
        detail = `answered ${String(response.status)}`;
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }

    const elapsed = now() - startedAt;
    if (elapsed + pollMs > options.timeoutMs) {
      return { ok: false, attempts, waitedMs: elapsed, detail };
    }
    await wait(pollMs);
  }
}

/**
 * A skipped job is not a failed job: a workflow whose release jobs all skip finishes
 * green having released nothing. This is the last word on whether a run did what it was
 * asked to do, so the answer does not depend on reading the job list by eye.
 */

export type ReleaseRun = Readonly<{
  skipStaging: boolean;
  skipProduction: boolean;
  /** Each environment's release result: success, failure, cancelled or skipped. */
  results: Readonly<Record<ReleaseEnvironment, string>>;
}>;

export type ReleaseEnvironment = "staging" | "production";

export type ReleaseVerdict = Readonly<{ ok: boolean; detail: string }>;

export function verifyReleaseHappened(run: ReleaseRun): ReleaseVerdict {
  const expected: ReleaseEnvironment[] = [
    ...(run.skipStaging ? [] : (["staging"] as const)),
    ...(run.skipProduction ? [] : (["production"] as const)),
  ];

  if (expected.length === 0) {
    return { ok: false, detail: "skipping both environments releases nothing" };
  }

  const wrong = expected
    .filter((environment) => run.results[environment] !== "success")
    .map((environment) => `${environment} ${run.results[environment]}`);

  return wrong.length === 0
    ? { ok: true, detail: `released to ${expected.join(" and ")}` }
    : { ok: false, detail: `nothing was released: ${wrong.join(", ")}` };
}

export function formatAwaitRelease(version: string, result: AwaitReleaseResult): string {
  const seconds = (result.waitedMs / 1000).toFixed(1);
  const checks = `${String(result.attempts)} check${result.attempts === 1 ? "" : "s"}`;
  return result.ok
    ? `${version} is serving after ${seconds}s and ${checks}`
    : `${version} is not serving after ${seconds}s and ${checks}: ${result.detail}`;
}
