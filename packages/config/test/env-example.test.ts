import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "../src/schema";

/**
 * `.env.example` is the only place a newcomer learns what a deployment needs, and it
 * is a file no compiler reads. This test is what keeps it honest against the schema
 * every server process validates at startup.
 */

const EXAMPLE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env.example"),
  "utf8",
);

function namesIn(text: string): string[] {
  return [...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] as string);
}

describe(".env.example", () => {
  it("names every variable the schema knows, set or commented out", () => {
    const documented = new Set(namesIn(EXAMPLE));
    const missing = Object.keys(serverEnvSchema.shape).filter((name) => !documented.has(name));

    expect(missing).toEqual([]);
  });

  it("names nothing the schema would ignore, so no example is quietly dead", () => {
    const known = new Set<string>([
      ...Object.keys(serverEnvSchema.shape),
      // Read by the client build and by docker-compose rather than by the server.
      "VITE_API_BASE_URL",
      "VITE_APP_ENV",
      "POSTGRES_PORT",
      "TEST_DATABASE_URL",
    ]);

    expect(namesIn(EXAMPLE).filter((name) => !known.has(name))).toEqual([]);
  });
});
