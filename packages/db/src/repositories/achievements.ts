import { and, asc, eq, sql } from "drizzle-orm";
import { achievements, userAchievements } from "../schema";
import type { AchievementRow } from "../schema";
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
