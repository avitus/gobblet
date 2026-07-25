# ADR-0001: Record architecture decisions

## Status

Accepted

## Date

2026-07-24

## Context

Gobblet Online is a small project with a long list of decisions that are expensive to reverse:
a server-authoritative model, a pure shared rules engine, a versioned command protocol, a
single-region deployment, signed desktop distribution. Most of these decisions are not visible
in the code that results from them. A reader can see that clocks are stored as remaining
milliseconds plus a turn start timestamp, but not why decrementing a timer was rejected.

Without a record, three failures repeat. Decisions get relitigated because nobody remembers the
constraint that produced them. Decisions get silently violated because the constraint was never
written down. New contributors, human or automated, infer intent from implementation details and
then generalise the wrong rule.

The project also mixes a rulebook adaptation with software architecture. Rules interpretations
(for example how a physical touch-move rule maps to a digital interface) need the same
durability as technology choices, and they need to be citable from the rules documentation and
the test suite.

## Decision

Architecture decision records are mandatory for material or architectural changes and live in
[`docs/adr/`](README.md).

- One decision per file, named `NNNN-short-kebab-title.md`, with sequential four-digit numbers
  that are never reused.
- The format is the MADR-style template in [`0000-template.md`](0000-template.md): title,
  status, date, context, decision, consequences (positive, negative, neutral), alternatives
  considered with rejection reasons, references.
- Statuses are `Proposed`, `Accepted`, `Superseded by ADR-NNNN` and `Rejected`.
- Accepted ADRs are immutable except for the status line. A changed decision is expressed by a
  new ADR that supersedes the old one and states what changed.
- An ADR is required for technology changes, package boundary or build strategy changes,
  protocol changes, data model changes affecting match state, ratings, audit or persistence
  guarantees, rules interpretations and deviations, operational posture changes, and changes to
  quality gates that other decisions rely on.
- A pull request that makes a material or architectural change without an ADR does not pass
  review. This is a human review gate, not an automated check.
- The index table in [`README.md`](README.md) lists every ADR with number, title, status and
  date, and is updated in the same pull request as the ADR.

## Consequences

### Positive

- The reasoning behind expensive constraints survives contributor turnover and long gaps
  between phases.
- Reviewers have a citable rule to point at when a change violates a boundary.
- Rules interpretations and deviations from the printed rulebook become explicit and testable
  rather than folklore.
- Superseded decisions remain readable, so the same alternatives are not re-proposed without
  new information.

### Negative

- Every material change carries documentation work, which slows small architectural
  adjustments.
- Judging what counts as material requires taste, and borderline changes will occasionally be
  argued about.
- Records can drift from reality if a decision is implemented differently and no supersede is
  written.

### Neutral

- ADR numbering is a shared resource, so two concurrent branches can collide on a number and
  one must be renumbered before merge.
- The ADR set is the "why" layer. Current state and phase status live in
  [`../architecture.md`](../architecture.md), [`../protocol.md`](../protocol.md) and
  [`../operations.md`](../operations.md).

## Alternatives considered

### No decision records, rely on the specification alone

The specification describes what the system must do, not which options were rejected or why.
Rejected because the most costly conversations are about alternatives that look reasonable in
isolation, and the specification has no place to record them without becoming unreadable.

### Decisions captured in pull request descriptions and issue threads

Rejected because that history is hard to search, is tied to a hosting provider, and mixes
decision rationale with implementation chatter. It also cannot be linked from the rules
documentation or from tests.

### A single running architecture document that is edited in place

Rejected because editing in place destroys history. The current state document is useful and
exists, but it cannot answer "why not Redis" or "why not increment clocks" once the text has
been rewritten.

### Wiki pages outside the repository

Rejected because decisions must be reviewed in the same pull request as the code that depends on
them, and must be versioned with that code.

## References

- [`README.md`](README.md)
- [`0000-template.md`](0000-template.md)
- [`../product-spec.md`](../product-spec.md)
- MADR, Markdown Any Decision Records
