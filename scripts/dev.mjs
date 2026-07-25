#!/usr/bin/env node
/**
 * Single-command local development entry point (Phase 0 exit criterion).
 *
 * 1. Starts the local PostgreSQL container (when Docker is available).
 * 2. Starts the API server and the web client in parallel through Turborepo.
 *
 * Docker is optional: without it the server still boots and reports the database
 * as unavailable on /health/ready, which keeps the loop usable on machines that
 * cannot run containers.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", ...options });
}

function hasDockerCompose() {
  const probe = spawnSync("docker", ["compose", "version"], { cwd: repoRoot, stdio: "ignore" });
  return probe.status === 0;
}

function hasLocalPostgres() {
  const probe = spawnSync("pg_isready", ["-q"], { cwd: repoRoot, stdio: "ignore" });
  return probe.status === 0;
}

function ensureEnvFile() {
  if (!existsSync(path.join(repoRoot, ".env"))) {
    console.warn("[dev] No .env found. Falling back to .env.example defaults.");
    console.warn("[dev] Run: cp .env.example .env");
  }
}

function startDatabase() {
  if (hasLocalPostgres()) {
    console.log("[dev] Using the PostgreSQL server already listening locally.");
    return true;
  }

  if (!hasDockerCompose()) {
    console.warn("[dev] No local PostgreSQL server and no Docker Compose.");
    console.warn("[dev] Start PostgreSQL or point DATABASE_URL at a reachable instance.");
    return false;
  }

  console.log("[dev] Starting PostgreSQL (docker compose up -d postgres)...");
  const up = run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  if (up.status !== 0) {
    console.error("[dev] Failed to start PostgreSQL. Fix Docker or set DATABASE_URL manually.");
    process.exit(up.status ?? 1);
  }
  return true;
}

function applyMigrations() {
  console.log("[dev] Applying database migrations...");
  const migrate = run("pnpm", ["--filter", "@gobblet/db", "db:migrate"]);
  if (migrate.status !== 0) {
    console.error("[dev] Migrations failed. The server would start without a usable schema.");
    process.exit(migrate.status ?? 1);
  }
}

ensureEnvFile();
if (startDatabase()) {
  applyMigrations();
}

console.log("[dev] Starting server and web client...");
const child = spawn(
  "pnpm",
  ["turbo", "run", "dev", "--filter=@gobblet/server", "--filter=@gobblet/web"],
  { cwd: repoRoot, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
