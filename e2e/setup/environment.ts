/**
 * One description of the environment under test, shared by the Playwright
 * configuration and the database preparation step. Ports differ from the
 * development ones so a running `pnpm dev` never collides with a suite run.
 */

const DEFAULT_TEST_DATABASE_URL = "postgresql://gobblet@localhost:5432/gobblet_test";

export const API_HOST = "127.0.0.1";
export const WEB_HOST = "127.0.0.1";
export const API_PORT = 4100;
export const WEB_PORT = 4173;
export const API_URL = `http://${API_HOST}:${String(API_PORT)}`;
export const WEB_URL = `http://${WEB_HOST}:${String(WEB_PORT)}`;

/**
 * A database of its own, named by the same suffix convention the Vitest suites use
 * (`@gobblet/db/testing`), so a browser run never truncates a unit suite's data.
 */
export const DATABASE_URL = ((): string => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  url.pathname = `${url.pathname}_e2e`;
  return url.toString();
})();

/** The server under test, configured exactly as the production process reads it. */
export const SERVER_ENV: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: "production",
  APP_ENV: "local",
  APP_VERSION: "0.1.0-e2e",
  GIT_SHA: "e2e",
  LOG_LEVEL: "warn",
  HOST: API_HOST,
  PORT: String(API_PORT),
  PUBLIC_WEB_URL: WEB_URL,
  CORS_ORIGINS: `${WEB_URL},http://localhost:${String(WEB_PORT)}`,
  MIN_SUPPORTED_CLIENT_VERSION: "0.1.0",
  DATABASE_URL,
  DATABASE_POOL_MAX: "8",
  // Every player in the suite registers from the loopback address, so the
  // per-address throttle would count them as one determined attacker.
  CREDENTIAL_ATTEMPT_LIMIT: "1000",
});
