/**
 * The most recent errors, for the dashboard of section 16. It is a bounded ring in
 * this process: an error is a fact about a request, not product data, so nothing is
 * written to the database and nothing accumulates without limit (appendix P7.7).
 * Messages and stack traces are deliberately absent, because a stack belongs to the
 * error reporter rather than to a screen.
 */
export type RecentError = Readonly<{
  code: string;
  route: string;
  count: number;
  lastSeenAt: Date;
}>;

const DEFAULT_CAPACITY = 20;

export class RecentErrors {
  private readonly capacity: number;

  /** Keyed by code and route, so a repeated failure is one entry with a count. */
  private readonly entries = new Map<
    string,
    { code: string; route: string; count: number; at: number }
  >();

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  record(code: string, route: string, at: number): void {
    const key = `${code}\u0000${route}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.at = at;
      // Reinsertion moves it to the end, which is the recency order the map keeps.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return;
    }

    this.entries.set(key, { code, route, count: 1, at });
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
  }

  /** Most recent first, which is the order the dashboard shows them in. */
  list(limit = DEFAULT_CAPACITY): readonly RecentError[] {
    return [...this.entries.values()]
      .reverse()
      .slice(0, limit)
      .map((entry) => ({
        code: entry.code,
        route: entry.route,
        count: entry.count,
        lastSeenAt: new Date(entry.at),
      }));
  }
}
