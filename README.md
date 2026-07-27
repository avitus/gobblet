# Gobblet Online

Real-time online player-versus-player **standard 4x4 Gobblet** for the web, macOS and
Windows. The server is authoritative for moves, clocks, outcomes, ratings and match
lifecycle.

- Product and engineering specification: [`docs/product-spec.md`](docs/product-spec.md)
- Formal rules restatement: [`docs/rules.md`](docs/rules.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Protocol: [`docs/protocol.md`](docs/protocol.md)
- Operations: [`docs/operations.md`](docs/operations.md)
- Decision records: [`docs/adr/`](docs/adr/)
- Rule/scenario to test traceability: [`docs/traceability-matrix.md`](docs/traceability-matrix.md)
- Known defects: [`docs/defects.md`](docs/defects.md)
- What stands between this and a public launch: [`docs/launch-blockers.md`](docs/launch-blockers.md)
- Compatibility matrix: [`docs/compatibility.md`](docs/compatibility.md)

## Current delivery status

| Phase | Scope                                    | Status      |
| ----- | ---------------------------------------- | ----------- |
| 0     | Repository, decisions, delivery skeleton | Delivered\* |
| 1     | Authoritative rules engine (`game-core`) | Delivered   |
| 2     | Persistence and match runtime            | Delivered   |
| 3     | Authentication, guests, profiles         | Delivered†  |
| 4     | Matchmaking, Elo, rematches              | Delivered   |
| 5     | Playable 3D client                       | Delivered   |
| 6     | Social surface and progression           | Delivered   |
| 7     | Administration and operations            | Delivered‡  |
| 8     | Desktop distribution                     | Delivered§  |
| 9     | Hardening and public launch              | Delivered¶  |

Phases are defined in `docs/product-spec.md` section 24. Later phases must not be
started before the exit criteria of the current phase are met.

† Phase 3 was redirected: the product must not depend on an external identity
provider, so authentication is first-party email and password
([ADR-0017](docs/adr/0017-first-party-email-password-authentication.md)). The
provider-only login methods, the hosted login page and the desktop PKCE flow of
specification sections 2.3 and 5.6 are therefore not delivered, and email delivery
does not exist yet, so no account can be verified in production. All of it is recorded
in
[`docs/product-spec.md` appendix P3](docs/product-spec.md#appendix-p3--phase-3-change-of-direction-first-party-authentication).

‡ Phase 7 delivers the alert conditions, the backup scripts and the deployment
workflows, but not a deployment: there is no hosting account, so paging a human, managed
backups and the staging and production runbooks stop where a host would begin
([ADR-0015](docs/adr/0015-single-region-deployment.md)).

§ Phase 8 delivers the desktop application and every step of its release, but no signed
installer exists: the Apple and Windows signing identities have not been bought, so the two
clean-machine exit criteria are deferred and each signing step fails with the name of what is
missing rather than producing an unsigned build.

¶ Phase 9 delivers the gates, the load harness, the launch dashboards, the legal pages, a
third browser engine and a verifiable rollback. Three of its exit criteria are judgements a
person makes, not assertions a test can hold: the two product-owner approvals and the
production readiness review. They are recorded as deferred, and the material each reviewer
needs is prepared in [`docs/operations.md` section 17](docs/operations.md).

\* Two Phase 0 exit criteria are open because they need infrastructure that does not
exist yet: the empty Tauri shells (deferred to Phase 8, no Rust toolchain or signing
identities) and the reachable staging health check (no hosting account or secrets).
Both are recorded in
[`docs/product-spec.md` appendix P0](docs/product-spec.md#appendix-p0--phase-0-exit-criteria-not-yet-met-recorded-not-silently-skipped)
and in section 18 of the traceability matrix.

## Requirements

- Node.js 22 or newer (see `.nvmrc`)
- pnpm 10 (`corepack enable pnpm`)
- PostgreSQL 16, either through Docker Compose or natively (`brew install postgresql@16`)
- Rust toolchain (only needed to build the desktop shell)

The test suites need a reachable PostgreSQL. They create their own databases from
`TEST_DATABASE_URL`, so there is no setup step: `gobblet_test` for the db package,
`gobblet_test_server` for the server, `gobblet_test_e2e` for the browser suite and
`gobblet_test_load` for the load harness. See `.env.example`.

## Quick start

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts PostgreSQL (via Docker Compose when available, otherwise it uses the
PostgreSQL already listening locally), applies the migrations, then starts the API server on
`http://localhost:4000` and the web client on `http://localhost:5173`.

## Repository layout

```
apps/
  web/            React and Vite client: 3D board, matchmaking, profiles, admin, legal pages
  server/         Fastify HTTP API, match runtime, Socket.IO gateway, admin and ops modules
  desktop/        Tauri v2 shell packaging the same client build
packages/
  game-core/      Pure, dependency-free authoritative rules engine
  protocol/       Zod schemas for the command envelope, snapshots, events and HTTP bodies
  db/             PostgreSQL schema, migrations and repositories (Drizzle)
  config/         Typed environment configuration (zod)
  auth/           Password hashing and opaque session token helpers
  design-system/  Tokens and UI primitives
  game-ui/        Board rendering tiers, controls and the shared match surface
e2e/              Playwright suite: Chromium, WebKit and, nightly, Firefox
ops/              Generated alert rules and Grafana dashboards
assets/           Brand, models, textures, audio and licence records
docs/             Specification, rules, architecture, protocol, operations, ADRs
scripts/          Local development entry point
```

Deployment, monitoring and backup definitions live with the workflows in `.github/workflows`
and the generated files in `ops/`; there is no `infra/` tree because there is no host yet.

## Common commands

| Command                  | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `pnpm dev`               | Database + server + web client                          |
| `pnpm build`             | Build every package and app                             |
| `pnpm typecheck`         | TypeScript project-wide type check                      |
| `pnpm lint`              | ESLint (includes package boundary rules)                |
| `pnpm test`              | Unit and property tests                                 |
| `pnpm test:coverage`     | Tests with coverage gates (game-core must stay at 100%) |
| `pnpm verify`            | Everything a pull request must pass                     |
| `pnpm format:check`      | Prettier formatting check                               |
| `pnpm test:e2e`          | Browser suite in Chromium and WebKit                    |
| `pnpm test:e2e:firefox`  | Browser suite in Firefox                                |
| `pnpm gates`             | Every quality gate of specification section 21          |
| `pnpm load`              | The load harness of specification section 20.8          |
| `pnpm ops:defects`       | Fail on an open critical or high-severity defect        |
| `pnpm ops:secrets`       | Scan every tracked file for a committed secret          |
| `pnpm ops:alerts`        | Render the alert rules from their definition            |
| `pnpm ops:dashboards`    | Render the launch dashboards from their definition      |
| `pnpm db:up` / `db:down` | Start/stop the local PostgreSQL container               |

## Non-negotiable architecture constraints

1. The server is authoritative. Clients never decide legality, outcomes, clocks,
   ratings or achievements.
2. Rule logic exists exactly once, in `@gobblet/game-core`, and is shared by client
   and server.
3. Every accepted move is persisted before it is acknowledged; active matches are
   never stored only in memory.
4. Real-time commands are versioned and idempotent.
5. `@gobblet/game-core` stays pure: no I/O, no framework imports, no wall-clock reads,
   no randomness.
