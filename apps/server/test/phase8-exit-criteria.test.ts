import { readFileSync } from "node:fs";
import path from "node:path";
import { loadServerConfig } from "@gobblet/config";
import { setUserRole } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { authResponseSchema, releaseSummarySchema, updateManifestSchema } from "@gobblet/protocol";
import type { PublishReleaseRequest, UpdateTarget } from "@gobblet/protocol";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { NullAnalytics } from "../src/observability/analytics";
import { RecentErrors } from "../src/observability/error-log";
import { NullErrorReporting } from "../src/observability/error-reporting";
import { MetricsRegistry } from "../src/observability/metrics";
import { TelemetryService } from "../src/observability/telemetry";
import { ReleaseService } from "../src/releases/service";
import { adminServiceFixture } from "./helpers/admin-service";
import { TestClock } from "./helpers/match-fixtures";
import { sampleValue } from "./helpers/prometheus";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The Phase 8 exit criteria of spec section 24, as far as this machine can prove
 * them. "Prior version updates successfully" and "a failed update leaves the prior
 * application usable" are proved here against the real endpoint; the two clean
 * machine criteria need identities nobody has bought yet, so what is asserted here
 * is that the workflow refuses to ship without them rather than that a signed
 * installer opens (appendix P8.6).
 */

const config = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "1.3.0",
  GIT_SHA: "phase8",
  LOG_LEVEL: "fatal",
});

const SIGNATURE = "dGhlIHNpZ25hdHVyZSBvZiB0aGUgYnVuZGxl";
const DIGEST = "c".repeat(64);

let handle: DatabaseHandle;
let clock: TestClock;
let app: FastifyInstance;
let telemetry: TelemetryService;
let sequence = 0;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  telemetry = new TelemetryService({
    analytics: new NullAnalytics(),
    errors: new NullErrorReporting(),
    metrics: new MetricsRegistry({ appVersion: "1.3.0", gitSha: "phase8", appEnv: "local" }),
    recentErrors: new RecentErrors(),
    pseudonymise: null,
    now: clock.now,
  });
  const runtime = new MatchRuntime({ db: handle.db, now: clock.now, telemetry });
  const identity = new IdentityService({ db: handle.db, config, now: clock.now });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests: new GuestService({ db: handle.db, config, now: clock.now }),
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      releases: new ReleaseService({ db: handle.db, telemetry, now: clock.now }),
      db: handle.db,
    },
    telemetry,
    now: clock.now,
  });
});

afterEach(async () => {
  await app.close();
});

async function adminToken(): Promise<string> {
  sequence += 1;
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email: `releaser${String(sequence)}@example.com`,
      username: `releaser${String(sequence)}`,
      password: "correct horse battery staple 7",
    },
  });
  const account = authResponseSchema.parse(response.json());
  await setUserRole(handle.db, account.account.userId, "admin");
  return account.session.sessionToken;
}

function artifact(target: UpdateTarget): PublishReleaseRequest["artifacts"][0] {
  return {
    target,
    url: `https://downloads.example.com/1.3.0/${target}/bundle.tar.gz`,
    downloadUrl: `https://downloads.example.com/1.3.0/${target}/install.dmg`,
    signature: SIGNATURE,
    sizeBytes: 9_000_000,
    sha256: DIGEST,
  };
}

async function publish(token: string, version: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/releases",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      version,
      channel: "stable",
      notes: "The release candidate.",
      artifacts: [artifact("darwin-aarch64")],
      reason: "The exit criteria publish a release to update to it",
    },
  });
  expect(response.statusCode).toBe(200);
  return releaseSummarySchema.parse(response.json()).releaseId;
}

async function checkFor(currentVersion: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "GET",
    url: `/v1/updates/stable?target=darwin-aarch64&currentVersion=${currentVersion}`,
  });
}

describe("a prior version updates to the release candidate", () => {
  it("offers the newer build, with the signature and digest the build machine produced", async () => {
    await publish(await adminToken(), "1.3.0");

    const response = await checkFor("1.2.0");

    expect(response.statusCode).toBe(200);
    const manifest = updateManifestSchema.parse(response.json());
    expect(manifest.version).toBe("1.3.0");
    expect(manifest.platforms["darwin-aarch64"]).toEqual({
      signature: SIGNATURE,
      url: "https://downloads.example.com/1.3.0/darwin-aarch64/bundle.tar.gz",
    });
  });

  it("offers nothing to a client that already has it, and nothing to a newer one", async () => {
    await publish(await adminToken(), "1.3.0");

    expect((await checkFor("1.3.0")).statusCode).toBe(204);
    expect((await checkFor("1.4.0")).statusCode).toBe(204);
  });

  it("offers nothing while the rollout is paused, and again once it resumes", async () => {
    const token = await adminToken();
    const releaseId = await publish(token, "1.3.0");

    const pause = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: { authorization: `Bearer ${token}` },
      payload: { paused: true, reason: "A player reported a black window after updating" },
    });
    expect(pause.statusCode).toBe(200);
    expect((await checkFor("1.2.0")).statusCode).toBe(204);

    const resume = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: { authorization: `Bearer ${token}` },
      payload: { paused: false, reason: "The black window was a driver, not the build" },
    });
    expect(resume.statusCode).toBe(200);
    expect((await checkFor("1.2.0")).statusCode).toBe(200);
  });
});

describe("a failed update leaves the prior application usable", () => {
  it("counts the failure and keeps offering the same build to the same client", async () => {
    await publish(await adminToken(), "1.3.0");

    const reported = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      payload: {
        events: [
          {
            name: "desktop-update-completed",
            outcome: "failure",
            fromVersion: "1.2.0",
            toVersion: "1.3.0",
          },
        ],
      },
    });

    expect(reported.statusCode).toBe(200);
    const exposition = await telemetry.metrics.expose();
    expect(
      sampleValue(exposition, "gobblet_desktop_update_outcomes_total", { outcome: "failure" }),
    ).toBe(1);

    // The client that failed to install is still running 1.2.0 and is still offered
    // the same bytes: a failed update retracts nothing.
    const again = await checkFor("1.2.0");
    expect(again.statusCode).toBe(200);
    expect(updateManifestSchema.parse(again.json()).version).toBe("1.3.0");
  });
});

describe("the clean-machine criteria are deferred, not waived", () => {
  const workflow = readFileSync(
    path.join(import.meta.dirname, "../../../.github/workflows/desktop-release.yml"),
    "utf8",
  );

  it("stops the release when a signing identity is missing, naming what is needed", () => {
    for (const secret of [
      "TAURI_SIGNING_PRIVATE_KEY",
      "APPLE_CERTIFICATE",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
      "WINDOWS_CERTIFICATE",
    ]) {
      expect(workflow).toContain(secret);
    }
    // Four "Require" steps, each of which exits rather than carrying on unsigned.
    expect(workflow.match(/^\s+- name: Require the/gm)).toHaveLength(5);
    expect(workflow.match(/^\s+exit 1$/gm)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("refuses to publish an unsigned build", () => {
    expect(workflow).toContain("An unsigned build cannot be published");
  });

  it("reports a signing failure to the series the paging rule watches", () => {
    expect(workflow).toContain("/v1/admin/releases/build-events");
    expect(workflow).toContain('\\"step\\":\\"sign\\",\\"outcome\\":\\"failed\\"');
  });

  it("promotes to stable only behind an approval gate", () => {
    expect(workflow).toContain("environment: desktop-stable");
    expect(workflow).toContain("desktop-release promote");
  });
});
