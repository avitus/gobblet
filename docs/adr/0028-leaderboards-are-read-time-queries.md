# ADR-0028: Leaderboards are read-time queries over the rating audit

## Status

Accepted

## Date

2026-07-26

## Context

[Section 11.3](../product-spec.md) requires daily, weekly, monthly and all-time boards. All-time
ranks every eligible account by current Elo; a period board contains the accounts that completed at
least one ranked match in that period, ordered by current Elo, with four tie-breakers: higher Elo,
more ranked wins in the period, fewer ranked games in the period, and earlier achievement of the
current rating. The first page is the top hundred, the caller's own position is shown even when it
is outside that page, and deeper results are paginated.

The Phase 6 exit criterion is that "leaderboards are correct under concurrent rating updates". This
is the crux. Ratings move inside match completion transactions
([ADR-0019](0019-elo-in-the-completion-transaction.md)), so a board is being read while other
matches are finishing. Any board that is assembled from several separate reads can show a state
that never existed: a player counted twice, a player missing, or a rank that contradicts the rating
shown beside it.

There is already an append-only record of every ranked result: `rating_changes`, one row per player
per completed ranked match, carrying the outcome and the moment it was written. Everything a period
board needs, membership, wins in the period and games in the period, is an aggregate over that
table, and the current rating is a column of `ratings`.

## Decision

A leaderboard is one SQL query per request, executed in one snapshot, with nothing cached.

- All-time joins `ratings` with the account, filters to accounts that may appear, and orders by the
  tie-breakers. A period board joins the same rows with an aggregate over `rating_changes` limited
  to the period, which both selects the members and produces the two period tie-breakers.
- One statement means one MVCC snapshot, so the board is a consistent view of the ratings at a
  single instant, whatever finishes while it is being read. This is what makes the exit criterion
  true rather than approximately true.
- Nothing is cached and nothing is materialised. A board is cheap enough at MVP scale, and a cache
  would reintroduce the very inconsistency the query exists to avoid, in the form of staleness that
  a player reads as a wrong rank.
- Periods are calendar periods in UTC: the day, the ISO week beginning on Monday, and the calendar
  month that contain the moment of the request. UTC is chosen because a board is global, and a
  board that changes shape with the reader's time zone cannot be paginated coherently.
- Membership of a period comes from the rating audit rather than from the match rows, because the
  audit is written in the same transaction as the rating it explains, and it is the table the
  aggregates need anyway.
- "Earlier achievement of the current rating" is the moment the account's rating last changed, which
  is `ratings.updated_at`. An account that reached 1500 yesterday outranks one that reached 1500
  today.
- Eligibility is an active account with a rating row. An account with no ranked match has no rating
  and therefore no rank, which is why nothing invents 1200 for it, and suspended or deleted accounts
  do not appear.
- The caller's own position is answered by the same query shape, ranked over the whole board and
  filtered to that account, so the rank shown to a player and the rank in the page are produced by
  one definition rather than two.
- Pagination is a cursor over the sort key rather than an offset, so a page boundary does not skip
  or repeat an account when a rating moves between requests.
- Rank is a display value, computed at read time. It is never stored on the profile, so no row can
  hold a stale rank.

## Consequences

### Positive

- A board is always internally consistent, which is exactly the exit criterion, and it needs no
  invalidation logic.
- There is no scheduled job, no derived table and no cache to warm, drain or reason about during a
  deployment.
- The same query answers "the top hundred" and "where am I", so the two can never disagree.
- The rating audit gains a second consumer, which keeps it honest: a bug in the audit shows up on a
  leaderboard rather than only in an administrative view.

### Negative

- Every request costs a query with an aggregate and a sort, so a popular board is real database
  load. Indexes make it cheap at MVP scale, but this decision is the one to revisit first under
  load, and [section 21.3](../product-spec.md) is where the budget lives.
- The tie-breakers make the sort key wide, so the cursor is a composite value rather than a rating.
- A period board cannot be answered from the aggregates alone, so `rating_changes` grows into a
  read-path table rather than staying an audit.

### Neutral

- UTC boundaries mean a player in Auckland sees the daily board turn over during their afternoon.
  That is a global product's usual compromise, and it is recorded in the appendix rather than
  hidden.
- If load ever demands a materialised board, it can be added behind the same endpoint, with the
  query as the definition it must reproduce.

## Alternatives considered

### A materialised leaderboard table updated on every rating change

Rejected for now: it makes each completion write more, and it introduces a second definition of a
board that must be proved equal to the query. Its only advantage is read cost, which is not yet a
problem.

### A short-lived cache in front of the query

Rejected: a cached board is a board that is wrong for the duration of the cache, and the failure it
produces, a player seeing a rank that disagrees with their own rating, is precisely what the exit
criterion forbids.

### Period membership from the match rows

Rejected: the same information is in the audit, one row per player, already keyed by the account and
already written in the completion transaction. Reading it from `matches` needs a polymorphic
participant join that the audit does not.

### Ranking by rating at the end of the period rather than the current rating

Rejected because the specification defines a period board as "users who completed at least one
ranked match in that period, sorted by current Elo". Ranking by a historical rating would need a
point-in-time reconstruction and would contradict the text.

## References

- [`../product-spec.md`](../product-spec.md) sections 11.3, 21.3, appendices P6.9 to P6.11
- [ADR-0007](0007-postgresql-drizzle.md),
  [ADR-0019](0019-elo-in-the-completion-transaction.md)
- [`../protocol.md`](../protocol.md) section 9.1
