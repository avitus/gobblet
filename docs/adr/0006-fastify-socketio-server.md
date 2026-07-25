# ADR-0006: Fastify HTTP API with Socket.IO real-time transport

## Status

Accepted

## Date

2026-07-24

## Context

The server carries two different kinds of traffic. Request and response traffic covers
configuration, session bootstrap, profiles, leaderboards, match recovery reads and
administration. Real-time traffic covers matchmaking, move commands, snapshots, clock
synchronisation and communication. Both must be authoritative, and both must validate every
payload before it reaches domain logic (see [`../protocol.md`](../protocol.md)).

Real-time gameplay imposes specific transport requirements: reconnection with state
resynchronisation, per-command acknowledgements so a client learns the fate of every move it
sends, room-style fan-out to the two participants of a match, and a fallback when a WebSocket
cannot be established (restrictive networks and proxies are common).

Operationally the target deployment is deliberately small: one region, one or two containers on
one host, no Redis initially (see [ADR-0015](0015-single-region-deployment.md)). Splitting the
system into separate HTTP and real-time services would multiply deployment and observability work
without solving a present problem.

Status: skeleton (Phase 0). Only `GET /health/live`, `GET /health/ready` and `GET /v1/config`
exist today. The match runtime is planned for Phase 2.

## Decision

`apps/server` is a single Node process that serves the Fastify HTTP API and the Socket.IO
real-time transport.

- Fastify serves the versioned HTTP API under `/v1` plus the unversioned health probes.
- Socket.IO is attached to the same HTTP server and is the single authoritative real-time origin.
- Every inbound payload, HTTP or socket, is validated with a Zod schema from
  `@gobblet/protocol`. Unvalidated data never reaches the match runtime or the rules engine.
- Socket.IO acknowledgements are used for every client to server command, returning either
  `{ ok: true, commandId, newVersion }` or `{ ok: false, commandId, reason, snapshot? }` (see
  [ADR-0011](0011-versioned-idempotent-commands.md)).
- Matchmaking, presence and socket fan-out are used only through interfaces. The initial
  implementations are in-process; a Socket.IO Redis adapter and a shared queue or presence store
  can be introduced behind those interfaces without changing call sites.
- The server owns all authority: legality via `@gobblet/game-core`, clocks, outcomes, ratings,
  achievements and match lifecycle.
- The process depends on `@gobblet/game-core`, `@gobblet/protocol`, `@gobblet/db`,
  `@gobblet/config`, `@gobblet/observability` and `@gobblet/auth`, and never on client packages.

## Consequences

### Positive

- One process means one deployment unit, one log stream, one metrics endpoint and one drain
  procedure, which matches the single-region operational posture.
- Socket.IO provides reconnection, acknowledgements, rooms and transport fallback out of the box,
  all of which are directly required by the match protocol.
- Fastify's schema-oriented design and low overhead fit a JSON API where every route validates
  input anyway.
- A shared process makes it trivial for an HTTP request and a socket command to use the same
  authorization and database code paths.
- Interfaces around matchmaking, presence and fan-out mean horizontal scaling is an additive
  change rather than a rewrite.

### Negative

- HTTP and real-time traffic share a process, so a pathological HTTP workload can affect socket
  latency, and both scale together.
- Socket.IO is not plain WebSocket: it imposes its own protocol, so clients must use a compatible
  client library and non-browser tooling is more awkward.
- Long-lived sockets complicate deploys, which is why drain-and-reconnect exists in
  [`../operations.md`](../operations.md).
- Sticky routing becomes a requirement as soon as more than one container serves sockets.

### Neutral

- The metrics endpoint, structured logging and error reporting live in `@gobblet/observability`
  and are wired into both surfaces (planned, Phase 7).
- `CORS_ORIGINS` must list the web origin and the desktop shell origin.
- Rate limiting is applied per session on both surfaces.

## Alternatives considered

### Raw `ws` WebSocket server

Rejected because the acknowledgement, reconnection, room fan-out and transport-fallback machinery
would all be rebuilt by hand, and every one of them is on the critical path for match
correctness. The protocol already depends on per-command acknowledgements and on reconnect with
snapshot resynchronisation; reimplementing that is risk without benefit.

### Express instead of Fastify

Rejected as the weaker default. Express is viable, but Fastify offers better throughput, a
first-class schema and serialisation story, and a plugin and lifecycle model that suits
per-request context (request id, actor, logging) without ad hoc middleware ordering.

### tRPC only, with no separate protocol package

Rejected because the real-time surface is the primary gameplay path and tRPC's strength is typed
request and response calls. The command envelope, versioning, idempotency and reason codes are
domain contracts that must be explicit and language-independent, and they must be validated on a
socket boundary. Zod schemas in `@gobblet/protocol` give the same type sharing without coupling
the wire contract to a client-side call abstraction.

### A separate real-time service from the start

Rejected as premature. It doubles deployment, configuration, observability and authorization
surface, and it requires shared state (Redis or database backed) before there is any load that
justifies it. The interface seams keep the split available later.

### Server-sent events or long polling for match updates

Rejected because gameplay is bidirectional and latency sensitive, and clock synchronisation at
250 millisecond cadence with per-command acknowledgements does not fit a one-way channel.

## References

- [`../protocol.md`](../protocol.md), [`../architecture.md`](../architecture.md)
- [ADR-0011](0011-versioned-idempotent-commands.md), [ADR-0015](0015-single-region-deployment.md)
- [`../operations.md`](../operations.md)
