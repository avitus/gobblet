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
    });

    expect(config.nodeEnv).toBe("production");
    expect(config.appEnv).toBe("staging");
    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual(["https://play.example.com", "tauri://localhost"]);
    expect(config.databaseUrl).toBe("postgresql://db.internal.example.com:5432/gobblet");
    expect(config.databasePoolMax).toBe(25);
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
