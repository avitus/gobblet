# ADR-0038: The quality gates are one definition that runs, not a checklist that is read

## Status

Accepted

## Date

2026-07-27

## Context

[Section 21](../product-spec.md) lists ten pull-request gates and fifteen release-candidate gates,
and the Phase 9 exit criteria say "every quality gate in section 21 passes". Some of those gates are
commands this repository can run today. Some are commands that need a host. Two are human judgements
by the product owner, and one is a signed production-readiness review.

A list in a document has no way of telling anybody which of those it is. The same problem was solved
once already for alerting: [ADR-0031](0031-metrics-are-a-prometheus-exposition.md) and the alert
definitions of `apps/server/src/observability/alerts.ts` are a single TypeScript definition rendered
into the file Prometheus reads, with a test that drives every rule into its failing state. The gates
deserve the same treatment, because "the gates pass" is otherwise a claim nobody can check.

## Decision

The gates of section 21 are a typed definition in the repository, executed by one command.

- `apps/server/src/ops/gates.ts` holds every gate as a record: its identifier, the specification
  clause it comes from, whether it belongs to the pull-request set or the release-candidate set, and
  either the command that proves it here or the reason it cannot be proved here together with the
  thing it waits for.
- `pnpm gates` runs the executable ones in order and prints a report: the command, the outcome, the
  duration. It exits non-zero if any executable gate fails. A deferred gate is reported as deferred,
  never as passed, and the report says what it is waiting for.
- The command runner is injected, so the definition and the reporting are covered by tests that run
  no subprocesses, and one test proves the real runner against a trivial command.
- The set is closed: a test asserts that every clause of sections 21.1 and 21.2 appears exactly once
  in the definition. A gate cannot be dropped by being forgotten, only by being deleted, which shows
  up in review.
- Continuous integration keeps running its own steps rather than calling `pnpm gates`, because a
  workflow that stops at the first failure and reports each step separately is more useful in a pull
  request. The gate definition names the workflow step that proves each pull-request gate, and a test
  asserts those steps exist in `.github/workflows/ci.yml`, so the two cannot drift apart.

## Consequences

### Positive

- "Every quality gate passes" becomes a command with an exit code and a printed report.
- The deferred gates are enumerated with their blocker, so a reader learns the true state of the
  release rather than a green tick.
- The definition is the single place where a new gate is added, and the closure test makes an
  unimplemented specification clause a test failure.

### Negative

- Two places describe the pull-request gates: the workflow steps and the definition. The test that
  cross-checks them is what keeps that from rotting.
- Running every gate locally is slow, because it includes the browser suite and the load run.

### Neutral

- The report is text, not JSON. A machine-readable form is a formatter away if a dashboard ever wants
  it.

## Alternatives considered

### A markdown checklist maintained by hand

Rejected. It is what the specification already is, and it cannot distinguish a gate that passes from
a gate nobody ran.

### One shell script

Rejected: no structure, no way to mark a gate deferred with a reason, and nothing to test.

### Making continuous integration call `pnpm gates`

Rejected for pull requests, because a single opaque step hides which gate failed and prevents the
workflow from caching and parallelising. The release-candidate run is the place for the aggregate
command.

## References

- [`../product-spec.md`](../product-spec.md) section 21
- [ADR-0031](0031-metrics-are-a-prometheus-exposition.md),
  [ADR-0039](0039-the-defect-register-is-a-gate.md)
- [`../operations.md`](../operations.md) section 15
