# ADR-0004: Tauri v2 desktop shell

## Status

Accepted

## Date

2026-07-24

## Context

The product ships directly downloadable macOS and Windows applications in addition to the web
application. Players must be able to download an installer, install it without a store account,
and receive updates automatically. Installers and updates must be signed so operating systems do
not block them and so an update channel cannot be used to distribute tampered binaries.

The desktop application is not a different product. It plays the same matches against the same
authoritative server, with the same rules engine and the same protocol. Building a second client
would double the surface where a rules or protocol mismatch could appear.

Desktop delivery adds three concerns the web client does not have: where session material is
stored on disk, how an interactive login completes without embedding a credential form in the
application, and what happens when a player closes the window during a live match whose clock is
still running.

Status: planned (Phase 8). No desktop shell exists today.

## Decision

`apps/desktop` is a Tauri v2 shell that packages the identical `apps/web` build.

- The shell contains no game logic, no rules, no protocol handling and no alternative UI. It
  loads the same static bundle the web deployment serves.
- Session material is stored using platform secure storage (Keychain on macOS, Credential
  Manager on Windows), never in plain files inside the application data directory.
- Authentication opens the system browser for Auth0 Universal Login with Authorization Code Flow
  and PKCE, and the result returns through a registered deep link into the application. The
  desktop application never renders a credential form and never sees a password (see
  [ADR-0008](0008-auth0-identity.md)).
- Closing the window during an active match shows a confirmation dialog stating that quitting
  resigns the match. Confirming sends `match:resign` and waits for the acknowledgement before the
  process exits. A player who dismisses the dialog stays in the match.
- Installers (DMG for macOS, NSIS executable for Windows) are signed, and macOS builds are
  notarized. Automatic updates are delivered as signed update bundles referenced by a signed
  manifest. An unsigned artifact is never published.
- Release channels are `stable` plus an optional internal `beta`, with the ability to pause a
  rollout, and the server enforces `MIN_SUPPORTED_CLIENT_VERSION`. The procedure is in
  [`../operations.md`](../operations.md).

## Consequences

### Positive

- One client implementation serves web and desktop, so rules and protocol behaviour cannot
  diverge between platforms.
- Tauri uses the operating system web view, so installers are small (single-digit to low tens of
  megabytes) and download friction is low.
- Signing and notarization are first-class in the Tauri tooling, including signed updates with a
  manifest.
- Platform secure storage and system-browser authentication are materially safer than storing
  tokens in web view storage and safer than an embedded login form.
- The clock-still-runs problem gets an explicit, honest answer: quitting is a resignation, stated
  before it happens.

### Negative

- Building requires a Rust toolchain and platform-native runners: macOS signing and notarization
  need a macOS runner, Windows signing needs a Windows runner.
- Rendering depends on the operating system web view version, so the 3D scene must be tested
  against WebKit on macOS and WebView2 on Windows, and quality fallbacks matter.
- Signing credentials and certificates become operational assets with expiry dates and rotation
  procedures.
- Deep-link registration and the update pipeline are platform-specific work that cannot be
  verified from a single development machine.

### Neutral

- The desktop origin must be included in `CORS_ORIGINS`.
- Desktop distribution artifacts live in GitHub Releases or object storage, not on the
  application server.
- Store distribution (Mac App Store, Microsoft Store) is not part of this decision and is not
  planned.

## Alternatives considered

### Electron

Rejected on size and maintenance cost. Electron bundles Chromium and Node per application,
producing installers an order of magnitude larger, and it adds a second runtime to patch for
security. Signing, notarization and auto-update all require additional tooling that Tauri
provides directly. The one clear Electron advantage, a single guaranteed rendering engine, is
worth less here than the download-size and maintenance savings, and the 3D scene already needs a
quality fallback tier for web browsers.

### Native applications per platform (SwiftUI and a Windows-native stack)

Rejected because it would mean two additional clients, each with its own rendering,
reconnection, clock display and protocol handling. That is the exact duplication this project is
organised to avoid, at several times the implementation cost, for a game whose interface is not
platform specific.

### Progressive web application only

Rejected because it cannot satisfy the product requirement of a signed downloadable installer.
A progressive web application gives no code-signed artifact, weaker desktop integration (window
lifecycle, deep links, secure credential storage), and no controllable release channel with the
ability to pause a rollout.

### Web view wrapper written in-house

Rejected because it would mean owning signing, notarization, update manifests and update
signature verification from scratch, which is the most security-sensitive part of desktop
delivery.

## References

- [`../operations.md`](../operations.md)
- [ADR-0003](0003-react-vite-web-client.md), [ADR-0008](0008-auth0-identity.md)
- [`../product-spec.md`](../product-spec.md)
