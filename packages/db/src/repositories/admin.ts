import { sql } from "drizzle-orm";
import type { MatchRow, UserRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * The reads behind the dashboard of section 16. They are ordinary SQL over the
 * product tables rather than a read of the metrics registry, so a deployment does
 * not reset what an administrator sees
 * (docs/adr/0031-metrics-are-a-prometheus-exposition.md).
 */

export type AdminUserRow = Readonly<{
  userId: string;
  username: string;
  status: UserRow["status"];
  role: UserRow["role"];
  emailVerified: boolean;
  rating: number | null;
  createdAt: Date;
  lastSeenAt: Date;
}>;

/** The composite key a page of accounts ends on: most recently seen first. */
export type AdminUserCursorRow = Readonly<{ lastSeenAt: Date; userId: string }>;

export type AdminUserSearchOptions = Readonly<{
  /**
   * A username prefix, an internal id, or an email address in full. A partial
   * address matches nothing, so the surface cannot enumerate addresses (P7.2).
   */
  query?: string | undefined;
  status?: UserRow["status"] | undefined;
  limit: number;
  cursor?: AdminUserCursorRow | null | undefined;
}>;

type RawUserRow = Readonly<{
  user_id: string;
  username: string;
  status: UserRow["status"];
  role: UserRow["role"];
  email_verified: boolean;
  rating: number | null;
  created_at: string;
  last_seen_at: string;
}>;

/** A search term is data, so its wildcards are literal characters. */
function likePrefix(term: string): string {
  return `${term.replace(/([\\%_])/gu, "\\$1")}%`;
}

export async function searchUsers(
  executor: DatabaseExecutor,
  options: AdminUserSearchOptions,
): Promise<AdminUserRow[]> {
  const term = options.query?.trim() ?? "";
  const prefix = term.toLowerCase();
  const result = await executor.execute<RawUserRow>(sql`
    select
      u.id as user_id,
      u.username,
      u.status::text as status,
      u.role::text as role,
      u.email_verified_at is not null as email_verified,
      r.rating,
      u.created_at,
      u.last_seen_at
    from users u
    left join ratings r on r.user_id = u.id
    where (
        ${term} = ''
        or u.username_normalized like ${likePrefix(prefix)}
        or lower(u.email) = ${prefix}
        or u.id::text = ${prefix}
      )
      and (${options.status ?? null}::text is null or u.status::text = ${options.status ?? null})
      and (
        ${options.cursor?.lastSeenAt ?? null}::timestamptz is null
        or (u.last_seen_at, u.id) < (
          ${options.cursor?.lastSeenAt ?? null}::timestamptz,
          ${options.cursor?.userId ?? null}::uuid
        )
      )
    order by u.last_seen_at desc, u.id desc
    limit ${options.limit}
  `);

  return result.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    status: row.status,
    role: row.role,
    emailVerified: row.email_verified,
    rating: row.rating === null ? null : Number(row.rating),
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
  }));
}

/** How many sessions an account can still use, which the detail page reports. */
export async function countActiveSessions(
  executor: DatabaseExecutor,
  userId: string,
  now: Date,
): Promise<number> {
  const result = await executor.execute<{ count: string }>(sql`
    select count(*)::text as count
    from user_sessions
    where user_id = ${userId}
      and revoked_at is null
      and expires_at > ${now}
  `);
  return Number(result.rows[0]?.count ?? 0);
}

export type ActivitySummaryRow = Readonly<{
  accounts: number;
  guests: number;
}>;

/**
 * Accounts and guest sessions last seen inside the window, counted separately
 * because a guest is an active user without an account (appendix P7.8).
 */
export async function countActiveActors(
  executor: DatabaseExecutor,
  since: Date,
): Promise<ActivitySummaryRow> {
  const result = await executor.execute<{ accounts: string; guests: string }>(sql`
    select
      (select count(*)::text from users where last_seen_at >= ${since}) as accounts,
      (select count(*)::text from guest_sessions where last_seen_at >= ${since}) as guests
  `);
  const row = result.rows[0];
  return { accounts: Number(row?.accounts ?? 0), guests: Number(row?.guests ?? 0) };
}

export type MatchOutcomeSummaryRow = Readonly<{
  active: number;
  completed: number;
  aborted: number;
  /** Grouped in the enum's own order, which is the order section 7 lists endings in. */
  byEndReason: readonly Readonly<{ reason: NonNullable<MatchRow["endReason"]>; count: number }>[];
}>;

/**
 * Matches in flight now, and matches that finished inside the window by how they
 * finished. A match still being played counts in neither rate (appendix P7.9).
 */
export async function summariseMatches(
  executor: DatabaseExecutor,
  since: Date,
): Promise<MatchOutcomeSummaryRow> {
  const totals = await executor.execute<{ active: string; completed: string; aborted: string }>(sql`
    select
      count(*) filter (where status = 'active')::text as active,
      count(*) filter (where status = 'completed' and ended_at >= ${since})::text as completed,
      count(*) filter (where status = 'aborted' and ended_at >= ${since})::text as aborted
    from matches
  `);
  const reasons = await executor.execute<{
    reason: NonNullable<MatchRow["endReason"]>;
    count: string;
  }>(sql`
    select end_reason::text as reason, count(*)::text as count
    from matches
    where end_reason is not null and ended_at >= ${since}
    group by end_reason
    order by end_reason
  `);

  const row = totals.rows[0];
  return {
    active: Number(row?.active ?? 0),
    completed: Number(row?.completed ?? 0),
    aborted: Number(row?.aborted ?? 0),
    byEndReason: reasons.rows.map((reason) => ({
      reason: reason.reason,
      count: Number(reason.count),
    })),
  };
}

export type PairingSummaryRow = Readonly<{
  pairings: number;
  /** `null` when nothing was paired in the window, rather than a misleading zero. */
  averageWaitMs: number | null;
}>;

/**
 * Pairings made inside the window and how long they waited, read from the column the
 * queue writes as it seats a match, so the figure survives a deployment.
 */
export async function summarisePairings(
  executor: DatabaseExecutor,
  since: Date,
): Promise<PairingSummaryRow> {
  const result = await executor.execute<{ pairings: string; average: string | null }>(sql`
    select
      count(*)::text as pairings,
      avg(pairing_wait_ms)::text as average
    from matches
    where pairing_wait_ms is not null and created_at >= ${since}
  `);
  const row = result.rows[0];
  const average = row?.average ?? null;
  return {
    pairings: Number(row?.pairings ?? 0),
    averageWaitMs: average === null ? null : Math.round(Number(average)),
  };
}
