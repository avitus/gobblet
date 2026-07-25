/**
 * Normalisation and validation for the two identifiers an account owns: the
 * email address it signs in with, and the immutable public username
 * (docs/product-spec.md section 2.3).
 */

export const EMAIL_MAX_LENGTH = 254;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * Usernames are ASCII only. They are public, immutable and used to recognise an
 * opponent, so mixed-script lookalikes would be an impersonation tool rather
 * than an inclusivity feature. Display names elsewhere are unrestricted.
 */
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Names that must not become a player identity because they read as authority
 * or as a system surface.
 */
export const RESERVED_USERNAMES: readonly string[] = Object.freeze([
  "admin",
  "administrator",
  "api",
  "gobblet",
  "guest",
  "help",
  "me",
  "mod",
  "moderator",
  "official",
  "owner",
  "root",
  "staff",
  "support",
  "system",
  "unknown",
]);

export type EmailFailure = "empty" | "too-long" | "malformed";

export type UsernameFailure =
  "empty" | "too-short" | "too-long" | "invalid-characters" | "must-start-with-letter" | "reserved";

/**
 * Lowercases the whole address. Local parts are case sensitive in the standard
 * and case insensitive at every provider players actually use, so one canonical
 * form prevents two accounts that differ only by capitalisation.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().normalize("NFKC").toLowerCase();
}

export function checkEmail(raw: string): EmailFailure | null {
  const email = normalizeEmail(raw);
  if (email.length === 0) {
    return "empty";
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return "too-long";
  }
  if (!EMAIL_PATTERN.test(email)) {
    return "malformed";
  }
  return null;
}

/** The form uniqueness is enforced on, so `Ada` and `ada` are one username. */
export function normalizeUsername(raw: string): string {
  return raw.trim().normalize("NFKC").toLowerCase();
}

export function checkUsername(raw: string): UsernameFailure | null {
  const trimmed = raw.trim().normalize("NFKC");
  if (trimmed.length === 0) {
    return "empty";
  }
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return "too-short";
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return "too-long";
  }
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return "invalid-characters";
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "must-start-with-letter";
  }
  if (RESERVED_USERNAMES.includes(normalizeUsername(trimmed))) {
    return "reserved";
  }
  return null;
}

/** The display form of a username: trimmed, with the capitalisation the player chose. */
export function canonicalUsername(raw: string): string {
  return raw.trim().normalize("NFKC");
}
