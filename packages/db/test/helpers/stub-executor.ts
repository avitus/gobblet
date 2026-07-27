import type { DatabaseExecutor } from "../../src/executor";

const CHAIN_STEPS = [
  "values",
  "onConflictDoUpdate",
  "set",
  "where",
  "from",
  "orderBy",
  "limit",
  "returning",
] as const;

/**
 * A driver that answers every statement with no rows at all. Drizzle's executor
 * type is the whole query builder, so the double is assembled untyped and cast
 * once here rather than at each call site.
 */
export function executorAnsweringNothing(): DatabaseExecutor {
  const builder: Record<string, unknown> = {
    then: (resolve: (rows: readonly never[]) => unknown) => resolve([]),
  };
  for (const step of CHAIN_STEPS) {
    builder[step] = () => builder;
  }

  return {
    insert: () => builder,
    update: () => builder,
    select: () => builder,
    execute: () => Promise.resolve({ rows: [] }),
  } as unknown as DatabaseExecutor;
}
