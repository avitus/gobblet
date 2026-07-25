import { z } from "zod";
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "./constants";

/**
 * The identifiers and secret an account is created with (docs/product-spec.md
 * section 2.3). The rules live here rather than in `@gobblet/auth` because the
 * browser has to apply the same ones to show inline errors, and `@gobblet/auth`
 * depends on `node:crypto`.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Usernames are ASCII only. They are public, immutable and how a player
 * recognises an opponent, so mixed-script lookalikes would be an impersonation
 * tool. Display names, which guests also use, stay unrestricted.
 */
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Trims and lowercases. Local parts are case sensitive in the standard and case
 * insensitive at every provider players use, so one canonical form stops two
 * accounts that differ only by capitalisation.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().normalize("NFKC").toLowerCase();
}

/** The form username uniqueness is enforced on, so `Ada` and `ada` are one name. */
export function normalizeUsername(raw: string): string {
  return raw.trim().normalize("NFKC").toLowerCase();
}

export function isReservedUsername(raw: string): boolean {
  return RESERVED_USERNAMES.includes(normalizeUsername(raw));
}

export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.string().min(3).max(EMAIL_MAX_LENGTH).regex(EMAIL_PATTERN));

/**
 * Length does the work. One character-class requirement stops "aaaaaaaaaa"
 * without pushing players towards predictable substitutions. The value is never
 * trimmed: whitespace inside a password is the player's business.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .regex(/\p{L}/u, { error: "must contain a letter" })
  .regex(/[\p{N}\p{P}\p{S}]/u, { error: "must contain a number or symbol" })
  .refine((value) => value.trim().length > 0, { error: "must not be only whitespace" });

export const usernameSchema = z
  .string()
  .transform((value) => value.trim().normalize("NFKC"))
  .pipe(
    z
      .string()
      .min(USERNAME_MIN_LENGTH)
      .max(USERNAME_MAX_LENGTH)
      .regex(USERNAME_PATTERN, { error: "must start with a letter and use letters, digits or _" })
      .refine((value) => !isReservedUsername(value), { error: "is reserved" }),
  );

/** ISO 3166-1 alpha-2, the input a flag renderer expects. */
export const countryCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .length(2)
      .regex(/^[A-Z]{2}$/),
  );

/**
 * Avatars are referenced by URL because this phase hosts no uploads. `https`
 * only, so a profile cannot downgrade a page to plaintext.
 */
export const avatarUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
    error: "must be an https URL",
  });

export type Email = z.infer<typeof emailSchema>;
export type Username = z.infer<typeof usernameSchema>;
export type CountryCode = z.infer<typeof countryCodeSchema>;
