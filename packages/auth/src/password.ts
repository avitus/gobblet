import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { BinaryLike, ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password storage owned by this project, decided in
 * docs/adr/0017-first-party-email-password-authentication.md. The cost is stored
 * with every hash, so it can be raised later without invalidating old records.
 * What counts as an acceptable password is a wire rule and lives in
 * `@gobblet/protocol`, which the browser can also load.
 */
export const PASSWORD_HASH_ALGORITHM = "scrypt";

export type ScryptCost = Readonly<{
  /** CPU and memory cost. 2^15 with r=8 needs about 32 MiB per hash. */
  N: number;
  r: number;
  p: number;
  keyLength: number;
  saltLength: number;
}>;

export const DEFAULT_SCRYPT_COST: ScryptCost = Object.freeze({
  N: 32_768,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
});

/**
 * Floor for a stored hash. A shorter value is either a truncated record or a
 * weakened one, and either way it must not verify.
 */
export const PASSWORD_MIN_KEY_LENGTH = 32;
const MIN_SALT_LENGTH = 8;

/** Ceiling on the cost read back from storage, so a tampered row cannot exhaust memory. */
const MAX_STORED_N = 2 ** 22;
const MAX_STORED_R = 32;
const MAX_STORED_P = 16;

const scryptAsync = promisify<BinaryLike, BinaryLike, number, ScryptOptions, Buffer>(scrypt);

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return scryptAsync(
    // Two spellings of the same character must be the same password.
    password.normalize("NFKC"),
    salt,
    cost.keyLength,
    // scrypt needs headroom above N*r*128 bytes or it refuses to run.
    { N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * cost.N * cost.r },
  );
}

/** Returns `scrypt$N$r$p$salt$hash`, all parameters included so it is self-describing. */
export async function hashPassword(
  password: string,
  cost: ScryptCost = DEFAULT_SCRYPT_COST,
): Promise<string> {
  const salt = randomBytes(cost.saltLength);
  const derived = await derive(password, salt, cost);
  return [
    PASSWORD_HASH_ALGORITHM,
    cost.N,
    cost.r,
    cost.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

type ParsedHash = Readonly<{
  cost: ScryptCost;
  salt: Buffer;
  hash: Buffer;
}>;

type StoredFields = readonly [string, string, string, string, string, string];

/** Recognises `scrypt$N$r$p$salt$hash`, the only format this project writes. */
function isStoredHash(parts: readonly string[]): parts is StoredFields {
  return parts.length === 6 && parts[0] === PASSWORD_HASH_ALGORITHM;
}

function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (!isStoredHash(parts)) {
    return null;
  }

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return null;
  }
  const isPowerOfTwo = N >= 2 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N > MAX_STORED_N) {
    return null;
  }
  if (r < 1 || r > MAX_STORED_R || p < 1 || p > MAX_STORED_P) {
    return null;
  }

  const salt = Buffer.from(rawSalt, "base64url");
  const hash = Buffer.from(rawHash, "base64url");
  if (salt.length < MIN_SALT_LENGTH || hash.length < PASSWORD_MIN_KEY_LENGTH) {
    return null;
  }

  return {
    cost: { N, r, p, keyLength: hash.length, saltLength: salt.length },
    salt,
    hash,
  };
}

/**
 * Verifies a password against a stored hash. A malformed stored value is a
 * failed verification, never a thrown error, so a corrupt row cannot turn into a
 * 500 that tells an attacker the account exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }

  const derived = await derive(password, parsed.salt, parsed.cost);
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

/** True when a stored hash was produced with a weaker cost than the current default. */
export function needsRehash(stored: string, cost: ScryptCost = DEFAULT_SCRYPT_COST): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return true;
  }
  return (
    parsed.cost.N < cost.N ||
    parsed.cost.r < cost.r ||
    parsed.cost.p < cost.p ||
    parsed.hash.length < cost.keyLength
  );
}
