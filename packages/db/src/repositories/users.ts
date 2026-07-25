import { eq, sql } from "drizzle-orm";
import { profiles, users } from "../schema";
import type { NewProfileRow, NewUserRow, ProfileRow, UserRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * A unique violation is how a duplicate email or username is detected: the
 * database decides, so two concurrent registrations cannot both win (Phase 3
 * exit criterion "duplicate username races are handled transactionally").
 */
export const USERS_EMAIL_CONSTRAINT = "users_email_key";
export const USERS_USERNAME_CONSTRAINT = "users_username_normalized_key";

export type UniqueUserField = "email" | "username";

/** Postgres reports a unique violation as SQLSTATE 23505. */
const UNIQUE_VIOLATION = "23505";

/**
 * Names the field a unique violation was about, or null when the error is
 * something else and must keep propagating.
 */
export function uniqueUserConflict(error: unknown): UniqueUserField | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) {
    return candidate.cause === undefined ? null : uniqueUserConflict(candidate.cause);
  }
  if (candidate.constraint === USERS_EMAIL_CONSTRAINT) {
    return "email";
  }
  if (candidate.constraint === USERS_USERNAME_CONSTRAINT) {
    return "username";
  }
  return null;
}

export async function insertUser(executor: DatabaseExecutor, values: NewUserRow): Promise<UserRow> {
  const [row] = await executor.insert(users).values(values).returning();
  if (!row) {
    throw new Error("insertUser returned no row");
  }
  return row;
}

export async function findUserById(
  executor: DatabaseExecutor,
  userId: string,
): Promise<UserRow | undefined> {
  const [row] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
  return row;
}

export async function findUserByEmail(
  executor: DatabaseExecutor,
  email: string,
): Promise<UserRow | undefined> {
  const [row] = await executor.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

/** Takes the normalised form, which is the column the unique index covers. */
export async function findUserByUsername(
  executor: DatabaseExecutor,
  usernameNormalized: string,
): Promise<UserRow | undefined> {
  const [row] = await executor
    .select()
    .from(users)
    .where(eq(users.usernameNormalized, usernameNormalized))
    .limit(1);
  return row;
}

export async function markEmailVerified(
  executor: DatabaseExecutor,
  userId: string,
  verifiedAt: Date,
): Promise<void> {
  await executor
    .update(users)
    .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
    .where(eq(users.id, userId));
}

export async function touchUser(
  executor: DatabaseExecutor,
  userId: string,
  seenAt: Date,
): Promise<void> {
  await executor.update(users).set({ lastSeenAt: seenAt }).where(eq(users.id, userId));
}

export type SuspensionPatch = Readonly<{
  status: UserRow["status"];
  suspendedAt: Date | null;
  suspendedReason: string | null;
}>;

export async function setUserSuspension(
  executor: DatabaseExecutor,
  userId: string,
  patch: SuspensionPatch,
): Promise<UserRow> {
  const [row] = await executor
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) {
    throw new Error(`setUserSuspension found no user ${userId}`);
  }
  return row;
}

export async function insertProfile(
  executor: DatabaseExecutor,
  values: NewProfileRow,
): Promise<ProfileRow> {
  const [row] = await executor.insert(profiles).values(values).returning();
  if (!row) {
    throw new Error("insertProfile returned no row");
  }
  return row;
}

export async function findProfileByUserId(
  executor: DatabaseExecutor,
  userId: string,
): Promise<ProfileRow | undefined> {
  const [row] = await executor.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row;
}

/**
 * Only the fields present are written: an absent key is left alone, which is what
 * lets one endpoint serve a partial update.
 */
export type ProfilePatch = Readonly<{
  avatarUrl?: string | null | undefined;
  countryCode?: string | null | undefined;
  presetMessagesMuted?: boolean | undefined;
  reactionsMuted?: boolean | undefined;
  gameSoundMuted?: boolean | undefined;
  reducedMotion?: boolean | undefined;
}>;

export async function updateProfile(
  executor: DatabaseExecutor,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileRow> {
  const [row] = await executor
    .update(profiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(profiles.userId, userId))
    .returning();
  if (!row) {
    throw new Error(`updateProfile found no profile for user ${userId}`);
  }
  return row;
}

export type CasualRecordRow = Readonly<{
  wins: number;
  losses: number;
  draws: number;
  played: number;
}>;

/**
 * Counts finished casual matches from the match rows themselves. Derivation
 * keeps one source of truth; materialised counters arrive with ratings in
 * Phase 5, where an aggregate per rated game is unavoidable.
 */
export async function countCasualResults(
  executor: DatabaseExecutor,
  userId: string,
): Promise<CasualRecordRow> {
  const result = await executor.execute(sql`
    with participation as (
      select
        case
          when m.light_player_type = 'user' and m.light_player_id = ${userId} then 'light'
          else 'dark'
        end as side,
        m.result::text as result
      from matches m
      where m.mode = 'casual'
        and m.status = 'completed'
        and (
          (m.light_player_type = 'user' and m.light_player_id = ${userId})
          or (m.dark_player_type = 'user' and m.dark_player_id = ${userId})
        )
    )
    select
      count(*) filter (where result = side) as wins,
      count(*) filter (where result is not null and result <> 'draw' and result <> side) as losses,
      count(*) filter (where result = 'draw') as draws,
      count(*) as played
    from participation
  `);

  const [row] = result.rows as readonly Readonly<Record<string, string>>[];
  return {
    wins: Number(row?.wins ?? 0),
    losses: Number(row?.losses ?? 0),
    draws: Number(row?.draws ?? 0),
    played: Number(row?.played ?? 0),
  };
}
