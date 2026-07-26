# ADR-0033: The desktop application is the web build in a Tauri window, and native code is only what a browser cannot do

## Status

Accepted

## Date

2026-07-26

## Context

[ADR-0004](0004-tauri-v2-desktop-shell.md) chose Tauri v2 and listed what the shell would be
responsible for: packaging the same client build, storing session material in platform secure
storage, opening the system browser for authentication, receiving an OAuth callback through a deep
link, confirming a close during a match, and installing signed updates.

Three of those have moved since. [ADR-0017](0017-first-party-email-password-authentication.md)
replaced the hosted identity provider with first-party email and password authentication, so there is
no Universal Login page to open in a system browser and no callback to receive: the desktop signs in
against the same API as the browser, and appendix P3 already records the PKCE deep-link criterion as
void. [ADR-0020](0020-client-match-state-is-the-server-snapshot.md) made the client's match state a
server snapshot, so a desktop window has nothing extra to remember. What is left is genuinely native:
a place to keep an opaque session token that is not a file in the application directory, a close that
does not silently abandon a match, and an updater.

The temptation in a desktop phase is to grow a second client. Every native surface added here is a
second place where the rules, the protocol or the presentation can drift, and section 2.2 of the
specification is explicit that web and desktop share nearly all client code.

## Decision

`apps/desktop` is a Tauri v2 shell that loads the same production bundle `apps/web` ships, and the
Rust side contains only what a web view cannot do for itself.

- The bundle is not rebuilt or forked for the desktop. The release workflow builds `@gobblet/web`
  exactly as the web deployment does and hands the output to the Tauri bundler, so a defect can never
  be present in one product and absent in the other.
- The client detects its host at runtime rather than at build time. `isDesktop()` is true when the
  Tauri interface is present on the window, and every desktop-only behaviour is behind that one
  predicate, so the browser build carries the code but never runs it and the suites can exercise both
  paths without a second bundle.
- Native surface one, secure storage. The session token is an opaque bearer string
  ([ADR-0017](0017-first-party-email-password-authentication.md)); in a browser it lives in
  `localStorage`, and on the desktop it lives in the operating system's credential store through the
  `keyring` crate, reached by three commands: read, write and delete. The existing session store
  already takes an injected key-value store, so the desktop supplies a different implementation of an
  interface that already existed. Because the commands are asynchronous and the store is not, the
  shell reads the token once before the application mounts and writes through afterwards.
- Native surface two, the close. Closing the window during an active match is intercepted in the
  client, which asks the player whether quitting should resign. Confirming sends `match:resign` and
  waits for the acknowledgement before the window closes; dismissing keeps the player in the match.
  The interception is client code guarded by `isDesktop()`, so it is tested with the rest of the
  client rather than in Rust.
- Native surface three, the updater, which is [ADR-0034](0034-updates-are-asked-of-our-own-server.md).
- The desktop reports its version. `session:hello` already carries a client version and the server
  already refuses a version below `MIN_SUPPORTED_CLIENT_VERSION`; the desktop's version is the one in
  the bundle's metadata, and a refusal is shown as "download the new version" with a link rather than
  as a protocol error.
- There is no deep link, no embedded credential form other than the client's own, and no second
  window. If a future phase adds a hosted identity provider, the deep link returns with it.

## Consequences

### Positive

- One implementation of the rules, the protocol and the presentation, on both products.
- The Rust surface is three commands and a window configuration, which is a size a reviewer can hold
  in their head and a size that does not need its own test pyramid.
- Desktop behaviour is testable in the web suites, because it is client code behind a predicate.
- A session token never lands in a plain file inside the application data directory.

### Negative

- `isDesktop()` is a runtime branch, so the browser bundle carries a little code it will not run.
  The alternative is two bundles, which is the thing being avoided.
- The keychain is reached across an asynchronous boundary, so the shell has a short hydration step
  before the first render. It is one read.

### Neutral

- The web view is the operating system's, so the desktop inherits WebKit on macOS and WebView2 on
  Windows. That is exactly the pair the browser suite already runs, which is why
  [ADR-0021](0021-playwright-browser-end-to-end-tests.md) chose Chromium and WebKit.
- Platform secure storage is available on both target platforms, so the specification's "where
  supported" does not have to be exercised.

## Alternatives considered

### A separate desktop client

Rejected. It doubles the rules-adjacent code, and the specification says the products share nearly
all client code.

### Native code for the board

Rejected. The renderer is WebGL through the same web view, and a native renderer would be a second
implementation of the hardest part of the client.

### Storing the session in a file inside the application data directory

Rejected. It is the difference between a token protected by the operating system's credential store
and a token readable by anything running as the user, and section 19.2 asks for secure storage.

### Deciding the host at build time with a Vite flag

Rejected. It creates two bundles from one source, which is how a defect comes to exist in only one of
them, and it would need a second set of browser runs to prove.

## References

- [`../product-spec.md`](../product-spec.md) sections 2.2, 5.3, 5.4, 19.2, 24 (Phase 8), appendix P8
- [ADR-0004](0004-tauri-v2-desktop-shell.md), [ADR-0017](0017-first-party-email-password-authentication.md),
  [ADR-0020](0020-client-match-state-is-the-server-snapshot.md)
