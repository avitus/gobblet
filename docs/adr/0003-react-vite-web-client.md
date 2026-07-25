# ADR-0003: React and Vite web client

## Status

Accepted

## Date

2026-07-24

## Context

The web client is the primary way players reach Gobblet Online, and the same build is packaged
by the desktop shell (see [ADR-0004](0004-tauri-v2-desktop-shell.md)). That imposes two
requirements on the client architecture:

- The output must be a static bundle that a CDN can serve and a desktop shell can embed. No
  server-side rendering runtime may be required at play time.
- The client must integrate a 3D scene (see [ADR-0005](0005-threejs-react-three-fiber.md))
  alongside conventional UI (lobby, profiles, leaderboards, settings).

There is also a correctness constraint that shapes state management. Match state is
authoritative on the server and arrives as versioned snapshots and committed-move events (see
[ADR-0010](0010-match-event-persistence.md) and
[ADR-0011](0011-versioned-idempotent-commands.md)). If authoritative match state is copied into
a general-purpose client store, that store becomes a second source of truth that will drift,
and drift in a real-time game shows up as a board that disagrees with the server.

Almost every page is behind a session, so search engine indexing and first-paint server
rendering carry little value. Status: the client is a Phase 0 skeleton today; the playable
client is planned for Phase 5.

## Decision

`apps/web` is a React single-page application built with Vite.

- Routing uses React Router. The build output is a static bundle suitable for CDN hosting and
  for embedding in the Tauri shell.
- HTTP server state (configuration, profile, leaderboards, match history) is managed with
  TanStack Query. Caching, retry and invalidation are handled there rather than hand rolled.
- Zustand is used only for local UI state: selection preview, camera preferences, sound and
  reduced-motion settings, modal state, and other view concerns.
- Authoritative match state does not live in a general-purpose client store. It is held by the
  match session layer as the last server snapshot plus an explicitly separate optimistic overlay,
  and every server snapshot, `match:move-committed` event or command rejection replaces the
  overlay rather than merging into it.
- Optimistic evaluation uses `@gobblet/game-core` directly, so client previews are computed by
  the same rules the server enforces, and clocks are display-only interpolations of the last
  `match:clock-sync` (see [ADR-0009](0009-server-authoritative-clocks.md)).
- The web client depends only on `@gobblet/game-core`, `@gobblet/protocol`, `@gobblet/game-ui`,
  `@gobblet/design-system` and `@gobblet/config`.

## Consequences

### Positive

- A static bundle deploys to a CDN and into the desktop shell without a second code path or a
  Node runtime at the edge.
- The React ecosystem gives direct access to React Three Fiber, which makes the 3D board a part
  of the same component tree as the surrounding UI.
- TanStack Query removes most hand-written fetching, caching and retry logic, and its cache is
  clearly scoped to HTTP resources rather than to live match truth.
- Keeping authoritative match state out of a general store makes the reconciliation rule
  reviewable: there is exactly one place where server truth is adopted.
- Vite keeps the development loop fast, which matters for iterating on a 3D scene.

### Negative

- No server-side rendering means public pages (profiles, leaderboards) render client side and
  will need explicit work if search visibility is ever wanted.
- Two state mechanisms plus a match session layer is more structure than a single global store,
  and contributors must learn which one a given piece of state belongs to.
- Single-page applications need deliberate handling of code splitting and initial bundle size,
  especially with a 3D renderer in the tree.

### Neutral

- Client environment configuration is exposed through `VITE_` prefixed variables, which are
  public by definition.
- Route-level authorization is a user experience affordance only. Every authorization decision
  is made server side (see [`../protocol.md`](../protocol.md)).
- The same client code is the supported mobile experience through responsive layout; there is no
  native mobile app in the MVP.

## Alternatives considered

### Next.js

Rejected. Server-side rendering and server components add value for public content-heavy sites,
and this product is an authenticated real-time game where nearly every screen is session bound.
Next.js also complicates the two delivery constraints that matter here: producing a plain static
bundle for CDN hosting and embedding the identical build inside the Tauri shell. Taking on a
framework runtime, a second execution environment and export caveats to gain rendering features
the product does not need is not justified.

### SvelteKit

Rejected on ecosystem fit rather than quality. The 3D layer is the highest-risk part of the
client, and React Three Fiber plus drei is the most mature declarative Three.js integration
available. Choosing SvelteKit would mean hand-integrating Three.js and giving up that ecosystem.

### Vue with Nuxt or plain Vue

Rejected for the same reason as SvelteKit: no advantage that offsets losing the React Three
Fiber ecosystem, and the same server-rendering overhead in the Nuxt case.

### Redux Toolkit as the single store for all state, including match state

Rejected because it encourages exactly the failure mode this decision avoids: authoritative
match state living in a general-purpose client store where reducers can mutate it independently
of the server. The snapshot-plus-overlay model keeps server truth uncontaminated.

### Plain React with hand-written data fetching

Rejected because caching, retry, deduplication and invalidation would be rebuilt by hand across
many screens, and inconsistently.

## References

- [`../architecture.md`](../architecture.md)
- [`../protocol.md`](../protocol.md)
- [ADR-0004](0004-tauri-v2-desktop-shell.md), [ADR-0005](0005-threejs-react-three-fiber.md)
- [ADR-0009](0009-server-authoritative-clocks.md), [ADR-0011](0011-versioned-idempotent-commands.md)
