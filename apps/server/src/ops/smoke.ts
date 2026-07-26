import { publicServerConfigSchema } from "@gobblet/protocol";

/**
 * The smoke test of specification section 22.2 step 5, as a function rather than a
 * paragraph in a runbook: liveness, readiness, the configuration document, and the
 * assertion that answers the question a deploy actually asks, which is whether the
 * build now serving is the build that was just released.
 *
 * `fetch` is injected so the checks are proved in a test instead of against a host
 * that does not exist yet (docs/adr/0015-defer-hosting-choice.md). The scripted match
 * of step 5 is the browser suite, which needs the same host and is deferred with it;
 * a match that plays a move, drops its socket and re-synchronises is covered against
 * the runtime in `test/phase7-exit-criteria.test.ts`.
 */

export type SmokeCheck = Readonly<{
  name: string;
  ok: boolean;
  detail: string;
}>;

export type SmokeReport = Readonly<{
  ok: boolean;
  checks: readonly SmokeCheck[];
}>;

export type SmokeOptions = Readonly<{
  baseUrl: string;
  /** When given, the version the deployment expects to find serving. */
  expectVersion?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 10_000;

type Json = Record<string, unknown>;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function readJson(response: Response): Promise<Json> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? (body as Json) : {};
  } catch {
    return {};
  }
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeReport> {
  const call = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checks: SmokeCheck[] = [];

  const visit = async (name: string, path: string): Promise<Json | null> => {
    const url = endpoint(options.baseUrl, path);
    try {
      const response = await call(url, { signal: AbortSignal.timeout(timeoutMs) });
      const body = await readJson(response);
      if (!response.ok) {
        checks.push({ name, ok: false, detail: `${path} answered ${String(response.status)}` });
        return null;
      }
      checks.push({ name, ok: true, detail: `${path} answered 200` });
      return body;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      checks.push({ name, ok: false, detail: `${path} could not be reached: ${reason}` });
      return null;
    }
  };

  const live = await visit("liveness", "/health/live");
  await visit("readiness", "/health/ready");
  const config = await visit("configuration", "/v1/config");

  if (config) {
    const parsed = publicServerConfigSchema.safeParse(config);
    checks.push({
      name: "configuration document",
      ok: parsed.success,
      detail: parsed.success
        ? `advertises ${parsed.data.modes.length} modes and ${String(parsed.data.timeControlsSeconds.length)} time controls`
        : "does not match the published schema",
    });
  }

  if (options.expectVersion !== undefined) {
    const serving = typeof live?.appVersion === "string" ? live.appVersion : "unknown";
    checks.push({
      name: "released version is serving",
      ok: serving === options.expectVersion,
      detail: `expected ${options.expectVersion}, found ${serving}`,
    });
  }

  return { ok: checks.every((check) => check.ok), checks };
}

export function formatSmokeReport(report: SmokeReport): string {
  const lines = report.checks.map(
    (check) => `${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`,
  );
  lines.push(report.ok ? "smoke test passed" : "smoke test failed");
  return lines.join("\n");
}
