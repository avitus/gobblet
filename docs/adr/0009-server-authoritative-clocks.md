# ADR-0009: Server-authoritative clocks

## Status

Accepted

## Date

2026-07-24

## Context

Ranked matches are played with chess-style time controls of 3, 5, 10 or 15 minutes. Time is part
of the result: a player can lose on time, and that loss changes rating. Any clock implementation
therefore has the same correctness requirements as move legality.

Several failure modes are well known from other online board games:

- A client-side clock can be manipulated by changing the system time or pausing a tab, so a
  client can never be trusted to report remaining time or to declare a timeout.
- A server that decrements stored clocks on an interval accumulates drift, does the wrong thing
  when the interval is starved by load, and has no exact answer after a process restart.
- Latency compensation sounds fair but requires trusting client-reported timestamps, and the
  compensation logic itself becomes an attack surface and a source of disputes.
- Disconnection handling must be decided explicitly: either the clock keeps running or it does
  not, and both choices must be stated to players.

The deployment is single region (see [ADR-0015](0015-single-region-deployment.md)), so distant
players have a real latency disadvantage that no clock policy can remove.

Status: planned (Phase 2). No clock implementation exists today.

## Decision

Clocks are authoritative on the server, stored as remaining time plus a turn start timestamp, and
computed on demand.

- Persisted fields on the match row: `light_remaining_ms`, `dark_remaining_ms`, `active_player`,
  `turn_started_at`, `last_clock_commit_at`, `status`, `version`.
- The effective remaining time of the active side is always derived:

```text
effective_remaining = stored_remaining_ms - (server_now - turn_started_at)
```

- Stored clocks are never decremented by a timer or a background job. They are rewritten only when
  a turn ends, inside the same transaction that commits the move (see
  [ADR-0010](0010-match-event-persistence.md)).
- Time control is chess style with no increment, no delay and no latency compensation. The
  protocol carries `sentAtClient` for diagnostics only and never uses it for clock arithmetic.
- Clocks keep running while a player is disconnected. This is stated in the product interface so it
  is not a surprise.
- Only the server declares a timeout. When a command arrives after the active clock has expired,
  the server settles the match as a timeout loss and rejects the command with `clock-expired`.
- On process start, active matches are loaded, effective remaining time is derived from
  `turn_started_at`, and any match whose active clock already expired is marked terminal with its
  outcome and rating change before new commands are accepted.
- `match:clock-sync` is emitted every 2 seconds, every 250 milliseconds when the active clock is
  below 10 seconds, and immediately after an accepted move, after a reconnect and after a client
  visibility change.
- The client interpolates between syncs for display only, corrects to the server value on each
  sync, and never declares a timeout.

## Consequences

### Positive

- Clock state is exact and recoverable at any moment, including after a crash, a restart or a
  drain-and-reconnect deploy, because it is two stored numbers and a timestamp rather than an
  in-flight countdown.
- No timer drift, no dependence on interval scheduling under load, and no background job that can
  silently stop.
- Cheating by manipulating client time is impossible by construction.
- The database write volume for clocks is one write per turn, not one per tick.
- Reasoning about timeouts is simple enough to test exhaustively: given stored values and a server
  time, the outcome is a pure function.

### Negative

- Players far from the single region lose real thinking time to network latency, and the product
  must say so honestly.
- Fine-grained synchronisation below 10 seconds costs message volume on every active match, which
  is a real cost at scale.
- Clock display can visibly jump when a sync corrects an interpolation, particularly on an
  unstable connection.
- A clock that keeps running through disconnection will feel harsh to a player who loses
  connectivity, and there is no grace period.

### Neutral

- Clock arithmetic depends on the server's clock being sane; server time is the only time source
  and must be monitored.
- `last_clock_commit_at` exists for auditing and diagnostics, not for gameplay arithmetic.
- Clock calculation errors are treated as a top-severity alert (see
  [`../operations.md`](../operations.md)) because they change match results.

## Alternatives considered

### Client-side clocks with server verification at move time

Rejected because the client would still be the primary display authority while the server holds a
different truth, guaranteeing visible disagreements, and because timeout detection would depend on
a client message arriving.

### Server timer that decrements stored clocks every tick

Rejected because it introduces drift, couples correctness to scheduler behaviour under load,
multiplies database writes, and leaves no exact answer after an unclean restart. The derived-value
approach makes recovery trivial.

### Latency compensation based on client-reported send time

Rejected because it requires trusting a client timestamp, which is exactly the input that cannot be
trusted. It also converts a simple, explainable rule into a negotiation that players cannot verify
and support cannot audit.

### Pausing the clock on disconnection

Rejected because it creates an obvious abuse: a losing player in time trouble can disconnect to
buy thinking time. A grace period only moves the exploit to the size of the grace window.

### Increment or delay (Fischer or Bronstein) in the MVP

Rejected as scope. It adds time control variants, matchmaking queues and test surface without being
required by the product. It can be introduced later as an additive change with a new ADR.

## References

- [`../protocol.md`](../protocol.md), [`../architecture.md`](../architecture.md)
- [ADR-0010](0010-match-event-persistence.md), [ADR-0015](0015-single-region-deployment.md)
- [`../operations.md`](../operations.md)
