import { listAchievementProgress } from "@gobblet/db";
import type { AchievementProgressRow, DatabaseExecutor } from "@gobblet/db";
import { achievementByCode, isAchievementCode } from "@gobblet/protocol";
import type { AchievementProgress, ProfileBadge } from "@gobblet/protocol";

/**
 * The whole catalogue with the account's progress against it (spec section 11.4).
 * Names and badge tiers come from the protocol catalogue rather than from the row,
 * so the wire always describes an achievement the client knows; a stored code the
 * protocol does not name is withheld until the client that renders it ships.
 */
export async function readAchievementProgress(
  executor: DatabaseExecutor,
  userId: string,
): Promise<AchievementProgress[]> {
  const rows = await listAchievementProgress(executor, userId);
  return rows.flatMap((row) => (isAchievementCode(row.code) ? [toProgress(row, row.code)] : []));
}

/** Only what has been earned, which is all a public profile shows (spec section 11.1). */
export async function readProfileBadges(
  executor: DatabaseExecutor,
  userId: string,
): Promise<ProfileBadge[]> {
  const progress = await readAchievementProgress(executor, userId);
  return progress.flatMap((entry) =>
    entry.earnedAt === null
      ? []
      : [{ code: entry.code, name: entry.name, badge: entry.badge, earnedAt: entry.earnedAt }],
  );
}

function toProgress(
  row: AchievementProgressRow,
  code: AchievementProgress["code"],
): AchievementProgress {
  const catalogue = achievementByCode(code);
  return {
    code,
    name: catalogue.name,
    description: catalogue.description,
    badge: catalogue.badge,
    ruleVersion: row.ruleVersion,
    earnedAt: row.earnedAt?.toISOString() ?? null,
    matchId: row.sourceMatchId,
  };
}
