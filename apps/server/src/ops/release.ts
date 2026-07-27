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

export function formatAwaitRelease(version: string, result: AwaitReleaseResult): string {
  const seconds = (result.waitedMs / 1000).toFixed(1);
  const checks = `${String(result.attempts)} check${result.attempts === 1 ? "" : "s"}`;
  return result.ok
    ? `${version} is serving after ${seconds}s and ${checks}`
    : `${version} is not serving after ${seconds}s and ${checks}: ${result.detail}`;
}
