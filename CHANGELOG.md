# Changelog

All notable user-visible changes are documented here. This project uses semantic
versioning for desktop releases; the web client tracks the same version number.

## [Unreleased]

### Added

- Phase 0 delivery skeleton: pnpm/Turborepo monorepo, package boundaries, coding
  standards, local Docker Compose database, CI skeleton and `pnpm dev` as the single
  local start command.
- Phase 0 `@gobblet/config`: the typed environment variable schema that every server
  process validates at startup, mirrored by `.env.example`.
- Phase 0 `@gobblet/server`: Fastify application with `/health/live`, `/health/ready`
  (pluggable dependency probes) and the public `/v1/config` document.
- Phase 0 `@gobblet/web`: Vite and React client shell with the design tokens, an API
  reachability indicator and the shared rules engine running in the browser.
- Phase 0 documentation set: product specification, formal rules restatement,
  architecture, protocol, operations and the initial architecture decision records.
- Phase 1 `@gobblet/game-core`: the authoritative, dependency-free 4x4 Gobblet
  rules engine with move enumeration, terminal evaluation, canonical position
  keys, invariant assertions, unit tests and property-based tests.
- Phase 2 `@gobblet/protocol`: the wire contract as Zod schemas, shared between
  server and clients, including the command envelope, acknowledgements, snapshots,
  socket events and HTTP bodies.
- Phase 2 `@gobblet/db`: PostgreSQL schema and migrations for guest sessions,
  matches and the append-only match event log, with row-locking repositories.
- Phase 2 `@gobblet/server`: the authoritative match runtime (versioned idempotent
  commands, server-owned clocks, resignation, timeout, restart recovery), guest
  sessions, the Phase 2 HTTP surface and the Socket.IO gateway that lets two
  clients play a full match through the server.

- Phase 3 `@gobblet/auth`: `scrypt` password hashing with stored cost parameters and
  constant-time verification, plus opaque session and verification tokens that are
  stored only as SHA-256 hashes.
- Phase 3 accounts: registration, sign-in, sign-out, email verification, immutable
  unique usernames, guest-to-account claim that carries a guest's matches and its
  session, profile settings, the public profile page and suspension enforcement at
  match creation and at every match command.
- Phase 4 matchmaking: casual and ranked queues separated by time control, a rating
  window that widens while a player waits until it accepts anyone, colour assignment
  recorded with every match, and a queue that empties when the server drains.
- Phase 4 ratings: Elo with a K factor of 32 written in the same transaction that
  completes a ranked match, an append-only audit of every change, and the ranked
  record shown on a profile.
- Phase 4 rematches: a thirty second offer after a match ends, which creates a new
  match with the colours alternated and remembers the match it followed.
- Phase 5 client: the 3D board with three render tiers and a flat fallback, hidden
  piece rendering that never leaks what a cover conceals, keyboard play, synthesised
  sounds, the sign-in, registration, verification, profile, history and settings
  screens, and a Playwright suite that plays a complete match in Chromium and WebKit.
- Phase 5 packages: `@gobblet/design-system` for the tokens and primitives and
  `@gobblet/game-ui` for the board, both shared by the web client and the future
  desktop shell.
- Phase 6 social and progression: the eight preset messages and five reactions,
  relayed and never stored, each channel muted independently, achievements awarded in
  the transaction that completes a match, and daily, weekly, monthly and all-time
  leaderboards computed at read time.
- Phase 7 administration: the `admin` role on an account, a dashboard of gated routes
  in the player client, user search and detail, suspension and reinstatement, match
  inspection with its event log, corrective rating adjustment, achievement management,
  an operational summary, and an append-only audit log that every mutation writes to in
  the same transaction as the change.
- Phase 7 observability: structured logs carrying a pseudonym, Sentry and PostHog
  behind ports that stay inert without keys, client reports relayed through the server,
  and a Prometheus exposition on `GET /metrics` when a deployment asks for one.
- Phase 7 operations: `pnpm db:backup`, `pnpm db:restore` and `pnpm db:export-critical`
  with a manifest and a restore proved on every build, alert conditions defined once and
  rendered to `ops/alerts/gobblet.rules.yml`, and a deploy workflow with staging, an
  approval gate, production and the drain that keeps active matches.
- Phase 8 desktop: a Tauri v2 application that packages the same web build, keeps the
  session in the operating system's credential store, asks before closing during an
  active match and offers to resign, and checks for updates every six hours.
- Phase 8 releases: stable and beta channels served from our own API, so a rollout can
  be paused, resumed or promoted as an audited administrative action; a `/download`
  page that reads the same records with the size and SHA-256 of each installer; and a
  tagged release workflow that builds all three targets, signs them, publishes them to
  GitHub Releases, records them and promotes only after approval.
- Phase 9 quality gates: the twenty-five clauses of specification section 21 as one typed
  definition, run by `pnpm gates pull-request` and `pnpm gates release-candidate`. Four
  gates are deferred and each one names the identity, host or person it waits for.
- Phase 9 defect register: `docs/defects.md` is the release-candidate burn-down and
  `pnpm ops:defects` fails the build on an open critical or high-severity entry.
- Phase 9 secret scan: every tracked file is scanned by `pnpm ops:secrets` and by CI, with
  a reason recorded beside each allowlist entry.
- Phase 9 load harness: `pnpm load` drives real guests, sockets and legal moves against a
  running server, reports acknowledgement latency percentiles, and fails on a rejected
  move, a lost move or a match that completed twice. The report always states the scale it
  ran at as a share of the thousand-client target.
- Phase 9 launch dashboards: three Grafana dashboards defined once in TypeScript and
  rendered to `ops/dashboards` by `pnpm ops:dashboards`, with a test asserting every series
  a panel names is one the server actually emits.
- Phase 9 legal and support pages at `/privacy`, `/terms` and `/support`, linked from a
  footer on every screen and shipped in the desktop build. The privacy page lists every
  storage key the client writes and states that no cookie is set.
- Phase 9 Firefox: a third Playwright project, run nightly, alongside Chromium and WebKit.
- Phase 9 compatibility matrix, `docs/compatibility.md`: executed rows carry a date and a
  result; rows that need a person on hardware say `Not yet run` rather than nothing.
- Phase 9 rollback: the deploy workflow takes a `rollback` input that skips both migration
  jobs, and the production smoke check now fails unless the version serving is the version
  the run released.
- Phase 9 launch checklist in `docs/operations.md` section 17, including the scripted route
  list for the visual review and the blocked items with what unblocks each.
- Launch B1, hosting: Railway, one region and one replica per service, with the unit of
  deployment a container this repository defines. A Dockerfile per service, a Caddyfile so a
  reloaded deep link still resolves, and a `railway.json` per service holding the region, the
  health probe and a draining period longer than the server's own drain window.
- Launch B1, the drain window is real configuration: `SHUTDOWN_DRAIN_SECONDS` closes
  matchmaking on `SIGTERM`, gives matches in flight that long to settle, and only then closes
  the sockets and the pool. The image starts `node` directly, because a package manager as PID 1
  swallows the signal.
- Launch B1, a deploy now ends when the release serves rather than when the build finishes:
  `pnpm --filter @gobblet/server await-release` polls `GET /health/live` until the version it
  released is the one answering, and the workflow smokes only after that.
- Launch B1, a release is confirmed by the commit serving, not only the version. `APP_VERSION` is
  the package version, which does not change with every commit, so the wait and the smoke check
  could both be satisfied by the container the release was replacing. Both now compare `gitSha`.
- Launch B1, the checks refuse an address without a scheme instead of retrying it. A release spent
  five minutes and sixty attempts on `gobblet-production.up.railway.app`, because `PRODUCTION_URL`
  had no `https://` and nothing rejected it; the workflow guard now fails in seconds, the CLIs
  validate before polling, and the wait prints what each attempt found so it is visibly a wait.
- Launch B1, the service configurations no longer set watch patterns. A release that changed no
  client file was skipped by the platform, and `railway up --ci` waited for build output that a
  skipped deployment never produces, so the job hung with the client a version behind the server.
- Launch B1, production is released by one job rather than four. GitHub approves each job that
  references a protected environment separately, so a single release asked for approval again and
  again; migrating, releasing, waiting and smoking are now steps of `production-release`, and a
  test fails if any second job references the production environment.
- Launch B1, the deploy backup installs the PostgreSQL client the database needs. The runner ships
  `pg_dump` 16, the managed database is 18, and `pg_dump` refuses to dump a newer server, so the
  migration job failed with the archive unwritten. The major version is read from the database
  rather than pinned.
- Launch B1, the deploy jobs build the packages their command imports. `tsx` runs a CLI from
  source, but its import of `@gobblet/config` resolves to that package's `dist`, and a fresh
  runner has none: the migration job failed on `db:backup`, and the smoke jobs would have failed
  next. A test now rejects a job that runs a workspace command without building first.
- Launch B1, a deploy run that releases nothing now fails. The first production run finished
  green having skipped every job after the approval: without a status function in its condition,
  GitHub skips a job when anything upstream skipped, and `skip-staging` skips plenty. Each job
  now states which upstream results it requires, and a final `release-check` job, which runs
  whatever else did, fails the run unless the environments it was asked for were deployed and
  smoked.
- Launch B1, the server image hands every copy to the user it runs as. `COPY` keeps the build
  context's file modes and makes root the owner, so a tree checked out under a restrictive umask
  produced an image whose workspace manifests the `node` user could not read; Node reports an
  unreadable `package.json` as `Cannot find package '.../@gobblet/config/index.js'`, which reads
  like a missing build rather than a permission. A test now requires `--chown` on every copy in
  the stage that runs.
- Launch B1, the region is `us-west2`, beside the database rather than across the country from
  it: a split would have paid a cross-country round trip inside every persisted move
  ([ADR-0044](docs/adr/0044-the-deployment-runs-in-us-west.md)). A test now asserts both service
  configurations name the same single region.
- Launch B1, the Windows shell's origin, `http://tauri.localhost`, is now in `CORS_ORIGINS`
  alongside `tauri://localhost`: the packaged origin differs by platform, and with only the
  second the Windows build could not reach the API while the other two could.
- Launch B1, production can be released without a staging rehearsal, because staging does not
  exist yet: `skip-staging` stands the staging jobs down and the approval gate records the
  release as untried instead of passing it off as rehearsed.

### Fixed

- Two high-severity dependency advisories, found by the new audit gate on its first run:
  `drizzle-orm` raised to 0.45.2 for an SQL identifier escaping flaw, and `react-router`
  to 8.3.0 for a CSRF bypass in its server component mode. The whole suite, including all
  three browsers, is green on both.
- The browser download test could read a release published by another browser project
  running at the same time. The release catalogue is one list for the whole server, so the
  projects now take turns over it and each turn starts from an empty catalogue.
- The load harness could pair one match's client with another's, because the queue pairs
  whoever is waiting. Pairing is now serialised and a pair split across two matches fails
  the run instead of measuring rejections.
- A socket frame arriving while the server was shutting down could reach the database
  after the pool had closed. The gateway now refuses work once a shutdown has begun, and
  waits for the handlers already running, so no command is abandoned half-written.
- `.env.example` was missing five variables the configuration schema accepts, including
  the telemetry pseudonym secret. It is now checked against the schema in both directions
  by a test.
- The secret scanner reported its own rule definitions, which failed `pnpm ops:secrets`
  for anyone who ran it. The rules file is exempt from that one rule, with the reason
  next to it, and a test keeps the scanner quiet about itself.
- A database helper test asserted which of two connections won a lock rather than that
  neither ran inside the other, and failed when the loser connected first.

### Notes

- No public release yet. The first public milestone is the polished MVP described
  in `docs/product-spec.md`.
- One Phase 0 exit criterion remains open, a reachable staging health check, and is
  recorded in appendix P0 of `docs/product-spec.md`. The other, Tauri shells building on
  macOS and Windows CI, is met by the nightly `desktop-shell` job added in Phase 8.
- Phase 2 decisions and deviations, including the development only match creation
  route and the native PostgreSQL used locally instead of a container, are recorded
  in appendix P2 of `docs/product-spec.md`.
- Phase 3 replaced the hosted identity provider of the specification with first-party
  email and password authentication (ADR-0017). Passwordless email, Google, Apple,
  GitHub, the hosted login page, the desktop PKCE flow and password reset are not
  delivered, and email verification links are not delivered anywhere, because all of
  them need an external service. Appendix P3 of `docs/product-spec.md` records each
  one and the Phase 3 decisions.
- Phase 4 holds queues and rematch offers in the server process rather than in the
  database, so a restart discards both on purpose (ADR-0018); leaderboards remain
  Phase 6. Appendix P4 of `docs/product-spec.md` records each Phase 4 decision.
- Phase 5 runs the browser suite in Chromium and WebKit; Firefox is a manual pass until
  a runner is available, and the packaged shells are Phase 8. Appendix P5 records the
  render tier decisions and the synthesised sounds.
- Phase 6 stores no communication at all and computes every leaderboard at read time,
  so nothing has to be rebuilt after a rating correction. Appendix P6 records each
  Phase 6 decision.
- Phase 7 delivers the conditions, the scripts and the workflow, not the hosting: paging
  a human, managed daily backups, point-in-time recovery, retention and the encrypted
  upload wait for the host deferred by ADR-0015, and each is named as deferred in
  `docs/operations.md` section 10. Appendix P7 records each Phase 7 decision.
- Phase 8 ships the desktop application and every step of its release, but no signed
  installer exists yet: the Apple Developer Program membership, the Developer ID
  certificate and the Windows code-signing certificate have not been bought, so the two
  clean-machine exit criteria are deferred rather than met. Each signing step fails with
  the name of what is missing instead of producing an unsigned build. Appendix P8 records
  each Phase 8 decision, and `docs/operations.md` section 13 lists every secret.
- Phase 9 hardens and prepares the launch, but three exit criteria are judgements a person
  makes and cannot be asserted: the two product-owner approvals and the production readiness
  review. Each is recorded as deferred, with the material a reviewer needs prepared in
  `docs/operations.md` section 17. The load target is executable at the scale the machine
  running it carries; the thousand-client figure waits for the same host as ADR-0015.
  Appendix P9 records each Phase 9 decision.
