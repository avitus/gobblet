# Protocol

This document is the contract between Gobblet Online clients and the authoritative server. It
covers HTTP versioning, the real-time transport, the command envelope, acknowledgement and
error models, the full event and endpoint catalogue, the snapshot and clock contracts, and the
authorization matrix.

Related documents: [`product-spec.md`](product-spec.md),
[`architecture.md`](architecture.md), [`operations.md`](operations.md), [`adr/`](adr/).

## 1. Implementation status

Implemented HTTP surfaces: `GET /health/live`, `GET /health/ready`, `GET /v1/config`,
`POST /v1/guests`, `POST /v1/guests/claim`, `POST /v1/auth/register`, `POST /v1/auth/sign-in`,
`POST /v1/auth/sign-out`, `POST /v1/auth/verify-email`, `GET /v1/me`, `PATCH /v1/me/profile`,
`GET /v1/me/matches`, `POST /v1/usernames/check`, `GET /v1/profiles/:username`,
`GET /v1/matches/:matchId`, `GET /v1/matches/:matchId/snapshot` and the development only
`POST /v1/dev/matches`.

Implemented socket surfaces: `session:authenticate`, `match:sync`, `match:move` and
`match:resign` inbound; `session:ready`, `match:snapshot`, `match:move-committed`,
`match:clock-sync`, `match:ended`, `error:recoverable` and `error:fatal` outbound. Matchmaking,
rematch and communication events remain planned.

The schemas of the command envelope, the acknowledgement contract, the snapshot, the Phase 2
socket payloads and the Phase 2 and Phase 3 HTTP bodies are implemented in `@gobblet/protocol`,
which is the single source of truth. Where this document and the package disagree, the package wins and
this document is a defect.

Everything marked with a later phase in the tables below is still planned. Each table carries a
phase column so no reader can mistake a design for a shipped feature.

Conventions used throughout:

- Socket payloads carry timestamps and durations as integer milliseconds, because the clock
  formula is arithmetic on them.
- HTTP bodies carry timestamps as ISO 8601 strings, because they are read by humans and stored
  as `timestamptz`.

## 2. Versioning policy

- The HTTP API is versioned in the path: every product endpoint lives under `/v1`. Health
  endpoints (`/health/live`, `/health/ready`) are intentionally unversioned because they are
  infrastructure probes.
- Additive changes are allowed inside a version: new endpoints, new optional request fields,
  new response fields, new enum members that clients may ignore, new socket events.
- Breaking changes require a new path version (`/v2`) and a bump of
  `MIN_SUPPORTED_CLIENT_VERSION` so older clients are told to update instead of failing in
  confusing ways.
- Removing or renaming a field, changing a field type, changing the meaning of an existing
  enum member, or removing an acknowledgement reason code all count as breaking.
- Socket events are versioned with the HTTP version. A client that authenticates against `/v1`
  speaks the `/v1` event catalogue.
- Clients send their version on `session:authenticate`. A client below
  `MIN_SUPPORTED_CLIENT_VERSION` receives `error:fatal` with an update instruction rather than
  a partial session. Status: planned (Phase 8 for enforcement, the variable exists in
  configuration from Phase 0).
- Every protocol change requires an ADR when it changes envelopes, reason codes, authorization
  or persistence semantics (see [`adr/README.md`](adr/README.md)).

## 3. Transport overview

Status: implemented (Phase 2) for the events listed in section 1.

| Channel   | Technology                                            | Used for                                                                        |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| HTTP      | Fastify, JSON, `/v1`                                  | Configuration, session bootstrap, profiles, leaderboards, recovery reads, admin |
| Real-time | Socket.IO over WebSocket, single authoritative origin | Matchmaking, match commands, snapshots, clock sync, communication               |

Rules:

- There is exactly one authoritative Socket.IO origin. Clients never talk to more than one
  match runtime.
- Every payload crossing either boundary is validated with a Zod schema from
  `@gobblet/protocol`. Validation failures never reach domain logic.
- Socket.IO acknowledgements are used for every client to server command, so the client always
  learns the outcome of a command it sent.
- CORS origins are configured explicitly with `CORS_ORIGINS` (the desktop shell origin is
  included alongside the web origin).

## 4. Session handshake

Status: implemented (Phase 3).

```text
client connects socket
   |
   |-- session:authenticate { clientVersion, appEnv, sessionToken? } -->
   |                                            verify token or issue guest binding
   |                                            reject if clientVersion is unsupported
   |<-- session:ready { actorId, actorType, displayName, isGuest, serverTime, features }
   |
   |-- presence:heartbeat (periodic) -->
```

A socket without a completed `session:authenticate` may not send any other event. Commands
received before `session:ready` are rejected with reason `not-authorized`.

`sessionToken` is the opaque bearer token of either credential kind: an account session issued
by `/v1/auth/register` and `/v1/auth/sign-in`, or a guest session issued by `/v1/guests`. The
server resolves account sessions first and answers `actorType: "user"` with `isGuest: false`;
a guest resolves to `actorType: "guest"`. There is one resolution path, so every surface agrees
on who the caller is
([ADR-0017](adr/0017-first-party-email-password-authentication.md)).

A suspended account is refused at the handshake with `error:fatal`
`{ code: "account_suspended", action: "contact-support" }`, and refused again before each
`match:move` and `match:resign` commit, because a suspension applied mid-match must stop the
next command rather than the next sign-in (spec section 19.3). The command is acknowledged
`{ ok: false, reason: "not-authorized" }` and the socket is closed.

## 5. Command envelope

Status: implemented (Phase 2). Every client to server real-time command that mutates match
state uses this envelope:

```json
{
  "commandId": "b3c1f0a4-6f2c-4c53-9b0f-4c0c31d4a111",
  "matchId": "9f0c8c8e-1d1b-4d1c-9a3d-1f3f2b7e55aa",
  "expectedVersion": 17,
  "sentAtClient": 1753392000000,
  "payload": {}
}
```

| Field             | Type             | Rules                                                                  |
| ----------------- | ---------------- | ---------------------------------------------------------------------- |
| `commandId`       | UUID v4 string   | Generated by the client, unique per logical command, reused on retries |
| `matchId`         | UUID string      | Target match, must be one the actor participates in                    |
| `expectedVersion` | integer >= 0     | The snapshot version the client believes is current                    |
| `sentAtClient`    | integer epoch ms | Diagnostics and latency metrics only, never used for clock arithmetic  |
| `payload`         | object           | Command specific, validated by the command schema                      |

`sentAtClient` is explicitly untrusted. The server never derives clock state from it (see
[ADR-0009](adr/0009-server-authoritative-clocks.md)).

## 6. Acknowledgement contract

Success:

```json
{ "ok": true, "commandId": "b3c1f0a4-...", "newVersion": 18 }
```

Failure:

```json
{ "ok": false, "commandId": "b3c1f0a4-...", "reason": "stale-version", "snapshot": {} }
```

The `reason` field is a closed enum. Clients must handle every member.

| Reason              | Meaning                                                       | Snapshot attached | Client action                                                     |
| ------------------- | ------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `stale-version`     | `expectedVersion` does not match the stored version           | Yes               | Replace local state with the snapshot, do not auto-retry the move |
| `not-your-turn`     | The actor is not the active player                            | Yes               | Resynchronise and re-enable input for the correct side            |
| `illegal-move`      | The rules engine rejected the move                            | Yes               | Revert the optimistic preview, surface a non-blaming message      |
| `match-ended`       | The match is already terminal                                 | Yes               | Show the final result                                             |
| `not-authorized`    | The actor is not a participant, or is not authenticated       | No                | Return to the lobby and re-authenticate                           |
| `clock-expired`     | The active clock had already run out when the command arrived | Yes               | Show the timeout result from the snapshot                         |
| `duplicate-command` | The `commandId` was already applied to this match             | Yes               | Treat as success for that command, adopt the snapshot             |

Rejections are not errors in the transport sense. They are normal, expected outcomes of a
race, a stale client or an illegal attempt, and they are logged with the command id and match
version.

## 7. Idempotency and optimistic concurrency

Status: implemented (Phase 2). Recorded in
[ADR-0011](adr/0011-versioned-idempotent-commands.md).

- Optimistic concurrency: the server compares `expectedVersion` with the stored match
  `version` inside the transaction. A mismatch produces `stale-version` and no state change.
- Exactly-once application: `(match_id, command_id)` is unique. A second arrival of the same
  `commandId` never applies a second time.
- Retry safety: a client that does not receive an acknowledgement retries the identical
  envelope, including the same `commandId`.

Lost acknowledgement sequence:

```text
client                              server                         database
  |-- match:move (cmd A, v17) --------->|
  |                                     |-- commit event + snapshot v18 -->|
  |                                     |<---------------------------------|
  |        ack lost in transit  <-------|
  |
  | (socket drops, client reconnects)
  |
  |-- match:sync ---------------------->|
  |<-- match:snapshot v18 --------------|
  |
  | client sees its move already applied, discards the pending command
  |
  | if instead the client retries first:
  |-- match:move (cmd A, v17) --------->|
  |                                     | lookup (match_id, cmd A) -> found
  |<-- ack { ok:false,                  |
  |          reason:"duplicate-command",|
  |          snapshot: v18 } -----------|
```

Client obligations:

- Keep at most one in-flight match command per match.
- Never mutate `commandId` on retry.
- Never treat a local optimistic state as authoritative; reconcile on every snapshot,
  `match:move-committed` or rejection.
- Stop retrying after the configured attempt budget and fall back to `match:sync`.

## 8. Socket event catalogue

The phase column states when each event is delivered, and `Implemented today` states what the
server answers right now.

### 8.1 Client to server

| Event                   | Purpose                                      | Payload sketch                             | Ack | Phase                   | Implemented today |
| ----------------------- | -------------------------------------------- | ------------------------------------------ | --- | ----------------------- | ----------------- |
| `session:authenticate`  | Bind a socket to a session or guest identity | `{ clientVersion, appEnv, sessionToken? }` | Yes | 2 (guest), 3 (accounts) | Yes, guests only  |
| `queue:join`            | Enter a matchmaking queue                    | `{ mode, timeControlSeconds }`             | Yes | 4                       | No                |
| `queue:leave`           | Leave the current queue                      | `{}`                                       | Yes | 4                       | No                |
| `match:sync`            | Request the authoritative snapshot           | `{ matchId }`                              | Yes | 2                       | Yes               |
| `match:move`            | Submit a move                                | envelope with `{ payload: { move } }`      | Yes | 2                       | Yes               |
| `match:resign`          | Resign the match                             | envelope with `{ payload: {} }`            | Yes | 2                       | Yes               |
| `match:rematch-request` | Offer a rematch after a match ends           | `{ matchId }`                              | Yes | 4                       | No                |
| `match:rematch-respond` | Accept or decline a rematch offer            | `{ matchId, accept }`                      | Yes | 4                       | No                |
| `match:preset-message`  | Send one preset phrase                       | `{ matchId, messageKey }`                  | Yes | 6                       | No                |
| `match:reaction`        | Send one preset reaction                     | `{ matchId, reactionKey }`                 | Yes | 6                       | No                |
| `match:mute-state`      | Mute or unmute the opponent's communication  | `{ matchId, muted }`                       | Yes | 6                       | No                |
| `presence:heartbeat`    | Keep the session marked present              | `{}`                                       | No  | 4                       | No                |

`match:move` payload sketch, where board coordinates and reserve stacks follow
[`rules.md`](rules.md):

```json
{ "move": { "kind": "reserve", "reserveStack": 2, "to": "r1c3" } }
```

```json
{ "move": { "kind": "board", "from": "r0c0", "to": "r0c1" } }
```

### 8.2 Server to client

| Event                  | Purpose                                                | Payload sketch                                                                      | Phase                  | Implemented today |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------- | ----------------- |
| `session:ready`        | Session established, session identity returned         | `{ actorId, actorType, displayName, isGuest, serverTime, features }`                | 2 (guest), 3           | Yes, guests only  |
| `queue:status`         | Queue position and current search band                 | `{ mode, timeControlSeconds, waitingMs, searchBand }`                               | 4                      | No                |
| `match:found`          | A match was created for this actor                     | `{ matchId, opponent, colour, timeControlSeconds }`                                 | 4                      | No                |
| `match:snapshot`       | Full authoritative match state                         | see the snapshot contract below                                                     | 2                      | Yes               |
| `match:move-committed` | A move was durably applied                             | `{ matchId, version, move, actor, activePlayer, clocks }`                           | 2                      | Yes               |
| `match:clock-sync`     | Authoritative clock reading                            | `{ matchId, version, activePlayer, lightRemainingMs, darkRemainingMs, serverTime }` | 2                      | Yes               |
| `match:ended`          | Terminal outcome, including rating change              | `{ matchId, version, result, reason, ratingChange? }`                               | 2 (result), 4 (rating) | Yes, no rating    |
| `match:rematch-status` | Rematch offer lifecycle                                | `{ matchId, state, expiresAt? }`                                                    | 4                      | No                |
| `match:preset-message` | Opponent preset phrase delivered                       | `{ matchId, from, messageKey }`                                                     | 6                      | No                |
| `match:reaction`       | Opponent reaction delivered                            | `{ matchId, from, reactionKey }`                                                    | 6                      | No                |
| `error:recoverable`    | The session continues, the last action did not succeed | `{ code, message, retryable: true, context? }`                                      | 2                      | Yes               |
| `error:fatal`          | The session cannot continue                            | `{ code, message, action }`                                                         | 2                      | Yes               |

### 8.3 Acknowledgements, rooms and delivery

- `session:authenticate` acknowledges `{ ok: true, session }` with the same payload as
  `session:ready`, or `{ ok: false, error }` with a fatal error. A refused handshake is
  followed by `error:fatal` and a server side disconnect, so a client can never hold a
  half-open session.
- `match:sync` acknowledges `{ ok: true, snapshot }` or `{ ok: false, reason }` with a
  rejection reason. Success also joins the socket to the match room and emits
  `match:snapshot` to that socket.
- `match:move` and `match:resign` acknowledge with the command acknowledgement of section 6.
- Broadcasts go to the match room, which means both seats receive `match:move-committed`,
  `match:clock-sync`, `match:ended` and every corrective `match:snapshot`, including the
  player who sent the command.
- A committed move is published as `match:move-committed`. A resignation and a timeout are
  published as `match:snapshot` followed by `match:ended`, because there is no move to send.
- A payload that fails schema validation is reported on `error:recoverable` with the field
  details, because no acknowledgement reason describes a malformed payload. When the envelope
  metadata is readable the command is also acknowledged as rejected; when it is not, the error
  event is the only answer.
- A match that is no longer active is dropped from the clock cadence, so `match:clock-sync`
  stops after `match:ended`.

## 9. HTTP endpoint catalogue

`Auth` column values: `none` (public), `session` (guest or authenticated session),
`user` (authenticated account), `participant` (match participant or admin), `admin`.

### 9.1 Public

| Method | Path                     | Auth | Purpose                                                                | Phase | Implemented today |
| ------ | ------------------------ | ---- | ---------------------------------------------------------------------- | ----- | ----------------- |
| GET    | `/health/live`           | none | Process liveness                                                       | 0     | Yes               |
| GET    | `/health/ready`          | none | Dependency readiness, including the database                           | 0     | Yes               |
| GET    | `/v1/config`             | none | Client bootstrap: environment, version, limits                         | 0     | Yes               |
| GET    | `/v1/leaderboards`       | none | Global rating leaderboards                                             | 4     | No                |
| GET    | `/v1/profiles/:username` | none | Public profile: username, avatar, country, member since, casual record | 3     | Yes               |

### 9.2 Session and user

`Auth` value `guest` marks the one endpoint that requires a guest session specifically.

| Method | Path                    | Auth    | Purpose                                             | Phase | Implemented today |
| ------ | ----------------------- | ------- | --------------------------------------------------- | ----- | ----------------- |
| POST   | `/v1/guests`            | none    | Create a guest session                              | 2     | Yes               |
| POST   | `/v1/guests/claim`      | guest   | Convert a guest session into an account             | 3     | Yes               |
| POST   | `/v1/auth/register`     | none    | Create an account with email, password and username | 3     | Yes               |
| POST   | `/v1/auth/sign-in`      | none    | Exchange credentials for a session token            | 3     | Yes               |
| POST   | `/v1/auth/sign-out`     | user    | Revoke the calling session                          | 3     | Yes               |
| POST   | `/v1/auth/verify-email` | none    | Consume an email verification token                 | 3     | Yes               |
| GET    | `/v1/me`                | user    | Current account, verification state, casual record  | 3     | Yes               |
| PATCH  | `/v1/me/profile`        | user    | Update profile fields                               | 3     | Yes               |
| GET    | `/v1/me/matches`        | session | Own match history, newest first                     | 3     | Yes               |
| GET    | `/v1/me/achievements`   | user    | Own achievement progress                            | 6     | No                |
| POST   | `/v1/usernames/check`   | none    | Check username availability                         | 3     | Yes               |
| POST   | `/v1/usernames/claim`   | session | Claim an immutable username                         | 3     | Not delivered     |

The credential endpoints replace the hosted login page of specification section 5.6; appendix P3
of the specification records why, and why `/v1/usernames/claim` is not delivered: a username is
chosen inside the transaction that creates the account, so there is no window in which an
account exists without one.

`POST /v1/auth/register` and `POST /v1/auth/sign-in` answer
`{ account, session: { sessionToken, expiresAt }, emailVerification? }`. `emailVerification` is
present only outside production, where no mail sender exists to deliver the link. Register,
sign-in and verify-email are throttled per address and route; over the limit they answer
`429 rate_limited` with a `retry-after` header.

`POST /v1/guests/claim` answers the same body plus `claimedMatches`, the number of matches moved
to the new account. The guest token itself becomes an account session token, so a client holding
it, mid-match included, keeps acting as the account it just created rather than losing its seat.

### 9.3 Match recovery

| Method | Path                            | Auth        | Purpose                             | Phase | Implemented today |
| ------ | ------------------------------- | ----------- | ----------------------------------- | ----- | ----------------- |
| GET    | `/v1/matches/:matchId`          | participant | Match metadata and result           | 2     | Yes               |
| GET    | `/v1/matches/:matchId/snapshot` | participant | Authoritative snapshot for recovery | 2     | Yes               |

Both endpoints are restricted to match participants and admins. A non-participant receives the
same not-found shape as an unknown match id so match existence is not leaked. A credential of
either kind is sent as `Authorization: Bearer <sessionToken>`.

### 9.3.1 Development only

| Method | Path              | Auth | Purpose                        | Phase | Implemented today |
| ------ | ----------------- | ---- | ------------------------------ | ----- | ----------------- |
| POST   | `/v1/dev/matches` | none | Create a match without a queue | 2     | Yes               |

Matchmaking arrives in Phase 4, so Phase 2 needs a way to start a match. The route is only
registered when `APP_ENV` is `local` or `NODE_ENV` is `test`; a deployed environment answers
`404 not_found` because the route does not exist there.

### 9.4 Administration

Status: planned (Phase 7). Every mutation writes an audit record.

| Method | Path                                    | Auth  | Purpose                                   | Phase | Implemented today |
| ------ | --------------------------------------- | ----- | ----------------------------------------- | ----- | ----------------- |
| GET    | `/v1/admin/users`                       | admin | Search and list users                     | 7     | No                |
| GET    | `/v1/admin/users/:userId`               | admin | User detail, including moderation history | 7     | No                |
| POST   | `/v1/admin/users/:userId/suspend`       | admin | Suspend an account                        | 7     | No                |
| POST   | `/v1/admin/users/:userId/unsuspend`     | admin | Lift a suspension                         | 7     | No                |
| GET    | `/v1/admin/matches/:matchId`            | admin | Full match inspection, including events   | 7     | No                |
| POST   | `/v1/admin/ratings/:userId/adjust`      | admin | Corrective rating adjustment              | 7     | No                |
| GET    | `/v1/admin/achievements`                | admin | List achievement definitions              | 7     | No                |
| POST   | `/v1/admin/achievements`                | admin | Create an achievement definition          | 7     | No                |
| PATCH  | `/v1/admin/achievements/:achievementId` | admin | Update an achievement definition          | 7     | No                |
| GET    | `/v1/admin/metrics/summary`             | admin | Operational summary for the admin surface | 7     | No                |
| GET    | `/v1/admin/audit`                       | admin | Read the audit log                        | 7     | No                |

Audit record shape: `{ adminActorId, action, targetType, targetId, before, after, reason, createdAt }`.
A mutation that cannot write its audit record must fail.

## 10. Error model

### 10.1 HTTP

Status: implemented (Phase 2). Errors use a single JSON problem shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "timeControlSeconds must be one of 180, 300, 600, 900",
    "requestId": "01J2Z3T2Q0J8VF2A2P8YQ2K1M9",
    "details": [{ "path": "timeControlSeconds", "issue": "invalid_enum_value" }]
  }
}
```

| HTTP status | `code` examples                 | Meaning                                     |
| ----------- | ------------------------------- | ------------------------------------------- |
| 400         | `validation_failed`             | Schema validation rejected the request      |
| 401         | `unauthenticated`               | Missing or invalid session                  |
| 403         | `forbidden`, `email_unverified` | Authenticated but not permitted             |
| 404         | `not_found`                     | Unknown resource, or hidden from this actor |
| 409         | `conflict`, `username_taken`    | State conflict                              |
| 429         | `rate_limited`                  | Too many requests                           |
| 500         | `internal_error`                | Unexpected server failure                   |
| 503         | `dependency_unavailable`        | Database or upstream not ready              |

`message` is safe to show to a player. `details` is for developers and must never contain
tokens, password material, magic links or authorization headers.

### 10.2 Socket

| Event               | Semantics                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error:recoverable` | The session stays usable. Examples: transient database unavailability, rate limiting, an action attempted in the wrong state. Payload `{ code, message, retryable: true, context? }`.                                       |
| `error:fatal`       | The session must be torn down. Examples: unsupported client version, revoked session, suspended account. Payload `{ code, message, action }` where `action` is one of `reauthenticate`, `update-client`, `contact-support`. |

Command rejections use the acknowledgement `reason` enum, not these events. `error:*` is for
session-level and infrastructure-level failures.

## 11. Snapshot contract

Status: implemented (Phase 2). The snapshot is the only authoritative representation of match
state that a client may trust.

```json
{
  "matchId": "9f0c8c8e-...",
  "version": 18,
  "status": "active",
  "mode": "ranked",
  "timeControlSeconds": 300,
  "players": {
    "light": { "actorId": "usr_...", "displayName": "ada", "isGuest": false, "rating": 1243 },
    "dark": { "actorId": "usr_...", "displayName": "bo", "isGuest": false, "rating": 1198 }
  },
  "state": {},
  "activePlayer": "dark",
  "clocks": {
    "lightRemainingMs": 214300,
    "darkRemainingMs": 187500,
    "turnStartedAt": 1753392000000,
    "serverTime": 1753392003250
  },
  "result": null,
  "lastMove": { "move": { "kind": "board", "from": "r0c0", "to": "r0c1" }, "version": 18 }
}
```

| Field                  | Notes                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| `version`              | Monotonic per match, incremented once per accepted command                       |
| `status`               | `queued`, `active`, `completed`, `aborted` (spec section 15.5 vocabulary)        |
| `state`                | The canonical board and reserve state produced by `@gobblet/game-core`           |
| `activePlayer`         | `light` or `dark`                                                                |
| `clocks.turnStartedAt` | Server timestamp the active turn began, used for the effective remaining formula |
| `clocks.serverTime`    | Server time at snapshot generation, used by the client to offset interpolation   |
| `result`               | `null` while in progress, otherwise the terminal outcome and reason              |

Snapshots never contain opponent private data beyond public profile fields, and never contain
tokens.

## 12. Clock synchronisation contract

Status: implemented (Phase 2). Full rationale in
[ADR-0009](adr/0009-server-authoritative-clocks.md).

```text
effective_remaining = stored_remaining_ms - (server_now - turn_started_at)
```

Where the formula is applied differs by payload, and both readings are consistent:

- `match:snapshot` and `match:move-committed` carry the stored clocks plus `turnStartedAt`, so
  a client applies the formula itself and can keep counting down between events.
- `match:clock-sync` carries no turn start, so the server has already applied the formula to
  the active side. Both values are true as of `serverTime`.

| Trigger                             | Cadence or moment          |
| ----------------------------------- | -------------------------- |
| Steady state                        | Every 2 seconds            |
| Active clock below 10 seconds       | Every 250 milliseconds     |
| Immediately after an accepted move  | Once, with the new version |
| On reconnect and after `match:sync` | Once, with the snapshot    |
| On client visibility change         | Once, on request           |

Client rules:

- Interpolate locally between syncs for display only.
- Correct to the server value on every sync without animation tricks that hide a discrepancy.
- Never declare a timeout. Only the server ends a match on time.
- No increment, no delay and no latency compensation exist, so there is nothing to negotiate.

## 13. Authorization matrix

Status: implemented for guests, users and participants (Phase 3); admin roles are Phase 7.
`Yes*` marks an action allowed only with a verified email address.

| Capability                                | Guest | User | Participant | Admin |
| ----------------------------------------- | ----- | ---- | ----------- | ----- |
| `GET /v1/config`, leaderboards            | Yes   | Yes  | Yes         | Yes   |
| Casual matchmaking                        | Yes   | Yes  | Yes         | Yes   |
| Ranked matchmaking                        | No    | Yes* | Yes*        | Yes*  |
| Submit `match:move`, `match:resign`       | No    | No   | Yes         | No    |
| Read `/v1/matches/:matchId/snapshot`      | No    | No   | Yes         | Yes   |
| Rematch request and response              | No    | No   | Yes         | No    |
| Preset messages and reactions             | No    | No   | Yes         | No    |
| Claim a username                          | Yes   | Yes  | Yes         | Yes   |
| Read a public profile                     | Yes   | Yes  | Yes         | Yes   |
| Persistent profile, history, achievements | No    | Yes  | Yes         | Yes   |
| Admin endpoints                           | No    | No   | No          | Yes   |

Admin access is a server-side role check, never a client-side route guard. Guests are treated
as rating 1200 for casual pairing purposes and never receive a persistent rating.

Seating is decided by one function, `checkParticipant` in `apps/server/src/match/eligibility.ts`,
which match creation calls today and the Phase 4 queues will call as well. It refuses a guest in
a ranked seat, an account without a verified email in a ranked seat, a suspended account and an
account that no longer exists, and it answers with the seat and the reason
(`guest-ranked`, `email-unverified`, `suspended`, `unknown-account`).

## 14. Limits and payload constraints

Status: planned (Phase 2 for envelope limits, Phase 6 for communication limits).

| Constraint                         | Value                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Maximum socket message size        | Small fixed limit, enforced by the transport configuration                                  |
| Maximum in-flight match commands   | 1 per match per client                                                                      |
| Command rate limit                 | Per session, enforced server side, exceeding yields `error:recoverable` with `rate_limited` |
| Free-text player to player content | Not supported at all                                                                        |
| Communication payloads             | Enum keys only (`messageKey`, `reactionKey`) from a server-known set                        |
| Unknown fields                     | Rejected by Zod strict object parsing                                                       |
| Unknown enum members               | Rejected on input, ignorable on output                                                      |

Communication is enum-only by design: there is no moderation burden, no localisation drift and
no injection surface, because the client sends a key and the server resolves it.

## 15. How to add a new command

Status: this checklist applies from Phase 2 onwards, when `@gobblet/protocol` and the match
runtime exist.

1. Write or update an ADR if the change alters envelopes, reason codes, authorization or
   persistence semantics.
2. Add the Zod schema and inferred types to `@gobblet/protocol`, including the payload schema
   and any new enum members.
3. Decide whether the command mutates match state. If it does, it uses the standard envelope
   with `expectedVersion` and `commandId`, and it must be applied inside a single transaction.
4. Extend the rules engine in `@gobblet/game-core` only if the change is a rule change, never
   to accommodate transport concerns.
5. Implement the server handler: validate, authorize, load with a row lock, check idempotency,
   apply, persist, commit, acknowledge, then broadcast.
6. Add or extend the acknowledgement reason handling on the client for every reason code.
7. Add tests: schema round-trip, authorization rejection, idempotent retry, stale version
   rejection, and the persistence assertion that no acknowledgement precedes a commit.
8. Update this document (event or endpoint table plus the phase column) and
   [`traceability-matrix.md`](traceability-matrix.md).
9. If the change is not backward compatible, introduce `/v2` and raise
   `MIN_SUPPORTED_CLIENT_VERSION`.
