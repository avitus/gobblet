import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { auditLog, users } from "../schema";
import type { AuditLogRow, NewAuditLogRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * The audit log of section 14.4. Rows are inserted inside the transaction that makes
 * the change they describe, and nothing here updates or deletes one
 * (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */
export async function insertAuditRecord(
  executor: DatabaseExecutor,
  values: NewAuditLogRow,
): Promise<AuditLogRow> {
  const [row] = await executor.insert(auditLog).values(values).returning();
  if (!row) {
    throw new Error("insertAuditRecord returned no row");
  }
  return row;
}

export type AuditEntryRow = Readonly<{
  id: string;
  adminUserId: string | null;
  adminUsername: string | null;
  action: AuditLogRow["action"];
  targetType: AuditLogRow["targetType"];
  targetId: string;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: Date;
}>;

/** The composite key a page ends on, so a new record cannot shift a boundary. */
export type AuditCursorRow = Readonly<{ createdAt: Date; id: string }>;

export type AuditQueryOptions = Readonly<{
  action?: AuditLogRow["action"] | undefined;
  targetId?: string | undefined;
  limit: number;
  cursor?: AuditCursorRow | null | undefined;
}>;

export async function listAuditRecords(
  executor: DatabaseExecutor,
  options: AuditQueryOptions,
): Promise<AuditEntryRow[]> {
  const filters = [
    options.action === undefined ? undefined : eq(auditLog.action, options.action),
    options.targetId === undefined ? undefined : eq(auditLog.targetId, options.targetId),
    options.cursor
      ? or(
          lt(auditLog.createdAt, options.cursor.createdAt),
          and(eq(auditLog.createdAt, options.cursor.createdAt), lt(auditLog.id, options.cursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined);

  const query = executor
    .select({
      id: auditLog.id,
      adminUserId: auditLog.adminUserId,
      adminUsername: users.username,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      targetLabel: auditLog.targetLabel,
      before: auditLog.before,
      after: auditLog.after,
      reason: auditLog.reason,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.adminUserId));

  return (filters.length > 0 ? query.where(and(...filters)) : query)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(options.limit);
}

/**
 * One account's moderation history, which is the part of the log its own page shows
 * (section 16, "View profile and account status").
 */
export async function listModerationHistory(
  executor: DatabaseExecutor,
  userId: string,
  limit: number,
): Promise<AuditEntryRow[]> {
  return listAuditRecords(executor, { targetId: userId, limit });
}

/** How many audit rows exist, which the exit-criteria test counts. */
export async function countAuditRecords(executor: DatabaseExecutor): Promise<number> {
  const result = await executor.execute<{ count: string }>(
    sql`select count(*)::text as count from audit_log`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
