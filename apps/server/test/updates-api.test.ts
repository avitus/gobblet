import { loadServerConfig } from "@gobblet/config";
import { listAuditRecords, setUserRole } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import {
  adminReleaseListResponseSchema,
  authResponseSchema,
  latestReleasesResponseSchema,
  releaseSummarySchema,
  updateManifestSchema,
} from "@gobblet/protocol";
import type { AuthResponse, PublishReleaseRequest, UpdateTarget } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
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
 * The update endpoint of ADR-0034 and the administrative routes that feed it: what
 * an updater is offered, what a paused rollout offers instead, and what the audit
 * log holds afterwards.
 */

const config = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "1.2.0",
  GIT_SHA: "phase8",
  LOG_LEVEL: "fatal",
});

let handle: DatabaseHandle;
let clock: TestClock;
let app: FastifyInstance;
let telemetry: TelemetryService;
let releases: ReleaseService;
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
    metrics: new MetricsRegistry({ appVersion: "1.2.0", gitSha: "phase8", appEnv: "local" }),
    recentErrors: new RecentErrors(),
    pseudonymise: null,
    now: clock.now,
  });
  const runtime = new MatchRuntime({ db: handle.db, now: clock.now, telemetry });
  const identity = new IdentityService({ db: handle.db, config, now: clock.now });
  releases = new ReleaseService({ db: handle.db, telemetry, now: clock.now });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests: new GuestService({ db: handle.db, config, now: clock.now }),
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      releases,
      db: handle.db,
    },
    telemetry,
    now: clock.now,
  });
});

afterEach(async () => {
  await app.close();
});

async function register(name: string): Promise<AuthResponse> {
  sequence += 1;
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email: `${name}${sequence}@example.com`,
      username: `${name}${sequence}`,
      password: "correct horse battery staple 7",
    },
  });
  expect(response.statusCode).toBe(201);
  return authResponseSchema.parse(response.json());
}

async function registerAdmin(): Promise<AuthResponse> {
  const account = await register("releaser");
  await setUserRole(handle.db, account.account.userId, "admin");
  return account;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function artifactOf(target: UpdateTarget, version: string): PublishReleaseRequest["artifacts"][0] {
  return {
    target,
    url: `https://downloads.example.com/${version}/${target}/bundle.tar.gz`,
    downloadUrl: `https://downloads.example.com/${version}/${target}/installer`,
    signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
    sizeBytes: 11_534_336,
    sha256: "c".repeat(64),
  };
}

async function publish(
  token: string,
  version: string,
  channel: "stable" | "beta",
  targets: UpdateTarget[] = ["darwin-aarch64", "windows-x86_64"],
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/releases",
    headers: auth(token),
    payload: {
      version,
      channel,
      notes: `What changed in ${version}`,
      artifacts: targets.map((target) => artifactOf(target, version)),
      reason: `Publishing ${version} to the ${channel} channel.`,
    },
  });
  expect(response.statusCode).toBe(200);
  return releaseSummarySchema.parse(response.json()).releaseId;
}

describe("GET /v1/updates/:channel", () => {
  it("offers the newest release to a client running an older version", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "1.3.0", "stable");

    const response = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });

    expect(response.statusCode).toBe(200);
    const manifest = updateManifestSchema.parse(response.json());
    expect(manifest.version).toBe("1.3.0");
    expect(manifest.notes).toBe("What changed in 1.3.0");
    expect(manifest.platforms["darwin-aarch64"]?.url).toContain("bundle.tar.gz");
    expect(manifest.platforms["darwin-aarch64"]?.signature).toBe(
      "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
    );
    // The platform that asked, and no other, which keeps the answer minimal.
    expect(Object.keys(manifest.platforms)).toEqual(["darwin-aarch64"]);
  });

  it("offers nothing to a client that is already current, or ahead", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "1.3.0", "stable");

    for (const currentVersion of ["1.3.0", "1.4.0"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/updates/stable?target=darwin-aarch64&currentVersion=${currentVersion}`,
      });

      expect(response.statusCode, currentVersion).toBe(204);
      expect(response.body).toBe("");
    }
  });

  it("offers nothing for a platform the release was not built for", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "1.3.0", "stable", ["windows-x86_64"]);

    const response = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });

    expect(response.statusCode).toBe(204);
  });

  it("keeps the channels apart, so a beta release is not offered to stable", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "1.4.0", "beta");

    const stable = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });
    const beta = await app.inject({
      method: "GET",
      url: "/v1/updates/beta?target=darwin-aarch64&currentVersion=1.2.0",
    });

    expect(stable.statusCode).toBe(204);
    expect(updateManifestSchema.parse(beta.json()).version).toBe("1.4.0");
  });

  it("refuses a channel and a version it cannot read", async () => {
    const channel = await app.inject({
      method: "GET",
      url: "/v1/updates/nightly?target=darwin-aarch64&currentVersion=1.2.0",
    });
    const version = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=latest",
    });
    const target = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=linux-x86_64&currentVersion=1.2.0",
    });

    expect(channel.statusCode).toBe(400);
    expect(version.statusCode).toBe(400);
    expect(target.statusCode).toBe(400);
  });

  it("counts every check, offered or not, without naming anybody", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "1.3.0", "stable");

    await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });
    await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.3.0",
    });

    const exposition = await telemetry.metrics.expose();
    expect(
      sampleValue(exposition, "gobblet_desktop_update_checks_total", {
        channel: "stable",
        target: "darwin-aarch64",
        offered: "yes",
      }),
    ).toBe(1);
    expect(
      sampleValue(exposition, "gobblet_desktop_update_checks_total", {
        channel: "stable",
        target: "darwin-aarch64",
        offered: "no",
      }),
    ).toBe(1);
  });
});

describe("pausing and promoting a rollout", () => {
  it("stops offering a paused release and offers it again when it resumes", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "1.3.0", "stable");

    const paused = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: auth(admin.session.sessionToken),
      payload: { paused: true, reason: "The Windows build crashes on start." },
    });
    expect(paused.statusCode).toBe(200);
    expect(releaseSummarySchema.parse(paused.json()).paused).toBe(true);

    const whilePaused = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });
    expect(whilePaused.statusCode).toBe(204);

    await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: auth(admin.session.sessionToken),
      payload: { paused: false, reason: "The crash was in the installer, not the build." },
    });

    const resumed = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });
    expect(resumed.statusCode).toBe(200);
  });

  it("promotes what the beta channel proved without touching its artifacts", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "1.5.0", "beta");
    const before = await app.inject({
      method: "GET",
      url: "/v1/updates/beta?target=darwin-aarch64&currentVersion=1.2.0",
    });

    const promoted = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/promote`,
      headers: auth(admin.session.sessionToken),
      payload: { reason: "The staged channel ran clean for a day." },
    });

    expect(promoted.statusCode).toBe(200);
    expect(releaseSummarySchema.parse(promoted.json()).channel).toBe("stable");
    const after = await app.inject({
      method: "GET",
      url: "/v1/updates/stable?target=darwin-aarch64&currentVersion=1.2.0",
    });
    const beforeManifest = updateManifestSchema.parse(before.json());
    const afterManifest = updateManifestSchema.parse(after.json());
    expect(afterManifest.platforms).toEqual(beforeManifest.platforms);
  });

  it("refuses to promote a release that is already stable, and one that is unknown", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "1.6.0", "stable");

    const already = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/promote`,
      headers: auth(admin.session.sessionToken),
      payload: { reason: "Trying to promote what is already promoted." },
    });
    const unknownPause = await app.inject({
      method: "POST",
      url: "/v1/admin/releases/0f1c1a1e-2b3c-4d5e-8f90-1a2b3c4d5e6f/pause",
      headers: auth(admin.session.sessionToken),
      payload: { paused: true, reason: "Pausing something that is not there." },
    });
    const unknownPromote = await app.inject({
      method: "POST",
      url: "/v1/admin/releases/0f1c1a1e-2b3c-4d5e-8f90-1a2b3c4d5e6f/promote",
      headers: auth(admin.session.sessionToken),
      payload: { reason: "Promoting something that is not there." },
    });

    expect(already.statusCode).toBe(409);
    expect(unknownPause.statusCode).toBe(404);
    expect(unknownPromote.statusCode).toBe(404);
  });

  it("refuses a rollout change and a promotion that say nothing usable", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "1.7.5", "beta");

    const pause = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: auth(admin.session.sessionToken),
      payload: { paused: "yes", reason: "A pause that is not a boolean." },
    });
    const promote = await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/promote`,
      headers: auth(admin.session.sessionToken),
      payload: {},
    });

    expect(pause.statusCode).toBe(400);
    expect(promote.statusCode).toBe(400);
  });

  it("refuses a second publication of a version already in that channel", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "1.7.0", "stable");

    const again = await app.inject({
      method: "POST",
      url: "/v1/admin/releases",
      headers: auth(admin.session.sessionToken),
      payload: {
        version: "1.7.0",
        channel: "stable",
        notes: "The same version again",
        artifacts: [artifactOf("darwin-aarch64", "1.7.0")],
        reason: "Publishing the same version twice by mistake.",
      },
    });

    expect(again.statusCode).toBe(409);
  });
});

describe("who may change a release", () => {
  it("refuses every mutation to an account without the role", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "1.8.0", "beta");
    const player = await register("player");

    const attempts = [
      { method: "GET" as const, url: "/v1/admin/releases", payload: undefined },
      {
        method: "POST" as const,
        url: "/v1/admin/releases",
        payload: {
          version: "9.9.9",
          channel: "stable",
          notes: "Not mine to publish",
          artifacts: [artifactOf("darwin-aarch64", "9.9.9")],
          reason: "A player trying to publish a release.",
        },
      },
      {
        method: "POST" as const,
        url: `/v1/admin/releases/${releaseId}/pause`,
        payload: { paused: true, reason: "A player trying to pause a rollout." },
      },
      {
        method: "POST" as const,
        url: `/v1/admin/releases/${releaseId}/promote`,
        payload: { reason: "A player trying to promote a release." },
      },
      {
        method: "POST" as const,
        url: "/v1/admin/releases/build-events",
        payload: {
          version: "1.8.0",
          target: "darwin-aarch64",
          step: "sign",
          outcome: "failed",
        },
      },
    ];

    for (const attempt of attempts) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: auth(player.session.sessionToken),
        ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
      });

      expect(response.statusCode, attempt.url).toBe(403);
    }
  });

  it("refuses a publication that is not a release at all", async () => {
    const admin = await registerAdmin();

    const responses = await Promise.all(
      [
        { version: "1.9", channel: "stable", notes: "Bad version" },
        { version: "1.9.0", channel: "nightly", notes: "Bad channel" },
        { version: "1.9.0", channel: "stable", notes: "" },
      ].map((payload) =>
        app.inject({
          method: "POST",
          url: "/v1/admin/releases",
          headers: auth(admin.session.sessionToken),
          payload: {
            ...payload,
            artifacts: [artifactOf("darwin-aarch64", "1.9.0")],
            reason: "Publishing something malformed on purpose.",
          },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(400);
    }
  });

  it("refuses a request that carries no body at all", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "1.8.5", "beta");

    for (const url of [
      "/v1/admin/releases",
      `/v1/admin/releases/${releaseId}/pause`,
      `/v1/admin/releases/${releaseId}/promote`,
      "/v1/admin/releases/build-events",
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: auth(admin.session.sessionToken),
      });

      expect(response.statusCode, url).toBe(400);
    }
  });

  it("refuses an unsigned artifact, which is the point of the schema", async () => {
    const admin = await registerAdmin();
    const { signature: _signature, ...unsigned } = artifactOf("darwin-aarch64", "2.0.0");

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/releases",
      headers: auth(admin.session.sessionToken),
      payload: {
        version: "2.0.0",
        channel: "stable",
        notes: "An unsigned build",
        artifacts: [unsigned],
        reason: "Trying to publish a build that was never signed.",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("what the audit log holds afterwards", () => {
  it("records the publication, the pause, the resumption and the promotion", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "2.1.0", "beta");

    // A minute between decisions, because a log ordered by time needs distinct times.
    clock.advance(60_000);
    await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: auth(admin.session.sessionToken),
      payload: { paused: true, reason: "Holding the beta while a report is checked." },
    });
    clock.advance(60_000);
    await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: auth(admin.session.sessionToken),
      payload: { paused: false, reason: "The report was about an older build." },
    });
    clock.advance(60_000);
    await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/promote`,
      headers: auth(admin.session.sessionToken),
      payload: { reason: "A day on the staged channel with no reports." },
    });

    const records = await listAuditRecords(handle.db, { limit: 10 });
    expect(records.map((record) => record.action)).toEqual([
      "release-promoted",
      "release-resumed",
      "release-paused",
      "release-published",
    ]);
    for (const record of records) {
      expect(record.targetType).toBe("release");
      expect(record.targetId).toBe(releaseId);
      expect(record.adminUserId).toBe(admin.account.userId);
      expect(record.reason.length).toBeGreaterThan(8);
    }
  });
});

describe("GET /v1/releases/latest", () => {
  it("serves the newest of each channel to anybody, with digests and no signatures", async () => {
    const admin = await registerAdmin();
    await publish(admin.session.sessionToken, "2.2.0", "stable");
    await publish(admin.session.sessionToken, "2.3.0", "beta");

    const response = await app.inject({ method: "GET", url: "/v1/releases/latest" });

    expect(response.statusCode).toBe(200);
    const latest = latestReleasesResponseSchema.parse(response.json());
    expect(latest.stable?.version).toBe("2.2.0");
    expect(latest.beta?.version).toBe("2.3.0");
    expect(latest.stable?.artifacts.map((artifact) => artifact.target)).toEqual([
      "darwin-aarch64",
      "windows-x86_64",
    ]);
    expect(latest.stable?.artifacts[0]?.sha256).toBe("c".repeat(64));
    expect(JSON.stringify(latest)).not.toContain("dW50cnVzdGVk");
  });

  it("says there is nothing to download before anything is published", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/releases/latest" });

    expect(latestReleasesResponseSchema.parse(response.json())).toEqual({
      stable: null,
      beta: null,
    });
  });

  it("lists every release for an administrator, paused ones included", async () => {
    const admin = await registerAdmin();
    const releaseId = await publish(admin.session.sessionToken, "2.4.0", "stable");
    await app.inject({
      method: "POST",
      url: `/v1/admin/releases/${releaseId}/pause`,
      headers: auth(admin.session.sessionToken),
      payload: { paused: true, reason: "Holding this one back for now." },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/releases",
      headers: auth(admin.session.sessionToken),
    });

    const listed = adminReleaseListResponseSchema.parse(response.json());
    expect(listed.releases).toHaveLength(1);
    expect(listed.releases[0]).toMatchObject({ version: "2.4.0", paused: true });
  });
});

describe("build events from the release workflow", () => {
  it("counts a signing failure, which is the series the paging rule watches", async () => {
    const admin = await registerAdmin();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/releases/build-events",
      headers: auth(admin.session.sessionToken),
      payload: {
        version: "2.5.0",
        target: "darwin-aarch64",
        step: "sign",
        outcome: "failed",
        detail: "No Developer ID Application certificate in the keychain.",
      },
    });

    expect(response.statusCode).toBe(200);
    const exposition = await telemetry.metrics.expose();
    expect(
      sampleValue(exposition, "gobblet_desktop_signing_failures_total", {
        target: "darwin-aarch64",
        step: "sign",
      }),
    ).toBe(1);
    expect(telemetry.recentFailures()[0]?.code).toBe("release_sign_failed");
  });

  it("counts nothing when a step succeeds, and nothing for a step that is not signing", async () => {
    const admin = await registerAdmin();

    for (const payload of [
      { version: "2.5.0", target: "darwin-aarch64", step: "sign", outcome: "succeeded" },
      { version: "2.5.0", target: "darwin-aarch64", step: "bundle", outcome: "failed" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/releases/build-events",
        headers: auth(admin.session.sessionToken),
        payload,
      });
      expect(response.statusCode).toBe(200);
    }

    const exposition = await telemetry.metrics.expose();
    expect(sampleValue(exposition, "gobblet_desktop_signing_failures_total")).toBe(0);
    // A failed bundle is still an operational failure worth seeing on the dashboard.
    expect(telemetry.recentFailures()[0]?.code).toBe("release_bundle_failed");
  });

  it("refuses a build event that names a step it does not know", async () => {
    const admin = await registerAdmin();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/releases/build-events",
      headers: auth(admin.session.sessionToken),
      payload: {
        version: "2.5.0",
        target: "darwin-aarch64",
        step: "upload",
        outcome: "failed",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
