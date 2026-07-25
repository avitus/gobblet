# ADR-0015: Single-region deployment with replaceable scaling interfaces

## Status

Accepted

## Date

2026-07-24

## Context

The product is described as globally available, and it is a real-time game where latency is felt
directly, so the temptation is to deploy in multiple regions. Multi-region real-time gameplay is not
a hosting configuration, though. Two players in different regions must share one authoritative match
runtime, which means either cross-region state coordination or routing both players to one region
anyway. Matchmaking across regions requires a shared queue, and match state requires a single writer.
The full multi-region version of this system needs a distributed matchmaking store, cross-region
socket fan-out, and a database topology with a clear primary, all of which must be operated.

The realistic initial scale is small: an unproven multiplayer board game with an unknown player base.
The initial team is very small, so the operational surface has to stay within what one person can
reason about during an incident.

At the same time, the seams that would need to change under growth are predictable: matchmaking queue
storage, presence tracking, and socket fan-out between processes. Those are the components that assume
a single process today.

Status: planned. There is no deployed environment today; the first deployed environment is planned for
Phase 2.

## Decision

Deploy to a single region, keeping the components that would block scaling behind replaceable
interfaces.

- One server region, recommended US Central, chosen as a latency compromise for a primarily North
  American and European audience.
- One authoritative Socket.IO origin. All match traffic goes to the same runtime.
- One or two application containers on a single host. The second container exists for deploy
  continuity through drain-and-reconnect, not for throughput.
- Managed PostgreSQL in the same region, with automated backups and point-in-time recovery where
  available (see [ADR-0007](0007-postgresql-drizzle.md)).
- A CDN (Cloudflare or equivalent) serves static web assets globally and terminates TLS at the edge.
- Desktop installers and signed update manifests are served from GitHub Releases or object storage,
  not from the application host.
- No Redis in the initial deployment. Matchmaking, presence and socket fan-out are used only through
  interfaces, with in-process implementations initially, so a Redis-backed queue, presence store and
  Socket.IO adapter can be introduced without changing call sites (see
  [ADR-0006](0006-fastify-socketio-server.md)).
- "Global" means globally reachable from one region. It does not mean uniform worldwide latency, and
  the product must not imply otherwise.
- Consequence for players: round-trip latency for distant players is higher, and because clocks are
  not latency compensated (see [ADR-0009](0009-server-authoritative-clocks.md)), that latency is paid
  out of their thinking time. This is stated openly rather than hidden.

## Consequences

### Positive

- One region, one database, one authoritative runtime: an incident has a small number of moving parts,
  which matters when there is one responder.
- No distributed state means no cross-region consistency problems, no split-brain matchmaking, and no
  cross-region replication lag affecting match writes.
- Cost stays proportional to an unproven audience.
- Static assets are still fast worldwide through the CDN, so page load is not the bottleneck; only
  live match traffic is region bound.
- The interface seams mean the first scaling step (multiple containers with a shared adapter) is an
  additive change rather than a redesign.

### Negative

- Players far from the region experience higher latency and therefore lose more clock time to the
  network. There is no mitigation within this topology.
- Single region is a single failure domain. A regional outage is a full outage, bounded by the restore
  procedures in [`../operations.md`](../operations.md) rather than by failover.
- Vertical scaling has a ceiling, and reaching it forces the multi-container step under time pressure
  unless capacity is watched.
- In-process matchmaking and presence mean the second container cannot participate in matchmaking
  while both run during a deploy, which is why draining stops new matchmaking on the old container.

### Neutral

- Region choice is documented as a recommendation and can be changed before launch with a migration,
  since no production data exists yet.
- Multi-region live matches are explicitly not planned in phases 0 to 9.
- Adding Redis later is expected to be an operational change plus adapter implementations, not a
  change to gameplay code.

## Alternatives considered

### Multi-region deployment from the start

Rejected as disproportionate. Real-time matches need a single authoritative writer, so multi-region
would still route both players to one runtime while adding a distributed matchmaking store,
cross-region fan-out and a more complex database topology. That is a large operational burden for an
audience that does not exist yet, and it would slow every phase of delivery.

### Single region with Redis included immediately

Rejected as premature. Redis is only needed once more than one process serves sockets or shares a
queue. Adding it now would mean another managed dependency to configure, monitor, secure and restore,
with no functional gain, while the interface seams already make it easy to add later.

### Serverless functions plus a managed real-time service

Rejected because match runtime is stateful and long lived, with per-turn clock derivation and
persisted transactional commits. Fitting that into short-lived function invocations plus an external
real-time provider adds a vendor in the middle of gameplay and complicates the persist-then-acknowledge
guarantee.

### Self-managed PostgreSQL on the same host

Rejected because backups, point-in-time recovery and patching are exactly the operational work a
small team should not own, and the recovery commitments in
[`../operations.md`](../operations.md) depend on provider features.

### Kubernetes cluster from the start

Rejected as operational overhead without a matching problem. One or two containers on one host with a
scripted drain-and-reconnect deploy is sufficient and far easier to debug.

## References

- [`../architecture.md`](../architecture.md), [`../operations.md`](../operations.md)
- [ADR-0006](0006-fastify-socketio-server.md), [ADR-0007](0007-postgresql-drizzle.md)
- [ADR-0009](0009-server-authoritative-clocks.md)
