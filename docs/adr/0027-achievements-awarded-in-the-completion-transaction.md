# ADR-0027: Achievements are awarded in the completion transaction, from recorded facts

## Status

Accepted

## Date

2026-07-26

## Context

[Section 11.4](../product-spec.md) names eight achievements and requires that "achievement
evaluation must be idempotent". [Section 19.3](../product-spec.md) requires that clients cannot
award achievements. [Section 15.7](../product-spec.md) fixes the schema: an `achievements`
catalogue with a `code`, a `rule_version` and an `enabled` flag, and a `user_achievements` table
whose primary key is `(user_id, achievement_id)`.

The eight rules need three different kinds of input:

- Aggregates the account already carries: ranked wins, the current ranked streak, games played.
  `ratings` holds the ranked ones and the casual record is derived from `matches`.
- Facts about the match that just ended: its mode, its result and its end reason.
- Facts about how the match was played: which line category won it ("Four Ways"), and whether the
  winner ever made a move that revealed an opponent's line and blocked it in the same move
  ("Uncovered"). `@gobblet/game-core` computes both while evaluating a move, but nothing durable
  keeps them today, and recomputing them later would mean replaying every match of an account.

[ADR-0019](0019-elo-in-the-completion-transaction.md) already settled the analogous question for
Elo: a rating moves inside the transaction that completes the match, so a result and its
consequences cannot be separated by a crash. Achievements have the same shape and one additional
requirement, idempotency, which the specification's own primary key provides if the write is an
insert that tolerates a conflict.

## Decision

Achievements are evaluated inside the transaction that completes a match, from facts recorded when
they were computed.

- The catalogue is defined once, in `@gobblet/protocol`, because the server evaluates it and the
  client names the badges. The migration seeds the `achievements` table from that same list, and a
  server test fails if the table and the catalogue drift.
- Evaluation is a pure function from a facts record to a set of achievement codes. It has no
  database access, so every rule is unit-testable and the "was it earned" question has one answer
  whatever called it.
- The award is `insert ... on conflict (user_id, achievement_id) do nothing`. Idempotency is
  therefore a property of the schema rather than of a code path that remembers whether it ran, and
  a repeated completion, a retried transaction or a concurrent settle all converge.
- Facts a rule needs but cannot recompute are recorded when the rules engine produces them:
  - the identifiers of the winning lines are written on the match row as it completes, so the line
    categories of an account's wins are a single aggregate query;
  - a move that revealed an opponent's line and blocked it is marked on its own match event, which
    is already written for every move, so "Uncovered" is a query over that match's events.
- Only accounts earn achievements. A guest has no `user_id` and therefore no row; matches a guest
  played that were later claimed count towards the account, because claiming moves the match rows.
- An achievement is cosmetic: the award changes no rating, no eligibility and no gameplay
  ([section 11.4](../product-spec.md)), so a failure to award can never alter a result. It is
  nevertheless in the transaction, because being inside it is what makes it exactly once.
- A badge is a code, not a binary asset. The client renders it from the design tokens, as
  [ADR-0022](0022-procedural-placeholder-assets.md) does for the board, so no artwork enters the
  repository in this phase.
- Administrative creation and editing of achievements is Phase 7. `rule_version` is stored now so
  that a later rule change can be told from the original evaluation.

## Consequences

### Positive

- A completed match and the achievements it earned share one transaction, so no reconciliation job
  is needed and no partial state exists.
- Idempotency is enforced by the database, which is the only place that can enforce it under
  concurrency.
- Every rule is a pure function over an explicit facts record, so the eight rules are covered by
  unit tests without a database.
- The two derived facts are stored where they were computed, so no achievement needs a replay of
  history.

### Negative

- The completion transaction grows: it now reads the winner's aggregates and one query over the
  match's events. It stays bounded, but it is no longer only writes.
- Two columns exist only for achievements: the winning line identifiers on the match row and a flag
  on a move event. Both are facts about the match, but they are denormalised.
- A rule that needs a fact nobody recorded requires a migration and a backfill decision, rather
  than a new query.

### Neutral

- Because evaluation is idempotent, it can also be run again over historical matches if a rule is
  added later, given the facts it needs were recorded.
- The catalogue in the protocol package is the source of truth for both sides, which keeps the
  badge names in the client from drifting from the codes on the server.

## Alternatives considered

### Evaluate achievements in a background job after the match

Rejected: it reintroduces the split that [ADR-0019](0019-elo-in-the-completion-transaction.md)
removed for ratings. A crash between the two writes leaves a player who won without the award, and
recovering it needs exactly the job-level bookkeeping the primary key already gives for free.

### Keep a per-user progress table updated on every match

Rejected as premature: the aggregates the rules need already exist in `ratings` and in the match
rows, and a second set of counters would have to be kept in step with them. The one thing that
could not be recomputed cheaply, the line category of a win, is recorded on the match itself.

### Recompute the derived facts by replaying an account's matches

Rejected: it makes the cost of completing a match grow with the length of an account's history, and
it would deserialise every past game state to answer a cosmetic question.

### Let the client claim an achievement it believes it earned

Rejected outright by [section 19.3](../product-spec.md): clients cannot award achievements.

## References

- [`../product-spec.md`](../product-spec.md) sections 11.4, 15.7, 19.3, appendices P6.5 to P6.8
- [ADR-0012](0012-pure-shared-rules-engine.md),
  [ADR-0019](0019-elo-in-the-completion-transaction.md),
  [ADR-0022](0022-procedural-placeholder-assets.md)
- [`../architecture.md`](../architecture.md)
