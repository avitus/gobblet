# ADR-0018: In-process matchmaking queues and rematch offers

## Status

Accepted

## Date

2026-07-25

## Context

Phase 4 delivers the first way for two players to find each other without a developer route:
queues separated by mode and time control, a rating window that widens while a player waits, and a
rematch offer that expires after 30 seconds
([`../product-spec.md` sections 9 and 4.5](../product-spec.md)). Both are coordination state: a
waiting entry matters only while its player is connected, and a rematch offer matters only while
both players are still looking at the result of the match they just finished.

Everything the project has persisted so far is different in kind. A match, its event log and a
rating are facts that must survive a restart, a crash and a deploy, which is why they live in
PostgreSQL under [ADR-0007](0007-postgresql-drizzle.md) and
[ADR-0010](0010-match-event-persistence.md). A queue entry is not a fact of that kind. The
specification states the consequence directly: after a restart, clients "automatically rejoin
their prior queue only after explicit client confirmation; do not silently queue stale sessions"
([section 7.5](../product-spec.md)), and a draining container "stops accepting matchmaking
entries" while existing matches finish ([section 7.6](../product-spec.md)). A queue that survived
a restart would therefore have to be discarded on purpose to obey the specification.

The deployment shape is one server process in one region
([ADR-0015](0015-single-region-deployment.md)). There is exactly one authoritative Socket.IO
origin ([ADR-0006](0006-fastify-socketio-server.md)), so there is exactly one process that can
observe whether a waiting player is still connected.

The forces that decide this are:

- Pairing must be atomic against itself. Two sockets must never be paired into two matches, and a
  player must never be seated against themselves.
- A queue entry whose socket is gone must not be paired, because the opponent would meet an empty
  seat and lose time on a clock that has already started.
- The window expansion is a function of waiting time, so the queue needs a clock, and the clock
  must be injectable for tests, exactly as the match clock is
  ([ADR-0009](0009-server-authoritative-clocks.md)).
- Seating rules already exist in one place (`apps/server/src/match/eligibility.ts`, appendix P3),
  and matchmaking must call them rather than restate them.

## Decision

Matchmaking queues and rematch offers are held in the server process, not in the database.

- A queue is keyed by `(mode, timeControlSeconds)`. An entry holds the actor, the socket, the
  rating used for pairing, and the instant it joined. A player may hold at most one entry across
  all queues; `queue:join` while already queued replaces the entry, so a client cannot occupy two
  queues.
- Pairing runs inside one synchronous critical section per attempt: candidates are selected,
  removed from the queue, and only then is the match created. The section cannot be interleaved,
  because Node runs one continuation at a time and no `await` appears between selecting a
  candidate and removing it.
- Ranked pairing uses the specification's window: ±100 Elo, widened by 50 every 10 seconds to a
  maximum of ±400, and after 60 seconds any opponent in the same time control. Casual pairing
  treats an unrated guest as 1200 and widens immediately, because casual optimises for a short
  wait ([section 9.3](../product-spec.md)).
- Disconnecting removes the entry. Every queue removal is idempotent, so a disconnect, an explicit
  `queue:leave` and a successful pairing can all race without leaving a stale entry.
- A rematch offer is held in the process against the match it follows, with a 30 second deadline
  read from the same injected clock. Accepting it creates a new match with the colours swapped and
  the same mode and time control; declining, expiring, or either player disconnecting ends the
  offer. The match records that it was a rematch of its predecessor, so the chain is auditable in
  the database even though the offer never was.
- A restart empties both. Clients are told the queue is gone and must send `queue:join` again;
  nothing rejoins a queue on a player's behalf. Active matches are unaffected, because they are
  persisted and recovered ([ADR-0010](0010-match-event-persistence.md)).
- The queue is reached only through an interface (`MatchmakingQueue`), so a shared store can
  replace the in-memory implementation when there is more than one process, which is the scaling
  seam [ADR-0015](0015-single-region-deployment.md) requires each such decision to leave behind.

## Consequences

Accepted:

- A restart loses every waiting entry and every open rematch offer. This is the behaviour the
  specification asks for, and it is tested rather than assumed.
- Queue depth is per process. With more than one process, players in different processes would not
  see each other, so a second process cannot be added without replacing the implementation behind
  the interface. This is recorded as a scaling seam, not hidden.
- Pairing decisions are not auditable after a restart, because they were never written down. The
  match they produced is auditable: it stores its mode, time control, colour assignment and, for a
  rematch, its predecessor.

Gained:

- Pairing is a memory operation with no lock contention and no polling loop against PostgreSQL,
  and it can see whether a socket is still connected, which a database queue cannot.
- The critical section is small enough to reason about, which is what keeps a player from being
  paired twice.
- Tests inject a clock and drive the window expansion deterministically, with no waiting in real
  time.

## Alternatives considered

**A PostgreSQL queue table with `FOR UPDATE SKIP LOCKED`.** Pairing would survive a restart and
would work across processes. Rejected for this phase: the specification requires a restart to
discard entries and requires explicit client confirmation before requeueing, so durability buys
nothing here, while the cost is real. It also cannot see socket liveness, so it would pair players
who have already gone, and it turns every waiting player into repeated database work.

**Redis with sorted sets keyed by rating.** The conventional answer, and the natural upgrade for
more than one process. Rejected now because it adds a service to operate, back up and monitor for
a phase whose deployment is a single process, and because [ADR-0015](0015-single-region-deployment.md)
requires the cheap shape until a measured need exists.

**A separate matchmaker service.** Rejected: it multiplies deployment and failure modes for a
product that has not launched, and the interface introduced here is the same seam a separate
service would need later.

**Persisting rematch offers.** Rejected: an offer lives for 30 seconds and is meaningless to a
player who has reconnected to a different process or come back an hour later. Writing it would
create rows whose only purpose is to be expired.

## References

- [`../product-spec.md`](../product-spec.md) sections 2.5, 4.5, 7.3, 7.5, 7.6, 9
- [ADR-0006](0006-fastify-socketio-server.md), [ADR-0009](0009-server-authoritative-clocks.md),
  [ADR-0010](0010-match-event-persistence.md), [ADR-0015](0015-single-region-deployment.md)
- [`../architecture.md`](../architecture.md) sections 7 and 12
