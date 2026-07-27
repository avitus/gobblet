# ADR-0037: The load harness is ours, written against the protocol rather than against HTTP

## Status

Accepted

## Date

2026-07-27

## Context

[Section 20.8](../product-spec.md) sets a baseline release target of a thousand simultaneous
connected clients, five hundred simultaneous active matches, a p95 below one hundred milliseconds
for move acknowledgement processing, no lost committed moves, no duplicate match completion, stable
database connection usage and recovery after a restart. It says "use k6, Artillery, or equivalent".

The load this product has to survive is not a stream of HTTP requests. It is a population of
Socket.IO sessions that authenticate, queue, get paired, and then exchange versioned, idempotent
commands whose acknowledgements carry the state the next command depends on
([`../protocol.md`](../protocol.md) sections 5 to 7). A generic load tool can open a socket and
send frames, but it cannot answer the questions the target actually asks: was every committed move
acknowledged exactly once, did any match complete twice, did the match version advance by one per
accepted command. Those are protocol assertions, and the schemas that decide them already exist in
`@gobblet/protocol`.

There is also no host to point a load generator at ([ADR-0015](0015-single-region-deployment.md)),
so whatever is written now has to be runnable against a server this repository starts.

## Decision

The load harness is a module in the repository, driven by the same protocol package the client and
the server share, with no new tool in the toolchain.

- `apps/server/src/ops/load.ts` holds the driver: it opens a given number of sessions, pairs them
  into matches, plays scripted legal moves, and records the acknowledgement latency of every command
  along with every refusal, disconnection and duplicate completion. The report is a value, not a log
  line, so a test can assert on it.
- The socket client is an injected port. The CLI supplies the real `socket.io-client`; the unit tests
  supply a fake that answers immediately, so the harness's own logic is proved without a network,
  and one integration test runs the real port against a bootstrapped server.
- `pnpm load` runs it. The size, the shape of the run and the thresholds are arguments, so the same
  code runs a small proof in continuous integration and the full baseline against a host when one
  exists.
- The thresholds of section 20.8 are encoded in the report's verdict rather than eyeballed. A run
  that exceeds the p95, loses a move or completes a match twice exits non-zero.
- The scale actually asserted here is the scale a shared runner can carry, and the report states the
  scale it ran at. The thousand-client, five-hundred-match baseline is recorded as deferred against a
  host, with the exact command that runs it, rather than reported as passing on a laptop.
- Latency is measured as server processing time: the harness times from sending a command to
  receiving its acknowledgement over a loopback connection, which is what section 20.8 means by
  "excluding public-network latency".

## Consequences

### Positive

- The harness asserts protocol correctness under load, not just throughput, which is what the target
  is about.
- No new runtime, binary or service enters the toolchain, so the load run works anywhere the test
  suite works.
- The same code path proves a small run on every nightly build and the full baseline later, so the
  two cannot drift.
- Injected ports keep the harness testable, which matters because a load tool that lies is worse than
  no load tool.

### Negative

- We maintain it. A dedicated tool would give percentile reporting, ramping profiles and distributed
  generation for free.
- A single Node process generating a thousand sessions is itself a bottleneck; the harness reports its
  own generation lag so a run that is limited by the generator is visible rather than silently
  reported as a server result.

### Neutral

- Adopting k6 later is not blocked: the scripted journey is small, and the assertions that matter
  would move into a check function.

## Alternatives considered

### k6

Rejected for this phase. It is the strongest option for HTTP and has a Socket.IO extension, but the
extension speaks the transport, not our command envelope, so every acknowledgement assertion would be
hand-rolled inside a JavaScript runtime that cannot import `@gobblet/protocol`. It also adds a binary
to every machine that runs the suite.

### Artillery

Rejected for the same reason, with a smaller Socket.IO gap: it can emit events and wait for acks, but
the correctness assertions would live in a YAML scenario rather than in typed code, and the schemas
would be duplicated.

### Reusing the Playwright suite with many browsers

Rejected: a browser per client measures the browser. The target is about the server.

### Not load testing until a host exists

Rejected. Most of what the target asks about, lost moves, duplicate completions, connection-pool
behaviour under concurrency, is observable against a local server, and finding those late is exactly
what a hardening phase is for.

## References

- [`../product-spec.md`](../product-spec.md) sections 20.8, 21.2, 21.3
- [ADR-0006](0006-fastify-socketio-server.md), [ADR-0015](0015-single-region-deployment.md)
- [`../operations.md`](../operations.md) section 16
