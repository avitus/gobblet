import type { Database } from "./client";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Repository functions accept either the pool-backed database or an open transaction. */
export type DatabaseExecutor = Database | Transaction;
