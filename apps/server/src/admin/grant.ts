import { findUserByUsername } from "@gobblet/db";
import type { Database, UserRow } from "@gobblet/db";
import { insertAuditRecord, setUserRole } from "@gobblet/db";
import { normalizeUsername } from "@gobblet/protocol";

/**
 * Granting the role from the console, which is how the first administrator exists
 * at all: nothing in the product can grant it before one holds it (appendix P7.18).
 * The change is audited like any other, with no administrator named as the actor,
 * because the actor was a shell with the database credentials.
 */
export type GrantOutcome =
  | Readonly<{ ok: true; userId: string; username: string; role: UserRow["role"] }>
  | Readonly<{ ok: false; reason: "unknown-user" | "already-held" }>;

export async function grantRoleByUsername(
  db: Database,
  input: Readonly<{
    username: string;
    role: UserRow["role"];
    reason: string;
    now: () => number;
  }>,
): Promise<GrantOutcome> {
  const user = await findUserByUsername(db, normalizeUsername(input.username));
  if (!user) {
    return { ok: false, reason: "unknown-user" };
  }
  if (user.role === input.role) {
    return { ok: false, reason: "already-held" };
  }

  const updated = await db.transaction(async (tx) => {
    const written = await setUserRole(tx, user.id, input.role);
    await insertAuditRecord(tx, {
      adminUserId: null,
      action: "role-granted",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.username,
      before: { role: user.role },
      after: { role: input.role },
      reason: input.reason,
      createdAt: new Date(input.now()),
    });
    return written;
  });

  return { ok: true, userId: updated.id, username: updated.username, role: updated.role };
}
