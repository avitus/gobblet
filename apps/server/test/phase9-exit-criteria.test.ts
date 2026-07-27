import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@gobblet/config";
import { publicServerConfigSchema } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import { GATE_DEFINITIONS } from "../src/ops/gates";
import { judgeDefects, parseDefectRegister } from "../src/ops/defects";
import { DASHBOARD_DEFINITIONS } from "../src/observability/dashboards";
import { runSmoke } from "../src/ops/smoke";
import { buildApp } from "../src/app";
import { createSilentTelemetry } from "../src/observability/telemetry";

/**
 * The Phase 9 exit criteria of spec section 24. Three of the five are judgements a
 * person makes and are deferred as such (appendix P9.12 and P9.13); what can be
 * asserted is asserted here, including the mechanisms the deferred ones will rest
 * on, so nothing is reported as done because nobody looked.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function read(relative: string): Promise<string> {
  return readFile(path.join(ROOT, relative), "utf8");
}

const CONFIG = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "abc1234",
  LOG_LEVEL: "fatal",
});

describe("every quality gate in section 21", () => {
  it("is a definition that either runs or names what it waits for", () => {
    for (const gate of GATE_DEFINITIONS) {
      const runnable = gate.command !== null;
      const explained = (gate.deferred ?? "").length > 20;

      expect(runnable || explained, `${gate.id} neither runs nor explains itself`).toBe(true);
    }
  });

  it("defers exactly the four gates that need a signing identity, a host or a person", () => {
    const deferred = GATE_DEFINITIONS.filter((gate) => gate.command === null).map(
      (gate) => gate.id,
    );

    expect(deferred).toEqual(["adr-present", "macos-signed", "windows-signed", "auto-update"]);
  });

  it("runs the whole release-candidate set from one command", async () => {
    const scripts = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(scripts.scripts["gates"]).toContain("gates");
    expect(scripts.scripts["load"]).toContain("load");
    expect(scripts.scripts["ops:defects"]).toContain("ops:defects");
    expect(scripts.scripts["ops:secrets"]).toContain("ops:secrets");
    expect(scripts.scripts["ops:dashboards"]).toContain("ops:dashboards");
  });
});

describe("zero known critical or high-severity defects", () => {
  it("holds, against the register that ships", async () => {
    const verdict = judgeDefects(parseDefectRegister(await read("docs/defects.md")));

    expect(verdict.blocking).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("is a gate, not a claim: an open high-severity defect would fail it", async () => {
    const register = await read("docs/defects.md");
    const withOne = `${register}\n| D-9999 | high | open | server | A hypothetical serious defect | none |\n`;

    expect(judgeDefects(parseDefectRegister(withOne)).ok).toBe(false);
  });
});

describe("the load target of section 20.8", () => {
  it("is a command anyone can run, with the scale in the environment", async () => {
    const workflowless = await read("apps/server/src/cli/load.ts");

    expect(workflowless).toContain("LOAD_MATCHES");
    expect(workflowless).toContain("formatLoadReport");
  });
});

describe("the rollback procedure", () => {
  it("is a documented input to the deployment workflow that skips the migrations", async () => {
    const workflow = await read(".github/workflows/deploy.yml");

    expect(workflow).toContain("rollback:");
    expect(workflow).toContain("if: ${{ !inputs.rollback }}");
    expect(workflow).toContain("production-smoke:");
  });

  it("rests on a check that fails when the version serving is not the version released", async () => {
    const responses: Readonly<Record<string, unknown>> = {
      "/health/live": { status: "ok", appVersion: "1.3.0" },
      "/health/ready": { status: "ok" },
      "/v1/config": {
        appEnv: "production",
        appVersion: "1.3.0",
        minSupportedClientVersion: "0.1.0",
        modes: ["casual", "ranked"],
        timeControlsSeconds: [180, 300, 600, 900],
      },
    };
    const stub: typeof globalThis.fetch = (input) =>
      Promise.resolve(
        Response.json(responses[new URL(input as string).pathname] ?? {}, { status: 200 }),
      );

    const rolledBack = await runSmoke({
      baseUrl: "https://gobblet.test",
      expectVersion: "1.2.0",
      fetch: stub,
    });
    const rolledForward = await runSmoke({
      baseUrl: "https://gobblet.test",
      expectVersion: "1.3.0",
      fetch: stub,
    });

    expect(rolledBack.ok).toBe(false);
    expect(rolledForward.ok).toBe(true);
  });
});

describe("the error-monitoring release marker", () => {
  it("is the version the server reports on its configuration document", async () => {
    const app = await buildApp({
      config: CONFIG,
      telemetry: createSilentTelemetry(),
      now: () => Date.UTC(2026, 6, 27),
    });

    try {
      const response = await app.inject({ method: "GET", url: "/v1/config" });

      expect(response.statusCode).toBe(200);
      expect(publicServerConfigSchema.parse(response.json()).appVersion).toBe("9.9.9");
    } finally {
      await app.close();
    }
  });

  it("is carried into the reporter, so a report can be attributed to a build", async () => {
    const bootstrap = await read("apps/server/src/bootstrap.ts");

    expect(bootstrap).toContain("release: config.appVersion");
    expect(bootstrap).toContain("environment: config.appEnv");
  });
});

describe("the launch dashboards", () => {
  it("are rendered files, not screenshots of somebody's browser", async () => {
    for (const dashboard of DASHBOARD_DEFINITIONS) {
      const rendered = await read(`ops/dashboards/${dashboard.uid}.json`);

      expect(JSON.parse(rendered)).toMatchObject({ uid: dashboard.uid, title: dashboard.title });
    }
  });
});

describe("the compatibility matrices", () => {
  it("run Firefox as a third project rather than promising a manual pass", async () => {
    const config = await read("e2e/playwright.config.ts");
    const nightly = await read(".github/workflows/nightly.yml");

    expect(config).toContain('name: "firefox"');
    expect(nightly).toContain("test:e2e:firefox");
  });

  it("date every row a person has to run, and say plainly which are unanswered", async () => {
    const matrix = await read("docs/compatibility.md");

    expect(matrix).toContain("Not yet run");
    expect(matrix).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("privacy and terms are published", () => {
  it("as routes in the client, from one content module", async () => {
    const routes = await read("apps/web/src/app/routes.tsx");
    const footer = await read("apps/web/src/app/AppFooter.tsx");

    expect(routes).toContain('path="privacy"');
    expect(routes).toContain('path="terms"');
    expect(routes).toContain('path="support"');
    expect(footer).toContain("LEGAL_DOCUMENTS");
  });
});

describe("the criteria a person has to sign", () => {
  it("are named in the launch checklist, with what each reviewer looks at", async () => {
    const operations = await read("docs/operations.md");

    expect(operations).toContain("Product owner approves visual quality");
    expect(operations).toContain("Product owner approves official-rule behavior");
    expect(operations).toContain("Production readiness review is signed off");
  });

  it("are recorded as deferred in the specification appendix, not quietly passed", async () => {
    const spec = await read("docs/product-spec.md");
    const appendix = spec.slice(spec.indexOf("## Appendix P9"));

    expect(appendix).toContain("P9.12");
    expect(appendix).toContain("P9.13");
    expect(appendix).toContain("cannot be asserted by a test");
  });
});
