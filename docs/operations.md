# Operations

Runbooks, environment definitions and operational policy for Gobblet Online.

Related documents: [`architecture.md`](architecture.md), [`protocol.md`](protocol.md),
[`product-spec.md`](product-spec.md), [`adr/`](adr/).

## 1. Implementation status

The local development runbook, the continuous integration gates and the local database
migration procedure are executable today. Nothing is deployed, there is no staging or
production environment and no desktop release pipeline exists. Every runbook below is labelled
with the phase that delivers it. Do not attempt a runbook marked planned.

| Runbook                        | Status                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Local development              | Executable (Phase 0)                                                                   |
| CI gates                       | Executable (Phase 0)                                                                   |
| Database migrations            | Executable locally (Phase 2)                                                           |
| Staging deploy                 | Workflow written and ordered (Phase 7); the release commands wait for a host           |
| Production deploy and rollback | Workflow written with its approval gate and drain (Phase 7); the same commands wait    |
| Backup and restore             | Executable (Phase 7); the round trip runs in CI, the managed schedule waits for a host |
| Incident response              | Alert conditions and the catalogue are executable (Phase 7); paging waits for a host   |
| Desktop release                | Planned (Phase 8)                                                                      |
| Secret and key rotation        | Planned (Phase 3 onwards)                                                              |
| Account moderation             | Executable through the admin API and dashboard (Phase 7)                               |
| Matchmaking observation        | Readable from the log, the exposition and the dashboard (Phase 7)                      |
| Browser end-to-end suite       | Executable locally and in CI (Phase 5); the packaged shells are Phase 8                |

## 2. Environments

| Environment | `APP_ENV`    | Purpose                                             | Status              |
| ----------- | ------------ | --------------------------------------------------- | ------------------- |
| Local       | `local`      | Development on a workstation, Docker PostgreSQL     | Available (Phase 0) |
| Staging     | `staging`    | Pre-production verification, production-shaped data | Planned (Phase 2)   |
| Production  | `production` | Player-facing single-region deployment              | Planned (Phase 7)   |

Configuration and secret handling:

- All configuration is read from environment variables and validated at startup by
  `@gobblet/config`. The authoritative schema lives in `packages/config/src/schema.ts`. A
  process with invalid configuration must fail to start rather than run degraded.
- `.env` files exist for local development only and are never committed.
  [`.env.example`](../.env.example) is the documented template.
- Staging and production secrets live in the deployment platform secret store and in GitHub
  Actions secrets for release workflows. Secrets are never written to logs, never printed by
  scripts and never included in Sentry payloads.
- Web client variables must be prefixed `VITE_` and are therefore public. Never place a secret
  behind a `VITE_` name.
- Every environment records `APP_VERSION` and `GIT_SHA` so a running process can be traced to a
  commit.

## 3. Environment variable reference

| Name                           | Required        | Default (local)                | Phase                | Description                                             |
| ------------------------------ | --------------- | ------------------------------ | -------------------- | ------------------------------------------------------- |
| `NODE_ENV`                     | Yes             | `development`                  | 0                    | Node runtime mode                                       |
| `APP_ENV`                      | Yes             | `local`                        | 0                    | One of `local`, `staging`, `production`                 |
| `APP_VERSION`                  | Yes             | `0.1.0`                        | 0                    | Deployed application version, reported by `/v1/config`  |
| `GIT_SHA`                      | Yes             | `local`                        | 0                    | Commit the build came from                              |
| `LOG_LEVEL`                    | Yes             | `debug`                        | 0                    | Pino log level                                          |
| `HOST`                         | Yes             | `127.0.0.1`                    | 0                    | Server bind address                                     |
| `PORT`                         | Yes             | `4000`                         | 0                    | Server port                                             |
| `PUBLIC_WEB_URL`               | Yes             | `http://localhost:5173`        | 0                    | Canonical web origin, used for links and redirects      |
| `CORS_ORIGINS`                 | Yes             | web origin plus desktop origin | 0                    | Comma separated allowed origins                         |
| `MIN_SUPPORTED_CLIENT_VERSION` | Yes             | `0.1.0`                        | 0 (enforced Phase 8) | Oldest client version the server accepts                |
| `DATABASE_URL`                 | Yes             | local PostgreSQL URL           | 0 (used Phase 2)     | PostgreSQL connection string                            |
| `DATABASE_POOL_MAX`            | Yes             | `10`                           | 0 (used Phase 2)     | Maximum pooled connections                              |
| `POSTGRES_PORT`                | No              | `5432`                         | 0                    | Host port for the local Docker PostgreSQL container     |
| `VITE_API_BASE_URL`            | Yes (web build) | `http://localhost:4000`        | 0                    | API origin used by the web client                       |
| `VITE_APP_ENV`                 | Yes (web build) | `local`                        | 0                    | Environment label shown in the client                   |
| `GUEST_SESSION_TTL_DAYS`       | No              | `30`                           | 2                    | Lifetime of a guest session token                       |
| `USER_SESSION_TTL_DAYS`        | No              | `30`                           | 3                    | Lifetime of an account session token                    |
| `CREDENTIAL_ATTEMPT_LIMIT`     | No              | `10`                           | 3                    | Credential attempts per address per route per 15 min    |
| `METRICS_ENABLED`              | No              | unset (off)                    | 7                    | Serves `GET /metrics`; absent, the route does not exist |
| `METRICS_TOKEN`                | No              | unset                          | 7                    | Bearer token `GET /metrics` requires when set           |
| `SENTRY_DSN`                   | No              | unset                          | 7                    | Sentry ingestion endpoint; unset, no error is sent      |
| `POSTHOG_API_KEY`              | No              | unset                          | 7                    | PostHog project key; unset, no event is sent            |
| `POSTHOG_HOST`                 | No              | `https://eu.i.posthog.com`     | 7                    | PostHog ingestion host                                  |
| `TELEMETRY_PSEUDONYM_SECRET`   | No              | unset                          | 7                    | Key that turns an actor id into the shared pseudonym    |
| `TELEMETRY_ATTEMPT_LIMIT`      | No              | `60`                           | 7                    | Client telemetry reports per address per minute         |

Every Phase 7 variable is optional and every transport is inert without it, so a workstation
and the test suites run with none of them set
([ADR-0030](adr/0030-telemetry-behind-ports-relayed-through-the-server.md)). Two consequences
are worth stating: without `TELEMETRY_PSEUDONYM_SECRET` the server derives a per-process key, so
pseudonyms do not survive a restart and must not be compared across deployments; and rotating
that secret deliberately detaches new records from old ones, which is what makes it a pseudonym
rather than an identifier.

## 4. Local development runbook

Status: executable (Phase 0).

Prerequisites: Node.js 22 or newer (see [`.nvmrc`](../.nvmrc)), pnpm 10, Docker with Compose
(optional), and a Rust toolchain only when building the desktop shell (Phase 8).

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts the local PostgreSQL container when Docker Compose is available, then runs the
server and the web client through Turborepo. Without Docker the server still boots and reports
the database as unavailable on `GET /health/ready`.

Verification before opening a pull request:

```bash
pnpm verify
```

`pnpm verify` runs `typecheck`, `lint`, `test:coverage` and `build` across the workspace.
Formatting is checked separately with `pnpm format:check` and fixed with `pnpm format`.

Useful commands:

| Command                        | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `pnpm db:up` / `pnpm db:down`  | Start or stop the local PostgreSQL container                  |
| `pnpm db:reset`                | Destroy the local database volume and start clean             |
| `pnpm test`                    | Unit and property tests                                       |
| `pnpm test:coverage`           | Coverage gates, `@gobblet/game-core` must stay at 100 percent |
| `pnpm test:properties:nightly` | Long-running property suites, not part of `verify`            |

## 5. Continuous integration gates

Status: executable (Phase 0). Workflows live in `.github/workflows/`.

Every pull request must pass:

1. `pnpm format:check`
2. `pnpm typecheck`
3. `pnpm lint`, which includes the `@gobblet/game-core` purity and boundary rules
4. `pnpm test:coverage`, with the 100 percent coverage gate on `@gobblet/game-core`
5. `pnpm build`
6. `pnpm test:e2e`, which plays a complete match in Chromium and WebKit and runs as its own job
   ([ADR-0021](adr/0021-playwright-browser-end-to-end-tests.md))
7. An ADR when the change is material or architectural (see [`adr/README.md`](adr/README.md))

The browser suite builds the production client, points it at a server on port 4100 and uses a
database of its own, `..._e2e`, derived from `TEST_DATABASE_URL`. It creates, migrates and empties
that database itself, so no manual setup step is needed. Run `pnpm test:e2e:browsers` once to
download the engines.

Planned additions: database migration check against a disposable PostgreSQL instance (Phase 2),
nightly property suites (Phase 1 onwards), desktop build verification (Phase 8), load and soak runs
(Phase 9).

## 6. Database migration procedure

Status: executable locally (Phase 2); the deploy steps stay planned until an environment
exists. Locally, `pnpm db:generate` writes a migration from the Drizzle schema and
`pnpm db:migrate` applies it. `pnpm dev` applies pending migrations before the server starts,
and the test suites apply them to their own databases.

1. Author the migration alongside the Drizzle schema change in `packages/db`.
2. Migrations must be forward-only and additive where possible. A destructive change is split
   into expand, migrate, contract across separate deploys.
3. Run the migration against a disposable local database and against staging before production.
4. Migrations run as an explicit step before the new server container is marked ready, never
   lazily on first request.
5. A migration that cannot be applied aborts the deploy; the previous container keeps serving.
6. Record any migration that changes match, rating or audit semantics in an ADR.

## 7. Staging deploy runbook

Status: the workflow exists and is ordered (Phase 7); the two release commands wait for a host
([ADR-0015](adr/0015-defer-hosting-choice.md), [appendix P7.16](product-spec.md#appendix-p7--phase-7-decisions-and-deviations-recorded-not-silently-decided)).
It is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), run from the Actions tab
against a commit that is already green on CI.

1. `build` checks the commit out, builds every workspace with `APP_VERSION` and `GIT_SHA` set,
   and fails if `ops/alerts/gobblet.rules.yml` is not what the definitions render.
2. `staging-migrate` takes a backup first, then applies pending migrations, and keeps the
   pre-migration archive as a workflow artefact. A migration that cannot be applied stops the
   deploy here, with the previous container still serving.
3. `staging-deploy` releases the build. This is one of the two steps waiting for a provider; it
   fails loudly rather than reporting a deployment that did not happen.
4. `staging-smoke` runs `pnpm --filter @gobblet/server smoke` against `STAGING_URL`: liveness,
   readiness, the configuration document, and the assertion a deploy actually cares about, which
   is that the version now serving is the version just released.
5. Confirm logs and error reporting show no new error classes.

The scripted match of section 22.2 step 5 is the browser suite, which needs the same host and is
deferred with it. That a match survives the process being replaced is proved against the runtime
in `apps/server/test/phase7-exit-criteria.test.ts`, which is what section 7.6 actually constrains.

## 8. Production deploy runbook

Status: the workflow exists with its approval gate and drain step (Phase 7); the release commands
wait for a host.

Preconditions: staging smoke test passed, migrations applied to staging, no open Sev1 or Sev2
incident, and manual approval recorded in the release workflow. The `production-approval` job is
that gate: reviewers are configured on the GitHub `production` environment, and no job that
touches production runs until one of them approves.

Drain-and-reconnect procedure:

1. Apply pending database migrations, after taking the backup the workflow keeps as an artefact.
2. Start the new container. Wait for `GET /health/ready` to succeed.
3. Stop routing new matchmaking to the old container. Existing sockets stay connected.
4. Let the old container drain: existing matches continue until they finish or the maximum
   drain period elapses.
5. When the drain period elapses, stop the old container. Remaining clients reconnect, call
   `match:sync` and re-synchronise from PostgreSQL.
6. Watch error rate, readiness and match transaction failures for the post-deploy observation
   window.

Because match state is persisted and clocks are derived from `turn_started_at`, a drained
client loses no match progress. See
[ADR-0009](adr/0009-server-authoritative-clocks.md) and
[ADR-0010](adr/0010-match-event-persistence.md).

Matchmaking is the exception, because it is the one thing a process holds that is not written
down ([ADR-0018](adr/0018-in-process-matchmaking-and-rematch-offers.md)). Draining stops the
queue first: every waiting player receives a recoverable `queue_closed` error and every open
rematch offer is cancelled, so nobody is paired into a match this process is about to stop
serving. Nothing requeues a player automatically; the client must send `queue:join` again, which
is what section 7.5 of the specification requires. Matches in progress are untouched.

`BootstrappedServer.close` performs the drain in that order: the queue closes, every open rematch
offer is cancelled, then sockets close, then the HTTP server, then buffered telemetry is flushed,
then the pool. `apps/server/test/phase7-exit-criteria.test.ts` plays a move, drains, replaces the
process and re-synchronises the same match on a second instance, which is the deploy this runbook
describes with the container substitution taken out.

## 9. Rollback procedure

Status: the procedure is the deploy workflow run against the previous commit (Phase 7).

1. Redeploy the previous immutable image using the same drain-and-reconnect steps.
2. Never roll back a database migration automatically. If the previous image is incompatible
   with the applied schema, roll forward with a fix instead.
3. If the incident is caused by data corruption rather than code, follow the restore runbook.
4. Record the rollback in the changelog and open a follow-up with the root cause.

## 10. Backup and restore

Status: executable (Phase 7). The backup, the restore and the verification are scripts in this
repository and the round trip runs on every CI build against a real PostgreSQL
([ADR-0032](adr/0032-backups-are-scripts-proved-by-a-restore.md)). What is deferred is named
below, and it is the managed part: nothing here depends on a provider to be exercised.

```bash
pnpm db:backup                                   # pg_dump, a manifest and a metric
pnpm db:restore <archive> <target-database>      # into a database that is not the source
pnpm db:export-critical                          # gzipped CSV of the ten critical tables
```

`pnpm db:backup` writes three files into `--directory` (default `./backups`): the archive
`gobblet-<database>-<timestamp>.dump` in `pg_dump` custom format, a manifest beside it, and
`gobblet_backup.prom` for a Prometheus textfile collector. The manifest records the database, the
moment, the server and tool versions, the applied migration, a SHA-256 digest of the archive, and
the row count of every critical table. A restore that does not reproduce those counts fails.

`pnpm db:restore` requires the target database to be named and refuses to restore over the source
recorded in the manifest, because step 3 below is a rule and not a preference. It verifies the
digest before touching anything, restores, then compares the row counts against the manifest.

`pnpm db:export-critical` is the off-provider copy: gzipped CSV per table plus a manifest, which
any PostgreSQL can ingest and any auditor can read. Encrypting and uploading it belongs to the
provider and is deferred.

The critical tables, the ones a restore has to reproduce exactly, are `users`, `matches`,
`match_events`, `ratings`, `rating_changes`, `achievements`, `user_achievements`, `audit_log`,
`match_participants` and `guest_actors`. Sessions, verification tokens and connection history are
deliberately not in that list: they are re-createable, they age out on their own, and a restore
that reinstates a revoked session would be a security defect rather than a recovery.

Policy:

| Item                   | Commitment                                                          | Status                             |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| On-demand backup       | `pnpm db:backup`, with a manifest and a verified restore            | Executable                         |
| Restore                | `pnpm db:restore`, into a different database, counts checked        | Executable, proved in CI           |
| Off-provider export    | `pnpm db:export-critical`                                           | Executable; upload deferred        |
| Automated backups      | Daily, from the managed PostgreSQL service                          | Deferred with the host (ADR-0015)  |
| Point-in-time recovery | Enabled where the provider supports it                              | Deferred with the host             |
| Retention              | 14 days minimum                                                     | Deferred with the host             |
| Off-provider copy      | Monthly encrypted export to object storage                          | Deferred with the host             |
| RPO                    | 24 hours or better, and effectively minutes where PITR is available | Deferred with the host             |
| RTO                    | 4 hours for a single-region restore                                 | Deferred with the host             |
| Restore drill          | Quarterly into a scratch instance                                   | Superseded: it runs on every build |

Restore runbook:

1. Declare an incident and stop accepting new matchmaking: draining does this, and it is also
   what the deploy runbook's step 3 does.
2. Identify the target recovery point. With a provider that supports it this is a PITR
   timestamp; with the scripts it is the newest archive whose manifest digest verifies.
3. Restore into a new database, never over the live one. `pnpm db:restore` enforces this by
   refusing the database named in the manifest.
4. Verify integrity. The script compares every critical table's row count against the manifest;
   then confirm by hand that the unique `(match_id, sequence)` constraint holds and that ratings
   reconcile with completed matches.
5. Repoint `DATABASE_URL` at the restored database and restart the application.
6. Let active matches recover from their snapshots. Clocks are derived from `turn_started_at`,
   so a match resumes where it stopped. Only if database recovery fails may active matches be
   declared aborted, and an aborted match applies no rating change (specification section 23).
7. Write the incident review, including the data loss window and follow-up actions.

Who declares recovery: the responder who declared the incident. Recovery is declared when
`GET /health/ready` succeeds against the restored database, the row counts match the manifest,
and one completed match reads back correctly through `GET /v1/matches/:id`. Until all three
hold, the incident is open, whatever the dashboard says.

The metric the alert reads is `gobblet_backup_last_success_timestamp_seconds`, written to
`gobblet_backup.prom` by every successful backup. Point the node exporter's textfile collector at
the backup directory; `GobbletBackupStale` fires when more than a day and a bit has passed since
the last success, which is a backup that stopped happening rather than a backup that failed once.

## 11. Incident response

Status: the severities, the checklist and the alert catalogue are in force (Phase 7); routing an
alert to a person needs the hosted monitoring of [ADR-0015](adr/0015-defer-hosting-choice.md).

Severity levels:

| Severity | Definition                                                                     | Response                    |
| -------- | ------------------------------------------------------------------------------ | --------------------------- |
| Sev1     | Matches cannot be played, data loss, or authentication is broken for everyone  | Immediate, all hands        |
| Sev2     | Significant degradation: elevated errors, matchmaking failing, clock anomalies | Immediate, single responder |
| Sev3     | Contained defect with a workaround, one feature affected                       | Next business day           |
| Sev4     | Cosmetic or low-impact issue                                                   | Normal backlog              |

First responder checklist:

1. Acknowledge the alert and declare a severity.
2. Check `GET /health/live` and `GET /health/ready`.
3. Check error rate and recent deploys. If a deploy correlates, prefer rollback over debugging
   in production.
4. Check database connectivity, connection pool saturation and slow queries.
5. Capture evidence (request ids, match ids, command ids) before restarting anything.
6. Communicate status, including a player-facing message if matches are affected.
7. After resolution, write a review with timeline, root cause and prevention.

Alert catalogue and first actions. The rule names are the ones in
[`ops/alerts/gobblet.rules.yml`](../ops/alerts/gobblet.rules.yml), which is generated from
`apps/server/src/observability/alerts.ts` by `pnpm ops:alerts` and regenerated in CI, so the
catalogue and the rules cannot drift apart.

| Rule                                   | Likely cause                                 | First action                                                                      |
| -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `GobbletReadinessFailing`              | Database unreachable, migration stuck        | Check the database, then the last deploy                                          |
| `GobbletServerErrorRateElevated`       | Regression, dependency failure               | Correlate with the last deploy, consider rollback                                 |
| `GobbletDatabasePoolExhausted`         | Leak, slow queries, traffic spike            | Inspect long-running transactions, raise `DATABASE_POOL_MAX` only after diagnosis |
| `GobbletMatchTransactionsFailing`      | Lock contention, schema mismatch             | Inspect failing match ids, verify migration state                                 |
| `GobbletStaleVersionRejectionsSpiking` | Client retry bug, snapshot desynchronisation | Compare client version distribution, inspect one match's event log                |
| `GobbletClockAnomaly`                  | Clock invariant violation                    | Treat as Sev1, freeze deploys, inspect `turn_started_at` values                   |
| `GobbletBackupStale`                   | Provider or credential problem               | Re-run `pnpm db:backup`, verify retention, escalate to the provider               |
| `GobbletDesktopSigningFailure`         | Expired or missing signing credentials       | Halt the release, rotate or renew credentials, never publish unsigned updates     |
| `GobbletErrorRegressionAfterDeploy`    | Bad release                                  | Roll back, then investigate                                                       |

Every rule is driven into its failing state by `apps/server/test/alert-rules.test.ts`, which
evaluates the expression over a real exposition, and each is checked to stay quiet on a healthy
one. `GobbletDesktopSigningFailure` is the one rule whose series does not exist yet: the release
job that would emit `gobblet_desktop_signing_failures_total` is Phase 8, and the rule says so
rather than being left out. Delivering any of these to a human needs the hosted monitoring of
[ADR-0015](adr/0015-defer-hosting-choice.md) and is deferred with it; the conditions are not.

Production targets that these alerts protect: 99.9 percent API availability, better than 99.9
percent crash-free sessions, zero accepted illegal moves, zero duplicate rating applications,
zero lost committed match events, daily backups with at least 14 day retention.

## 12. Observability

Status: executable (Phase 7), except delivery to a human, which needs a host.

- Structured JSON logs via Pino. Every log line carries, where applicable: request id, socket
  session id, match id, pseudonymous actor id, command id, match version, event type, duration,
  result and error code.
- Logs must never contain tokens, passwords, magic links or authorization headers. The
  pseudonym is what appears instead of an account id: an HMAC of the actor id under
  `TELEMETRY_PSEUDONYM_SECRET`, the same value in logs, analytics and error reports, so one
  session can be followed across all three without any of them naming a player
  ([appendix P7.12](product-spec.md#appendix-p7--phase-7-decisions-and-deviations-recorded-not-silently-decided)).
- Sentry receives server and client errors with release and environment tags, when `SENTRY_DSN`
  is set. PostHog receives product analytics when `POSTHOG_API_KEY` is set. Both sit behind
  ports, so a deployment without keys reports nothing and fails nothing
  ([ADR-0030](adr/0030-telemetry-behind-ports-relayed-through-the-server.md)).
- Client errors and client analytics are relayed through `POST /v1/telemetry`, throttled per
  address by `TELEMETRY_ATTEMPT_LIMIT`. The browser never holds a provider key.
- `GET /metrics` serves a Prometheus exposition when `METRICS_ENABLED` is set, guarded by
  `METRICS_TOKEN` when one is configured, and does not exist at all otherwise
  ([ADR-0031](adr/0031-metrics-are-a-prometheus-exposition.md)). Every label is drawn from a
  fixed set: a route pattern, never a path with an id in it.
- Instrumentation boundaries are OpenTelemetry-ready so tracing can be added without moving
  call sites.

What the exposition publishes, and the alert or question each one answers:

| Series                                                   | Kind      | Answers                                                 |
| -------------------------------------------------------- | --------- | ------------------------------------------------------- |
| `gobblet_ready`                                          | Gauge     | Would this instance accept traffic                      |
| `gobblet_deployment_info`                                | Gauge     | Which version and commit is serving                     |
| `gobblet_deployment_started_seconds`                     | Gauge     | How recent this deployment is                           |
| `gobblet_http_requests_total`                            | Counter   | Traffic and the 5xx share, by route and status          |
| `gobblet_http_request_duration_seconds`                  | Histogram | Request latency by route                                |
| `gobblet_socket_connections_total`                       | Counter   | Sockets accepted since start                            |
| `gobblet_socket_reconnects_total`                        | Counter   | Sockets that came back                                  |
| `gobblet_socket_connections`                             | Gauge     | Sockets connected now                                   |
| `gobblet_client_sessions_total`                          | Counter   | Handshakes, by client version and actor type            |
| `gobblet_active_matches`                                 | Gauge     | Matches in progress                                     |
| `gobblet_queue_depth`                                    | Gauge     | Waiting players by mode and time control                |
| `gobblet_matchmaking_wait_seconds`                       | Histogram | How long a pairing took                                 |
| `gobblet_matches_completed_total`                        | Counter   | Completions by mode and end reason                      |
| `gobblet_command_rejections_total`                       | Counter   | Rejections by command and reason, stale ones among them |
| `gobblet_move_validation_duration_seconds`               | Histogram | Time spent deciding whether a move is legal             |
| `gobblet_match_transaction_failures_total`               | Counter   | Match transactions that rolled back                     |
| `gobblet_clock_anomalies_total`                          | Counter   | Stored clocks that cannot be true                       |
| `gobblet_clock_timeouts_total`                           | Counter   | Matches decided by the clock                            |
| `gobblet_database_transaction_duration_seconds`          | Histogram | Database latency by operation                           |
| `gobblet_database_pool_connections`, `_idle`, `_waiting` | Gauge     | Pool saturation                                         |
| `gobblet_errors_total`                                   | Counter   | Errors by code and route                                |
| `gobblet_backup_last_success_timestamp_seconds`          | Gauge     | When a backup last succeeded (textfile collector)       |

The dashboard of section 16 reads the same numbers over SQL rather than over the exposition, so
an administrator sees the deployment as a whole rather than one instance
([appendix P7.13](product-spec.md#appendix-p7--phase-7-decisions-and-deviations-recorded-not-silently-decided)).

The server also logs one line per pairing, `paired two waiting players`, carrying the match id,
mode, time control, the wait the pairing ended and the depth of every queue that still holds
someone. Queue depth can be read in a running process through `server.matchmaking.depths()`,
which is what the tests assert against
([appendix P4.9](product-spec.md#appendix-p4--phase-4-decisions-and-deviations-recorded-not-silently-decided)).

## 13. Desktop release runbook

Status: planned (Phase 8).

1. Tag the release. The tagged workflow builds the web bundle once and reuses it for both
   platforms.
2. On a macOS runner: build the app, sign with the Developer ID certificate, notarize with
   Apple, staple the ticket, produce the DMG.
3. On a Windows runner: build the app, sign the executable and the NSIS installer.
4. Publish installers (DMG, NSIS exe) to GitHub Releases or object storage.
5. Publish signed update bundles plus the update manifest to the internal beta channel.
6. Install the previous stable version, then verify the update applies, the signature verifies,
   and the app relaunches with the new version.
7. Promote the manifest to the stable channel.
8. Update the download page and the changelog.

Channels and controls:

| Control                  | Behaviour                                                                   |
| ------------------------ | --------------------------------------------------------------------------- |
| Channels                 | `stable` plus an optional internal `beta`                                   |
| Rollout pause            | Revert the stable manifest to the previous version so clients stop updating |
| Minimum supported client | `MIN_SUPPORTED_CLIENT_VERSION` on the server forces an update prompt        |
| Signing requirement      | Updates are always signed. An unsigned artifact is never published          |

Failed update recovery:

1. Pause the rollout by restoring the previous stable manifest.
2. Confirm affected clients can still launch the installed version and still connect.
3. If the installed version is below `MIN_SUPPORTED_CLIENT_VERSION`, publish a fixed build
   before raising the minimum, so players are never locked out without a path forward.
4. Direct affected players to the download page for a full reinstall as the last resort.

## 14. Secret and key rotation

Status: planned (Phase 3 onwards).

| Secret                                     | Cadence                    | Procedure summary                                                                                                          |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Account session tokens                     | On suspicion of compromise | Revoke the affected sessions in `user_sessions`; the next request from that token is rejected because sessions are opaque  |
| Database credentials                       | Annually and on suspicion  | Create a new role or rotate the password, deploy with the new `DATABASE_URL`, drain and restart, revoke the old credential |
| macOS signing and notarization credentials | Before certificate expiry  | Renew the certificate and app-specific password, verify a signed build end to end                                          |
| Windows signing certificate                | Before certificate expiry  | Renew, verify a signed installer, then publish                                                                             |
| Update signing key                         | Only on compromise         | Publish a new key with a transition build, never invalidate installed clients without a reinstall path                     |
| Sentry DSN                                 | On suspicion               | Rotate the DSN, deploy, confirm events arrive, retire the old DSN                                                          |

Rules: rotate one secret at a time, verify the dependent flow before revoking the old value,
and record every rotation in the operational log.

## 14.1 Account moderation and email verification

Status: executable (Phase 7) through the administrative surface of
[`protocol.md` section 9.4](protocol.md) and the dashboard at `/admin`.

The first administrator cannot be created through the API, because an endpoint that grants the
role would be an endpoint for taking over the deployment. It is granted from the machine that
holds `DATABASE_URL`:

```bash
pnpm admin:grant <username> "Reason recorded in the audit log"
```

The script writes a `role-granted` audit record with the console as the actor
([ADR-0029](adr/0029-administration-is-a-role-on-the-account.md)). Every subsequent grant runs
the same way: no endpoint creates an administrator, so the surface cannot widen itself.

Suspend an account with `POST /v1/admin/users/:userId/suspend` and a reason, which the schema
requires rather than the screen. The change and its audit record are written in one transaction,
so a failed suspension leaves neither. Suspension revokes every live session, so a token already
in the player's hands stops working; the gates also read suspension fresh on every request, so
either one alone would be enough.

Lift a suspension with `POST /v1/admin/users/:userId/reinstate`, again with a reason. Sessions are
not restored: the player signs in again.

Correcting a rating is `POST /v1/admin/users/:userId/rating`. It writes the new rating, the audit
record and a `rating_adjustments` row that points at that record, and deliberately no
`rating_changes` row: that table is the per-match history the period leaderboards aggregate, and a
correction is not a match
([appendix P7.4](product-spec.md#appendix-p7--phase-7-decisions-and-deviations-recorded-not-silently-decided)).

Email verification has no delivery mechanism in this phase
([`product-spec.md` appendix P3](product-spec.md#appendix-p3--phase-3-change-of-direction-first-party-authentication)).
Outside production the token is returned in the registration response so a developer can complete
the flow. In production the token is stored and never returned, so no account can be verified
until a mail sender exists. Verification tokens live for three days and are single use. The token
value is never logged.

## 15. On-call and maintenance policy

Status: planned (Phase 7).

- Before public launch there is no formal rotation. The maintaining engineer is the responder
  and alerts route to them directly.
- From launch: a single primary responder with a documented escalation contact. Acknowledge
  Sev1 and Sev2 alerts promptly; Sev3 and Sev4 wait for business hours.
- Deploys are avoided during peak play hours. Routine deploys target low-traffic windows and
  use drain-and-reconnect, so no announced downtime window is normally required.
- Maintenance that requires refusing matchmaking (for example a destructive migration) is
  announced in the client in advance, stops matchmaking first, lets active matches finish, and
  only then proceeds.
- Every operational change that alters behaviour or topology is recorded in
  [`CHANGELOG.md`](../CHANGELOG.md) and, if material, in an ADR.
