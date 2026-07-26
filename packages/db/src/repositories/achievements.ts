import { and, asc, eq, sql } from "drizzle-orm";
import { achievements, userAchievements } from "../schema";
import type { AchievementRow, NewAchievementRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * The catalogue of section 15.7 and the awards it produced. Awarding is idempotent
 * because `(user_id, achievement_id)` is the primary key, so a repeated match
 * completion inserts nothing
 * (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
 */
export type AchievementProgressRow = Readonly<{
  code: string;
  name: string;
  description: string;
  badgeAsset: string;
  ruleVersion: number;
  earnedAt: Date | null;
  sourceMatchId: string | null;
}>;

/** Disabled achievements are withheld, which is what the Phase 7 admin flag controls. */
export async function listEnabledAchievements(
  executor: DatabaseExecutor,
): Promise<AchievementRow[]> {
  return executor
    .select()
    .from(achievements)
    .where(eq(achievements.enabled, true))
    .orderBy(asc(achievements.code));
}

/**
 * Every enabled achievement with the account's progress against it, so an unearned
 * achievement is a null timestamp rather than a missing row.
 */
export async function listAchievementProgress(
  executor: DatabaseExecutor,
  userId: string,
): Promise<AchievementProgressRow[]> {
  return executor
    .select({
      code: achievements.code,
      name: achievements.name,
      description: achievements.description,
      badgeAsset: achievements.badgeAsset,
      ruleVersion: achievements.ruleVersion,
      earnedAt: userAchievements.earnedAt,
      sourceMatchId: userAchievements.sourceMatchId,
    })
    .from(achievements)
    .leftJoin(
      userAchievements,
      and(eq(userAchievements.achievementId, achievements.id), eq(userAchievements.userId, userId)),
    )
    .where(eq(achievements.enabled, true))
    .orderBy(asc(achievements.code));
}

export type AchievementAdminRow = Readonly<{
  achievementId: string;
  code: string;
  name: string;
  description: string;
  badgeAsset: string;
  enabled: boolean;
  ruleVersion: number;
  awarded: number;
  updatedAt: Date;
}>;

/**
 * The whole catalogue with how many accounts hold each badge, which is the list an
 * administrator manages (section 16). Disabled rows are included, because hiding
 * them is the very thing being administered.
 */
export async function listAchievementsForAdmin(
  executor: DatabaseExecutor,
): Promise<AchievementAdminRow[]> {
  const result = await executor.execute<{
    achievement_id: string;
    code: string;
    name: string;
    description: string;
    badge_asset: string;
    enabled: boolean;
    rule_version: number;
    awarded: string;
    updated_at: string;
  }>(sql`
    select
      a.id as achievement_id,
      a.code,
      a.name,
      a.description,
      a.badge_asset,
      a.enabled,
      a.rule_version,
      count(ua.user_id)::text as awarded,
      a.updated_at
    from achievements a
    left join user_achievements ua on ua.achievement_id = a.id
    group by a.id
    order by a.code
  `);

  return result.rows.map((row) => ({
    achievementId: row.achievement_id,
    code: row.code,
    name: row.name,
    description: row.description,
    badgeAsset: row.badge_asset,
    enabled: row.enabled,
    ruleVersion: row.rule_version,
    awarded: Number(row.awarded),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function findAchievementByCode(
  executor: DatabaseExecutor,
  code: string,
): Promise<AchievementRow | undefined> {
  const [row] = await executor
    .select()
    .from(achievements)
    .where(eq(achievements.code, code))
    .limit(1);
  return row;
}

export async function insertAchievement(
  executor: DatabaseExecutor,
  values: NewAchievementRow,
): Promise<AchievementRow> {
  const [row] = await executor.insert(achievements).values(values).returning();
  if (!row) {
    throw new Error("insertAchievement returned no row");
  }
  return row;
}

/** Only the fields present are written, so one endpoint serves a partial edit. */
export type AchievementPatch = Readonly<{
  name?: string | undefined;
  description?: string | undefined;
  badgeAsset?: string | undefined;
  enabled?: boolean | undefined;
}>;

export async function updateAchievement(
  executor: DatabaseExecutor,
  achievementId: string,
  patch: AchievementPatch,
): Promise<AchievementRow> {
  const [row] = await executor
    .update(achievements)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(achievements.id, achievementId))
    .returning();
  if (!row) {
    throw new Error(`updateAchievement found no achievement ${achievementId}`);
  }
  return row;
}

/**
 * Awards the codes an account has just earned and answers with the ones this call
 * actually wrote, so a caller can announce a first award without announcing it
 * twice. Unknown or disabled codes award nothing.
 */
export async function awardAchievements(
  executor: DatabaseExecutor,
  userId: string,
  codes: readonly string[],
  sourceMatchId: string | null,
): Promise<string[]> {
  if (codes.length === 0) {
    return [];
  }
  const codeList = sql.join(
    codes.map((code) => sql`${code}`),
    sql`, `,
  );
  const result = await executor.execute<{ code: string }>(sql`
    with candidates as (
      select id, code
      from achievements
      where enabled and code in (${codeList})
    ),
    awarded as (
      insert into user_achievements (user_id, achievement_id, source_match_id)
      select ${userId}::uuid, candidates.id, ${sourceMatchId}::uuid
      from candidates
      on conflict (user_id, achievement_id) do nothing
      returning achievement_id
    )
    select candidates.code
    from awarded
    join candidates on candidates.id = awarded.achievement_id
    order by candidates.code
  `);

  return result.rows.map((row) => row.code);
}
