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

## Current delivery status

| Phase | Scope                                    | Status      |
| ----- | ---------------------------------------- | ----------- |
| 0     | Repository, decisions, delivery skeleton | Delivered\* |
| 1     | Authoritative rules engine (`game-core`) | Delivered   |
| 2     | Persistence and match runtime            | Delivered   |
| 3     | Authentication, guests, profiles         | Delivered†  |
| 4     | Matchmaking, Elo, rematches              | Not started |
| 5     | Playable 3D client                       | Not started |
| 6     | Social surface and progression           | Not started |
| 7     | Administration and operations            | Not started |
| 8     | Desktop distribution                     | Not started |
| 9     | Hardening and public launch              | Not started |

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

The server and database test suites need a reachable PostgreSQL. They create their own
databases (`gobblet_test`, `gobblet_test_server`) from `TEST_DATABASE_URL`; see
`.env.example`.

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

What exists today:

```
apps/
  web/          React + Vite web client shell (design tokens, /v1/config probe)
  server/       Fastify HTTP API, match runtime and Socket.IO gateway
packages/
  game-core/    Pure, dependency-free authoritative rules engine
  protocol/     Zod schemas for the command envelope, snapshots, events and HTTP bodies
  db/           PostgreSQL schema, migrations and repositories (Drizzle)
  config/       Typed environment configuration (zod)
  auth/         Password hashing and opaque session token helpers
docs/           Specification, rules, architecture, protocol, operations, ADRs
scripts/        Local development entry point
```

Planned by the target architecture (`docs/architecture.md`), created by the phase that
needs them:

```
apps/
  desktop/      Tauri v2 shell packaging the same client build (Phase 8)
packages/
  observability/ Logging, metrics and error reporting helpers (Phase 7)
  design-system/ Shared UI primitives on top of the tokens (Phase 5)
  test-utils/   Shared deterministic test helpers (Phase 5)
assets/         Brand, models, textures, audio and license records (Phase 5)
infra/          Deployment, monitoring and backup definitions (Phase 7)
```

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
