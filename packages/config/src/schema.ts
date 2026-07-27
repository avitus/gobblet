import { z } from "zod";

/**
 * Authoritative environment schema for every server side process
 * (docs/product-spec.md section 24, Phase 0 "environment-variable schema").
 * `.env.example` documents the same surface for humans.
 *
 * Variables that later phases need are optional here and become required in the
 * phase that consumes them, so Phase 0 stays runnable without a database.
 */
const absoluteUrl = z
  .string()
  .refine((value) => URL.canParse(value), { message: "must be an absolute URL" });

const commaSeparatedList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string()).min(1));

export const nodeEnvValues = ["development", "test", "production"] as const;
export const appEnvValues = ["local", "staging", "production"] as const;
export const logLevelValues = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(nodeEnvValues).default("development"),
  APP_ENV: z.enum(appEnvValues).default("local"),
  APP_VERSION: z.string().min(1).default("0.0.0-dev"),
  GIT_SHA: z.string().min(1).default("local"),
  LOG_LEVEL: z.enum(logLevelValues).default("info"),

  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_WEB_URL: absoluteUrl.default("http://localhost:5173"),
  CORS_ORIGINS: commaSeparatedList.default(["http://localhost:5173"]),
  MIN_SUPPORTED_CLIENT_VERSION: z.string().min(1).default("0.1.0"),

  /**
   * How long a shutdown waits for active matches to settle after it has stopped
   * matchmaking. The platform's own kill delay has to be longer than this, or the
   * drain is decoration (docs/adr/0043-railway-hosts-the-deployment.md).
   */
  SHUTDOWN_DRAIN_SECONDS: z.coerce.number().int().min(0).max(600).default(30),

  // Required from Phase 2 onwards, when match state is persisted.
  DATABASE_URL: absoluteUrl.optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Phase 3: identity is first party, so a session lifetime is the only knob
  // (docs/adr/0017-first-party-email-password-authentication.md).
  GUEST_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  USER_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // One address is one player in a deployment and every player in a test suite,
  // so the throttle ADR-0017 accepts is a number the environment can raise.
  CREDENTIAL_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(100_000).default(10),

  // Phase 7: observability. Every one of these is optional, and each transport is
  // inert without it, so a developer machine and the suites run with none set
  // (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
  METRICS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** When set, `GET /metrics` requires it as a bearer token (ADR-0031). */
  METRICS_TOKEN: z.string().min(16).optional(),
  SENTRY_DSN: absoluteUrl.optional(),
  POSTHOG_API_KEY: z.string().min(1).optional(),
  POSTHOG_HOST: absoluteUrl.default("https://eu.i.posthog.com"),
  /**
   * The key that turns an account or guest id into the pseudonym logs and analytics
   * share. Rotating it detaches new records from old ones, which is the point of a
   * pseudonym (appendix P7.12).
   */
  TELEMETRY_PSEUDONYM_SECRET: z.string().min(16).optional(),
  /** How many telemetry reports one address may send in a minute (appendix P7.11). */
  TELEMETRY_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(100_000).default(60),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
