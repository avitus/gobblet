import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  TOKEN_BYTES,
  expiresAt,
  hashToken,
  isTokenUsable,
  issueToken,
  tokenHashesMatch,
} from "../src/index";

describe("issueToken", () => {
  it("returns a url-safe secret and its hash", () => {
    const issued = issueToken();

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(issued.token, "base64url")).toHaveLength(TOKEN_BYTES);
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.tokenHash).toBe(hashToken(issued.token));
    expect(Object.isFrozen(issued)).toBe(true);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueToken().token));

    expect(tokens.size).toBe(200);
  });

  it("accepts a different length for shorter lived secrets", () => {
    expect(Buffer.from(issueToken(16).token, "base64url")).toHaveLength(16);
  });
});

describe("hashToken", () => {
  it("is stable, so a lookup by hash finds the row", () => {
    expect(hashToken("session-token-placeholder")).toBe(hashToken("session-token-placeholder"));
  });

  it("differs for a different token", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("tokenHashesMatch", () => {
  it("matches identical hashes", () => {
    const hash = hashToken("session-token-placeholder");

    expect(tokenHashesMatch(hash, hash)).toBe(true);
  });

  it("rejects different hashes and different lengths", () => {
    expect(tokenHashesMatch(hashToken("a"), hashToken("b"))).toBe(false);
    expect(tokenHashesMatch(hashToken("a"), "short")).toBe(false);
  });
});

describe("expiresAt", () => {
  it("adds the lifetime to the given instant", () => {
    const now = Date.UTC(2026, 6, 25, 12, 0, 0);

    expect(expiresAt(now, 30 * DAY_MS).toISOString()).toBe("2026-08-24T12:00:00.000Z");
    expect(expiresAt(now, 2 * HOUR_MS).toISOString()).toBe("2026-07-25T14:00:00.000Z");
  });
});

describe("isTokenUsable", () => {
  const now = Date.UTC(2026, 6, 25, 12, 0, 0);

  it("accepts a token that is live", () => {
    expect(isTokenUsable({ expiresAt: new Date(now + 1) }, now)).toBe(true);
  });

  it("rejects a token at or past its expiry", () => {
    expect(isTokenUsable({ expiresAt: new Date(now) }, now)).toBe(false);
    expect(isTokenUsable({ expiresAt: new Date(now - 1) }, now)).toBe(false);
  });

  it("rejects a revoked token", () => {
    expect(
      isTokenUsable({ expiresAt: new Date(now + DAY_MS), revokedAt: new Date(now - 1) }, now),
    ).toBe(false);
  });

  it("rejects a token that was already consumed", () => {
    expect(
      isTokenUsable({ expiresAt: new Date(now + DAY_MS), consumedAt: new Date(now - 1) }, now),
    ).toBe(false);
  });

  it("treats explicit nulls as never revoked or consumed", () => {
    expect(
      isTokenUsable({ expiresAt: new Date(now + DAY_MS), revokedAt: null, consumedAt: null }, now),
    ).toBe(true);
  });
});
