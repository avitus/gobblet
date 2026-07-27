# ADR-0039: The defect register is a file in the repository, and the release gate reads it

## Status

Accepted

## Date

2026-07-27

## Context

Two Phase 9 exit criteria and two release-candidate gates are about defects: zero known critical
defects, zero known high-severity defects, and a release-candidate bug burn-down. There is no issue
tracker attached to this repository, and a criterion that depends on a system nobody can query from
a test is a criterion that will be asserted by assumption.

There is also an honesty problem worth solving properly. Every phase so far has ended with a handful
of known imperfections: a bundle chunk over the warning threshold, a browser engine covered only by a
manual pass, a screen reader nobody has run. They were reported in prose at the end of a phase and
then lived only in a conversation. A hardening phase is exactly the moment to give them a home.

## Decision

Known defects live in [`../defects.md`](../defects.md), one table row each, and the release gate
parses that file.

- A row carries an identifier, a severity of `critical`, `high`, `medium` or `low`, a status of
  `open`, `fixed` or `accepted`, the area, a one-line description, and where the evidence is.
- `apps/server/src/ops/defects.ts` parses the file and answers two questions: what is open at each
  severity, and does the register satisfy the release rule. The rule is the specification's: no open
  `critical` and no open `high`.
- The parser is strict. An unknown severity, an unknown status, a duplicated identifier or a
  malformed row is an error, not a row that is silently skipped, because a register that quietly
  drops what it cannot read is worse than no register.
- `accepted` is a status, and it requires the row to say who accepted it and why. A defect that is
  accepted at `critical` or `high` still fails the gate: the severity is the judgement, and accepting
  a critical defect means changing the severity with a reason, in the file, where it is reviewable.
- The gate runs in `pnpm gates` as the "zero known critical or high-severity defects" gate, so the
  claim is executed rather than asserted.

## Consequences

### Positive

- The release claim about defects is checked by a program against a file both a human and a test can
  read.
- Known imperfections stop evaporating between phases; each has an identifier that documents and
  commit messages can cite.
- Downgrading a severity to pass the gate leaves a diff with a reason in it.

### Negative

- It is a second place to record a defect once a real tracker exists. The register is small and the
  parser is strict, so the merge is mechanical if that day comes.
- Nothing forces a defect to be registered. Only review does, which is the same as anywhere else.

### Neutral

- The format is markdown, so it renders on any code host and needs no tooling to read.

## Alternatives considered

### GitHub issues with a label query

Rejected for now: it needs credentials and a network call inside a release gate, it cannot be
evaluated in a unit test, and it puts the release criterion outside the repository that the release
is cut from.

### A JSON or YAML register

Rejected: the register is read by people more often than by programs, and a markdown table is the
form the rest of the documentation already uses.

### No register, relying on the phase reports

Rejected. That is the current state, and it is why the same three imperfections were re-explained at
the end of three different phases.

## References

- [`../product-spec.md`](../product-spec.md) sections 21.2, 24 (Phase 9)
- [ADR-0038](0038-quality-gates-are-a-definition-not-a-checklist.md)
- [`../defects.md`](../defects.md)
