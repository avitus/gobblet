# ADR-0026: Preset communication is relayed, never stored, and mute is enforced by the server

## Status

Accepted

## Date

2026-07-26

## Context

[Section 12](../product-spec.md) gives players eight preset phrases and five reactions, no free
text, and an independent mute for messages, reactions and sound. [Section 19.3](../product-spec.md)
states that "preset-message payloads are enumerated server-side", and
[section 12.4](../product-spec.md) adds that unknown values are rejected, event sizes are capped,
and "muted communication must not be rendered or played". There is deliberately no cooldown in the
MVP.

Two questions are left open, and both decide how much machinery this feature needs.

The first is whether a sent phrase is durable. The match event log exists and is already the place
administrators inspect ([section 15.6](../product-spec.md)), so a phrase could be appended to it.
But a phrase is not part of the game: it changes no state, it is not needed for recovery, it cannot
be replayed to a player, and it would make the one table whose rows reconstruct a match contain
rows that do not. Storing it would also create a message history for a product that has no
moderation surface in the MVP.

The second is where mute is enforced. A client could filter what it renders, but "must not be
rendered or played" is a requirement that a client cannot be trusted to keep for a player: a muted
player who receives the event has already received it, and any later bug renders it. Mute also has
two sources: the profile of a registered player, which follows them between machines
([section 15.2](../product-spec.md)), and the running connection, which is what `match:mute-state`
carries and what a guest has instead of a profile.

## Decision

Communication is a relay of server-defined keys, held only for as long as it takes to deliver.

- A phrase or reaction is a key from a closed set in `@gobblet/protocol`. The client sends the key,
  never the words. An unknown key is a validation failure reported on `error:recoverable`, never a
  silent no-operation.
- Only a participant of an active or just-ended match may send, which the gateway checks the same
  way it checks a move. A guest participant may send and receive: seating, not account type,
  decides.
- Nothing is written to the database. There is no message history, no `match_events` row and no
  administrative view of what was said, because nothing is kept to view.
- The server holds the mute state of each connection, seeded from the profile when an account
  authenticates and updated by `match:mute-state`. A muted recipient is not sent the event at all,
  so no client is ever asked to withhold something it has already received.
- The two channels are independent, as section 12.3 requires: `match:mute-state` carries the state
  of both, and sound mute stays entirely local because it plays nothing across the wire.
- The sender is echoed its own message, so both clients render the same exchange and a player can
  see what they sent. A player's own message is not suppressed by their own mute, which mutes the
  opponent rather than themselves.
- A registered player's mute preference is stored in the profile as well, so it survives a
  reconnection from another machine. The connection state is the authority while the connection
  lives; the profile is what seeds it.
- There is no cooldown, as the specification directs. The enum, the participant check and the
  transport's message size limit are the whole abuse surface.

## Consequences

### Positive

- The feature adds no table, no migration and no retention question, and it cannot leak a message
  into a match replay because it never enters the event log.
- A muted player cannot be shown a message by a client bug, because the server does not send it.
- The wire carries keys, so there is nothing to sanitise, nothing to localise on the server and no
  injection surface.
- Guests are first-class communicators without needing a profile row.

### Negative

- There is no record of what was sent, so a report of abuse cannot be investigated. This is
  consistent with the MVP scope, which excludes moderation, but it is a real limitation.
- Mute state lives in server memory, so it is lost when a process restarts and is re-seeded from
  the profile; a guest's in-match mute reverts to unmuted after a reconnection.
- A player who reconnects mid-match sees no history of what was said before they left.

### Neutral

- Adding a phrase is a protocol change plus a client string, which is a deliberate cost: it keeps
  the vocabulary reviewable.
- Should moderation ever be needed, a durable log can be added without changing the wire contract,
  because the keys are already enumerated.

## Alternatives considered

### Append every phrase to the match event log

Rejected: the event log is the sequence that reconstructs a match, and a phrase reconstructs
nothing. It would also create a message archive for a product with no moderation process, and the
event log is exposed to administrators, which turns a transient nicety into retained personal
communication.

### Let the client decide what to render, and send everything

Rejected: the specification requires that muted communication is not rendered or played. Enforcing
it only in the client makes that requirement a matter of client correctness, and it sends a player
something they asked never to receive.

### One mute flag for all communication

Rejected: section 12.3 requires messages, reactions and sound to be mutable independently, and the
three are genuinely different: a player may want an opponent's "good game" without an animated
applause icon.

### A per-player cooldown to prevent spam

Rejected for the MVP because the specification explicitly says there is no user-visible cooldown.
The closed enum bounds the harm to repetition, and the transport limits the rate at which anything
can be sent.

## References

- [`../product-spec.md`](../product-spec.md) sections 7.3, 12, 15.2, 19.3, appendices P6.1 to P6.4
- [`../protocol.md`](../protocol.md) sections 8 and 14
- [ADR-0011](0011-versioned-idempotent-commands.md),
  [ADR-0020](0020-client-match-state-is-the-server-snapshot.md)
