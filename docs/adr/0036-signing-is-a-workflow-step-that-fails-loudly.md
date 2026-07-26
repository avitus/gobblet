# ADR-0036: Signing and notarization are workflow steps that fail loudly, and the criteria they satisfy are deferred honestly

## Status

Accepted

## Date

2026-07-26

## Context

Two of the four Phase 8 exit criteria are about a machine this repository does not have:

- a clean macOS machine installs and launches the application without a security warning;
- a clean Windows machine installs and launches it without a SmartScreen warning, once reputation and
  signing requirements are met.

Both require paid identities: an Apple Developer Program membership with a Developer ID Application
certificate and an Apple ID that can notarize, and a Windows code-signing certificate, in practice an
organisation-validated or extended-validation certificate from a public authority. Neither exists
here, and neither can be conjured by a build script. Windows SmartScreen additionally requires
reputation, which accrues over downloads and time and cannot be tested at all before publication.

The precedent is Phase 7: the deploy workflow's provider steps `exit 1` with an explanation rather
than pretending to deploy ([`../operations.md`](../operations.md) section 7). A build that quietly
produces an unsigned artifact is worse than a build that stops, because an unsigned artifact can be
published, downloaded and blocked by the operating system in front of a player.

## Decision

The desktop release workflow contains the signing, notarization and stapling steps in full, and each
one stops the release when its secret is absent.

- Every signing step begins by checking for the secrets it needs and calling `exit 1` with the name of
  the missing secret and what has to be bought or generated to obtain it. There is no fallback path
  that yields an unsigned installer.
- An explicit `allow-unsigned` input exists for a developer build and is refused when the target is a
  channel: it produces artifacts marked as unsigned in their file names, and the publication step
  refuses to record them as a release. This is what makes a local or a rehearsal build possible
  without making an unsigned publication possible.
- The two "clean machine" criteria are recorded as deferred in appendix P8 with the exact remaining
  steps, the secrets each one needs, and where in the workflow they plug in. They are deferred, not
  waived: nothing about them is redesigned by their absence.
- The failure of a signing or notarization step is reported to the API as a build event, so
  `gobblet_desktop_signing_failures_total` becomes a real series and the `GobbletDesktopSigningFailure`
  rule of [ADR-0031](0031-metrics-are-a-prometheus-exposition.md) stops being pending. A failed step
  therefore fails the job _and_ leaves a mark an operator can see.
- What can be proved here is proved here: that the shell builds on both platforms, that the bundle it
  packages is the web build, that an update manifest is served and verified against the public key
  compiled into the application, and that a rejected or corrupt update leaves the running application
  untouched.

## Consequences

### Positive

- The release procedure is written, ordered and reviewable now, so acquiring the identities is a
  configuration task rather than a development task.
- No unsigned artifact can be published by accident.
- The one alert that was pending on Phase 8 becomes live.

### Negative

- The desktop release workflow cannot be exercised end to end in this repository. It is exercised as
  far as the first signing step, and the steps beyond it are reviewed rather than run.
- Windows reputation cannot be established until real downloads happen, so the second criterion
  remains partly outside anybody's control even after a certificate is bought.

### Neutral

- Notarization is a network round trip to Apple that takes minutes. The workflow waits for it and
  staples, which is the only correct order.

## Alternatives considered

### Producing unsigned artifacts and documenting the warnings

Rejected. Unsigned installers that reach a player are a security lesson taught the wrong way, and the
specification says an unsigned artifact is never published.

### Omitting the signing steps until an identity exists

Rejected. The steps are where the procedure's knowledge lives; writing them later means designing the
release under time pressure with a certificate in hand.

### Ad-hoc signing on macOS

Rejected: an ad-hoc signature satisfies neither Gatekeeper nor notarization, so it looks like progress
while changing nothing a player would see.

## References

- [`../product-spec.md`](../product-spec.md) sections 19.2, 22.3, 24 (Phase 8), appendix P8
- [ADR-0031](0031-metrics-are-a-prometheus-exposition.md), [ADR-0034](0034-updates-are-asked-of-our-own-server.md),
  [ADR-0035](0035-artifacts-live-in-github-releases.md)
- [`../operations.md`](../operations.md) sections 7 and 13
