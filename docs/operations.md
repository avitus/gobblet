# Operations

Runbooks, environment definitions and operational policy for Gobblet Online.

Related documents: [`architecture.md`](architecture.md), [`protocol.md`](protocol.md),
[`product-spec.md`](product-spec.md), [`adr/`](adr/).

## 1. Implementation status

The local development runbook, the continuous integration gates and the local database
migration procedure are executable today. Nothing is deployed yet: the host is decided and its
configuration is in this repository ([ADR-0043](adr/0043-railway-hosts-the-deployment.md)), but
the account, the project and the two services do not exist until someone creates them, which is
[B1](launch-blockers.md). Runbooks that end at that account stop there and say so. Every runbook
below is labelled with the phase that delivers it. Do not attempt a runbook marked planned.

| Runbook                        | Status                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Local development              | Executable (Phase 0)                                                                        |
| CI gates                       | Executable (Phase 0)                                                                        |
| Database migrations            | Executable locally (Phase 2)                                                                |
| Staging deploy                 | Deferred until production exists (section 2.1); run **Deploy** with `skip-staging`          |
| Production deploy and rollback | Workflow, images and service configuration complete (B1); waiting on the Railway account    |
| Backup and restore             | Executable (Phase 7); the round trip runs in CI, the managed schedule waits for a host      |
| Incident response              | Alert conditions and the catalogue are executable (Phase 7); paging waits for a host        |
| Desktop release                | Workflow written and its logic tested (Phase 8); signing waits for two identities           |
| Secret and key rotation        | Planned (Phase 3 onwards)                                                                   |
| Account moderation             | Executable through the admin API and dashboard (Phase 7)                                    |
| Matchmaking observation        | Readable from the log, the exposition and the dashboard (Phase 7)                           |
| Browser end-to-end suite       | Executable locally and in CI (Phase 5); the packaged shell is built by the release workflow |
| Quality gates                  | Executable (Phase 9); four of twenty-five are deferred and each names what it waits for     |
| Load target                    | Executable (Phase 9) at the scale the runner carries; the stated scale waits for a host     |
| Launch checklist               | Written (Phase 9); the three items a person signs wait for that person                      |

## 2. Environments

| Environment | `APP_ENV`    | Purpose                                             | Status              |
| ----------- | ------------ | --------------------------------------------------- | ------------------- |
| Local       | `local`      | Development on a workstation, Docker PostgreSQL     | Available (Phase 0) |
| Staging     | `staging`    | Pre-production verification, production-shaped data | Deferred (see 2.1)  |
| Production  | `production` | Player-facing single-region deployment              | Awaiting an account |

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

### 2.1 Creating the environments on Railway

Status: the repository side is complete and tested; the account side is [B1](launch-blockers.md).
The host is Railway, one region, one replica per service
([ADR-0043](adr/0043-railway-hosts-the-deployment.md)), and that region is `us-west2` because it
is where the database is ([ADR-0044](adr/0044-the-deployment-runs-in-us-west.md)). Production is
created first and staging later, which is why **Deploy** takes a `skip-staging` input: a release
with no rehearsal is allowed, but it is recorded as untried at the approval gate rather than
passed off as rehearsed.

In the Railway dashboard, once per environment:

1. Create a project, and inside it an environment named `production` (later, `staging`).
2. Add PostgreSQL to the project. Its `DATABASE_URL` is private to the project; the public proxy
   URL, `DATABASE_PUBLIC_URL`, is the one CI needs, because migrations run from GitHub.
3. Create a service from this repository for the server and name it `gobblet-server`. In its
   settings, set the config file to `apps/server/railway.json`; everything else about the build
   and the deploy comes from that file.
4. Create a second service from the same repository for the client, named `gobblet-web`, with the
   config file `apps/web/railway.json`.
5. Check that all three services, including PostgreSQL, are in the same region. A service in one
   region and its database in another pays a cross-country round trip on every write
   ([ADR-0044](adr/0044-the-deployment-runs-in-us-west.md)).
6. Generate a domain for each service. The server's domain is the API origin.
7. In each service's Settings, remove the branch deploy trigger. Releases go through the deploy
   workflow, which migrates first and stops at an approval; a push that deploys itself does
   neither.
8. Create a project token in **project** settings, which is what CI authenticates with. An
   account or workspace token from the account settings page is a different thing and the CLI
   rejects it as `RAILWAY_TOKEN`.

Step 3 is the one that is silently wrong if it is skipped: Railway looks for `railway.json` at the
repository root, this repository has one per service, and without the path set the build falls
back to the default builder and fails with `No start command detected`. There is no start script,
on purpose: the image says how to start it.

Neither service configuration sets watch patterns. They exist to stop a push from rebuilding a
service it did not touch, and pushes do not deploy this project; what they do instead is skip a
release the workflow asked for, and `railway up --ci` then waits forever for the build output a
skipped deployment never produces. The first release that changed only the server hung on the
client for exactly this reason.

Deploying by hand, with `railway up --ci --service gobblet-server`, uploads the working tree as
the build context, including its file modes. The image copies everything as the unprivileged user
it runs as, so a tree checked out under a restrictive umask still produces a working container
([`apps/server/Dockerfile`](../apps/server/Dockerfile)); without that, the manifests arrive
root-owned and unreadable, and Node reports an unreadable `package.json` as a missing package
rather than as a permission problem.

#### Service variables

Each service's Variables tab has a raw editor that accepts `.env` text. Paste the block for that
service, replacing `gobblet-server`, `gobblet-web` and `Postgres` with your own service names if
they differ; `${{service.VARIABLE}}` is Railway's reference syntax and `RAILWAY_PUBLIC_DOMAIN` is
provided by the platform, so neither domain has to be typed twice. Generate a domain for both
services first (step 5), or the references resolve to nothing.

Server service:

```dotenv
NODE_ENV=production
APP_ENV=production
LOG_LEVEL=info
HOST=0.0.0.0
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_POOL_MAX=10
PUBLIC_WEB_URL=https://${{gobblet-web.RAILWAY_PUBLIC_DOMAIN}}
CORS_ORIGINS=https://${{gobblet-web.RAILWAY_PUBLIC_DOMAIN}},tauri://localhost,http://tauri.localhost
MIN_SUPPORTED_CLIENT_VERSION=0.1.0
SHUTDOWN_DRAIN_SECONDS=30
GUEST_SESSION_TTL_DAYS=30
USER_SESSION_TTL_DAYS=30
CREDENTIAL_ATTEMPT_LIMIT=10
METRICS_ENABLED=true
METRICS_TOKEN=replace-me-with-32-hex-characters
TELEMETRY_PSEUDONYM_SECRET=replace-me-with-32-hex-characters
TELEMETRY_ATTEMPT_LIMIT=60
```

Client service:

```dotenv
VITE_API_BASE_URL=https://${{gobblet-server.RAILWAY_PUBLIC_DOMAIN}}
VITE_APP_ENV=production
```

Five things about those blocks, each of which is a way to get it wrong:

- **`PORT` is absent on purpose.** Railway provides one as long as no `PORT` variable is defined,
  and both images listen on it. Define your own and the domain's target port has to be changed to
  match.
- **`HOST=0.0.0.0`**, which is what the platform's proxy connects to. The schema's default is
  `127.0.0.1`, which is right on a workstation and unreachable in a container.
- **Two secrets to generate**, with `openssl rand -hex 32` for each: `METRICS_TOKEN`, which
  `GET /metrics` then requires as a bearer token, and `TELEMETRY_PSEUDONYM_SECRET`, which is the
  key behind the pseudonym in logs and analytics. Both must be at least sixteen characters, and
  rotating the pseudonym secret deliberately detaches new records from old ones (section 3).
- **Never paste an optional variable with an empty value.** `SENTRY_DSN=` is not "unset", it is
  an invalid URL, and the process refuses to start rather than run degraded. Sentry and PostHog
  arrive with [B5](launch-blockers.md); until then their lines must not exist.
- **Do not accept Railway's suggested variables.** It offers to import `.env.example` from the
  repository root, which is the local development template: `127.0.0.1`, `localhost` and a
  database on the workstation.

`APP_VERSION` and `GIT_SHA` are not set by hand: the deploy workflow sets them on the server
service for each release, which is what makes the smoke check able to tell one release from
another.

The three desktop origins in `CORS_ORIGINS` are the web client and the packaged shell, which is
`tauri://localhost` on macOS and Linux and `http://tauri.localhost` on Windows. Omitting the
second one blocks the Windows build from reaching the API while the other two work.

Variable changes are staged: review and deploy them in Railway, or the running container is still
using the old set.

#### Repository variables and secrets

In GitHub, on the `production` environment (later also `staging`):

| Kind     | Name                     | Value                                                               |
| -------- | ------------------------ | ------------------------------------------------------------------- |
| Secret   | `RAILWAY_TOKEN`          | the project token from step 6                                       |
| Secret   | `DATABASE_URL`           | the **public** PostgreSQL proxy URL, for the migration job          |
| Variable | `RAILWAY_SERVER_SERVICE` | the server service name from step 3                                 |
| Variable | `RAILWAY_WEB_SERVICE`    | the client service name from step 4                                 |
| Variable | `PRODUCTION_URL`         | the server's origin **including `https://`**                        |
| Variable | `PRODUCTION_CLIENT_URL`  | the client's origin, which the release checks after it publishes it |

`PRODUCTION_URL` is an origin, not a hostname: `https://gobblet-production.up.railway.app`. Every
check that decides whether a release worked fetches it, and a value without a scheme is not a URL
`fetch` can parse, so the release would wait out its whole window failing identically.

Add the required reviewers to the GitHub `production` environment at the same time; the approval
gate is only a gate if someone other than the workflow has to press it.

The deploy workflow refuses to start without any of these, names the missing one, and rejects a
host without a scheme, so a half-configured environment fails in seconds rather than at the end of
a timeout.

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
| `SHUTDOWN_DRAIN_SECONDS`       | No              | `30`                           | 9                    | How long a stopping process lets matches finish         |

Every Phase 7 variable is optional and every transport is inert without it, so a workstation
and the test suites run with none of them set
([ADR-0030](adr/0030-telemetry-behind-ports-relayed-through-the-server.md)). Two consequences
are worth stating: without `TELEMETRY_PSEUDONYM_SECRET` the server derives a per-process key, so
pseudonyms do not survive a restart and must not be compared across deployments; and rotating
that secret deliberately detaches new records from old ones, which is what makes it a pseudonym
rather than an identifier.

## 4. Local development runbook

Status: executable (Phase 0).

Prerequisites: Node.js 22 or newer (see [`.nvmrc`](../.nvmrc)), pnpm 10, PostgreSQL 16 either
natively (`brew install postgresql@16`) or through Docker Compose, and a Rust toolchain only when
building the desktop shell (Phase 8).

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts the local PostgreSQL container when Docker Compose is available and otherwise
uses the PostgreSQL already running on the workstation, then runs the server and the web client
through Turborepo. With neither, the server still boots and reports the database as unavailable on
`GET /health/ready`. The test suites create and migrate their own databases, so no manual setup
step is needed either way.

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

Since Phase 9 every pull request also runs `pnpm audit --audit-level high --prod` and the secret
scan of `pnpm ops:secrets`. The full list of gates, including the release-candidate set and the
four that are deferred, is one typed definition in `apps/server/src/ops/gates.ts`; run it with
`pnpm gates pull-request` or `pnpm gates release-candidate`
([ADR-0038](adr/0038-quality-gates-are-a-definition-not-a-checklist.md)). Nightly, the browser suite also runs
in Firefox and the desktop shell is built on macOS and Windows.

The browser and platform results those jobs produce are collected in
[`compatibility.md`](compatibility.md), together with the rows that still need a person on the
hardware.

## 6. Database migration procedure

Status: executable locally (Phase 2); against a deployed environment it runs from the deploy
workflow, over the public PostgreSQL proxy URL held as the `DATABASE_URL` secret (section 2.1). Locally, `pnpm db:generate` writes a migration from the Drizzle schema and
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

Status: the workflow is complete (Phase 9); the staging environment itself is deferred until
production exists ([ADR-0043](adr/0043-railway-hosts-the-deployment.md), section 2.1). Until then,
run **Deploy** with `skip-staging` and read this section as what will happen once staging is
created. It is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), run from the
Actions tab against a commit that is already green on CI.

1. `build` checks the commit out, builds every workspace with `APP_VERSION` and `GIT_SHA` set,
   and fails if `ops/alerts/gobblet.rules.yml` is not what the definitions render.
2. `staging-migrate` takes a backup first, then applies pending migrations, and keeps the
   pre-migration archive as a workflow artefact. A migration that cannot be applied stops the
   deploy here, with the previous container still serving.
3. `staging-deploy` releases both services with `railway up --ci`, then waits until the version
   it released is the version answering `GET /health/live`. The platform's own command returns
   when the build finishes, which is not the same thing as serving, so the wait is a separate
   step that fails the run rather than reporting a deployment that did not happen.
4. `staging-smoke` runs `pnpm --filter @gobblet/server smoke` against `STAGING_URL`: liveness,
   readiness, the configuration document, and the assertion a deploy actually cares about, which
   is that the version now serving is the version just released.
5. Confirm logs and error reporting show no new error classes.

The scripted match of section 22.2 step 5 is the browser suite, which needs the same host and is
deferred with it. That a match survives the process being replaced is proved against the runtime
in `apps/server/test/phase7-exit-criteria.test.ts`, which is what section 7.6 actually constrains.

## 8. Production deploy runbook

Status: complete except for the account it releases to (Phase 9, [B1](launch-blockers.md)).

Preconditions: staging smoke test passed, migrations applied to staging, no open Sev1 or Sev2
incident, and manual approval recorded in the release workflow. The `production-release` job is
that gate: reviewers are configured on the GitHub `production` environment, and nothing in the run
touches production until one of them approves. Migrating, releasing and smoking are steps of that
one job on purpose, because every job referencing a protected environment is approved separately,
and a reviewer asked the same question four times stops reading it.

Drain-and-reconnect procedure. Steps 2 to 5 are configuration rather than commands: they are
`healthcheckPath`, `overlapSeconds` and `drainingSeconds` in
[`apps/server/railway.json`](../apps/server/railway.json) and `SHUTDOWN_DRAIN_SECONDS` on the
service, and `drainingSeconds` is deliberately longer than the drain window so the platform never
kills a process that is still draining.

1. Apply pending database migrations, after taking the backup the workflow keeps as an artefact.
   The job installs the PostgreSQL client matching the managed database before dumping, because
   `pg_dump` refuses to dump a server newer than itself and the runner's client is older; the
   major version is read from the database rather than pinned, so an upgrade cannot quietly leave
   the backup behind.
2. The platform starts the new container and waits for `GET /health/ready` to succeed.
3. Traffic moves to the new container. The old one keeps the sockets it already has.
4. The old container receives `SIGTERM` and drains: the queue closes at once, and existing
   matches continue until they finish or `SHUTDOWN_DRAIN_SECONDS` elapses.
5. The old container exits. Remaining clients reconnect, call `match:sync` and re-synchronise
   from PostgreSQL.
6. The workflow waits for the released commit to be the one serving, printing what it finds on
   each attempt, and smokes it: liveness, readiness, the configuration document, and that the
   build answering is this run's commit. The commit is what makes that check meaningful, because
   the package version is the same string across commits that do not change it. Then you
   watch error rate, readiness and match transaction failures for the post-deploy observation
   window.
7. `release-check` has the last word. GitHub counts a skipped job as a success, so a run whose
   release jobs all skipped reports green having deployed nothing; this job runs whatever else
   did and fails the run unless the environments the run was asked for were both deployed and
   smoked. If a deploy ever looks suspiciously quick, this is the job to read.

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

`SIGTERM` reaches the process directly, because the image starts `node` rather than a package
manager ([`apps/server/Dockerfile`](../apps/server/Dockerfile)); a package manager as PID 1 would
swallow the signal and every word of this runbook would be decoration.
`drainAndClose` then waits out the window, and `BootstrappedServer.close` performs the drain in
this order: the queue closes, every open rematch offer is cancelled, then sockets close, then the
HTTP server, then buffered telemetry is flushed, then the pool. `apps/server/test/phase7-exit-criteria.test.ts` plays a move, drains, replaces the
process and re-synchronises the same match on a second instance, which is the deploy this runbook
describes with the container substitution taken out.

## 9. Rollback procedure

Status: the procedure is an input to the deploy workflow (Phase 9). What is tested is the part
that makes a rollback verifiable rather than hopeful: the smoke check refuses a deployment whose
serving version is not the version the run released, which is proved in
`apps/server/test/phase9-exit-criteria.test.ts`. A rollback is an ordinary release of an older
commit, so it uses the same command as a deploy.

To roll back:

1. Run the **Deploy** workflow with `ref` set to the last good commit and `rollback` set to true.
2. The workflow skips both migration jobs. Migrations are written to be backward compatible for
   exactly this reason: rolling the code back never rolls the schema back.
3. The staging and production smoke jobs assert that the version now serving is the version of
   the commit you named. A rollback that did not take effect fails the run rather than reporting
   success.
4. If the previous image is genuinely incompatible with the applied schema, do not roll back:
   roll forward with a fix, or follow the restore runbook if the cause is corrupted data.
5. Record the rollback in the changelog and open a follow-up with the root cause.

The observation window afterwards is the same as a deploy: error rate, readiness and match
transaction failures, against `ops/alerts/gobblet.rules.yml`.

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
alert to a person needs the hosted monitoring of [ADR-0015](adr/0015-single-region-deployment.md).

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
one. Every series a rule names is now emitted by the running server, including
`gobblet_desktop_signing_failures_total`, which a failing signing step of the desktop release
workflow reports through `POST /v1/admin/releases/build-events`. The one exception is
`gobblet_backup_last_success_timestamp_seconds`, which the backup script writes into a textfile
collector rather than the server. Delivering any of these to a human needs the hosted monitoring of
[ADR-0015](adr/0015-single-region-deployment.md) and is deferred with it; the conditions are not.

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

The administrative dashboard of [`product-spec.md` section 16](product-spec.md) reads the same
numbers over SQL rather than over the exposition, so
an administrator sees the deployment as a whole rather than one instance
([appendix P7.13](product-spec.md#appendix-p7--phase-7-decisions-and-deviations-recorded-not-silently-decided)).

Three launch dashboards are defined once in `apps/server/src/observability/dashboards.ts` and
rendered to `ops/dashboards` by `pnpm ops:dashboards`: service health, gameplay, and clients.
`apps/server/test/dashboards.test.ts` asserts that every series a panel names is one the running
server actually emits, so a dashboard cannot quietly point at a metric that was renamed. Importing
the JSON into an instance needs the hosted monitoring of
[ADR-0015](adr/0015-single-region-deployment.md) and is deferred with it
([ADR-0042](adr/0042-launch-dashboards-are-rendered-from-one-definition.md)).

The server also logs one line per pairing, `paired two waiting players`, carrying the match id,
mode, time control, the wait the pairing ended and the depth of every queue that still holds
someone. Queue depth can be read in a running process through `server.matchmaking.depths()`,
which is what the tests assert against
([appendix P4.9](product-spec.md#appendix-p4--phase-4-decisions-and-deviations-recorded-not-silently-decided)).

## 13. Desktop release runbook

Status: executable (Phase 8) except for the two signing identities nobody has bought yet. It is
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml), triggered by
a `v*` tag or run from the Actions tab. The steps that are not YAML live in
`apps/server/src/ops/desktop-release.ts` and are covered by `test/desktop-release.test.ts`, so a
release runs code that has been proved rather than shell that has only ever been read.

1. Set `apps/desktop/package.json` to the version being released and tag the commit `vX.Y.Z`.
   The `identify` job refuses a tag that disagrees with the manifest.
2. `bundle` runs three times: macOS on Apple silicon, macOS on Intel, Windows on x64. Each one
   builds `@gobblet/web` once, rewrites the updater endpoint to the deployment's host, checks
   for its signing secrets, and hands the result to the Tauri bundler, which signs, notarizes
   and staples where the platform asks for it
   ([ADR-0033](adr/0033-the-desktop-application-is-the-web-build-in-a-window.md)).
3. `tauri-action` uploads the installers and the signed update bundles to the GitHub Release for
   the tag ([ADR-0035](adr/0035-artifacts-live-in-github-releases.md)). The release is public, so
   a download needs no credentials.
4. `publish` records those artifacts against a release row on the `beta` channel through
   `POST /v1/admin/releases`, then asks `GET /v1/updates/beta` what a client on an older version
   would be offered and fails if the answer is not this release
   ([ADR-0034](adr/0034-updates-are-asked-of-our-own-server.md)).
5. `promote` waits on the GitHub `desktop-stable` environment. When a reviewer approves, it moves
   the same row to `stable`. Nothing is rebuilt and nothing is resigned: what beta tested is what
   stable receives.
6. Add the release to `CHANGELOG.md`. The download page at `/download` needs no edit; it reads
   the release rows.

### Secrets and variables the workflow needs

| Name                                 | Kind     | Needed by            | How to obtain it                                                                                                                                                                                             |
| ------------------------------------ | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PRODUCTION_URL`                     | Variable | Every job            | The deployment's https origin. Until a host exists the workflow stops here ([ADR-0015](adr/0015-single-region-deployment.md))                                                                                |
| `PRODUCTION_CLIENT_URL`              | Variable | `production-release` | The client's https origin. The release fetches the page a player loads and fails if it is served without a cache directive, because then a browser may keep the client it already has ([D-0009](defects.md)) |
| `STAGING_CLIENT_URL`                 | Variable | `staging-smoke`      | The same, for staging                                                                                                                                                                                        |
| `RELEASE_ADMIN_TOKEN`                | Secret   | `publish`, `promote` | A session token for an account holding the `admin` role, granted with `pnpm admin:grant`                                                                                                                     |
| `TAURI_SIGNING_PRIVATE_KEY`          | Secret   | Every bundle         | `pnpm --filter @gobblet/desktop exec tauri signer generate`. The public half is in `tauri.conf.json`                                                                                                         |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret   | Every bundle         | The passphrase chosen when the key was generated                                                                                                                                                             |
| `APPLE_CERTIFICATE`                  | Secret   | macOS bundles        | A Developer ID Application certificate exported as a base64 `.p12`. Needs an Apple Developer Program membership                                                                                              |
| `APPLE_CERTIFICATE_PASSWORD`         | Secret   | macOS bundles        | The password used for the `.p12` export                                                                                                                                                                      |
| `APPLE_SIGNING_IDENTITY`             | Secret   | macOS bundles        | The certificate's common name, `Developer ID Application: ...`                                                                                                                                               |
| `APPLE_ID`, `APPLE_TEAM_ID`          | Secrets  | macOS notarization   | The Apple ID that owns the team, and the ten-character team identifier                                                                                                                                       |
| `APPLE_APP_SPECIFIC_PASSWORD`        | Secret   | macOS notarization   | Generated at appleid.apple.com for that Apple ID                                                                                                                                                             |
| `WINDOWS_CERTIFICATE`                | Secret   | Windows bundle       | An organisation-validated or extended-validation code-signing certificate, base64 encoded                                                                                                                    |
| `WINDOWS_CERTIFICATE_PASSWORD`       | Secret   | Windows bundle       | The password for that certificate                                                                                                                                                                            |

Each of these has a step that checks for it and stops the release naming what is missing
([ADR-0036](adr/0036-signing-is-a-workflow-step-that-fails-loudly.md)). A failing signing step
also reports a build event to `POST /v1/admin/releases/build-events`, which is what makes
`gobblet_desktop_signing_failures_total` a real series and the `GobbletDesktopSigningFailure`
rule of section 12 something that can actually fire.

Two exit criteria are deferred with this, not waived
([appendix P8.6](product-spec.md#appendix-p8--phase-8-decisions-and-deviations-recorded-not-silently-decided)):
that a clean macOS machine installs without a security warning, and that a clean Windows machine
installs without a SmartScreen warning. The first needs the Apple identity above; the second
needs the Windows certificate and then reputation, which accrues with downloads and cannot be
tested before publication.

For a developer package, run the workflow with `allow-unsigned` set and `publish` cleared. It
produces installers nobody should distribute and refuses to record them as a release.

### Channels and controls

| Control                  | Behaviour                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Channels                 | `stable` and `beta`. A tagged build enters `beta`; promotion is a separate, approved job                                            |
| Rollout pause            | `POST /v1/admin/releases/:releaseId/pause` with a reason. The endpoint immediately offers the previous unpaused release, or nothing |
| Promotion                | `POST /v1/admin/releases/:releaseId/promote` with a reason. The artifacts are untouched                                             |
| Minimum supported client | `MIN_SUPPORTED_CLIENT_VERSION` on the server refuses the handshake of anything older                                                |
| Signing requirement      | The publish schema requires a signature per artifact, so an unsigned build cannot be recorded                                       |

Every one of those mutations is an audited administrative action visible at `/admin/audit`.

### Failed update recovery

1. Pause the rollout with a reason. Clients on the previous version are offered nothing on their
   next check, which is at most six hours away.
2. Confirm players can still launch what they have. A failed update never touches the installed
   application: the bundle is verified against the public key before Tauri replaces anything, and
   a failure is dismissed and reported
   ([appendix P8.8](product-spec.md#appendix-p8--phase-8-decisions-and-deviations-recorded-not-silently-decided)).
3. Watch `gobblet_desktop_update_outcomes_total{outcome="failure"}` fall back to its baseline.
4. Publish the fixed build to `beta`, check the manifest, then promote. Raise
   `MIN_SUPPORTED_CLIENT_VERSION` only after a fixed build is available on `stable`, so nobody is
   locked out without a path forward.
5. Direct anyone still stuck to `/download` for a full reinstall.

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

## 16. Load runbook

Status: executable (Phase 9), at whatever scale the machine running it can carry. The target of
[`product-spec.md` section 20.8](product-spec.md) is a thousand connected clients in five hundred
concurrent matches with a p95 acknowledgement latency under a hundred milliseconds. That scale
needs a host; the harness does not
([ADR-0037](adr/0037-the-load-harness-is-ours.md)).

The harness drives real sessions: a guest for each seat, a socket each, the casual queue, and
legal moves chosen by the same engine the server uses. It measures acknowledgement latency, moves
the server rejected, committed moves lost to a version that skipped, and matches that ended twice.

```bash
# No host named: the run starts a server of its own, against a database of its own,
# and stops it afterwards. This is what the release gate runs.
pnpm load

# Against a host, at the scale section 20.8 asks for.
LOAD_MATCHES=500 LOAD_MOVES_PER_MATCH=20 LOAD_WAVE_SIZE=50 pnpm load https://gobblet.example
```

| Variable                    | Default    | What it changes                                                                         |
| --------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `LOAD_MATCHES`              | `25`       | Concurrent matches. Two clients are connected for each.                                 |
| `LOAD_MOVES_PER_MATCH`      | `12`       | Moves each match attempts before it is torn down.                                       |
| `LOAD_WAVE_SIZE`            | `25`       | How many matches start together, so a run ramps.                                        |
| `LOAD_SEED`                 | `20260727` | Makes a run reproducible: the same seed picks the same moves.                           |
| `LOAD_TIME_CONTROL_SECONDS` | `300`      | The queue the clients join.                                                             |
| `LOAD_BASE_URL`             | none       | A host, when one is not given as an argument. Without it the run starts its own server. |

The report always states the scale it ran at, as a share of the target, and says plainly when a
run does not prove the target. A run that loses a move, has one rejected, or sees a match complete
twice fails regardless of how fast it was: latency is only meaningful when nothing was dropped.

Reading a failing run:

| Line                                   | What it means                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `matches never started`                | Pairing or connection failed. Look at queue depth and socket connections first.          |
| `legal moves were rejected`            | The server refused a move the engine says is legal. This is a correctness bug, not load. |
| `committed moves were lost`            | A version skipped. Persist-before-acknowledge is not holding; stop and investigate.      |
| `matches completed more than once`     | A client was told twice that its match ended. Check the completion transaction.          |
| `p95 acknowledgement latency ... over` | The latency target. Check database transaction duration and pool waiting first.          |

## 17. Launch checklist

Status: written (Phase 9). Every item is executable, or blocked and named as blocked. The three
items a person signs are the Phase 9 exit criteria that no test can assert
([appendix P9.12 and P9.13](product-spec.md)).

### 17.1 Before the release candidate

| Item                                                     | How                                                          | State                                     |
| -------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| Every pull-request gate passes                           | `pnpm gates pull-request`                                    | Executable                                |
| Every release-candidate gate passes or is named deferred | `pnpm gates release-candidate`                               | Executable; four gates deferred           |
| No open critical or high-severity defect                 | `pnpm ops:defects`                                           | Executable                                |
| No secret in a tracked file                              | `pnpm ops:secrets`                                           | Executable                                |
| Dashboards match the definitions                         | `pnpm ops:dashboards && git diff --exit-code ops/dashboards` | Executable                                |
| Alert rules match the definitions                        | `pnpm ops:alerts && git diff --exit-code ops/alerts`         | Executable                                |
| Browser suite green in Chromium and WebKit               | `pnpm test:e2e`                                              | Executable                                |
| Browser suite green in Firefox                           | `pnpm test:e2e:firefox`                                      | Executable, nightly in CI                 |
| Compatibility matrix rows dated                          | [`compatibility.md`](compatibility.md)                       | Executable rows green; manual rows open   |
| Load target run and reported at its scale                | `pnpm load`                                                  | Executable; the stated scale needs a host |
| Backup restores                                          | `pnpm --filter @gobblet/db run test`                         | Executable                                |

### 17.2 The three signatures

These are judgements, not assertions. What is prepared for each is named so the review is the
same review every time.

**Product owner approves visual quality.** Walk these routes at 1280x800 and at 1024x640, in a
light and a dark system theme, signed out and then signed in:

`/`, `/play`, a live `/match/:id` in each rendering tier, `/history`, `/leaderboard`,
`/profile`, `/settings`, `/download`, `/privacy`, `/terms`, `/support`, `/sign-in`, `/register`,
and, as an administrator, `/admin` and each of its pages.

**Product owner approves official-rule behavior.** The rules are stated in
[`rules.md`](rules.md) and each one is asserted by the `@gobblet/game-core` suite. Play a match
against yourself in two browser windows and confirm the four rules a player feels: a gobble only
covers a strictly smaller piece, lifting a piece that reveals an opponent line of four loses
unless the destination breaks it, three of a colour visible in a line lets the opponent enter
from the reserve onto that line, and the clock only runs for the player to move.

**Production readiness review is signed off.** Blocked: the review covers a deployment, and
nothing is deployed until the Railway account exists ([B1](launch-blockers.md)). The checklist it will use is section
17.1 above plus the deferred items in section 17.3.

### 17.3 Blocked at launch, with what unblocks each

Each of these is expanded in [`launch-blockers.md`](launch-blockers.md), with what "done" looks
like and which repository secret or variable it fills.

| Item                                        | Blocked by                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Staging and production deploys              | A Railway account ([ADR-0043](adr/0043-railway-hosts-the-deployment.md)) |
| Managed backup schedule and off-site copies | The same account                                                         |
| Paging a human                              | A monitoring service and an on-call rotation                             |
| macOS binary signed and notarized           | An Apple Developer Program membership and a Developer ID                 |
| Windows binary signed                       | A code-signing certificate                                               |
| Auto-update from a prior public version     | A published prior version, on a clean machine                            |
| Load target at its stated scale             | A host that can carry a thousand clients                                 |
| Safari, packaged web views, discrete GPUs   | A person on the hardware ([`compatibility.md`](compatibility.md))        |
| Screen reader pass                          | A person with VoiceOver and NVDA (defect D-0002)                         |
| Email delivery, so an account can verify    | A mail sender ([appendix P3](product-spec.md))                           |

### 17.4 On the day

1. Tag the release and run the **Deploy** workflow against the tag.
2. Watch the service health dashboard for the observation window. The alert that matters most is
   `GobbletErrorRegressionAfterDeploy`.
3. Publish the desktop release to the beta channel first, then promote it once the update
   outcomes on the clients dashboard show installs rather than failures.
4. If anything on the dashboards is worse than before the deploy, roll back with section 9. A
   rollback is cheap and does not need a meeting.
