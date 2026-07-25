import { APP_ENVIRONMENTS } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import { appEnvValues } from "../src/index";

/**
 * `@gobblet/protocol` cannot depend on this package (docs/architecture.md section 6),
 * so the environment vocabulary exists twice. This test is the only thing that keeps
 * the two copies identical.
 */
describe("environment vocabulary", () => {
  it("matches the protocol package", () => {
    expect([...appEnvValues]).toEqual([...APP_ENVIRONMENTS]);
  });
});
