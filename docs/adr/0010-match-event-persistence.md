# ADR-0010: Match event persistence

## Status

Accepted

## Date

2026-07-24

## Context

A match is a sequence of moves with a clock and a result that affects rating. Losing a committed
move, or applying one twice, is a data-integrity failure that a player experiences directly: the
board disagrees with what they did, or a rating changes twice.

The system must survive events that are normal rather than exceptional: a process restart, a
container replacement during a deploy with drain-and-reconnect, a dropped socket, a client that
retries because an acknowledgement was lost. In all of those cases the match must resume exactly
where it was, including clocks.

Two shapes of state are needed at once. The full nested match state (board cells with stacks,
reserves) is read as a whole when a client synchronises, while the history of what happened is
needed for support, dispute investigation, integrity auditing and metrics.

Status: planned (Phase 2). No persistence exists today.

## Decision

Match state is persisted as a canonical versioned snapshot plus an append-only event log, and
acknowledgement always follows commit.

- `match_events` is append-only: a row per accepted command with a unique constraint on
  `(match_id, sequence)`. Rows are never updated or deleted.
- The same table (or an equivalent constraint) enforces uniqueness of `(match_id, command_id)`, so
  a retried command cannot append twice (see
  [ADR-0011](0011-versioned-idempotent-commands.md)).
- The match row holds the canonical JSONB snapshot with an integer `version` incremented once per
  accepted command, plus the indexed summary and clock columns from
  [ADR-0007](0007-postgresql-drizzle.md).
- Persist then acknowledge: the event append, snapshot update, clock update and, on completion, the
  rating update happen in one transaction. The acknowledgement is sent only after that transaction
  commits, and the broadcast follows the acknowledgement.
- Active matches are never memory-only. In-memory structures are caches of the database row and may
  be discarded at any time.
- Recovery uses the snapshot plus derived clocks, never event replay: load the snapshot, derive
  effective remaining time from `turn_started_at`, settle any expired match before accepting new
  commands (see [ADR-0009](0009-server-authoritative-clocks.md)).
- The event log is internal. It is not exposed as a player-facing replay or move list in the MVP.
  It is readable through the admin match inspection endpoint (planned, Phase 7).

## Consequences

### Positive

- A client that received `ok: true` can rely on the move being durable, which makes the client's
  reconciliation rules simple and safe.
- Recovery is cheap and deterministic: one row read plus arithmetic, with no replay cost that grows
  with match length.
- The append-only log gives an audit trail for disputes, integrity checks (for example verifying
  that no illegal move was ever accepted) and analytics, without being on the read path of
  gameplay.
- Deploys can drain and replace containers safely, because no match progress lives in a process.
- Duplicate rating application is prevented by the same transaction boundary that commits the final
  move.

### Negative

- Every accepted move costs a database transaction, so database latency is felt as move latency and
  the database is a hard dependency for gameplay.
- Two representations of the same history (snapshot and event log) can disagree if a code path
  updates one without the other, so the single transactional write path must be the only way to
  mutate a match.
- The event log grows without bound and will eventually need archival or retention policy.
- Snapshot shape changes require compatibility handling, since old snapshots persist in JSONB.

### Neutral

- Writing the snapshot as the canonical read model means the event log is not required to
  reconstruct state, which is a deliberate simplification rather than classical event sourcing.
- Because the log exists, a player-facing replay becomes possible later as an additive feature; it
  is simply not in scope now.
- Match transaction failures are an alerting condition (see [`../operations.md`](../operations.md)).

## Alternatives considered

### Full event sourcing with state rebuilt by replay

Rejected as unnecessary complexity for this domain. Replay-on-read makes synchronisation cost grow
with match length, requires versioned event upcasting forever, and needs snapshots anyway for
performance. Keeping the snapshot canonical and the log as an audit record gives the useful part of
event sourcing without the machinery.

### Snapshot only, with no event log

Rejected because it removes the ability to answer "what happened in this match" for support,
disputes and integrity auditing, and it removes the natural place to enforce
`(match_id, command_id)` uniqueness for idempotency.

### In-memory active matches with periodic snapshot writes

Rejected outright. It breaks persist-before-acknowledge, loses committed moves on a crash, makes
drain-and-reconnect deploys unsafe, and creates ambiguity about which side of a restart a move
landed on.

### Acknowledge first, persist asynchronously

Rejected because it makes the acknowledgement a lie. A client would show a move as accepted that
can still be lost, which is the exact failure the product commits to preventing (zero lost
committed match events).

### Writing clocks into the event log on every tick

Rejected because clocks are derived rather than ticked (see
[ADR-0009](0009-server-authoritative-clocks.md)), so there is nothing per-tick to record.

## References

- [`../architecture.md`](../architecture.md), [`../protocol.md`](../protocol.md)
- [ADR-0007](0007-postgresql-drizzle.md), [ADR-0009](0009-server-authoritative-clocks.md)
- [ADR-0011](0011-versioned-idempotent-commands.md)
