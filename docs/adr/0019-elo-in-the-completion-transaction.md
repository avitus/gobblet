# ADR-0019: Elo written in the match completion transaction, with an append-only audit

## Status

Accepted

## Date

2026-07-25

## Context

Phase 4 introduces the first derived, player-visible number that is not a match fact: a rating.
The specification fixes the arithmetic (standard Elo, `K = 32`, win 1, draw 0.5, loss 0, rounded to
the nearest integer, no provisional K, one rating across all time controls) and fixes when it
changes: "Rating updates for both players must occur in the same transaction as final match
completion" ([`../product-spec.md` section 10](../product-spec.md)). It also lists what must be
stored for each change: rating before, rating after, delta, formula version, opponent rating
before, and the outcome.

Section 15.4 defines a `ratings` aggregate per user. It does not define a table for the per-change
record that section 10 requires, and Phase 4 lists "rating transaction audit" as a deliverable, so
the data model has to gain something the data model section does not name.

The match runtime already commits a terminal outcome exactly once, inside a transaction that locks
the match row, and it already refuses every later command
([ADR-0011](0011-versioned-idempotent-commands.md), Phase 2 exit criteria). A rating written
anywhere else would be a second source of truth about whether a match had finished, and a rating
written twice would be indistinguishable from a rating written once unless something recorded the
attempt.

## Decision

Ratings change only as part of the transaction that marks a ranked match complete.

- The arithmetic lives in one pure module (`apps/server/src/rating/elo.ts`): no clock, no database,
  no randomness, and no knowledge of matches. It is held by the reference vectors of the
  specification's formula, so a change in the numbers fails a test rather than a leaderboard.
- `ratings` holds the aggregate per user: rating, games played, wins, losses, draws, current streak,
  best streak. A user starts at 1200 and the row is created on demand, so a player who has never
  played ranked has no row rather than a fake one.
- `rating_changes` is append-only and records, per player per match, the rating before, the rating
  after, the delta, the opponent's rating before, the outcome and a formula version constant. The
  pair `(match_id, user_id)` is unique, so a second write for the same match and player is a
  database error rather than a silent double count.
- Only ranked matches with two accounts produce rating changes. A casual match, or a ranked match
  that somehow held a guest, writes nothing; the seating rules already refuse the latter before the
  match exists (appendix P3).
- Both aggregates and both audit rows are written inside the same transaction that writes the
  result, the end reason and the terminal status. If any of it fails, the match does not complete.
- Timeout and resignation are ordinary losses, and threefold repetition is an ordinary draw. There
  is no special case in the arithmetic for how a match ended.

## Consequences

Accepted:

- The completion transaction grows: it now touches four more rows. It stays a single-match
  transaction with a row lock already held, so the added contention is bounded by the match itself.
- The data model gains `rating_changes`, which specification section 15 does not list. This is
  recorded as a deviation in appendix P4 rather than treated as an omission, because section 10
  requires the fields and Phase 4 requires the audit.
- A corrective adjustment (specification section 16, Phase 7) will have to write both the aggregate
  and an audit row through the same path, and will therefore need an admin action, not a manual
  update.

Gained:

- A rating cannot disagree with the match that produced it, because there is no moment at which one
  exists without the other.
- Double counting is prevented by a constraint, not by care.
- The formula is a pure function with reference vectors, so the arithmetic can be reviewed without
  a database and reused later by the leaderboards of Phase 6.

## Alternatives considered

**Rate after the fact, from the match history.** Recompute ratings from completed matches on a
schedule or on read. Rejected: the specification requires the update inside the completion
transaction, a recomputation would have to replay every match in order to be correct, and a
player's rating would be wrong for as long as the lag lasted.

**An outbox event consumed by a rating worker.** Durable and decoupled, and the shape this would
take with more than one process. Rejected for this phase: it makes the rating eventually
consistent with the match, which contradicts section 10, and it adds a worker to operate for a
single-process deployment ([ADR-0015](0015-single-region-deployment.md)).

**Store only the aggregate, no per-change audit.** Cheapest. Rejected: section 10 names the fields
to store, a corrective adjustment could not be distinguished from a played result, and a rating
dispute would have no evidence.

**Put the Elo arithmetic in `@gobblet/game-core`.** It is pure, and it would be reusable in the
browser. Rejected: `game-core` is the rules of Gobblet
([ADR-0012](0012-pure-shared-rules-engine.md)), and rating is a product decision about the league
around the game. Mixing them would make the engine's coverage gate protect something that is not a
rule.

## References

- [`../product-spec.md`](../product-spec.md) sections 2.6, 10, 15.4, 15.5
- [ADR-0007](0007-postgresql-drizzle.md), [ADR-0010](0010-match-event-persistence.md),
  [ADR-0011](0011-versioned-idempotent-commands.md), [ADR-0012](0012-pure-shared-rules-engine.md)
- [`../architecture.md`](../architecture.md) section 7
