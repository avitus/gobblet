import { serverEnvSchema } from "./schema";
import type { ServerEnv } from "./schema";

export type NodeEnv = ServerEnv["NODE_ENV"];
export type AppEnv = ServerEnv["APP_ENV"];
export type LogLevel = ServerEnv["LOG_LEVEL"];

export type ServerConfig = Readonly<{
  nodeEnv: NodeEnv;
  appEnv: AppEnv;
  appVersion: string;
  gitSha: string;
  logLevel: LogLevel;
  host: string;
  port: number;
  publicWebUrl: string;
  corsOrigins: readonly string[];
  minSupportedClientVersion: string;
  databaseUrl: string | null;
  databasePoolMax: number;
  guestSessionTtlDays: number;
  userSessionTtlDays: number;
  credentialAttemptLimit: number;
  metricsEnabled: boolean;
  metricsToken: string | null;
  sentryDsn: string | null;
  posthogApiKey: string | null;
  posthogHost: string;
  telemetryPseudonymSecret: string | null;
  telemetryAttemptLimit: number;
}>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class ConfigValidationError extends Error {
  readonly issues: readonly Readonly<{ variable: string; message: string }>[];

  constructor(issues: readonly Readonly<{ variable: string; message: string }>[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  ${issue.variable}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

/**
 * Parses and freezes the configuration for a server process. Throws a
 * {@link ConfigValidationError} that names every offending variable, so a
 * misconfigured deployment fails at startup instead of at first request.
 */
export function loadServerConfig(env: EnvSource = process.env): ServerConfig {
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => ({
        variable: issue.path.map(String).join(".") || "(root)",
        message: issue.message,
      })),
    );
  }

  const values = parsed.data;
  return Object.freeze({
    nodeEnv: values.NODE_ENV,
    appEnv: values.APP_ENV,
    appVersion: values.APP_VERSION,
    gitSha: values.GIT_SHA,
    logLevel: values.LOG_LEVEL,
    host: values.HOST,
    port: values.PORT,
    publicWebUrl: values.PUBLIC_WEB_URL,
    corsOrigins: Object.freeze([...values.CORS_ORIGINS]),
    minSupportedClientVersion: values.MIN_SUPPORTED_CLIENT_VERSION,
    databaseUrl: values.DATABASE_URL ?? null,
    databasePoolMax: values.DATABASE_POOL_MAX,
    guestSessionTtlDays: values.GUEST_SESSION_TTL_DAYS,
    userSessionTtlDays: values.USER_SESSION_TTL_DAYS,
    credentialAttemptLimit: values.CREDENTIAL_ATTEMPT_LIMIT,
    metricsEnabled: values.METRICS_ENABLED,
    metricsToken: values.METRICS_TOKEN ?? null,
    sentryDsn: values.SENTRY_DSN ?? null,
    posthogApiKey: values.POSTHOG_API_KEY ?? null,
    posthogHost: values.POSTHOG_HOST,
    telemetryPseudonymSecret: values.TELEMETRY_PSEUDONYM_SECRET ?? null,
    telemetryAttemptLimit: values.TELEMETRY_ATTEMPT_LIMIT,
  });
}
