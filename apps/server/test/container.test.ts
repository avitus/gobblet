import { loadServerConfig } from "@gobblet/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The image is where a deployment stops being a repository and starts being a running
 * process, and nothing else in the suite would notice if it were wrong. These are the
 * facts that would break a deployment silently or slowly
 * (docs/adr/0043-railway-hosts-the-deployment.md).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function manifest(path: string): Readonly<{ dependencies?: Record<string, string> }> {
  return JSON.parse(read(path)) as Readonly<{ dependencies?: Record<string, string> }>;
}

/** Every workspace package the server needs at runtime, transitively. */
function workspaceDependenciesOfServer(): string[] {
  const found = new Set<string>();
  const pending = ["apps/server/package.json"];

  while (pending.length > 0) {
    const next = pending.pop() as string;
    for (const name of Object.keys(manifest(next).dependencies ?? {})) {
      if (!name.startsWith("@gobblet/")) {
        continue;
      }
      const directory = `packages/${name.slice("@gobblet/".length)}`;
      if (found.has(directory)) {
        continue;
      }
      found.add(directory);
      pending.push(`${directory}/package.json`);
    }
  }

  return [...found].sort();
}

describe("the server image", () => {
  const dockerfile = read("apps/server/Dockerfile");

  it("copies the manifest and the build of every workspace package it needs", () => {
    const missing = workspaceDependenciesOfServer().filter(
      (directory) =>
        !dockerfile.includes(`COPY ${directory}/package.json ${directory}/`) ||
        !dockerfile.includes(`/repo/${directory}/dist ${directory}/dist`),
    );

    expect(missing).toEqual([]);
  });

  it("starts node itself, because pnpm would swallow the SIGTERM the drain needs", () => {
    expect(dockerfile).toContain('CMD ["node", "apps/server/dist/main.js"]');
    expect(dockerfile).not.toMatch(/CMD.*pnpm/);
  });

  it("runs as a user that is not root", () => {
    expect(dockerfile).toContain("USER node");
  });

  it("installs without development dependencies in the stage that runs", () => {
    expect(dockerfile).toContain("--prod");
  });

  it("builds on the Node version the repository pins", () => {
    const pinned = read(".nvmrc").trim();

    for (const image of dockerfile.matchAll(/FROM node:(\d+)/g)) {
      expect(image[1]).toBe(pinned);
    }
  });
});

describe("the client image", () => {
  const dockerfile = read("apps/web/Dockerfile");

  it("refuses to build without the address of the server it must talk to", () => {
    expect(dockerfile).toContain("ARG VITE_API_BASE_URL");
    expect(dockerfile).toMatch(/test -n "\$\{VITE_API_BASE_URL\}"/);
  });

  it("serves the single-page application so a deep link survives a reload", () => {
    expect(read("apps/web/Caddyfile")).toContain("try_files {path} /index.html");
  });

  it("lets the platform choose the port", () => {
    expect(read("apps/web/Caddyfile")).toContain("{$PORT");
  });
});

type ServiceConfig = Readonly<{
  build: { dockerfilePath: string };
  deploy: {
    healthcheckPath: string;
    drainingSeconds?: number;
    multiRegionConfig: Record<string, { numReplicas: number }>;
  };
}>;

describe("the service configuration", () => {
  const server = JSON.parse(read("apps/server/railway.json")) as ServiceConfig;
  const client = JSON.parse(read("apps/web/railway.json")) as ServiceConfig;

  it("points the platform at the readiness probe, not at liveness", () => {
    // A container that is alive but cannot reach the database must not take traffic.
    expect(server.deploy.healthcheckPath).toBe("/health/ready");
  });

  it("names the Dockerfile this repository defines", () => {
    expect(server.build.dockerfilePath).toBe("apps/server/Dockerfile");
  });

  it("runs one replica, because the queue and the clocks are in this process", () => {
    const replicas = Object.values(server.deploy.multiRegionConfig).map(
      (region) => region.numReplicas,
    );

    expect(replicas).toEqual([1]);
  });

  it("puts both services in one region, which is where the database has to be too", () => {
    // Split across regions, every query the server makes crosses the continent
    // (docs/adr/0044-the-deployment-runs-in-us-west.md).
    const regions = [server, client].map((service) =>
      Object.keys(service.deploy.multiRegionConfig),
    );

    expect(regions[0]).toHaveLength(1);
    expect(regions[1]).toEqual(regions[0]);
  });

  it("waits longer than the drain window before killing the process", () => {
    // A platform that kills the process sooner than the server waits for matches to
    // settle would make the drain of docs/operations.md section 8 decoration.
    const { shutdownDrainSeconds } = loadServerConfig({});

    expect(server.deploy.drainingSeconds).toBeGreaterThan(shutdownDrainSeconds);
  });
});
