# ADR-0032: Backups are repository scripts, proved by a restore round trip in continuous integration

## Status

Accepted

## Date

2026-07-26

## Context

[Section 23](../product-spec.md) commits to daily managed backups, point-in-time recovery where
available, fourteen days of retention, a monthly export of critical tables to encrypted object
storage, a restore runbook, a quarterly restore test, and recovery objectives of twenty-four hours
for the recovery point and four hours for the recovery time. The Phase 7 exit criterion is narrower
and sharper: "backup restores into staging".

The daily backups and point-in-time recovery are properties of a managed PostgreSQL service, and
there is no such service, no staging environment and no object storage in this environment
([ADR-0015](0015-single-region-deployment.md) already records that the hosted topology is deferred).
What can exist here is the part that is ours: the export, the restore, the verification that the
restored database is the same database, and the runbook a human follows at three in the morning.

A restore runbook that has never been executed is a wish. The exit criterion is therefore read as:
the export and restore procedure must be executable, and must be executed by the test suite against
a real PostgreSQL, comparing the restored data with the source.

## Decision

Backup and restore are scripts in the repository, and the round trip is a test that runs in
continuous integration against its PostgreSQL service.

- `pnpm db:backup` writes a compressed `pg_dump` custom-format archive plus a manifest recording the
  database, the schema version, the row counts of the critical tables, the archive's SHA-256 digest
  and the moment. The manifest is what makes a restore verifiable rather than hopeful.
- `pnpm db:restore` restores an archive into a named target database, refuses to touch a database
  whose name is not the target given on the command line, and re-reads the row counts to compare them
  with the manifest. A mismatch is a non-zero exit.
- `pnpm db:export-critical` writes the monthly export of the critical tables as compressed CSV with
  the same manifest discipline, so an export can be read without PostgreSQL. Encryption and the
  upload to object storage are the deferred, hosted half; the script writes to a local directory and
  the runbook states the remaining step.
- The round trip is a test: seed a database through the repositories, including a completed match
  with its events and ratings, back it up, restore into a scratch database, and assert that the row
  counts match the manifest and that a match reads back identically through the same repositories,
  events, clocks and result included. This is what "restores into staging" means in a repository that
  has no staging: same procedure, same tools, a different database name.
- The test runs in the `Verify` job, which already has a PostgreSQL service and the client tools, so
  the procedure is exercised on every push rather than quarterly.
- The runbook in [`../operations.md`](../operations.md) states the objectives, the ordered steps for a
  full restore and for a point-in-time recovery, who declares the recovery, what is told to players,
  and the explicit rule from section 23 that active matches may be declared aborted only after
  recovery has failed, with no Elo change.
- The deferred items are named in the runbook and in appendix P7 rather than implied: managed daily
  backups, point-in-time recovery, retention, the encrypted upload and the quarterly drill in a real
  staging environment. Each names the provider setting that will satisfy it.

## Consequences

### Positive

- The restore path is executed continuously, so it cannot rot while nobody is looking.
- A backup carries its own verification, so a corrupt or truncated archive is discovered on the day
  it is written rather than during an incident.
- The scripts are the runbook's commands, so the document and the tooling cannot disagree.
- Nothing about the procedure depends on a provider, so a managed service can be adopted without
  rewriting it.

### Negative

- `pg_dump` and `pg_restore` must be on the path of anybody running the scripts, and their major
  version must match the server's. The scripts check this and say so plainly.
- A logical dump is not point-in-time recovery. The recovery point objective of twenty-four hours is
  met by a daily dump, but the specification's preference for point-in-time recovery is only met by
  the managed service that is deferred.
- The round-trip test makes the `Verify` job slower by the cost of a dump and a restore.

### Neutral

- The archive format is PostgreSQL's own, so a restore needs PostgreSQL. The monthly CSV export
  exists for the case where that is not available.
- Object storage is a single function in the export script when a bucket exists.

## Alternatives considered

### Documentation only, with no executable scripts

Rejected: it cannot satisfy an exit criterion that says a backup restores, and an unexecuted runbook
is the classic disaster-recovery failure.

### Relying entirely on the managed service's backups

Rejected as insufficient rather than wrong. Managed backups are part of the answer, but they cannot
be tested from this repository, they do not cover the monthly export, and they leave the restore
procedure unwritten.

### A physical base backup with write-ahead log archiving

Rejected for this phase: it is the right shape for point-in-time recovery and the wrong shape for a
test, since it needs a running server's data directory and archive configuration rather than a client
connection. It is the natural successor once a managed service exists.

### Testing the restore against a database created by migrations only

Rejected: an empty database restores trivially. The test seeds real rows, including a completed match
with events, because those are what an incident would lose.

## References

- [`../product-spec.md`](../product-spec.md) sections 5.8, 22.2, 23, appendix P7
- [ADR-0007](0007-postgresql-drizzle.md), [ADR-0015](0015-single-region-deployment.md)
- [`../operations.md`](../operations.md) sections 7 and 8
