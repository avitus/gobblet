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

### Notes

- No public release yet. The first public milestone is the polished MVP described
  in `docs/product-spec.md`.
- Two Phase 0 exit criteria remain open (empty Tauri shells in CI, reachable staging
  health check) and are recorded in appendix P0 of `docs/product-spec.md`.
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
