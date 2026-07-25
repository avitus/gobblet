# ADR-0020: The client's match state is the server snapshot plus one pending command

## Status

Accepted

## Date

2026-07-25

## Context

Phase 5 delivers the first client that plays a match. Everything it renders already exists on the
server: a versioned snapshot, an authoritative clock reading and an acknowledgement per command
([ADR-0009](0009-server-authoritative-clocks.md),
[ADR-0011](0011-versioned-idempotent-commands.md)). The question this decision settles is where
that information lives inside the client, because the specification forbids the obvious answer:
"do not put authoritative game state in a general-purpose client state store. The active match
view should consume a versioned server snapshot and pending command state"
([section 5.3](../product-spec.md)).

The forces are:

- A client must never invent truth. It may not decide legality, a result or a timeout, and a
  reload or a reconnect must produce the same view as the server's snapshot
  ([sections 7.1 and 4.3](../product-spec.md)).
- A move must be submitted exactly once even when the network loses an acknowledgement, which
  means the client owns a `commandId` and reuses it on retry
  ([ADR-0011](0011-versioned-idempotent-commands.md)).
- Selection is a local preview with no game consequence, so it must live somewhere that is
  obviously not match state ([ADR-0014](0014-selection-is-preview-not-touch-move.md)).
- The clock must count down smoothly without drifting into a client-declared timeout
  ([section 8.3](../product-spec.md)).
- Two independent stores of the same fact always diverge, and the divergence surfaces as a board
  that disagrees with the server. The cheapest way to avoid it is to have one store.

## Decision

The active match view derives everything it renders from the last snapshot the server sent, plus
at most one command the player has submitted and not yet had answered.

- The match channel holds exactly four things: the last accepted `MatchSnapshot`, the pending
  command (`commandId`, move, `expectedVersion`, the instant it was sent) or `null`, the local
  selection, and the connection phase. A reducer applies parsed server events to it; nothing else
  writes to it.
- Every inbound socket payload is parsed with its `@gobblet/protocol` schema before it reaches the
  reducer. A payload that fails validation is discarded, counted, and answered with `match:sync`
  rather than being coerced, because a client that guesses at a malformed event is worse than a
  client that asks again.
- An event whose `version` is not the successor of the held version is not applied: the client
  requests `match:sync` and rebuilds from the returned snapshot. Gaps are therefore self-healing
  and never silently patched.
- While a command is pending, board input is locked and the move is displayed by applying it to
  the held state with `@gobblet/game-core`. That display is a preview: the held version stays the
  server's, and the acknowledgement or the broadcast replaces the preview. A rejection clears it
  and applies the snapshot the server returned with the rejection.
- A retry of a pending command reuses its `commandId`. The client never generates a second
  identifier for the same intent, and there is no cancellation
  ([ADR-0014](0014-selection-is-preview-not-touch-move.md)).
- Clocks are rendered by interpolating the last authoritative reading against a monotonic browser
  clock (`performance.now()` deltas), never by subtracting a server timestamp from `Date.now()`.
  The displayed value is clamped at zero and the client never declares a timeout; the server's
  `match:ended` does.
- HTTP server state (the account, profiles, match history, the public configuration) is held by
  TanStack Query, keyed by resource. A general-purpose store (Zustand) holds only the session
  token, the resolved actor and the local settings (sound volumes, reduced motion, rendering
  tier). No match fact is ever written to it, and no match fact is persisted in the browser: a
  reload rebuilds the view from `match:sync`.
- Reconnection is the transport's business, with backoff. On every reconnect the client
  re-authenticates the socket, then re-synchronises each match view it holds. A pending command is
  retried once after the resynchronisation, and only if the snapshot shows it was not applied.

## Consequences

### Positive

- There is one copy of match truth in the client, so the board cannot disagree with the server for
  longer than one event.
- Reload, reconnect and a mid-match deploy all take the same path, which is the path that already
  has server tests behind it.
- The optimistic preview cannot leak into truth, because it is computed on render from the held
  snapshot rather than stored as a new state.
- The reducer is a pure function of (state, parsed event), so the whole protocol behaviour of the
  client is testable without a browser, a socket or a server.

### Negative

- A move shows a preview that can be replaced by a corrective snapshot, which is a visible
  correction on a bad connection. The alternative, waiting for the acknowledgement before showing
  anything, feels worse.
- Every inbound event costs a schema parse. That is a deliberate expense for a message rate of a
  few events per second.
- Two state mechanisms live side by side (a reducer for the match, TanStack Query for HTTP), which
  a reader must learn.

### Neutral

- Because settings are the only persisted client state, a new setting is the only reason to touch
  browser storage.
- The reducer's event vocabulary is the protocol's event catalogue, so a protocol change shows up
  as a compile error in the client.

## Alternatives considered

### Hold the match in the general-purpose store

Put the snapshot, the clocks and the selection in Zustand like any other application state.
Rejected: the specification forbids it, and for a good reason. A store that anything may write to
invites a component to "fix" the board locally, and the first such write makes the client a second
source of truth.

### Mirror the server state machine on the client

Apply moves locally and reconcile with the server, as a rollback-netcode game would. Rejected:
Gobblet is turn based with a two second event budget, so there is nothing to hide with prediction
beyond the single pending move, and reconciliation logic would be a second implementation of the
match runtime.

### Derive the clock from `Date.now()` and the server timestamp

Simpler arithmetic. Rejected: wall-clock skew and sleeping tabs make it wrong exactly when it
matters, and the specification requires the displayed clock to be derived from the last
authoritative reading ([section 8.3](../product-spec.md)).

### Persist the snapshot in browser storage for instant restore

Rejected: it creates a stale board that looks authoritative after a reload, and `match:sync`
already returns the real one within a round trip.

## References

- [`../product-spec.md`](../product-spec.md) sections 4.3, 5.3, 7.1, 7.2, 8.3, 13.3
- [ADR-0009](0009-server-authoritative-clocks.md), [ADR-0011](0011-versioned-idempotent-commands.md),
  [ADR-0012](0012-pure-shared-rules-engine.md), [ADR-0014](0014-selection-is-preview-not-touch-move.md)
- [`../protocol.md`](../protocol.md) sections 6, 7, 11 and 12
