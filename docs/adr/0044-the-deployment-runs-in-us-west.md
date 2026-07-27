# ADR-0044: The deployment runs in US West, beside its database

## Status

Accepted. Amends the region named in [ADR-0043](0043-railway-hosts-the-deployment.md); every
other decision in that record stands.

## Date

2026-07-27

## Context

ADR-0043 chose `us-east4-eqdc4a`, Virginia, reasoning that of the regions the provider offers it
is the compromise between North American and European players. That reasoning was about client
latency only, and it was written before an account existed.

Creating the account made two things concrete that the ADR could not know:

- The managed PostgreSQL was created in US West, California, because that is the workspace's
  default region.
- The database is on the private network, and the server talks to it on every command it
  persists: a move, a resignation, a completion, a rating update.

A region for the application that differs from the region of its database is the worst of the
available choices. A cross-country round trip is roughly sixty milliseconds, and it is paid
inside every persist-before-acknowledge write ([ADR-0010](0010-match-event-persistence.md)), so
it lands directly in the acknowledgement latency the load target measures
([`../operations.md` section 16](../operations.md)). Distance to the player, by contrast, is paid
once per round trip and is already unavoidable for anyone far from the single region
([ADR-0015](0015-single-region-deployment.md)).

The database is empty, so the choice costs nothing today and would cost a migration later.

## Decision

Deploy in `us-west2`, US West Metal in California, and keep the database in the same region.

- Both service configurations, `apps/server/railway.json` and `apps/web/railway.json`, name that
  one region with one replica.
- `apps/server/test/container.test.ts` asserts the two files name the same single region, so a
  later edit cannot split the application from its database quietly.

## Consequences

- Every database round trip stays inside one region, which is where the latency that matters to
  a move acknowledgement is spent.
- European players are further away than Virginia would have made them: roughly an extra forty
  milliseconds each way. Clocks are server-authoritative and not latency compensated
  ([ADR-0009](0009-server-authoritative-clocks.md)), so this is felt as a slower acknowledgement,
  not as lost time on the clock.
- The compromise ADR-0043 wanted is now unavailable in a single region without moving the
  database as well. Should the player base turn out to be mostly European, the move is both
  services and the database together, and it is a restore from
  [`../operations.md` section 10](../operations.md) rather than a configuration change.
- The region is the workspace default, so a service created without our configuration file lands
  in the right place rather than the wrong one, which is one fewer way for a new service to be
  subtly wrong.

## Alternatives considered

- **Keep Virginia and move the database to it.** Defensible, and it is what ADR-0043 intended.
  Rejected because the reasoning for Virginia was a latency compromise for players that has never
  been measured against a real player base, while the cost of the move is paid immediately by
  every write.
- **Application in Virginia, database in California.** The status quo if the configuration file
  had simply been applied. Rejected: it is the only arrangement that is worse than either
  consistent choice.
- **Amsterdam.** Correct only if the players are mostly European, which is not known. Left as the
  move to make if that turns out to be true.

## References

- [ADR-0043](0043-railway-hosts-the-deployment.md), which this amends
- [ADR-0015](0015-single-region-deployment.md), single region and its accepted failure modes
- [`../operations.md` section 2.1](../operations.md), the setup runbook
