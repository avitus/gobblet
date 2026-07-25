import { describe, expect, it } from "vitest";
import { sessionAuthenticateSchema, sessionReadySchema } from "../src/index";
import { LIGHT_ACTOR_ID } from "./helpers/fixtures";

describe("sessionAuthenticateSchema", () => {
  it("accepts a guest handshake without a session token", () => {
    const handshake = { clientVersion: "0.1.0", appEnv: "local" };

    expect(sessionAuthenticateSchema.parse(handshake)).toEqual(handshake);
  });

  it("accepts a handshake that resumes a session", () => {
    const handshake = {
      clientVersion: "0.1.0",
      appEnv: "production",
      sessionToken: "session-token-placeholder",
    };

    expect(sessionAuthenticateSchema.parse(handshake)).toEqual(handshake);
  });

  it("rejects an unknown environment, an empty client version and unknown fields", () => {
    expect(
      sessionAuthenticateSchema.safeParse({ clientVersion: "0.1.0", appEnv: "sandbox" }).success,
    ).toBe(false);
    expect(
      sessionAuthenticateSchema.safeParse({ clientVersion: "", appEnv: "local" }).success,
    ).toBe(false);
    expect(
      sessionAuthenticateSchema.safeParse({ clientVersion: "0.1.0", appEnv: "local", locale: "en" })
        .success,
    ).toBe(false);
  });
});

describe("sessionReadySchema", () => {
  it("accepts a ready session", () => {
    const ready = {
      actorId: LIGHT_ACTOR_ID,
      actorType: "user",
      displayName: "ada",
      isGuest: false,
      serverTime: 1753392003250,
      features: ["ranked", "rematch"],
    };

    expect(sessionReadySchema.parse(ready)).toEqual(ready);
    expect(sessionReadySchema.parse({ ...ready, features: [] }).features).toEqual([]);
    expect(sessionReadySchema.safeParse({ ...ready, actorType: "bot" }).success).toBe(false);
    expect(sessionReadySchema.safeParse({ ...ready, serverTime: 0 }).success).toBe(false);
  });
});
