# Architecture

Gobblet Online is a real-time online player-versus-player implementation of standard 4x4
Gobblet, delivered as a web application and as directly downloadable signed macOS and Windows
desktop applications. This document describes the system structure, the runtime topology, the
package boundaries and the data flows that keep the server authoritative.

Related documents:

- Product and engineering requirements: [`product-spec.md`](product-spec.md)
- Formal rules restatement: [`rules.md`](rules.md)
- Wire contracts: [`protocol.md`](protocol.md)
- Runbooks and environments: [`operations.md`](operations.md)
- Decision records: [`adr/`](adr/)
- Rule and scenario coverage: [`traceability-matrix.md`](traceability-matrix.md)

## 1. Scope and status legend

Every component below carries an implementation status. Only two phases exist today: Phase 0
(repository, decisions and delivery skeleton) and Phase 1 (the authoritative rules engine
`@gobblet/game-core`). Anything marked planned does not exist yet, is not deployed and must
not be assumed to work.

| Marker             | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| Implemented        | Exists in the repository today and is covered by tests             |
| Skeleton (Phase 0) | Scaffolding exists so the delivery loop runs, no product behaviour |
| Planned (Phase N)  | Designed and specified here, not built                             |

## 2. System context

Status: the only externally reachable surfaces implemented today are the server health
endpoints and `GET /v1/config`. All other interactions are planned.

```text
                     +--------------------------+
                     |        Players           |
                     |  web browser | desktop   |
                     +------+-------------------+
                            |
             static assets  |  HTTPS /v1  +  Socket.IO (WSS)
                            |
        +-------------------v--------------------+
        |          CDN / TLS edge                |   (Phase 5 for web hosting)
        |  static web bundle, cache, TLS         |
        +-------------------+--------------------+
                            |
        +-------------------v--------------------+
        |   Gobblet application server           |
        |   Fastify HTTP + Socket.IO realtime    |
        |   authoritative rules, clocks, ratings |
        |   first-party sessions (Phase 3)       |
        +----+-------------------------+---------+
             |                         |
             | SQL                     | telemetry
             |                         |
   +---------v----------+     +--------v-----------------+
   | Managed PostgreSQL |     | Sentry + metrics scrape  |
   | (Phase 2)          |     | (Phase 7)                |
   +--------------------+     +--------------------------+

   +-----------------------------------------------------+
   | GitHub Releases: desktop installers and signed      |
   | update bundles (Phase 8). The manifest that points  |
   | at them is served by the API, not published here.   |
   +-----------------------------------------------------+
```

## 3. Runtime components

```text
+----------------------------+        +----------------------------+
|  apps/web (React + Vite)   |        |  apps/desktop (Tauri v2)   |
|  routing, HTTP data,       |        |  packages the identical    |
|  socket client, 3D board   |        |  web build, secure storage |
+-------------+--------------+        +-------------+--------------+
              |    shares @gobblet/game-core, protocol, game-ui, design-system
              +----------------------+-------------+
                                     |
                    HTTPS /v1 + Socket.IO (single origin)
                                     |
                 +-------------------v--------------------+
                 |           apps/server (Node)           |
                 |                                        |
                 |  Fastify HTTP  |  Socket.IO gateway    |
                 |  ------------- |  -------------------  |
                 |  Zod boundary validation (protocol)    |
                 |  match runtime (command application)   |
                 |  clock service (derived remaining ms)  |
                 |  matchmaking / presence / fan-out      |
                 |    (interfaces, in-process today)      |
                 |  rules via @gobblet/game-core          |
                 |  persistence via @gobblet/db           |
                 +-------------------+--------------------+
                                     |
                          +----------v-----------+
                          |     PostgreSQL       |
                          |  users, matches,     |
                          |  match_events,       |
                          |  ratings, audit      |
                          +----------------------+
```

| Component                | Responsibility                                                        | Status                                              |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/web`               | All player-facing UI, optimistic feedback, socket client              | Implemented (Phase 5)                               |
| `apps/desktop`           | Tauri v2 shell: credential store, close confirmation, updater         | Implemented (Phase 8)                               |
| `apps/server`            | Authoritative HTTP API and real-time runtime                          | Implemented (Phase 4), gameplay surface grows later |
| `apps/admin`             | Not created: the surface is gated routes inside `apps/web`            | Superseded (Phase 7, appendix P7.1)                 |
| `packages/game-core`     | Pure rules engine: legality, victory detection, immutable transitions | Implemented (Phase 1)                               |
| `packages/protocol`      | Zod schemas and shared command, event and snapshot types              | Implemented (Phase 2)                               |
| `packages/db`            | Drizzle schema, migrations, transactional repositories                | Implemented (Phase 2)                               |
| `packages/config`        | Typed environment parsing and validation                              | Implemented (Phase 0)                               |
| `packages/auth`          | Password hashing and verification, opaque session token helpers       | Implemented (Phase 3)                               |
| `packages/observability` | Not created: the server owns it, in `apps/server/src/observability`   | Superseded (Phase 7, appendix P7.19)                |
| `packages/design-system` | CSS custom property tokens and shared primitives                      | Implemented (Phase 5)                               |
| `packages/game-ui`       | Shared React game UI reused by web and desktop                        | Implemented (Phase 5)                               |
| `packages/test-utils`    | Deterministic fixtures and helpers shared by test suites              | Grows with each phase's suites                      |

The server runs HTTP and real-time transport in one Node process (see
[ADR-0006](adr/0006-fastify-socketio-server.md)). There is exactly one authoritative
Socket.IO origin.

## 4. Deployment topology

Status: planned (Phase 2 for the first deployed environment, Phase 7 for full observability
and administration). Nothing is deployed today.

```text
                        +-----------------------------+
                        |  CDN / TLS edge (global)    |
                        |  static web bundle          |
                        +--------------+--------------+
                                       |
                    single region (recommended US Central)
                                       |
                 +---------------------v---------------------+
                 |            Application host               |
                 |  +----------------+  +----------------+   |
                 |  | server         |  | server         |   |
                 |  | container A    |  | container B    |   |
                 |  | (active)       |  | (deploy slot)  |   |
                 |  +--------+-------+  +--------+-------+   |
                 +-----------|-------------------|-----------+
                             |                   |
                             +---------+---------+
                                       |
                          +------------v-------------+
                          |  Managed PostgreSQL      |
                          |  automated backups, PITR |
                          +--------------------------+
```

Topology decisions and their consequences are recorded in
[ADR-0015](adr/0015-single-region-deployment.md):

- One region only. "Global" means globally reachable from that region, not uniform worldwide
  latency. Distant players see higher round-trip times, which matters because clocks are not
  latency compensated.
- One or two application containers on a single host exist for deploy continuity
  (drain-and-reconnect), not for horizontal throughput scaling.
- No Redis in the initial deployment. Matchmaking, presence and socket fan-out sit behind
  interfaces so a Redis-backed adapter can be introduced without touching call sites.
- Managed PostgreSQL provides backups and point-in-time recovery instead of self-managed
  database operations.
- Desktop installers and signed update bundles are served from GitHub Releases, never from the
  application server ([ADR-0035](adr/0035-artifacts-live-in-github-releases.md)). The update
  manifest is the exception: it is computed by the API from a release row, so a rollout can be
  paused without touching a published asset
  ([ADR-0034](adr/0034-updates-are-asked-of-our-own-server.md)).

## 5. Repository structure

```text
apps/        web/, desktop/, server/, admin/
packages/    game-core/, protocol/, game-ui/, design-system/, db/, auth/,
             observability/, config/, test-utils/
e2e/         Playwright browser suite: helpers/, setup/, tests/
assets/      brand/, models/, textures/, audio/, licenses/
infra/       docker/, deployment/, monitoring/, backup/
docs/        Specification, rules, architecture, protocol, operations, ADRs
.github/workflows/  CI and release workflows
```

Responsibilities per package are listed in section 3.

Every workspace package is named `@gobblet/<directory-name>`, is ESM only, and is built with
tsup into `dist/` with generated type declarations that are exposed through the package
`exports` map (see [ADR-0016](adr/0016-esm-tsup-internal-packages.md)). Turborepo owns the
task graph: `build`, `typecheck`, `lint`, `test`, `test:coverage`,
`test:properties:nightly` and `dev`, with `dependsOn: ["^build"]` so consumers always compile
against built declarations.

## 6. Package dependency rules

```text
                    apps/desktop
                         |  packages the build of
                         v
   design-system --> game-ui --> apps/web <-- config
                                   |   \
                                   |    \--> protocol --> zod
                                   v              ^
                              game-core -----------+ (types only)
                                   ^
                                   |
   observability --> apps/server <--+
        auth ---------^   |
                          +--> db --> protocol, config
```

| Package     | May depend on                                                    | Must never depend on                                                                                            |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `game-core` | nothing                                                          | any workspace package, node builtins, zod, react, three, socket.io, fastify, pg, drizzle, `Date`, `Math.random` |
| `protocol`  | `zod`, types from `game-core`                                    | runtime infrastructure, react, fastify, db                                                                      |
| `db`        | `protocol`, `config`                                             | react, three, socket.io, fastify routes                                                                         |
| `server`    | `game-core`, `protocol`, `db`, `config`, `observability`, `auth` | react, three, `game-ui`                                                                                         |
| `web`       | `game-core`, `protocol`, `game-ui`, `design-system`, `config`    | `db`, `auth` internals, fastify                                                                                 |
| `desktop`   | the built `web` artifact                                         | direct database or server internals, and any client code: the shell is Rust plus a bundled `dist/`              |

Enforcement:

- ESLint `no-restricted-imports` blocks every forbidden import group inside
  `packages/game-core/src/**`, including `@gobblet/*` (game-core is the lowest layer),
  `node:*`, `zod`, react, three, socket.io, fastify and persistence packages.
- ESLint `no-restricted-globals` blocks `Date`, `performance`, `crypto`, `fetch` and
  `process` inside `game-core`, and `no-restricted-syntax` blocks `Math.random`, `Date`
  member access and `new Date(...)`.
- The rules live in [`eslint.config.mjs`](../eslint.config.mjs) and run as part of
  `pnpm lint` and `pnpm verify`. Status: implemented (Phase 0).
- Purity is the reason the engine can be reused unchanged by a future AI opponent package and
  by a future mobile client (see [ADR-0012](adr/0012-pure-shared-rules-engine.md)).

## 7. Authority model

The server decides move legality, victory and draw, clock remaining time, timeout, rating
change, achievements and match lifecycle. Clients run the same shared engine only to render
optimistic feedback and to disable obviously illegal interactions, and they interpolate the last
clock sync for display. A client result never becomes truth, and a client never declares a
timeout.

### 7.1 Identity and eligibility

Status: implemented (Phase 3). Every credential resolves through one path, so no surface can
disagree about who is calling:

```text
Authorization: Bearer <token>
        |
        v
  identity.authenticate(token)  -->  account session? --> actorType "user"
        |  no
        v
  guests.authenticate(token)    -->  guest session?   --> actorType "guest"
        |  no
        v
      401 unauthenticated
```

A claimed guest token resolves as the account that claimed it, because the claim inserts the
guest token's hash as an account session. Suspension is read fresh at every gate rather than
cached in the session, so a suspension lands on the next action:

| Gate                               | Where                                             |
| ---------------------------------- | ------------------------------------------------- |
| Sign-in                            | `src/identity/service.ts`                         |
| Socket handshake                   | `src/socket/gateway.ts`                           |
| Every `match:move`, `match:resign` | `src/socket/gateway.ts`                           |
| Match creation                     | `src/match/eligibility.ts`                        |
| Queue entry, and again on pairing  | `src/matchmaking/service.ts` via `eligibility.ts` |
| A rematch offer, and its answer    | `src/matchmaking/rematch.ts` via `eligibility.ts` |

`src/match/eligibility.ts` is the only place that decides who may be seated: guests are casual
only, and a ranked seat needs an account with a verified email. A queue re-reads it when a
pairing is attempted, because a suspension may land while a player waits
([`product-spec.md` appendix P3](product-spec.md#appendix-p3--phase-3-change-of-direction-first-party-authentication)).

## 8. Data flow: an accepted move

Status: implemented (Phase 2) in `apps/server/src/match/runtime.ts`. The sequence below is the
contract the match runtime implements.

```text
Client                                  Server                          PostgreSQL
  |                                       |                                  |
  | 1 local legality check (game-core)    |                                  |
  | 2 optimistic render (pending state)   |                                  |
  |                                       |                                  |
  | 3 match:move                          |                                  |
  |   { commandId, matchId,               |                                  |
  |     expectedVersion, sentAtClient,    |                                  |
  |     payload }                         |                                  |
  |-------------------------------------->|                                  |
  |                                       | 4 Zod validate envelope          |
  |                                       | 5 authorize participant          |
  |                                       | 6 BEGIN                          |
  |                                       |--------------------------------->|
  |                                       | 7 load snapshot FOR UPDATE       |
  |                                       | 8 idempotency check on           |
  |                                       |   (match_id, command_id)         |
  |                                       | 9 clock check:                   |
  |                                       |   effective_remaining <= 0 ?     |
  |                                       |   -> terminal timeout            |
  |                                       | 10 game-core applyMove           |
  |                                       | 11 append match_events row       |
  |                                       | 12 update snapshot, version + 1, |
  |                                       |    clocks, turn_started_at       |
  |                                       | 13 ratings on completion         |
  |                                       | 14 COMMIT                        |
  |                                       |<---------------------------------|
  | 15 ack { ok: true, commandId,         |                                  |
  |          newVersion }                 |                                  |
  |<--------------------------------------|                                  |
  | 16 reconcile optimistic state         | 17 match:move-committed to both  |
  |                                       | 18 match:clock-sync to both      |
```

Invariants:

- Persist before acknowledge, so a client that received `ok: true` can rely on durability
  ([ADR-0010](adr/0010-match-event-persistence.md)).
- One transaction per accepted command: event append, snapshot update, clock update and, on
  completion, the rating update all commit together.
- Rejections are typed. `stale-version`, `not-your-turn`, `illegal-move`, `match-ended`,
  `not-authorized`, `clock-expired` and `duplicate-command` are the only reasons, and a
  rejection may carry a fresh snapshot for resynchronisation
  ([ADR-0011](adr/0011-versioned-idempotent-commands.md)).
- Active matches are never memory-only. The database row is the match.

## 9. Data flow: reconnection and recovery

Status: implemented (Phase 2) in `apps/server/src/socket/gateway.ts`.

```text
Client reconnects
  |
  | session:authenticate  ---------------> verify session, bind socket
  | match:sync { matchId } -------------->
  |                                        load canonical snapshot from PostgreSQL
  |                                        derive effective clocks from turn_started_at
  |                                        if a side already expired -> settle match first
  | <-------------- match:snapshot { version, state, clocks, players, status }
  | <-------------- match:clock-sync
  |
  | discard all local optimistic state, render the server snapshot
```

If the socket transport is unavailable but HTTP is reachable, participants can recover state
through `GET /v1/matches/:matchId/snapshot` (implemented, Phase 2). Recovery never depends on
in-memory server state, so a client can reconnect to a different container after a deploy.

## 10. Clock architecture

Status: implemented (Phase 2). Recorded in
[ADR-0009](adr/0009-server-authoritative-clocks.md).

Chess-style clocks, no increment, no delay, no latency compensation. Persisted fields on the
match row: `light_remaining_ms`, `dark_remaining_ms`, `active_player`, `turn_started_at`,
`last_clock_commit_at`, `status`, `version`.

```text
effective_remaining = stored_remaining_ms - (server_now - turn_started_at)
```

- Stored clocks are never decremented by a timer. They are only rewritten when a turn ends,
  which makes restart recovery exact.
- Clocks keep running while a player is disconnected.
- `match:clock-sync` is emitted every 2 seconds, every 250 milliseconds when the active clock
  is below 10 seconds, and immediately after an accepted move, after a reconnect and after a
  visibility change.
- The client interpolates between syncs for display only and never declares a timeout.

## 11. Restart, recovery and deploy draining

Status: restart recovery implemented (Phase 2) in `apps/server/src/bootstrap.ts`; draining
implemented (Phase 7) in `BootstrappedServer.close`, and the deploy workflow that calls for it is
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), waiting only on a host.

On process start:

1. Load every active match snapshot from PostgreSQL.
2. Derive effective remaining time for the active side from `turn_started_at`.
3. Mark any match whose active clock already expired as terminal, applying the timeout
   outcome and rating change, before accepting new commands for it.
4. Only then start accepting matchmaking and match commands.

On deploy (drain-and-reconnect): start the new container and wait for `GET /health/ready`, stop
routing new matchmaking to the old container, let existing sockets drain until their matches
finish or the maximum drain period elapses, then let remaining clients reconnect to the new
container and re-synchronise from PostgreSQL. Because match state lives in the database and
clocks are derived, a drained client loses no progress. The full procedure is in
[`operations.md`](operations.md).

Matchmaking is the exception, because a queue entry and a rematch offer are the only state a
process holds that is not written down ([ADR-0018](adr/0018-in-process-matchmaking-and-rematch-offers.md)).
Draining closes the queue first: every waiting player is told with a recoverable `queue_closed`
error, every open offer is cancelled, and nothing requeues a player automatically, which is what
specification section 7.5 requires.

## 12. Deliberate scaling seams

The initial deployment is intentionally small. These seams exist so growth does not require a
rewrite:

| Seam              | Initial implementation               | Replaceable with                                   | Status                                                |
| ----------------- | ------------------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| Matchmaking queue | In-process queue behind an interface | Shared queue (Redis or database backed)            | Implemented (Phase 4)                                 |
| Rematch offers    | In-process offers with a deadline    | Shared store, if offers must cross processes       | Implemented (Phase 4)                                 |
| Presence          | In-process session registry          | Shared presence store                              | In process (Phase 2)                                  |
| Socket fan-out    | In-process Socket.IO rooms           | Socket.IO Redis adapter across containers          | Seam only; needed by a second process serving sockets |
| Transport         | Socket.IO over one origin            | Additional origins behind sticky routing           | Seam only; needed by a second origin                  |
| Region            | Single region                        | Additional read-local edges, matches stay regional | Not planned for the MVP                               |

## 13. Mobile readiness

There is no native mobile application in the MVP and none is planned in phases 0 to 9. The
architecture keeps the option open: `@gobblet/game-core` is dependency free and runs unchanged
in any JavaScript runtime, `@gobblet/protocol` defines the wire contract independently of the
web client, and authentication is a first-party API that returns an opaque session token, which a
native client can hold in platform secure storage without a redirect flow. The responsive web
client remains the supported mobile experience.

A future mobile client would need a native rendering layer, platform secure storage and
platform deep-link handling. Nothing in the server or the engine would change.

## 14. Implementation status by component

| Area                                                      | Status      | Delivered by |
| --------------------------------------------------------- | ----------- | ------------ |
| Monorepo, task graph, lint, formatting                    | Implemented | Phase 0      |
| Package boundary enforcement for `game-core`              | Implemented | Phase 0      |
| Typed environment configuration                           | Implemented | Phase 0      |
| `GET /health/live`, `GET /health/ready`, `GET /v1/config` | Implemented | Phase 0      |
| Pure rules engine `@gobblet/game-core`                    | Implemented | Phase 1      |
| Zod protocol package                                      | Implemented | Phase 2      |
| PostgreSQL schema, migrations, match persistence          | Implemented | Phase 2      |
| Match runtime, command application, clocks                | Implemented | Phase 2      |
| Guest sessions and the Phase 2 HTTP surface               | Implemented | Phase 2      |
| Socket.IO gateway: sync, move, resign, clock cadence      | Implemented | Phase 2      |
| First-party authentication, guests, profiles              | Implemented | Phase 3      |
| Matchmaking, Elo, rematch                                 | Implemented | Phase 4      |
| 3D client and shared game UI                              | Implemented | Phase 5      |
| Social surface and progression                            | Implemented | Phase 6      |
| Admin API, audit log, metrics, alerting                   | Implemented | Phase 7      |
| Desktop shell, signing, auto-update                       | Implemented | Phase 8      |
| Load harness, quality gates, launch dashboards            | Implemented | Phase 9      |
| Legal and support pages                                   | Implemented | Phase 9      |
| Rollback as a workflow input, proved by the smoke check   | Implemented | Phase 9      |
| The three launch approvals a person signs                 | Deferred    | Phase 9      |

This table is the single place to update when a phase completes. Any document that disagrees
with it is out of date.
