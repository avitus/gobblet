import { createHash } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import { setUserRole } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { authResponseSchema } from "@gobblet/protocol";
import type { ReleaseArtifact } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { ReleaseService } from "../src/releases/service";
import type { BundleReader } from "../src/ops/desktop-release";
import {
  checkDesktopManifest,
  describeDesktopArtifact,
  nodeBundleReader,
  promoteDesktopRelease,
  publishDesktopRelease,
  readLatestReleases,
} from "../src/ops/desktop-release";
import { adminServiceFixture } from "./helpers/admin-service";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The steps of `.github/workflows/desktop-release.yml` that are not YAML: reading
 * what the bundler produced, publishing it, asking the endpoint whether it would
 * offer it, and promoting it. The three that talk to the API run against the real
 * routes, so what passes here is what a release will do to a deployment.
 */

const DOWNLOAD_BASE = "https://github.com/example/gobblet/releases/download/v1.2.0";

const config = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "1.2.0",
  GIT_SHA: "phase8",
  LOG_LEVEL: "fatal",
});

function bundle(files: Readonly<Record<string, string>>): BundleReader {
  return {
    list: () => Promise.resolve(Object.keys(files)),
    read: (file) => {
      const contents = files[file];
      return contents === undefined
        ? Promise.reject(new Error(`no such file ${file}`))
        : Promise.resolve(new TextEncoder().encode(contents));
    },
  };
}

const MAC_BUNDLE = Object.freeze({
  "/out/macos/Gobblet Online.app.tar.gz": "the update bundle",
  "/out/macos/Gobblet Online.app.tar.gz.sig": "c2lnbmF0dXJl\n",
  "/out/dmg/Gobblet Online_1.2.0_aarch64.dmg": "the installer",
});

describe("describing what the bundler built", () => {
  it("reads the update bundle, the installer and the signature beside them", async () => {
    const described = await describeDesktopArtifact({
      target: "darwin-aarch64",
      directory: "/out",
      downloadBase: `${DOWNLOAD_BASE}/`,
      reader: bundle(MAC_BUNDLE),
    });

    expect(described).toEqual({
      target: "darwin-aarch64",
      url: `${DOWNLOAD_BASE}/Gobblet%20Online.app.tar.gz`,
      downloadUrl: `${DOWNLOAD_BASE}/Gobblet%20Online_1.2.0_aarch64.dmg`,
      signature: "c2lnbmF0dXJl",
      sizeBytes: "the installer".length,
      sha256: createHash("sha256").update("the installer").digest("hex"),
    });
  });

  it("describes the Windows installer, which is also the update bundle", async () => {
    const described = await describeDesktopArtifact({
      target: "windows-x86_64",
      directory: "/out",
      downloadBase: DOWNLOAD_BASE,
      reader: bundle({
        "/out/nsis/Gobblet-Online_1.2.0_x64-setup.exe": "the installer",
        "/out/nsis/Gobblet-Online_1.2.0_x64-setup.exe.sig": "c2ln",
      }),
    });

    expect(described.url).toBe(described.downloadUrl);
    expect(described.signature).toBe("c2ln");
  });

  it("refuses a build with no signature beside the bundle", async () => {
    await expect(
      describeDesktopArtifact({
        target: "darwin-x86_64",
        directory: "/out",
        downloadBase: DOWNLOAD_BASE,
        reader: bundle({
          "/out/macos/Gobblet Online.app.tar.gz": "the update bundle",
          "/out/dmg/Gobblet Online_1.2.0_x64.dmg": "the installer",
        }),
      }),
    ).rejects.toThrow("The build was not signed");
  });

  it("refuses a directory with nothing to publish", async () => {
    await expect(
      describeDesktopArtifact({
        target: "darwin-aarch64",
        directory: "/out",
        downloadBase: DOWNLOAD_BASE,
        reader: bundle({ "/out/README.txt": "nothing here" }),
      }),
    ).rejects.toThrow("no update bundle ending in .app.tar.gz");
  });

  it("refuses an ambiguous build rather than guessing which installer to ship", async () => {
    await expect(
      describeDesktopArtifact({
        target: "darwin-aarch64",
        directory: "/out",
        downloadBase: DOWNLOAD_BASE,
        reader: bundle({
          ...MAC_BUNDLE,
          "/out/dmg/Gobblet Online_1.2.1_aarch64.dmg": "a second installer",
        }),
      }),
    ).rejects.toThrow("produced 2 files ending in .dmg");
  });

  it("reads a real directory through the reader the workflow uses", async () => {
    const files = await nodeBundleReader.list("src/ops");

    expect(files).toContain("src/ops/desktop-release.ts");
    expect((await nodeBundleReader.read("src/ops/desktop-release.ts")).byteLength).toBeGreaterThan(
      0,
    );
  });
});

describe("the release steps that talk to the API", () => {
  let handle: DatabaseHandle;
  let clock: TestClock;
  let app: FastifyInstance;
  let token: string;
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
    const telemetry = createSilentTelemetry();
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
    token = account.session.sessionToken;
  });

  afterEach(async () => {
    await app.close();
  });

  /** The workflow's `fetch`, pointed at the running application. */
  function caller(): Readonly<{ baseUrl: string; token: string; fetch: typeof globalThis.fetch }> {
    return {
      baseUrl: "https://api.test/",
      token,
      fetch: async (input, init) => {
        const url = new URL(input instanceof URL ? input.href : input);
        const injected = await app.inject({
          method: (init?.method ?? "GET") as "GET",
          url: `${url.pathname}${url.search}`,
          headers: (init?.headers ?? {}) as Record<string, string>,
          ...(typeof init?.body === "string" ? { payload: init.body } : {}),
        });
        return new Response(injected.statusCode === 204 ? null : injected.body, {
          status: injected.statusCode,
        });
      },
    };
  }

  function artifact(target: ReleaseArtifact["target"]): ReleaseArtifact {
    return {
      target,
      url: `${DOWNLOAD_BASE}/gobblet-${target}.tar.gz`,
      downloadUrl: `${DOWNLOAD_BASE}/gobblet-${target}.dmg`,
      signature: "c2lnbmF0dXJl",
      sizeBytes: 1024,
      sha256: createHash("sha256").update(target).digest("hex"),
    };
  }

  async function publish(
    targets: readonly ReleaseArtifact["target"][] = ["darwin-aarch64"],
  ): Promise<ReturnType<typeof caller>> {
    const from = caller();
    await publishDesktopRelease({
      ...from,
      version: "1.2.0",
      channel: "beta",
      notes: "Faster board.",
      artifacts: targets.map(artifact),
      reason: "Published by the desktop release workflow",
    });
    return from;
  }

  it("records the artifacts and then offers them to an older client", async () => {
    const from = await publish(["darwin-aarch64", "windows-x86_64"]);

    await expect(
      checkDesktopManifest({
        ...from,
        version: "1.2.0",
        channel: "beta",
        targets: ["darwin-aarch64", "windows-x86_64"],
      }),
    ).resolves.toBeUndefined();
  });

  it("stops the workflow when the API refuses the publication", async () => {
    await expect(
      publishDesktopRelease({
        ...caller(),
        token: "not-an-admin",
        version: "1.2.0",
        channel: "beta",
        notes: "Faster board.",
        artifacts: [artifact("darwin-aarch64")],
        reason: "Published by the desktop release workflow",
      }),
    ).rejects.toThrow("POST /v1/admin/releases answered 401");
  });

  it("fails the staged check when the endpoint offers nothing at all", async () => {
    await expect(
      checkDesktopManifest({
        ...caller(),
        version: "1.2.0",
        channel: "beta",
        targets: ["darwin-aarch64"],
      }),
    ).rejects.toThrow("beta offers nothing to a darwin-aarch64 client running 0.0.1");
  });

  it("fails the staged check when the endpoint offers a different version", async () => {
    const from = await publish();

    await expect(
      checkDesktopManifest({
        ...from,
        version: "1.3.0",
        channel: "beta",
        targets: ["darwin-aarch64"],
      }),
    ).rejects.toThrow("beta offers 1.2.0 to a darwin-aarch64 client, not 1.3.0");
  });

  it("fails the staged check when a manifest names no platform", async () => {
    // The endpoint cannot answer this way; a release must not proceed if it does.
    const answering = (): Promise<Response> =>
      Promise.resolve(
        Response.json({
          version: "1.2.0",
          notes: "Faster board.",
          pub_date: "2026-01-01T00:00:00.000Z",
          platforms: {},
        }),
      );

    await expect(
      checkDesktopManifest({
        baseUrl: "https://api.test",
        fetch: answering,
        version: "1.2.0",
        channel: "beta",
        targets: ["windows-x86_64"],
      }),
    ).rejects.toThrow("The beta manifest has nothing for windows-x86_64");
  });

  it("finds the release by version and moves it to stable", async () => {
    const from = await publish();

    const promoted = await promoteDesktopRelease({
      ...from,
      version: "1.2.0",
      reason: "The staged channel ran clean",
    });

    expect(promoted.channel).toBe("stable");
    expect((await readLatestReleases(from)).stable?.version).toBe("1.2.0");
  });

  it("is content when the release is already stable", async () => {
    const from = await publish();
    await promoteDesktopRelease({
      ...from,
      version: "1.2.0",
      reason: "The staged channel ran clean",
    });

    const again = await promoteDesktopRelease({
      ...from,
      version: "1.2.0",
      reason: "The staged channel ran clean",
    });

    expect(again.channel).toBe("stable");
  });

  it("refuses to promote a version that was never published", async () => {
    const from = await publish();

    await expect(
      promoteDesktopRelease({ ...from, version: "9.9.9", reason: "The staged channel ran clean" }),
    ).rejects.toThrow("No release 9.9.9 to promote");
  });
});
