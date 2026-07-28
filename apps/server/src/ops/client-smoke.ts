/**
 * What the deploy asks of the client it has just released. The server smoke test
 * cannot answer any of it: the client is a different service, serving a static shell
 * that names the code a browser will run.
 *
 * The shell has to be revalidated on every visit. It is the only file whose name never
 * changes, so a browser that keeps it keeps the whole client with it: a returning
 * player ran a build for an hour after it was replaced, because the shell carried no
 * cache directive and the browser was free to decide (D-0009).
 */

export type ClientCheck = Readonly<{
  name: string;
  ok: boolean;
  detail: string;
}>;

export type ClientReport = Readonly<{
  ok: boolean;
  checks: readonly ClientCheck[];
}>;

export type ClientSmokeOptions = Readonly<{
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 10_000;

/** A directive that makes a browser ask before it reuses what it holds. */
function revalidates(cacheControl: string | null): boolean {
  if (cacheControl === null) {
    return false;
  }
  const value = cacheControl.toLowerCase();
  return value.includes("no-cache") || value.includes("no-store") || value.includes("max-age=0");
}

function assetPath(html: string): string | null {
  return /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? null;
}

export async function runClientSmoke(options: ClientSmokeOptions): Promise<ClientReport> {
  const call = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const origin = options.baseUrl.replace(/\/+$/, "");
  const checks: ClientCheck[] = [];

  let shell: Response;
  try {
    shell = await call(origin, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, checks: [{ name: "the page loads", ok: false, detail: reason }] };
  }

  checks.push({
    name: "the page loads",
    ok: shell.ok,
    detail: `answered ${String(shell.status)}`,
  });
  if (!shell.ok) {
    return { ok: false, checks };
  }

  const cacheControl = shell.headers.get("cache-control");
  checks.push({
    name: "the page is revalidated",
    ok: revalidates(cacheControl),
    detail:
      cacheControl === null
        ? "no cache-control, so a browser may keep serving the client it already has"
        : `cache-control: ${cacheControl}`,
  });

  const html = await shell.text();
  const asset = assetPath(html);
  if (asset === null) {
    checks.push({
      name: "the code it names is served",
      ok: false,
      detail: "the page names no script under /assets",
    });
    return { ok: false, checks };
  }

  try {
    const script = await call(`${origin}${asset}`, { signal: AbortSignal.timeout(timeoutMs) });
    checks.push({
      name: "the code it names is served",
      ok: script.ok,
      detail: `${asset} answered ${String(script.status)}`,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    checks.push({ name: "the code it names is served", ok: false, detail: reason });
  }

  return { ok: checks.every((check) => check.ok), checks };
}

export function formatClientReport(report: ClientReport): string {
  const lines = report.checks.map(
    (check) => `${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`,
  );
  lines.push(report.ok ? "client check passed" : "client check failed");
  return lines.join("\n");
}
