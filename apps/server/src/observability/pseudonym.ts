import { createHmac } from "node:crypto";

/**
 * One keyed pseudonym for logs and analytics, so a log line and an event can be
 * correlated without either naming an account (spec section 17.2, appendix P7.12).
 * Rotating the key detaches new records from old ones, which is the point of a
 * pseudonym rather than a defect.
 */
export type Pseudonymiser = (actorType: string, actorId: string) => string;

const PSEUDONYM_LENGTH = 16;

/**
 * Without a key nothing is pseudonymised, because a hash anyone can recompute is
 * not one. `null` is what every field then carries, which the callers already allow
 * for an anonymous request.
 */
export function createPseudonymiser(secret: string | null): Pseudonymiser | null {
  if (secret === null) {
    return null;
  }
  return (actorType, actorId) =>
    createHmac("sha256", secret)
      .update(`${actorType}:${actorId}`)
      .digest("hex")
      .slice(0, PSEUDONYM_LENGTH);
}
