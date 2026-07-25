import { randomInt } from "node:crypto";
import { DAY_MS, expiresAt, hashToken, issueToken } from "@gobblet/auth";
import type { ServerConfig } from "@gobblet/config";
import { findGuestSessionByTokenHash, insertGuestSession, touchGuestSession } from "@gobblet/db";
import type { Database } from "@gobblet/db";
import type { CreateGuestResponse } from "@gobblet/protocol";

/**
 * A guest session is an identity without an account: the bearer token issued here
 * proves an actor may act in a match. Only the SHA-256 hash of the token is
 * stored (spec section 15.3), the same way account sessions are stored.
 */

export type GuestIdentity = Readonly<{
  guestId: string;
  displayName: string;
  expiresAt: Date;
}>;

export type GuestServiceOptions = Readonly<{
  db: Database;
  config: ServerConfig;
  now?: () => number;
}>;

export function generateGuestDisplayName(): string {
  return `guest-${randomInt(0x1000, 0x10000).toString(16)}`;
}

export class GuestService {
  private readonly db: Database;

  private readonly ttlMs: number;

  private readonly clock: () => number;

  constructor(options: GuestServiceOptions) {
    this.db = options.db;
    this.ttlMs = options.config.guestSessionTtlDays * DAY_MS;
    this.clock = options.now ?? ((): number => Date.now());
  }

  async createGuest(displayName?: string): Promise<CreateGuestResponse> {
    const now = this.clock();
    const issued = issueToken();
    const expires = expiresAt(now, this.ttlMs);

    const row = await insertGuestSession(this.db, {
      tokenHash: issued.tokenHash,
      displayName: displayName ?? generateGuestDisplayName(),
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: expires,
    });

    return {
      guestId: row.id,
      displayName: row.displayName,
      sessionToken: issued.token,
      expiresAt: expires.toISOString(),
    };
  }

  /** Resolves a bearer token to an identity, refusing expired sessions. */
  async authenticate(token: string): Promise<GuestIdentity | null> {
    const row = await findGuestSessionByTokenHash(this.db, hashToken(token));
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
