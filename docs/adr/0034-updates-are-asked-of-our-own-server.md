# ADR-0034: The desktop asks our own server for updates, so a channel can be paused without cutting a release

## Status

Accepted

## Date

2026-07-26

## Context

Section 22.3 of the specification requires a stable channel, an optional internal beta channel, the
ability to pause an update rollout, and a staged channel that is tested before a manifest is promoted
to stable. Section 24 repeats "stable and beta channels" and "update failure recovery" as Phase 8
deliverables.

Tauri's updater fetches a JSON manifest from one or more endpoints and compares the version it finds
with the version running. The common arrangement is a static file published beside the artifacts, on
GitHub Releases or in object storage. That arrangement makes every operational verb an edit to a
static asset: pausing a rollout means replacing a file, promoting beta to stable means copying one,
and pulling a bad release means deleting one, each of them unaudited and each of them a hand on a
production artifact at the worst possible moment.

The product already has a server with an admin API, an audit log and an operational dashboard
([ADR-0029](0029-administration-is-a-role-on-the-account.md)), and it already knows which client
versions are connected. A release is a record like any other record here.

## Decision

The updater asks the product's own API, and a release is a row.

- The endpoint is `GET /v1/updates/:channel`, with the target and the running version supplied by the
  updater through Tauri's endpoint template. It answers `204 No Content` when there is nothing to
  install, and the manifest Tauri expects when there is: version, notes, publication moment and, for
  the asking platform, the artifact URL and its detached signature.
- A release row carries its channel, its version, its notes, whether it is paused, and one artifact
  row per platform holding the URL, the size, the SHA-256 digest and the update signature. The
  channel is `stable` or `beta`; nothing else exists.
- Pausing is a column, not a deletion. A paused release is not offered, the artifacts stay exactly
  where they were, and resuming is the same switch. Promotion moves a version from beta to stable and
  keeps the artifacts, because promoting must not rebuild anything: what was tested in the staged
  channel is what reaches everybody.
- Publishing, pausing, resuming and promoting are administrative mutations, so they go through the
  admin API, require the `admin` role, and write an audit record in the same transaction as the change
  ([ADR-0029](0029-administration-is-a-role-on-the-account.md)). The release workflow authenticates as
  an administrator; there is no second credential path.
- The server never holds the update signing key. Artifacts are signed on the build machine by
  Tauri's minisign key, and the signature travels with the publication request as data. The
  application verifies it against the public key compiled into the bundle, so a server that is
  compromised can withhold an update or offer an old one, but cannot forge one.
- The client's part is deliberately small: check on start and every six hours, install when the
  player agrees, and report the outcome. An update that fails to download or verify is reported and
  then forgotten, and the running application is untouched, which is what "failed update leaves prior
  application usable" means when the installer is atomic.
- The public `GET /v1/releases/latest` serves the same records to the download page, so the page and
  the updater cannot disagree about what the current version is.

## Consequences

### Positive

- Pausing a rollout is a switch an administrator can throw from the dashboard at three in the
  morning, and it is audited.
- Promotion cannot rebuild or resign an artifact, so what was tested is what ships.
- The download page, the updater and the dashboard all read one source of truth.
- The signing key never sits on the server, so the blast radius of a server compromise excludes
  forged updates.

### Negative

- The updater depends on the API being up. A server that is down cannot offer an update, but it also
  cannot break a running application: the check fails quietly and is retried later.
- The database now holds a small amount of release metadata, which must be part of a restore. It is
  in the critical-table list of [ADR-0032](0032-backups-are-scripts-proved-by-a-restore.md).

### Neutral

- The manifest format is Tauri's, so the endpoint is a translation of our rows into their shape. If
  the format changes, one function changes.
- Artifacts live in immutable release storage ([ADR-0035](0035-artifacts-live-in-github-releases.md));
  the server stores where they are, not what they are.

## Alternatives considered

### A static manifest published to GitHub Releases

Rejected as the primary mechanism. It is simpler and it is the Tauri default, but every operational
verb becomes an unaudited edit of a published asset, and "pause the rollout" becomes a race against
clients that are already polling.

### Serving the artifacts from our own server as well

Rejected. It puts release-day bandwidth on the application server for no gain; immutable release
storage exists and section 23 asks for artifacts to be retained there.

### A separate release service or a static site generator

Rejected as premature. Four small routes on an existing authenticated API are less to operate than a
second service, and the audit log is already here.

### Letting the server sign updates

Rejected. It would place the signing key on an internet-facing host to save a step in a build job
that already holds a code-signing identity.

## References

- [`../product-spec.md`](../product-spec.md) sections 5.4, 22.3, 24 (Phase 8), appendix P8
- [ADR-0004](0004-tauri-v2-desktop-shell.md), [ADR-0029](0029-administration-is-a-role-on-the-account.md),
  [ADR-0033](0033-the-desktop-application-is-the-web-build-in-a-window.md)
- Tauri v2 updater: https://v2.tauri.app/plugin/updater/
