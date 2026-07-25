# ADR-0007: PostgreSQL with Drizzle ORM

## Status

Accepted

## Date

2026-07-24

## Context

The database is the source of truth for accounts, matches, match events, ratings, achievements
and audit records. Several product guarantees translate directly into database requirements:

- Every accepted move must be persisted before it is acknowledged, so a client that saw
  `ok: true` can rely on durability (see [ADR-0010](0010-match-event-persistence.md)).
- A move commit, the resulting snapshot update, the clock update and, on completion, the rating
  update must all take effect together or not at all. A partially applied match completion that
  awards rating twice, or awards none, is unacceptable.
- Active matches must survive a process restart and a deploy, so they cannot be memory-only.
- Match state is a nested structure (board cells with stacks, reserves) that is read as a whole,
  while lists and leaderboards need indexed, queryable columns.
- Admin actions must produce an immutable audit trail.

The team is small, so the data layer must be typed end to end, must produce reviewable SQL
migrations, and must not hide what the database is doing.

Status: planned (Phase 2). No schema, migrations or repositories exist today.

## Decision

PostgreSQL is the only datastore, accessed through Drizzle ORM with SQL migrations, from
`packages/db`.

- Canonical match state is a versioned JSONB snapshot column, written together with an
  incremented integer `version`.
- Alongside the snapshot, indexed relational summary columns carry everything that must be
  queried or constrained: participants, mode, time control, `status`, `active_player`,
  `light_remaining_ms`, `dark_remaining_ms`, `turn_started_at`, `last_clock_commit_at`, result and
  timestamps.
- `match_events` is an append-only log with a unique constraint on `(match_id, sequence)` and a
  unique constraint on `(match_id, command_id)` for idempotency.
- Every accepted command is applied in one transaction: lock the match row, verify version and
  idempotency, append the event, update the snapshot and clocks, apply rating changes on
  completion, commit, and only then acknowledge.
- Migrations are generated and checked in as SQL, are forward-only, and are applied as an explicit
  deploy step before a container is marked ready (see [`../operations.md`](../operations.md)).
- The database is a managed PostgreSQL instance with automated backups and point-in-time recovery
  where available. Locally it runs from [`../../docker-compose.yml`](../../docker-compose.yml).
- `@gobblet/db` depends only on `@gobblet/protocol` and `@gobblet/config`, and is used only by the
  server.

## Consequences

### Positive

- Transactional integrity is available exactly where the product needs it, so move commit plus
  rating update cannot half apply.
- Row-level locking plus an integer `version` column gives optimistic concurrency for commands
  without extra infrastructure (see [ADR-0011](0011-versioned-idempotent-commands.md)).
- JSONB keeps the nested match state in one place, so the rules engine's state shape does not have
  to be shredded across tables and reassembled.
- Summary columns keep listing, filtering and constraint enforcement in SQL where they belong.
- Drizzle's schema definitions are TypeScript, so table types flow into repository code, while the
  emitted SQL stays visible and reviewable.
- One managed datastore means one backup story, one restore runbook and one connection pool.

### Negative

- JSONB is opaque to the database: the shape is enforced by application code and by the rules
  engine, not by column constraints, so snapshot shape changes need explicit migration handling.
- Drizzle is younger than the most established alternatives, with a smaller ecosystem and fewer
  ready answers for unusual query needs.
- Transaction-per-command puts every accepted move on the database's critical path, so database
  latency is match latency, and pool exhaustion is a gameplay outage.
- Forward-only migrations mean destructive changes must be split into expand, migrate and contract
  deploys.

### Neutral

- Connection pooling is bounded by `DATABASE_POOL_MAX`, and pool saturation is an alerting
  concern.
- Snapshot versioning inside JSONB requires its own compatibility discipline when the engine's
  state shape changes; that is a schema change and needs an ADR.
- No Redis or secondary cache exists initially (see
  [ADR-0015](0015-single-region-deployment.md)), so PostgreSQL absorbs all reads.

## Alternatives considered

### Prisma

Rejected on control and fit. Prisma's schema language and generated client are ergonomic, but it
adds a separate schema dialect and a heavier runtime, and its handling of JSON columns, row locks
and hand-tuned transactional flows is less direct than Drizzle's SQL-shaped API. This project's
hardest requirement is precise transactional behaviour around a locked row, which is exactly where
a thinner layer helps.

### Raw SQL with a query builder only, no ORM layer

Rejected as a default because repository code and types would be maintained by hand on both sides
of every query, which is where mismatches appear. Drizzle still permits raw SQL where a query
needs it, so this option remains available locally without being the baseline.

### MySQL or MariaDB

Rejected on feature fit. PostgreSQL's JSONB support, richer indexing and constraint options, and
its managed offerings with point-in-time recovery match the requirements more closely, and the
team's operational familiarity is with PostgreSQL.

### MongoDB or another document store

Rejected because transactional guarantees are non-negotiable. Move commit with an append-only
event log, an incremented version and a rating update must be atomic and must hold a unique
constraint on `(match_id, sequence)` and `(match_id, command_id)`. Document stores can approximate
this, but the guarantee would be the application's responsibility instead of the database's.

### Keeping active matches in memory with periodic persistence

Rejected outright. It breaks persist-before-acknowledge, loses committed moves on a crash, and
makes drain-and-reconnect deploys unsafe.

## References

- [`../architecture.md`](../architecture.md), [`../operations.md`](../operations.md)
- [ADR-0010](0010-match-event-persistence.md), [ADR-0011](0011-versioned-idempotent-commands.md)
- [ADR-0009](0009-server-authoritative-clocks.md)
