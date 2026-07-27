import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_DEFINITIONS,
  dashboardFileName,
  dashboardMetrics,
  renderDashboard,
} from "../src/observability/dashboards";
import type { DashboardDefinition } from "../src/observability/dashboards";
import { MetricsRegistry } from "../src/observability/metrics";
import { parseExposition } from "./helpers/prometheus";

/**
 * A dashboard is only worth having if its panels draw series the server emits, so
 * every metric named by every panel is checked against a real exposition, and the
 * files under `ops/dashboards` are checked against the definitions that produced
 * them (appendix P9.8).
 */

const DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../ops/dashboards",
);

const DEPLOYMENT = { appVersion: "1.2.3", gitSha: "abcdef", appEnv: "staging" };

async function exposedMetrics(): Promise<ReadonlySet<string>> {
  const registry = new MetricsRegistry(DEPLOYMENT);
  registry.observeSources({
    activeMatches: () => 1,
    connectedSockets: () => 2,
    queueDepths: () => [{ mode: "casual", timeControlSeconds: 300, depth: 1 }],
    pool: () => ({ total: 4, idle: 3, waiting: 0 }),
    ready: () => Promise.resolve(true),
  });
  // Every counter and histogram the panels read, touched once so it appears.
  registry.recordHttpRequest("GET", "/v1/config", 200, 0.01);
  registry.recordError("internal", "/v1/config");
  registry.observeDatabaseLatency("commit-move", 0.004);
  registry.observeMatchmakingWait("casual", 1.5);
  registry.observeMoveLatency(0.000_4);
  registry.recordCompletedMatch("casual", "resignation");
  registry.recordCommandRejection("move", "stale-version");
  registry.recordClockTimeout();
  registry.recordClockAnomaly("negative-remaining");
  registry.recordMatchTransactionFailure("commit-move");
  registry.recordSocketConnection();
  registry.recordSocketReconnect();
  registry.recordClientSession("desktop", "1.2.3");
  registry.recordUpdateCheck("stable", "darwin-aarch64", true);
  registry.recordUpdateOutcome("installed");
  registry.recordSigningFailure("macos", "notarize");

  // A histogram exposes `_bucket`, `_sum` and `_count`; a panel names the base.
  return new Set(
    parseExposition(await registry.expose()).map((sample) =>
      sample.metric.replace(/_(?:bucket|sum|count)$/, ""),
    ),
  );
}

describe("the launch dashboards", () => {
  it("draws only series the server emits", async () => {
    const emitted = await exposedMetrics();

    for (const metric of dashboardMetrics()) {
      expect(emitted, `${metric} is on a panel but not in the exposition`).toContain(metric);
    }
  });

  it("covers the three questions a launch asks", () => {
    expect(DASHBOARD_DEFINITIONS.map((dashboard) => dashboard.uid)).toEqual([
      "gobblet-service-health",
      "gobblet-gameplay",
      "gobblet-clients",
    ]);
  });

  it("gives every panel a question it answers and a unit", () => {
    for (const dashboard of DASHBOARD_DEFINITIONS) {
      expect(dashboard.panels.length).toBeGreaterThan(0);
      for (const panel of dashboard.panels) {
        expect(panel.answers.endsWith("?")).toBe(true);
        expect(panel.unit).not.toBe("");
        expect(panel.series.length).toBeGreaterThan(0);
      }
    }
  });

  it("names in each expression the metric the panel claims to read", () => {
    for (const dashboard of DASHBOARD_DEFINITIONS) {
      for (const panel of dashboard.panels) {
        for (const series of panel.series) {
          expect(series.expression).toContain(series.metric);
          expect(series.legend).not.toBe("");
        }
      }
    }
  });

  it("gives every dashboard a unique identifier", () => {
    const uids = DASHBOARD_DEFINITIONS.map((dashboard) => dashboard.uid);

    expect(new Set(uids).size).toBe(uids.length);
  });

  it("lists each metric once, sorted, however many panels read it", () => {
    const metrics = dashboardMetrics();

    expect(metrics).toEqual([...new Set(metrics)].sort());
    expect(metrics).toContain("gobblet_http_requests_total");
  });

  it("lists nothing for an empty definition", () => {
    expect(dashboardMetrics([])).toEqual([]);
  });
});

describe("the rendered files", () => {
  it.each(DASHBOARD_DEFINITIONS.map((definition) => [definition.uid, definition] as const))(
    "%s is what the definition renders, so it cannot drift",
    async (_uid, definition: DashboardDefinition) => {
      const onDisk = await readFile(path.join(DIRECTORY, dashboardFileName(definition)), "utf8");

      expect(onDisk).toBe(renderDashboard(definition));
    },
  );

  it("lays panels out two to a row without overlapping", () => {
    const rendered: unknown = JSON.parse(
      renderDashboard(DASHBOARD_DEFINITIONS[0] as DashboardDefinition),
    );
    const panels = (rendered as { panels: { gridPos: { x: number; y: number } }[] }).panels;

    expect(panels[0]?.gridPos).toEqual({ h: 8, w: 12, x: 0, y: 0 });
    expect(panels[1]?.gridPos).toEqual({ h: 8, w: 12, x: 12, y: 0 });
    expect(panels[2]?.gridPos).toEqual({ h: 8, w: 12, x: 0, y: 8 });
  });

  it("gives each target of a panel a distinct reference", () => {
    const rendered: unknown = JSON.parse(
      renderDashboard(DASHBOARD_DEFINITIONS[0] as DashboardDefinition),
    );
    const panels = (rendered as { panels: { targets: { refId: string }[] }[] }).panels;

    for (const panel of panels) {
      const references = panel.targets.map((target) => target.refId);
      expect(new Set(references).size).toBe(references.length);
    }
  });

  it("points every panel at the dashboard's datasource variable", () => {
    for (const definition of DASHBOARD_DEFINITIONS) {
      const rendered: unknown = JSON.parse(renderDashboard(definition));
      const dashboard = rendered as {
        templating: { list: { name: string }[] };
        panels: { datasource: { uid: string } }[];
      };

      expect(dashboard.templating.list[0]?.name).toBe("datasource");
      for (const panel of dashboard.panels) {
        expect(panel.datasource.uid).toBe("${datasource}");
      }
    }
  });

  it("names the file after the identifier, which is how Grafana finds it again", () => {
    expect(dashboardFileName(DASHBOARD_DEFINITIONS[0] as DashboardDefinition)).toBe(
      "gobblet-service-health.json",
    );
  });
});
