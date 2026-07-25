import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Every bearer secret this project issues, session or email verification, is an
 * opaque random token stored only as a hash
 * (docs/adr/0017-first-party-email-password-authentication.md). The plaintext
 * exists once, in the response that created it.
 */
export const TOKEN_BYTES = 32;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export type IssuedToken = Readonly<{
  /** Returned to the client once and never stored. */
  token: string;
  /** The only form that reaches the database. */
  tokenHash: string;
}>;

export function issueToken(byteLength: number = TOKEN_BYTES): IssuedToken {
  const token = randomBytes(byteLength).toString("base64url");
  return Object.freeze({ token, tokenHash: hashToken(token) });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compares two token hashes without leaking their difference through timing.
 * Lookups happen by hash, so this covers the paths that compare a candidate
 * against a value already in memory.
 */
export function tokenHashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function expiresAt(now: number, ttlMs: number): Date {
  return new Date(now + ttlMs);
}

export type ExpirableToken = Readonly<{
  expiresAt: Date;
  revokedAt?: Date | null;
  consumedAt?: Date | null;
}>;

/** A token is usable while it is neither expired, revoked nor already consumed. */
export function isTokenUsable(token: ExpirableToken, now: number): boolean {
  return (
    (token.revokedAt ?? null) === null &&
    (token.consumedAt ?? null) === null &&
    token.expiresAt.getTime() > now
  );
}
