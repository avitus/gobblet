# ADR-0029: Administration is a role on the account, and every mutation is audited

## Status

Accepted

## Date

2026-07-26

## Context

[Section 16](../product-spec.md) requires a protected dashboard that can find a player, read their
account status, suspend and unsuspend them, inspect a match's complete internal event history,
correct Elo with a reason, manage the achievement catalogue, and read live operational figures and
the audit log. [Section 14.4](../product-spec.md) fixes the endpoints, and states that every
administrative mutation must record the administrator, the action, the target, the before state, the
after state, the reason and the moment.

Two questions had to be settled before any of it could be written: who an administrator is, and
where the dashboard lives.

Identity in this product is first party, an email address, a password and an opaque session token
([ADR-0017](0017-first-party-email-password-authentication.md)). There is no directory to inherit
group membership from, so an administrator is either a second kind of credential with its own store
and its own login, or an ordinary account carrying a role.

The dashboard is a browser interface over the same API the player client uses, and the specification
says it "does not need a separate native application". It could be a second Vite application with
its own origin and its own deployment, or a set of routes inside the existing client.

Suspension already exists as a database state that revokes live sessions and blocks queueing, match
creation and every match command (appendix P3.7, P3.8). What is missing is the surface that sets it,
and the record of who set it.

## Decision

An administrator is an account with the `admin` role, and the dashboard is a set of gated routes in
the player client.

- `users.role` is an enumeration, `player` or `admin`, defaulting to `player`. Every existing account
  is a player, and the column is the only thing that distinguishes an administrator.
- An administrator signs in through the same screens, with the same password rules, the same
  throttle and the same opaque session token as anybody else. There is no second credential store,
  no second login form and no second session lifetime.
- Every `/v1/admin/*` route resolves the session, requires an active account, and requires the
  `admin` role. Refusal is `403 forbidden` with no hint about what the endpoint would have done, and
  it is the same answer whether the caller is a player, a guest or unauthenticated. The role is
  never trusted from the client.
- `GET /v1/me` reports the role, because the client needs to know whether to offer the dashboard at
  all, but the report is a consequence of the server's decision rather than the basis of it.
- The dashboard lives at `/admin/*` in the web client, behind a guard that sends anybody without the
  role back to the play screen. Its screens are the design system's, so an administrative table
  looks like the rest of the product and costs no second component library.
- Every administrative mutation writes an `audit_log` row in the same transaction as the change it
  describes. The row carries the administrator, the action, the target kind and id, the before and
  after states as JSON, the required reason, and the moment. A mutation that fails writes nothing:
  there is no audit record for an action that did not happen, and no action that happened without
  one.
- The reason is required by the schema, not by the screen, so it cannot be omitted by a caller that
  bypasses the dashboard.
- The audit log is append-only. There is no endpoint that edits or deletes a row, and the table has
  no update path in the repository layer.
- Match inspection reads the complete internal event history, and the connection history section 16
  also asks for is recorded in a table of its own rather than in `match_events`. A match event
  consumes a sequence number, which is the match version the protocol acknowledges and the client
  applies ([ADR-0011](0011-versioned-idempotent-commands.md)); a socket attaching or detaching
  changes no game state and must not move that number.
- An Elo correction is a row in `rating_adjustments` beside the audit row, not a row in
  `rating_changes`. The latter is the per-match rating audit that period leaderboards aggregate
  ([ADR-0028](0028-leaderboards-are-read-time-queries.md)); a correction has no match, no side and no
  opponent, and it must not make an account a member of a period board it never played in.
- The first administrator is made by a script run against the database
  (`pnpm --filter @gobblet/server admin:grant`), not by an endpoint. Nothing in the API can create an
  administrator, so a compromised session cannot escalate itself.

## Consequences

### Positive

- One identity system, one session mechanism and one set of security properties to reason about.
  Password throttling, suspension and session revocation already apply to administrators.
- The dashboard reuses the client's routing, data layer, design system and test setup, so the
  administrative surface costs a set of screens rather than a second application.
- The audit record cannot drift from the mutation, because they commit or roll back together.
- An administrator who loses the role loses the dashboard immediately, since the role is read from
  the database on every request rather than carried in a token.

### Negative

- The administrative screens are part of the player bundle. They are useless without the role, and
  the API refuses regardless, but the code is downloaded by everybody. Route-level code splitting
  is the remedy if the bundle budget demands it.
- A compromised administrator account is a compromised dashboard. There is no second factor in this
  phase; the mitigations are the audit log, the throttle and session revocation.
- Granting the first administrator requires database access, which is deliberate friction.

### Neutral

- The role is a single enumeration rather than a permission set. Finer grades of administration can
  be added later by widening the column, and the audit rows already name the action.
- Nothing about the dashboard is a separate deployment, so it is drained and released with the
  client it lives in.

## Alternatives considered

### A separate administrative application on its own origin

Rejected for this phase. It buys a smaller blast radius for the bundle and a separate deployment,
and it costs a second Vite application, a second build and continuous integration target, a second
origin in the CORS list, and a duplicated data and design layer. The API refusal is the control that
matters, and it is identical either way.

### A separate administrator credential store

Rejected: it doubles the authentication surface, including the parts that are easy to get wrong,
and it would need its own throttle, its own session table and its own recovery path. A role on an
account that already has all of those is stronger, not weaker.

### An audit record written after the mutation commits

Rejected: it can be lost. A crash between the two writes leaves an administrative change with no
record of who made it, which is the one thing section 14.4 forbids.

### A permission flag in the session token

Rejected: a token that carries authority is a token that keeps it after the role is revoked. Reading
the role from the account on every request costs one join and removes a class of bug.

## References

- [`../product-spec.md`](../product-spec.md) sections 14.4, 16, 19.3, appendix P7
- [ADR-0017](0017-first-party-email-password-authentication.md),
  [ADR-0007](0007-postgresql-drizzle.md)
- [`../protocol.md`](../protocol.md) section 9.6
