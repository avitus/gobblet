import type { ServerConfig } from "@gobblet/config";
import type { Database } from "@gobblet/db";
import { AdminService } from "../../src/admin/service";
import type { ReadinessSnapshot } from "../../src/admin/service";
import type { IdentityService } from "../../src/identity/service";
import type { MatchRuntime } from "../../src/match/runtime";
import { MatchmakingService } from "../../src/matchmaking/service";
import type { MatchmakingQueue } from "../../src/matchmaking/service";
import { createSilentTelemetry } from "../../src/observability/telemetry";
import { ReleaseService } from "../../src/releases/service";
import type { TelemetryService } from "../../src/observability/telemetry";

/**
 * An administrative service for a test that only needs the app to have one. The
 * dashboard summary reads a queue and the readiness probes, so both are supplied
 * here rather than being made optional in the service itself.
 */
export function adminServiceFixture(
  options: Readonly<{
    db: Database;
    config: ServerConfig;
    runtime: MatchRuntime;
    identity: IdentityService;
    now: () => number;
    queue?: MatchmakingQueue;
    telemetry?: TelemetryService;
    readiness?: () => Promise<ReadinessSnapshot>;
    connectedSockets?: () => number;
  }>,
): AdminService {
  const { db, config, runtime, identity, now } = options;
  return new AdminService({
    db,
    config,
    queue: options.queue ?? new MatchmakingService({ runtime, identity, now }),
    telemetry: options.telemetry ?? createSilentTelemetry(),
    readiness: options.readiness ?? ((): Promise<ReadinessSnapshot> => Promise.resolve([])),
    connectedSockets: options.connectedSockets ?? ((): number => 0),
    startedAt: now(),
    now,
  });
}

/**
 * A release service for a test that only needs the app to have one. Publishing and
 * the update endpoint are exercised through the real thing in `releases-api.test.ts`.
 */
export function releaseServiceFixture(
  options: Readonly<{ db: Database; now: () => number; telemetry?: TelemetryService }>,
): ReleaseService {
  return new ReleaseService({
    db: options.db,
    telemetry: options.telemetry ?? createSilentTelemetry(),
    now: options.now,
  });
}
