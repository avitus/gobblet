# ADR-0017: First-party email and password authentication

## Status

Accepted

## Date

2026-07-25

## Context

[ADR-0008](0008-auth0-identity.md) delegated identity to Auth0 with Universal Login, PKCE, four
social connections and passwordless email. That decision was taken before Phase 3 began and
before the project owner stated a constraint that changes the option space: the product is not to
depend on an external identity provider. Every login method that requires a hosted provider or a
transactional mail sender is therefore unavailable, whatever its merits.

What the specification still requires is unchanged and must be delivered by whatever mechanism
replaces Auth0:

- Registered accounts distinct from guests ([`../product-spec.md` section 2.3](../product-spec.md)).
- Globally unique, immutable usernames.
- Guest activity claimable by the account that a guest creates or signs into.
- A verified-email gate before ranked matchmaking ([section 5.6](../product-spec.md)).
- Administrators identified server side, never from a client claim.
- Suspension enforced by the server.

The relevant existing system is already close to this shape. Phase 2 issues guest sessions from
`POST /v1/guests` as 32 random bytes returned once and stored only as a SHA-256 hash with an
expiry, and the match runtime already resolves an actor of type `guest` or `user` from a bearer
token. Nothing in the match runtime, the protocol package or the database depends on how an actor
was authenticated.

The constraint that dominates the remaining choice is that this project now owns password
verification, which [ADR-0008](0008-auth0-identity.md) explicitly rejected owning. Owning it
badly is the most severe defect class available to this codebase, so the mechanism must be
conservative, dependency-free where the platform already provides a vetted primitive, and
enforced in one place.

## Decision

Identity is first party. There is no external identity provider, no OAuth client and no
redirect-based login.

- Credentials are an email address and a password. Google, Apple, GitHub and passwordless email
  links are not offered, because each requires an external provider or a mail sender.
- Passwords are hashed with `scrypt` from `node:crypto` using a 16-byte random salt per user, a
  cost of `N = 2^15`, `r = 8`, `p = 1` and a 64-byte derived key. The stored value carries its own
  parameters (`scrypt$N$r$p$salt$hash`) so the cost can be raised later and old hashes stay
  verifiable. Verification compares with `timingSafeEqual`. No native dependency and no
  third-party hashing library is introduced.
- Sessions are opaque bearer tokens: 32 random bytes, base64url, returned once, stored only as a
  SHA-256 hash with an expiry and a revocation column. There are no self-contained tokens, because
  suspension and sign-out must take effect immediately, which a stateless token cannot guarantee.
- One code path authenticates every request and every socket handshake. A bearer token resolves to
  a guest session or a user session, producing the same `Actor` shape the match runtime already
  consumes.
- Password verification, session token generation and hashing, and email and username
  normalisation live in `packages/auth`. That package has no database, no HTTP framework and no
  server dependency, so it can be tested exhaustively in isolation.
- The local user record owns the immutable username, the email, the verification state, the
  moderation state and, later, rating and achievements. An email address identifies at most one
  user; a username identifies at most one user; both are enforced by database constraints, so a
  duplicate race fails in the database rather than in application logic.
- Email verification is issued as a single-use token with an expiry. Delivery has no sender in
  this phase: in local and test environments the verification link is logged. The verified-email
  gate exists and is enforced, so the gate cannot be forgotten when delivery arrives.
- Suspension is a state on the user record. Every authentication resolves it, a suspended user
  cannot create or join a match, and existing sessions are revoked when the suspension is applied.

## Consequences

### Positive

- Login has no third-party dependency, no tenant configuration and no provider outage on its
  critical path.
- Session revocation is immediate and total, which is what makes suspension enforcement and
  sign-out real rather than advisory.
- The authentication surface is small enough to test exhaustively, and `packages/auth` is pure, so
  its properties can be asserted without a database or a server.
- Guests and accounts share one session mechanism and one actor resolution path, so the match
  runtime is unaffected by identity changes.

### Negative

- This project now owns password verification, credential-stuffing exposure and session lifetime
  management, which [ADR-0008](0008-auth0-identity.md) deliberately avoided. The mitigation is a
  vetted platform primitive, parameterised hashes, opaque revocable sessions and rate limiting on
  the credential endpoints.
- Players lose social sign-in and passwordless links. Sign-in requires remembering a password,
  which will reduce conversion compared with a Google button.
- Without a mail sender there is no password reset and no delivered verification mail, so a
  forgotten password cannot be recovered in this phase.
- Every session check is a database read. The read is indexed and single-row, and it is the price
  of immediate revocation.

### Neutral

- The desktop shell no longer needs a deep-link callback or a system-browser flow, because there
  is no redirect. It uses the same HTTP API as the web client.
- Administrators are a flag on the local user record, evaluated server side, which is what
  [ADR-0008](0008-auth0-identity.md) already required.
- Adding a provider later remains possible: an `identities` table can map an external subject to
  the same local user record, because product data is keyed on the local user, never on a provider
  identifier.
- Specification sections 2.3 and 5.6 name login methods that are not delivered. The deviation is
  recorded in appendix P3 of [`../product-spec.md`](../product-spec.md) rather than silently
  dropped.

## Alternatives considered

### Keep Auth0 as decided in ADR-0008

Rejected on the stated constraint. The product is not to depend on an external identity provider,
which removes Auth0 and every other hosted option regardless of their security advantages.

### Self-hosted OIDC provider, for example Keycloak or Ory

Rejected on operating cost. It reintroduces a redirect flow, a second deployable, its own database
and its own upgrade treadmill, while still requiring a mail sender for verification and reset.
That is more operational surface than the whole match runtime for a two-person-scale project, and
the social connections it would enable still need external providers.

### Signed self-contained session tokens (JWT) issued by this server

Rejected on revocation. A stateless token remains valid until it expires, so a suspension or a
sign-out could not take effect immediately without a revocation list, which is the database read
the token was meant to avoid. Opaque tokens achieve the same request cost with correct
revocation, and reuse the guest session mechanism already in place.

### Argon2id instead of scrypt

Rejected on dependency risk, not on cryptography. Argon2id is the stronger modern choice, but on
Node it requires a native module in the build and deploy path of every environment. `scrypt` is in
the platform, is memory-hard, and the stored parameter prefix leaves the door open to migrate
hashes later.

## References

- [`../product-spec.md` sections 2.3, 5.6, 14.2](../product-spec.md)
- [`../architecture.md`](../architecture.md)
- [ADR-0008](0008-auth0-identity.md), superseded by this record
- [ADR-0004](0004-tauri-v2-desktop-shell.md) for the desktop consequence
- Node.js `crypto.scrypt` documentation
