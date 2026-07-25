# ADR-0014: Selection is a preview, not a binding touch-move

## Status

Accepted

## Date

2026-07-24

## Context

The printed Gobblet rulebook, like most physical board game rules, ties commitment to physical
contact: once a player touches a piece, they are committed to moving that piece. The rule exists
because in a physical game touching is unambiguous, observable by the opponent, and irreversible in
practice.

A digital interface has no equivalent of touching. A player selects a piece with a click, a tap or a
keyboard focus change, and any of those can happen by accident: a mis-tap on a touch screen, a
stray click while adjusting the camera, a focus change from a keyboard navigation key, or a pointer
event fired during a scroll. Treating selection as commitment would convert routine input noise into
lost matches, and it would do so invisibly, since there is no opponent watching a hand hover over a
piece.

There is also an architectural concern. If selection were binding, the notion of "selected but not
yet moved" would become part of match state, which means it would have to be persisted, versioned,
synchronised and validated by the rules engine. That would push a purely presentational concept into
the authoritative layer (see [ADR-0012](0012-pure-shared-rules-engine.md)).

Status: planned (Phase 5) for the interaction implementation. The rules engine already contains no
selection concept.

## Decision

Selecting a piece is a local preview with no game consequence. A move becomes binding only when a
destination is submitted, and a submitted move cannot be cancelled.

- Selecting or deselecting a piece changes nothing in match state, sends nothing to the server, and
  is not persisted. A player may select, deselect and reselect freely.
- Selection produces local affordances only: highlighting legal destinations computed with
  `@gobblet/game-core`, and showing a preview of the resulting position.
- The move is submitted when the player chooses a destination and confirms it through the interface's
  submission gesture (drop, tap on destination, or keyboard confirmation).
- Once submitted, the move is final. There is no take-back, no cancellation and no undo, regardless
  of whether the acknowledgement has arrived yet. A submitted command may only be retried with the
  same `commandId` (see [ADR-0011](0011-versioned-idempotent-commands.md)).
- The rules engine has no concept of selection. Its interface accepts a complete move (origin and
  destination) and knows nothing about how the player arrived at it.
- This is an intentional, documented deviation from the printed rulebook's touched-piece rule, and it
  is recorded as such in [`../rules.md`](../rules.md).

## Consequences

### Positive

- Accidental input cannot cost a game, which removes the single most likely source of unfair losses
  in a touch and pointer interface.
- The interface can be generous with feedback: legal destination highlighting and position preview are
  free, because looking costs nothing.
- Match state stays minimal. Nothing about a player's in-progress deliberation is transmitted,
  persisted or versioned.
- The rules engine's interface stays a pure function of a complete move, which keeps it reusable by a
  future AI opponent that never selects anything.
- No leakage of intent to the opponent: since selection is never sent, an opponent cannot learn what a
  player considered.

### Negative

- This is a deviation from the printed rules, so a player who knows the physical game may expect
  touch-move behaviour and must be told the digital rule.
- Because there is no cancellation after submission, the submission gesture must be unmistakable, and
  a careless drop still ends deliberation. The interface carries the burden of making commitment
  obvious.
- Players used to interfaces with a confirmation step for every action may submit sooner than intended
  on a fast gesture.

### Neutral

- Whether a submission requires an explicit confirmation step is a user experience decision inside
  the client and can be tuned (for example a confirmation for touch input) without changing this
  decision, as long as submission remains the single binding moment.
- Selection state lives in local UI state only (see [ADR-0003](0003-react-vite-web-client.md)).
- The deviation must be reflected in the rules document and in player-facing help text.

## Alternatives considered

### Enforce touch-move: selecting a piece commits the player to moving it

Rejected because digital selection is not equivalent to physical touching. Mis-taps, stray clicks,
camera-drag misfires and keyboard focus changes would all become binding commitments, producing lost
matches from input noise rather than from decisions. It would also require selection to become
authoritative server state, which is architecturally wrong for a presentational concept.

### Allow cancellation after submission until the server acknowledges

Rejected because it creates a race with no fair resolution. The move may already be committed and
broadcast when the cancellation arrives, so cancellation would sometimes work and sometimes not,
depending on latency. That is worse than a consistent rule, and it would require a compensating
command that can undo a persisted, acknowledged event.

### A universal explicit confirmation step for every move

Rejected as a global rule because it slows every move in a timed game, and clocks do not stop for
deliberation. It remains available as an input-specific affordance within the client.

### Server-tracked selection so the opponent can see deliberation

Rejected because it leaks information the physical game does not reliably leak, adds traffic per
pointer movement, and would put presentation state into the authoritative layer.

## References

- [`../rules.md`](../rules.md), [`../traceability-matrix.md`](../traceability-matrix.md)
- [ADR-0011](0011-versioned-idempotent-commands.md), [ADR-0012](0012-pure-shared-rules-engine.md)
- [ADR-0003](0003-react-vite-web-client.md)
