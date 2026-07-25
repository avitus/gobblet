# ADR-0012: Pure shared rules engine

## Status

Accepted

## Date

2026-07-24

## Context

Gobblet's rules are compact but subtle: pieces have sizes, a larger piece may cover a smaller one,
uncovering can reveal a line that already existed, and a player may move a piece already on the
board as well as introduce one from reserve. Victory conditions interact with covering in ways that
are easy to get almost right.

The client needs to evaluate legality locally to give immediate feedback: highlight legal
destinations, refuse an impossible drag, and show an optimistic preview before the server
acknowledges. The server must enforce legality authoritatively. If those two evaluations come from
two implementations, they will diverge, and divergence shows up as a rejected move that the client
believed was legal, which is the most confusing possible failure for a player.

Determinism matters beyond gameplay. Rule behaviour must be reproducible in tests, reproducible when
investigating a dispute from an event log, and reproducible when a future AI opponent explores
positions. Any hidden dependency on wall-clock time, randomness, environment or I/O breaks that
reproducibility, and such dependencies creep in through convenience (a timestamp on a move, a random
tiebreak, a log line).

Status: implemented (Phase 1). `@gobblet/game-core` exists today with its purity constraints
enforced.

## Decision

Rule logic exists exactly once, in `@gobblet/game-core`, as a pure deterministic module.

- `@gobblet/game-core` has no dependencies: no other workspace package, no Node built-ins, no zod,
  no react, no three, no socket.io, no fastify, no pg or drizzle.
- It reads no wall-clock time and produces no randomness: `Date`, `performance`, `crypto`, `fetch`,
  `process` and `Math.random` are forbidden. Any time or random value a rule needs is passed in as an
  argument.
- State transitions are immutable: applying a move returns a new state rather than mutating the
  input.
- Invariants are asserted inside the engine (for example stack ordering by piece size, piece counts
  per player, reachability of reserve entries), so an impossible state fails loudly instead of
  spreading.
- `@gobblet/game-core` is held at 100 percent test coverage, enforced by the `test:coverage` gate in
  `pnpm verify`.
- Enforcement is mechanical: ESLint `no-restricted-imports`, `no-restricted-globals` and
  `no-restricted-syntax` rules scoped to `packages/game-core/src/**` in
  [`../../eslint.config.mjs`](../../eslint.config.mjs).
- Client duplication of rule logic is forbidden. The client imports the engine for optimistic
  evaluation and never reimplements or approximates a rule, and it never treats its own evaluation
  as authoritative (see [ADR-0011](0011-versioned-idempotent-commands.md)).
- The formal rules restatement in [`../rules.md`](../rules.md) is the specification the engine
  implements, and [`../traceability-matrix.md`](../traceability-matrix.md) maps rules to tests.

## Consequences

### Positive

- Client previews and server decisions agree by construction, so a legal-looking move is not
  rejected because of an implementation gap.
- A pure, dependency-free module is exhaustively testable, including property-based testing, and 100
  percent coverage is realistic to reach and keep.
- The engine runs unchanged in Node, in browsers and in the desktop web view, and can be reused by a
  future AI opponent package or a future mobile client with no modification.
- Determinism makes disputes investigable: a stored event log plus the engine reproduces the exact
  sequence.
- The purity rules are enforced by tooling, so a well-intentioned convenience import fails CI rather
  than silently eroding the boundary.

### Negative

- Purity is inconvenient at the edges. Anything time-related or random must be threaded in as a
  parameter, which makes some signatures wider than they would otherwise be.
- Immutable transitions allocate more than in-place mutation, which matters if a future AI opponent
  searches many positions and may require optimisation work inside the engine.
- Shipping the engine to the client increases the client bundle, and it also means rule logic is
  visible to anyone who reads the bundle.
- Contributors must learn where a piece of logic belongs: rule versus runtime concern. Clock
  handling, for example, is deliberately outside the engine.

### Neutral

- The 100 percent coverage gate applies to this package specifically, not to the whole workspace.
- Zod validation lives in `@gobblet/protocol`, not in the engine, so the engine assumes structurally
  valid input.
- Adding a rule capability means changing the engine, the rules document and the traceability
  matrix together.

## Alternatives considered

### Separate client and server rule implementations

Rejected because divergence is inevitable and its symptom is the worst class of gameplay bug: the
server rejecting something the client presented as legal. It also doubles the test surface for the
most correctness-critical code in the product.

### Server-only rules with no client-side evaluation

Rejected on feel. Every interaction would wait for a round trip before the interface could respond,
so highlighting legal destinations and previewing a move would either be impossible or would require
the server to pre-compute and send legal-move sets, which is more traffic and still duplicates the
concept.

### Engine allowed to read time and randomness directly

Rejected because it destroys reproducibility, makes tests time dependent, and would let clock policy
leak into rule code. Clocks are a runtime concern handled by [ADR-0009](0009-server-authoritative-clocks.md).

### Engine allowed to depend on zod for input validation

Rejected because it would give the lowest layer a dependency and blur responsibility. Validation
belongs at the transport boundary in `@gobblet/protocol`; the engine's contract is enforced by types
and internal invariant assertions.

### Mutable state for performance

Rejected as premature optimisation with a high correctness cost. Shared mutable state across an
optimistic client overlay and an authoritative server path is exactly where aliasing bugs appear.

## References

- [`../rules.md`](../rules.md), [`../traceability-matrix.md`](../traceability-matrix.md)
- [`../architecture.md`](../architecture.md), [`../../eslint.config.mjs`](../../eslint.config.mjs)
- [ADR-0002](0002-typescript-monorepo-pnpm-turborepo.md), [ADR-0014](0014-selection-is-preview-not-touch-move.md)
