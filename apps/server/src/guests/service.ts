import { createHash, randomBytes, randomInt } from "node:crypto";
import { findGuestSessionByTokenHash, insertGuestSession, touchGuestSession } from "@gobblet/db";
import type { Database } from "@gobblet/db";
import type { CreateGuestResponse } from "@gobblet/protocol";

/**
 * Guest sessions are the Phase 2 identity: no accounts exist yet, so a bearer
 * token issued here is what proves an actor may act in a match. Only the SHA-256
 * hash of the token is stored (spec section 15.3).
 */
export const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;

export type GuestIdentity = Readonly<{
  guestId: string;
  displayName: string;
  expiresAt: Date;
}>;

export type GuestServiceOptions = Readonly<{
  db: Database;
  now?: () => number;
}>;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateGuestDisplayName(): string {
  return `guest-${randomInt(0x1000, 0x10000).toString(16)}`;
}

export class GuestService {
  private readonly db: Database;

  private readonly clock: () => number;

  constructor(options: GuestServiceOptions) {
    this.db = options.db;
    this.clock = options.now ?? ((): number => Date.now());
  }

  async createGuest(displayName?: string): Promise<CreateGuestResponse> {
    const now = this.clock();
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(now + GUEST_SESSION_TTL_MS);

    const row = await insertGuestSession(this.db, {
      tokenHash: hashSessionToken(token),
      displayName: displayName ?? generateGuestDisplayName(),
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt,
    });

    return {
      guestId: row.id,
      displayName: row.displayName,
      sessionToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Resolves a bearer token to an identity, refusing expired sessions. */
  async authenticate(token: string): Promise<GuestIdentity | null> {
    const row = await findGuestSessionByTokenHash(this.db, hashSessionToken(token));
    if (!row) {
      return null;
    }

    const now = this.clock();
    if (row.expiresAt.getTime() <= now) {
      return null;
    }

    await touchGuestSession(this.db, row.id, new Date(now));
    return { guestId: row.id, displayName: row.displayName, expiresAt: row.expiresAt };
  }
}
