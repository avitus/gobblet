# Operations

Runbooks, environment definitions and operational policy for Gobblet Online.

Related documents: [`architecture.md`](architecture.md), [`protocol.md`](protocol.md),
[`product-spec.md`](product-spec.md), [`adr/`](adr/).

## 1. Implementation status

The local development runbook, the continuous integration gates and the local database
migration procedure are executable today. Nothing is deployed, there is no staging or
production environment and no desktop release pipeline exists. Every runbook below is labelled
with the phase that delivers it. Do not attempt a runbook marked planned.

| Runbook                        | Status                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Local development              | Executable (Phase 0)                                                                           |
| CI gates                       | Executable (Phase 0)                                                                           |
| Database migrations            | Executable locally (Phase 2)                                                                   |
| Staging deploy                 | Planned (Phase 2)                                                                              |
| Production deploy and rollback | Planned (Phase 7)                                                                              |
| Backup and restore             | Planned (Phase 2, drills from Phase 7)                                                         |
| Incident response              | Planned (Phase 7)                                                                              |
| Desktop release                | Planned (Phase 8)                                                                              |
| Secret and key rotation        | Planned (Phase 3 onwards)                                                                      |
| Account moderation             | Executable through the database and `IdentityService` only (Phase 3); the admin API is Phase 7 |
| Matchmaking observation        | Readable from the server log today (Phase 4); dashboards and alerts are Phase 7                |
| Browser end-to-end suite       | Executable locally and in CI (Phase 5); the packaged shells are Phase 8                        |

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

| Name                           | Required         | Default (local)                | Phase                | Description                                            |
| ------------------------------ | ---------------- | ------------------------------ | -------------------- | ------------------------------------------------------ |
| `NODE_ENV`                     | Yes              | `development`                  | 0                    | Node runtime mode                                      |
| `APP_ENV`                      | Yes              | `local`                        | 0                    | One of `local`, `staging`, `production`                |
| `APP_VERSION`                  | Yes              | `0.1.0`                        | 0                    | Deployed application version, reported by `/v1/config` |
| `GIT_SHA`                      | Yes              | `local`                        | 0                    | Commit the build came from                             |
| `LOG_LEVEL`                    | Yes              | `debug`                        | 0                    | Pino log level                                         |
| `HOST`                         | Yes              | `127.0.0.1`                    | 0                    | Server bind address                                    |
| `PORT`                         | Yes              | `4000`                         | 0                    | Server port                                            |
| `PUBLIC_WEB_URL`               | Yes              | `http://localhost:5173`        | 0                    | Canonical web origin, used for links and redirects     |
| `CORS_ORIGINS`                 | Yes              | web origin plus desktop origin | 0                    | Comma separated allowed origins                        |
| `MIN_SUPPORTED_CLIENT_VERSION` | Yes              | `0.1.0`                        | 0 (enforced Phase 8) | Oldest client version the server accepts               |
| `DATABASE_URL`                 | Yes              | local PostgreSQL URL           | 0 (used Phase 2)     | PostgreSQL connection string                           |
| `DATABASE_POOL_MAX`            | Yes              | `10`                           | 0 (used Phase 2)     | Maximum pooled connections                             |
| `POSTGRES_PORT`                | No               | `5432`                         | 0                    | Host port for the local Docker PostgreSQL container    |
| `VITE_API_BASE_URL`            | Yes (web build)  | `http://localhost:4000`        | 0                    | API origin used by the web client                      |
| `VITE_APP_ENV`                 | Yes (web build)  | `local`                        | 0                    | Environment label shown in the client                  |
| `GUEST_SESSION_TTL_DAYS`       | No               | `30`                           | 2                    | Lifetime of a guest session token                      |
| `USER_SESSION_TTL_DAYS`        | No               | `30`                           | 3                    | Lifetime of an account session token                   |
| `CREDENTIAL_ATTEMPT_LIMIT`     | No               | `10`                           | 3                    | Credential attempts per address per route per 15 min   |
| `SENTRY_DSN`                   | Yes from Phase 7 | unset                          | 7                    | Sentry ingestion endpoint                              |
| `METRICS_ENABLED`              | No               | unset (off)                    | 7                    | Enables the Prometheus-compatible metrics endpoint     |

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

Status: planned (Phase 2).

1. Merge to the default branch. CI builds an immutable server image tagged with `GIT_SHA`.
2. Run the full test suite against the built image.
3. Apply pending database migrations to staging.
4. Deploy the image to staging.
5. Run the smoke test: `GET /health/live`, `GET /health/ready`, `GET /v1/config`, then a
   scripted match that plays a move, reconnects, and confirms the snapshot version advanced.
6. Confirm logs and error reporting show no new error classes.

## 8. Production deploy runbook

Status: planned (Phase 7).

Preconditions: staging smoke test passed, migrations applied to staging, no open Sev1 or Sev2
incident, and manual approval recorded in the release workflow.

Drain-and-reconnect procedure:

1. Apply pending database migrations.
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

## 9. Rollback procedure

Status: planned (Phase 7).

1. Redeploy the previous immutable image using the same drain-and-reconnect steps.
2. Never roll back a database migration automatically. If the previous image is incompatible
   with the applied schema, roll forward with a fix instead.
3. If the incident is caused by data corruption rather than code, follow the restore runbook.
4. Record the rollback in the changelog and open a follow-up with the root cause.

## 10. Backup and restore

Status: planned (Phase 2 for backups, Phase 7 for drills).

Policy:

| Item                   | Commitment                                                           |
| ---------------------- | -------------------------------------------------------------------- |
| Automated backups      | Daily, provided by the managed PostgreSQL service                    |
| Point-in-time recovery | Enabled where the provider supports it                               |
| Retention              | 14 days minimum                                                      |
| Off-provider copy      | Monthly encrypted export of critical tables to object storage        |
| RPO                    | 24 hours or better, and effectively minutes where PITR is available  |
| RTO                    | 4 hours for a single-region restore                                  |
| Restore drill          | Quarterly, restoring into a scratch instance and verifying integrity |

Restore runbook (planned, Phase 2):

1. Declare an incident and stop accepting new matchmaking.
2. Identify the target recovery point (latest backup or a PITR timestamp).
3. Restore into a new database instance, never over the live instance.
4. Verify integrity: row counts on `users`, `matches`, `match_events`; the unique
   `(match_id, sequence)` constraint holds; ratings reconcile with completed matches.
5. Repoint `DATABASE_URL` at the restored instance and restart the application.
6. Let active matches recover from their snapshots. Only if database recovery fails may active
   matches be declared aborted, and an aborted match applies no rating change.
7. Write the incident review, including data loss window and follow-up actions.

## 11. Incident response

Status: planned (Phase 7).

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

Alert catalogue and first actions:

| Alert                               | Likely cause                                 | First action                                                                      |
| ----------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| Readiness probe failing             | Database unreachable, migration stuck        | Check the database, then the last deploy                                          |
| Elevated 5xx rate                   | Regression, dependency failure               | Correlate with the last deploy, consider rollback                                 |
| Database connection pool exhaustion | Leak, slow queries, traffic spike            | Inspect long-running transactions, raise `DATABASE_POOL_MAX` only after diagnosis |
| Match transaction failures          | Lock contention, schema mismatch             | Inspect failing match ids, verify migration state                                 |
| Spike in `stale-version` rejections | Client retry bug, snapshot desynchronisation | Compare client version distribution, inspect one match's event log                |
| Clock calculation errors            | Clock invariant violation                    | Treat as Sev1, freeze deploys, inspect `turn_started_at` values                   |
| Backup failure                      | Provider or credential problem               | Re-run the backup, verify retention, escalate to the provider                     |
| Desktop update signing failure      | Expired or missing signing credentials       | Halt the release, rotate or renew credentials, never publish unsigned updates     |
| Post-deploy error regression        | Bad release                                  | Roll back, then investigate                                                       |

Production targets that these alerts protect: 99.9 percent API availability, better than 99.9
percent crash-free sessions, zero accepted illegal moves, zero duplicate rating applications,
zero lost committed match events, daily backups with at least 14 day retention.

## 12. Observability

Status: planned (Phase 7).

- Structured JSON logs via Pino. Every log line carries, where applicable: request id, socket
  session id, match id, pseudonymous actor id, command id, match version, event type, duration,
  result and error code.
- Logs must never contain tokens, passwords, magic links or authorization headers.
- Sentry receives server and client errors with release and environment tags.
- A Prometheus-compatible metrics endpoint is exposed when `METRICS_ENABLED` is set.
- Instrumentation boundaries are OpenTelemetry-ready so tracing can be added without moving
  call sites.

What exists today (Phase 4): the server logs one line per pairing, `paired two waiting players`,
carrying the match id, mode, time control, the wait the pairing ended and the depth of every
queue that still holds someone. That is the queue metric of specification section 17.1 until the
metrics endpoint arrives; a queue that is filling up is visible as a growing `depths` array and a
rising `waitedMs`. Queue depth can also be read in a running process through
`server.matchmaking.depths()`, which is what the tests assert against
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

Status: partly executable (Phase 3). There is no administrative endpoint yet
([`protocol.md` section 9.4](protocol.md) is Phase 7), so both procedures are run against the
database by an operator with access, and both are covered by automated tests.

Suspend an account:

1. Set `users.status = 'suspended'`, `users.suspended_at = now()` and a reason.
2. Revoke its sessions: `update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`.
3. The next request, socket handshake or match command from that account is refused. Step 2 is
   what makes a token already in the player's hands stop working; step 1 alone is enough for the
   gates, because suspension is read fresh at every gate.

Lift a suspension by setting `status = 'active'`, `suspended_at = null` and `suspended_reason = null`.
Sessions are not restored: the player signs in again.

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
