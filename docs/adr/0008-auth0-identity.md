# ADR-0008: Auth0 for identity

## Status

Superseded by ADR-0017

## Date

2026-07-24

## Context

Players must be able to sign in on the web and in the desktop application, with several options:
email and password, passwordless email, Google, Apple and GitHub. The product also needs guest
play, so a player can try the game before creating an account, and later claim that guest session.

Ranked play requires a verified email address, because rating is the incentive to abuse
throwaway accounts. Accounts must also be linkable, so a player who first used Google and later
used email and password does not end up with two ratings, but linking identities is a classic
account-takeover vector if it is done on unverified email.

The desktop application adds a constraint: an embedded credential form inside an application web
view is both a phishing-training pattern and a rejection risk with identity providers. Desktop
login must go through the system browser.

Building this correctly means owning password hashing and rotation, credential stuffing defence,
email verification flows, passwordless links, four social provider integrations, session
revocation and a security update treadmill. For a two-person-scale project, an authentication
defect is a far more likely source of harm than the cost of a managed provider.

Status: planned (Phase 3). No authentication exists today.

## Decision

Identity is delegated to Auth0 using Universal Login.

- The flow is Authorization Code Flow with PKCE for both the web client and the desktop shell. No
  implicit flow, no resource owner password grant.
- Connections enabled: username and password database, passwordless email, Google, Apple, GitHub.
- The desktop shell opens the system browser and receives the callback through a registered deep
  link. The desktop application never renders a credential form (see
  [ADR-0004](0004-tauri-v2-desktop-shell.md)).
- Email verification is required before ranked matchmaking. Casual play and guest play do not
  require it.
- Account linking is only permitted between identities that are both verified and share the same
  email address, and linking is always an explicit user action.
- The Auth0 subject identifier is mapped to a local user record that owns the immutable username,
  rating, history, achievements and moderation state. Product data is never keyed on an external
  provider identifier alone.
- Token verification and session helpers live in `packages/auth`. The server verifies tokens on
  every authenticated HTTP request and on `session:authenticate` for sockets.
- Guest sessions are issued by the server (`POST /v1/guests`) and can be claimed
  (`POST /v1/guests/claim`). Guests are treated as rating 1200 for casual pairing and never hold a
  persistent rating.
- Auth0 configuration is supplied by `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLIENT_ID`,
  `AUTH0_MANAGEMENT_CLIENT_ID` and `AUTH0_MANAGEMENT_CLIENT_SECRET`, with the management secret
  held only in the secret store.

## Consequences

### Positive

- The project never stores or verifies passwords, which removes the highest-severity class of
  vulnerability from its own codebase.
- Four social providers plus passwordless email arrive as configuration instead of four
  integrations, each with its own quirks.
- Universal Login is maintained against evolving provider requirements and attack patterns without
  project work.
- The same PKCE flow serves web, desktop and any future native client.
- Verified-only linking closes the pre-verification account-takeover path that naive linking
  creates.

### Negative

- A third-party dependency sits on the critical path for login. An Auth0 outage prevents new
  sign-ins, and its pricing and terms are outside project control.
- Login involves a redirect to a hosted page, so branding and flow customisation are bounded by
  what Universal Login supports.
- Tenant configuration (callbacks, origins, connections, deep-link scheme) becomes environment
  state that must be managed and kept in step across local, staging and production.
- The management client secret is a high-value credential requiring rotation procedures.

### Neutral

- Migrating away later would require exporting users and reissuing credentials, which is why the
  local user record, not the Auth0 subject, owns product data.
- Guest identity remains project-owned, because guests exist before any identity provider is
  involved.
- Admin roles are evaluated server side against the local user record, never taken from a client
  claim alone.

## Alternatives considered

### Self-hosted authentication in the server

Rejected on risk. It would mean owning password hashing, breach detection, credential stuffing
defence, verification and passwordless email delivery, session revocation and four OAuth client
integrations. The probability of introducing a serious defect there is high, and the consequence
is account compromise.

### Clerk

Rejected as a close second choice rather than on quality. Auth0's Universal Login plus its
native-application PKCE and deep-link support are well documented for exactly the desktop pattern
required here, and the connection set needed maps directly onto Auth0 configuration.

### Supabase Auth or Firebase Authentication

Rejected because both come with strong gravity toward their own data platforms, and the datastore
decision is already settled on managed PostgreSQL accessed through Drizzle (see
[ADR-0007](0007-postgresql-drizzle.md)). Adopting their auth alone means running a second platform
for one feature.

### Per-provider bespoke OAuth integrations

Rejected on maintenance cost and consistency. Each provider has its own token, refresh, revocation
and profile behaviour, and Apple in particular has distinctive requirements. Four bespoke
integrations plus a local password system is the worst of both worlds.

### Embedded login form in the desktop shell

Rejected explicitly. It trains players to type credentials into a non-browser window, it is
discouraged by identity providers, and it puts credential material inside the application process.

## References

- [`../protocol.md`](../protocol.md), [`../operations.md`](../operations.md)
- [ADR-0004](0004-tauri-v2-desktop-shell.md), [ADR-0007](0007-postgresql-drizzle.md)
- [`../product-spec.md`](../product-spec.md)
