import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALERT_DEFINITIONS, expressionText, renderAlertRules } from "../src/observability/alerts";
import type { AlertDefinition } from "../src/observability/alerts";
import { MetricsRegistry } from "../src/observability/metrics";
import type { GaugeSources } from "../src/observability/metrics";
import { fires, parseExposition } from "./helpers/prometheus";

/** Written by `pnpm db:backup` into a textfile collector, not by the server. */
const BACKUP_METRIC = "gobblet_backup_last_success_timestamp_seconds";
import type { Range, Sample } from "./helpers/prometheus";

/**
 * Every condition of spec section 17.4 is driven into its failing state and the rule
 * is evaluated over the exposition that results (appendix P7.15). A rule that cannot
 * be made to fire is a rule nobody has tested, so each one is also checked against a
 * healthy deployment, where it must stay quiet.
 */

const RULES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../ops/alerts/gobblet.rules.yml",
);

const DEPLOYMENT = { appVersion: "1.2.3", gitSha: "abcdef", appEnv: "staging" };

const NOW_SECONDS = 1_785_000_000;

type Sources = {
  activeMatches: number;
  connectedSockets: number;
  pool: { total: number; idle: number; waiting: number };
  ready: boolean;
};

function registryWith(overrides: Partial<Sources> = {}): {
  metrics: MetricsRegistry;
  sources: Sources;
} {
  const sources: Sources = {
    activeMatches: 0,
    connectedSockets: 0,
    pool: { total: 4, idle: 4, waiting: 0 },
    ready: true,
    ...overrides,
  };
  // Ten minutes ago, so the deployment is recent enough for the regression rule.
  const metrics = new MetricsRegistry(DEPLOYMENT, NOW_SECONDS - 600);
  const gauges: GaugeSources = {
    activeMatches: () => sources.activeMatches,
    connectedSockets: () => sources.connectedSockets,
    queueDepths: () => [],
    pool: () => sources.pool,
    ready: () => Promise.resolve(sources.ready),
  };
  metrics.observeSources(gauges);
  return { metrics, sources };
}

async function scrape(metrics: MetricsRegistry, extra: readonly Sample[] = []): Promise<Sample[]> {
  return [...parseExposition(await metrics.expose()), ...extra];
}

function ruleFor(alert: string): AlertDefinition {
  const definition = ALERT_DEFINITIONS.find((entry) => entry.alert === alert);
  if (!definition) {
    throw new Error(`No rule is named ${alert}`);
  }
  return definition;
}

/** A window with nothing in it: the same scrape at both ends. */
function steady(samples: readonly Sample[]): Range {
  return { before: samples, after: samples, nowSeconds: NOW_SECONDS };
}

function series(metric: string, value: number, labels: Record<string, string> = {}): Sample {
  return { metric, labels, value };
}

describe("the alert rules file", () => {
  it("is what the definitions render, so it cannot drift", async () => {
    const onDisk = await readFile(RULES_FILE, "utf8");

    expect(onDisk).toBe(renderAlertRules());
  });

  it("answers every condition of section 17.4 exactly once", () => {
    expect(ALERT_DEFINITIONS.map((definition) => definition.condition)).toEqual([
      "Readiness failure.",
      "Elevated 5xx rate.",
      "Database connection exhaustion.",
      "Match transaction failures.",
      "Large increase in stale-version rejections.",
      "Clock calculation errors.",
      "Failed backups.",
      "Desktop update-signing failure.",
      "Error-rate regression after deployment.",
    ]);
  });

  it("watches no series that the exposition does not have", async () => {
    const exposition = await new MetricsRegistry(DEPLOYMENT).expose();
    const named = new Set(
      ALERT_DEFINITIONS.flatMap((definition) =>
        definition.all.flatMap((condition) =>
          condition.term.kind === "share"
            ? [condition.term.part.metric, condition.term.whole.metric]
            : [condition.term.selector.metric],
        ),
      ),
    );

    for (const metric of named) {
      if (metric === BACKUP_METRIC) {
        // The one series the server does not write: the backup script's textfile.
        continue;
      }
      expect(exposition, metric).toContain(metric);
    }
    expect(named.has(BACKUP_METRIC)).toBe(true);
    // The last one to arrive was the signing failure, which Phase 8 made real.
    expect(named.has("gobblet_desktop_signing_failures_total")).toBe(true);
  });

  it("renders each expression as PromQL over the exposition's own names", async () => {
    const exposition = await new MetricsRegistry(DEPLOYMENT).expose();
    const rendered = ALERT_DEFINITIONS.map((definition) => expressionText(definition));

    expect(rendered[1]).toBe(
      'sum(rate(gobblet_http_requests_total{status=~"5.."}[5m])) / sum(rate(gobblet_http_requests_total[5m])) > 0.05',
    );
    expect(exposition).toContain("gobblet_http_requests_total");
  });
});

describe("readiness failure", () => {
  it("fires when the instance says it would refuse traffic, and not before", async () => {
    const { metrics, sources } = registryWith();
    const healthy = steady(await scrape(metrics));
    expect(fires(ruleFor("GobbletReadinessFailing"), healthy)).toBe(false);

    sources.ready = false;
    const failing = steady(await scrape(metrics));

    expect(fires(ruleFor("GobbletReadinessFailing"), failing)).toBe(true);
  });
});

describe("elevated server errors", () => {
  it("fires above one request in twenty, and stays quiet below it", async () => {
    const { metrics } = registryWith();
    for (let index = 0; index < 100; index += 1) {
      metrics.recordHttpRequest("GET", "/v1/me", 200, 0.01);
    }
    const before = await scrape(metrics);

    for (let index = 0; index < 100; index += 1) {
      metrics.recordHttpRequest("GET", "/v1/me", index < 4 ? 500 : 200, 0.01);
    }
    const tolerable = { before, after: await scrape(metrics), nowSeconds: NOW_SECONDS };
    expect(fires(ruleFor("GobbletServerErrorRateElevated"), tolerable)).toBe(false);

    const middle = await scrape(metrics);
    for (let index = 0; index < 100; index += 1) {
      metrics.recordHttpRequest("POST", "/v1/matches", index < 20 ? 503 : 200, 0.01);
    }
    const elevated = { before: middle, after: await scrape(metrics), nowSeconds: NOW_SECONDS };

    expect(fires(ruleFor("GobbletServerErrorRateElevated"), elevated)).toBe(true);
  });

  it("does not fire when no request was served at all", async () => {
    const { metrics } = registryWith();

    expect(fires(ruleFor("GobbletServerErrorRateElevated"), steady(await scrape(metrics)))).toBe(
      false,
    );
  });
});

describe("database connection exhaustion", () => {
  it("needs both a queue and no spare connection", async () => {
    const { metrics, sources } = registryWith();
    sources.pool = { total: 4, idle: 1, waiting: 3 };
    const spare = steady(await scrape(metrics));
    expect(fires(ruleFor("GobbletDatabasePoolExhausted"), spare)).toBe(false);

    sources.pool = { total: 4, idle: 0, waiting: 3 };
    const exhausted = steady(await scrape(metrics));

    expect(fires(ruleFor("GobbletDatabasePoolExhausted"), exhausted)).toBe(true);
  });
});

describe("match transaction failures", () => {
  it("fires on the first rollback in the window", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics);
    expect(fires(ruleFor("GobbletMatchTransactionsFailing"), steady(before))).toBe(false);

    metrics.recordMatchTransactionFailure("command");
    const after = await scrape(metrics);

    expect(
      fires(ruleFor("GobbletMatchTransactionsFailing"), { before, after, nowSeconds: NOW_SECONDS }),
    ).toBe(true);
  });
});

describe("stale-version rejections", () => {
  it("tolerates the ordinary trickle and fires on a spike", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics);

    for (let index = 0; index < 10; index += 1) {
      metrics.recordCommandRejection("move", "stale-version");
    }
    const trickle = { before, after: await scrape(metrics), nowSeconds: NOW_SECONDS };
    expect(fires(ruleFor("GobbletStaleVersionRejectionsSpiking"), trickle)).toBe(false);

    for (let index = 0; index < 60; index += 1) {
      metrics.recordCommandRejection("move", "stale-version");
    }
    const spike = { before, after: await scrape(metrics), nowSeconds: NOW_SECONDS };

    expect(fires(ruleFor("GobbletStaleVersionRejectionsSpiking"), spike)).toBe(true);
  });

  it("counts only stale versions, not every rejection", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics);
    for (let index = 0; index < 100; index += 1) {
      metrics.recordCommandRejection("move", "illegal-move");
    }

    expect(
      fires(ruleFor("GobbletStaleVersionRejectionsSpiking"), {
        before,
        after: await scrape(metrics),
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(false);
  });
});

describe("clock anomalies", () => {
  it("fires on a single stored clock that cannot be true", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics);

    metrics.recordClockAnomaly("turn-starts-in-the-future");
    const after = await scrape(metrics);

    expect(fires(ruleFor("GobbletClockAnomaly"), { before, after, nowSeconds: NOW_SECONDS })).toBe(
      true,
    );
  });
});

describe("failed backups", () => {
  it("fires once a day and a bit has passed without a successful backup", async () => {
    const { metrics } = registryWith();
    const fresh = await scrape(metrics, [
      series("gobblet_backup_last_success_timestamp_seconds", NOW_SECONDS - 3_600),
    ]);
    expect(fires(ruleFor("GobbletBackupStale"), steady(fresh))).toBe(false);

    const stale = await scrape(metrics, [
      series("gobblet_backup_last_success_timestamp_seconds", NOW_SECONDS - 100_000),
    ]);

    expect(fires(ruleFor("GobbletBackupStale"), steady(stale))).toBe(true);
  });
});

describe("desktop signing", () => {
  it("fires on a signing failure once the release job reports one", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics, [
      series("gobblet_desktop_signing_failures_total", 0, { platform: "macos" }),
    ]);
    const after = await scrape(metrics, [
      series("gobblet_desktop_signing_failures_total", 1, { platform: "macos" }),
    ]);

    expect(
      fires(ruleFor("GobbletDesktopSigningFailure"), { before, after, nowSeconds: NOW_SECONDS }),
    ).toBe(true);
    expect(fires(ruleFor("GobbletDesktopSigningFailure"), steady(before))).toBe(false);
  });
});

describe("an error regression after a deployment", () => {
  it("fires only while the deployment is recent", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics);
    for (let index = 0; index < 20; index += 1) {
      metrics.recordError("internal_error", "POST /v1/matches");
    }
    const after = await scrape(metrics);

    expect(
      fires(ruleFor("GobbletErrorRegressionAfterDeploy"), {
        before,
        after,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(true);

    // The same errors a day later are a different problem, and a different rule.
    expect(
      fires(ruleFor("GobbletErrorRegressionAfterDeploy"), {
        before,
        after,
        nowSeconds: NOW_SECONDS + 86_400,
      }),
    ).toBe(false);
  });

  it("stays quiet when a fresh deployment is behaving", async () => {
    const { metrics } = registryWith();
    const before = await scrape(metrics);
    metrics.recordError("validation_failed", "POST /v1/auth/sign-in");

    expect(
      fires(ruleFor("GobbletErrorRegressionAfterDeploy"), {
        before,
        after: await scrape(metrics),
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(false);
  });
});
