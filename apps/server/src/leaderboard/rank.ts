import { readLeaderboardPage } from "@gobblet/db";
import type { DatabaseExecutor } from "@gobblet/db";

/**
 * The account's position on the all-time board, which is the rank a profile shows
 * (appendix P6.13). It asks for no page, so the statement answers with the one row
 * it was asked about, ranked by the same definition the board itself uses.
 */
export async function readAllTimeRank(
  executor: DatabaseExecutor,
  userId: string,
): Promise<number | null> {
  const page = await readLeaderboardPage(executor, {
    window: null,
    limit: 0,
    viewerUserId: userId,
  });
  return page.viewer?.rank ?? null;
}
