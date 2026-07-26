import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadServerConfig } from "../src/index";

const minimal = {} as const;

describe("loadServerConfig", () => {
  it("applies local development defaults", () => {
    const config = loadServerConfig(minimal);

    expect(config).toEqual({
      nodeEnv: "development",
      appEnv: "local",
      appVersion: "0.0.0-dev",
      gitSha: "local",
      logLevel: "info",
      host: "127.0.0.1",
      port: 4000,
      publicWebUrl: "http://localhost:5173",
      corsOrigins: ["http://localhost:5173"],
      minSupportedClientVersion: "0.1.0",
      databaseUrl: null,
      databasePoolMax: 10,
      guestSessionTtlDays: 30,
      userSessionTtlDays: 30,
      credentialAttemptLimit: 10,
      metricsEnabled: false,
      metricsToken: null,
      sentryDsn: null,
      posthogApiKey: null,
      posthogHost: "https://eu.i.posthog.com",
      telemetryPseudonymSecret: null,
      telemetryAttemptLimit: 60,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
  });

  it("reads the documented variables", () => {
    const config = loadServerConfig({
      NODE_ENV: "production",
      APP_ENV: "staging",
      APP_VERSION: "1.2.3",
      GIT_SHA: "abc1234",
      LOG_LEVEL: "warn",
      HOST: "0.0.0.0",
      PORT: "8080",
      PUBLIC_WEB_URL: "https://play.example.com",
      CORS_ORIGINS: "https://play.example.com, tauri://localhost ,",
      MIN_SUPPORTED_CLIENT_VERSION: "1.0.0",
      DATABASE_URL: "postgresql://db.internal.example.com:5432/gobblet",
      DATABASE_POOL_MAX: "25",
      GUEST_SESSION_TTL_DAYS: "7",
      USER_SESSION_TTL_DAYS: "90",
      CREDENTIAL_ATTEMPT_LIMIT: "500",
      METRICS_ENABLED: "true",
      METRICS_TOKEN: "a-metrics-token-long-enough",
      SENTRY_DSN: "https://key@sentry.example.com/1",
      POSTHOG_API_KEY: "phc_example",
      POSTHOG_HOST: "https://posthog.example.com",
      TELEMETRY_PSEUDONYM_SECRET: "a-pseudonym-secret-value",
      TELEMETRY_ATTEMPT_LIMIT: "120",
    });

    expect(config.nodeEnv).toBe("production");
    expect(config.appEnv).toBe("staging");
    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual(["https://play.example.com", "tauri://localhost"]);
    expect(config.databaseUrl).toBe("postgresql://db.internal.example.com:5432/gobblet");
    expect(config.databasePoolMax).toBe(25);
    expect(config.guestSessionTtlDays).toBe(7);
    expect(config.userSessionTtlDays).toBe(90);
    expect(config.credentialAttemptLimit).toBe(500);
    expect(config.metricsEnabled).toBe(true);
    expect(config.metricsToken).toBe("a-metrics-token-long-enough");
    expect(config.sentryDsn).toBe("https://key@sentry.example.com/1");
    expect(config.posthogApiKey).toBe("phc_example");
    expect(config.posthogHost).toBe("https://posthog.example.com");
    expect(config.telemetryPseudonymSecret).toBe("a-pseudonym-secret-value");
    expect(config.telemetryAttemptLimit).toBe(120);
  });

  it("refuses a metrics token or a pseudonym key short enough to guess", () => {
    expect(() => loadServerConfig({ METRICS_TOKEN: "short" })).toThrow(ConfigValidationError);
    expect(() => loadServerConfig({ TELEMETRY_PSEUDONYM_SECRET: "short" })).toThrow(
      ConfigValidationError,
    );
  });

  it("reads the metrics switch as a word rather than a number", () => {
    expect(loadServerConfig({ METRICS_ENABLED: "false" }).metricsEnabled).toBe(false);
    expect(() => loadServerConfig({ METRICS_ENABLED: "1" })).toThrow(ConfigValidationError);
  });

  it("rejects a session lifetime outside the supported range", () => {
    expect(() => loadServerConfig({ USER_SESSION_TTL_DAYS: "0" })).toThrow(ConfigValidationError);
    expect(() => loadServerConfig({ GUEST_SESSION_TTL_DAYS: "400" })).toThrow(
      ConfigValidationError,
    );
  });

  it("rejects a credential attempt limit that would disable the throttle", () => {
    expect(() => loadServerConfig({ CREDENTIAL_ATTEMPT_LIMIT: "0" })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadServerConfig({ CREDENTIAL_ATTEMPT_LIMIT: "half" })).toThrow(
      ConfigValidationError,
    );
  });

  it("rejects an unknown environment name", () => {
    expect(() => loadServerConfig({ APP_ENV: "sandbox" })).toThrow(ConfigValidationError);
  });

  it("rejects a port outside the valid range", () => {
    expect(() => loadServerConfig({ PORT: "0" })).toThrow(ConfigValidationError);
    expect(() => loadServerConfig({ PORT: "70000" })).toThrow(ConfigValidationError);
    expect(() => loadServerConfig({ PORT: "not-a-port" })).toThrow(ConfigValidationError);
  });

  it("rejects a relative public web url", () => {
    expect(() => loadServerConfig({ PUBLIC_WEB_URL: "/play" })).toThrow(ConfigValidationError);
  });

  it("rejects an empty origin list", () => {
    expect(() => loadServerConfig({ CORS_ORIGINS: " , " })).toThrow(ConfigValidationError);
  });

  it("names every offending variable", () => {
    try {
      loadServerConfig({ PORT: "-1", LOG_LEVEL: "shout" });
      expect.unreachable("expected a configuration error");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const configError = error as ConfigValidationError;
      expect(configError.issues.map((issue) => issue.variable).sort()).toEqual([
        "LOG_LEVEL",
        "PORT",
      ]);
      expect(configError.message).toContain("PORT");
    }
  });
});
