import { and, eq, isNull } from "drizzle-orm";
import { guestSessions } from "../schema";
import type { GuestSessionRow, NewGuestSessionRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

export async function insertGuestSession(
  executor: DatabaseExecutor,
  values: NewGuestSessionRow,
): Promise<GuestSessionRow> {
  const [row] = await executor.insert(guestSessions).values(values).returning();
  if (!row) {
    throw new Error("insertGuestSession returned no row");
  }
  return row;
}

/** Only the hash of a guest claim token is stored (spec section 15.3). */
export async function findGuestSessionByTokenHash(
  executor: DatabaseExecutor,
  tokenHash: string,
): Promise<GuestSessionRow | undefined> {
  const [row] = await executor
    .select()
    .from(guestSessions)
    .where(eq(guestSessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function findGuestSessionById(
  executor: DatabaseExecutor,
  guestId: string,
): Promise<GuestSessionRow | undefined> {
  const [row] = await executor
    .select()
    .from(guestSessions)
    .where(eq(guestSessions.id, guestId))
    .limit(1);
  return row;
}

export async function touchGuestSession(
  executor: DatabaseExecutor,
  guestId: string,
  seenAt: Date,
): Promise<void> {
  await executor
    .update(guestSessions)
    .set({ lastSeenAt: seenAt })
    .where(eq(guestSessions.id, guestId));
}

/**
 * Attaches a guest session to the account that claimed it, and returns the row
 * only to the call that did it. A second claim of the same guest session must not
 * move history twice (docs/product-spec.md section 2.3).
 */
export async function claimGuestSession(
  executor: DatabaseExecutor,
  guestId: string,
  userId: string,
  claimedAt: Date,
): Promise<GuestSessionRow | undefined> {
  const [row] = await executor
    .update(guestSessions)
    .set({ claimedByUserId: userId, claimedAt })
    .where(and(eq(guestSessions.id, guestId), isNull(guestSessions.claimedByUserId)))
    .returning();
  return row;
}
