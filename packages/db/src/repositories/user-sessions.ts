import { and, eq, isNull } from "drizzle-orm";
import { userSessions } from "../schema";
import type { NewUserSessionRow, UserSessionRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

export async function insertUserSession(
  executor: DatabaseExecutor,
  values: NewUserSessionRow,
): Promise<UserSessionRow> {
  const [row] = await executor.insert(userSessions).values(values).returning();
  if (!row) {
    throw new Error("insertUserSession returned no row");
  }
  return row;
}

/** Only the hash of a session token is stored, as for guest sessions. */
export async function findUserSessionByTokenHash(
  executor: DatabaseExecutor,
  tokenHash: string,
): Promise<UserSessionRow | undefined> {
  const [row] = await executor
    .select()
    .from(userSessions)
    .where(eq(userSessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function touchUserSession(
  executor: DatabaseExecutor,
  sessionId: string,
  seenAt: Date,
): Promise<void> {
  await executor
    .update(userSessions)
    .set({ lastSeenAt: seenAt })
    .where(eq(userSessions.id, sessionId));
}

export async function revokeUserSession(
  executor: DatabaseExecutor,
  sessionId: string,
  revokedAt: Date,
): Promise<void> {
  await executor
    .update(userSessions)
    .set({ revokedAt })
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
}

/**
 * Revokes every live session of one account. Suspension and password change both
 * need this: an account that can no longer play must not keep a usable token.
 */
export async function revokeUserSessions(
  executor: DatabaseExecutor,
  userId: string,
  revokedAt: Date,
): Promise<number> {
  const rows = await executor
    .update(userSessions)
    .set({ revokedAt })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length;
}
