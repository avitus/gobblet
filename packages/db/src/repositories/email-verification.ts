import { and, eq, isNull } from "drizzle-orm";
import { emailVerificationTokens } from "../schema";
import type { EmailVerificationTokenRow, NewEmailVerificationTokenRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

export async function insertEmailVerificationToken(
  executor: DatabaseExecutor,
  values: NewEmailVerificationTokenRow,
): Promise<EmailVerificationTokenRow> {
  const [row] = await executor.insert(emailVerificationTokens).values(values).returning();
  if (!row) {
    throw new Error("insertEmailVerificationToken returned no row");
  }
  return row;
}

export async function findEmailVerificationToken(
  executor: DatabaseExecutor,
  tokenHash: string,
): Promise<EmailVerificationTokenRow | undefined> {
  const [row] = await executor
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/**
 * Marks a token used, and reports whether this call was the one that used it. A
 * verification link that is opened twice must only count once.
 */
export async function consumeEmailVerificationToken(
  executor: DatabaseExecutor,
  tokenId: string,
  consumedAt: Date,
): Promise<boolean> {
  const rows = await executor
    .update(emailVerificationTokens)
    .set({ consumedAt })
    .where(and(eq(emailVerificationTokens.id, tokenId), isNull(emailVerificationTokens.consumedAt)))
    .returning({ id: emailVerificationTokens.id });
  return rows.length === 1;
}
