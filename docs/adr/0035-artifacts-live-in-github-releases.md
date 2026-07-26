# ADR-0035: Installers live in GitHub Releases and the database holds only where they are

## Status

Accepted

## Date

2026-07-26

## Context

Section 5.9 of the specification allows "object storage or GitHub Releases for desktop installers and
update artifacts", and section 23 requires desktop artifacts to be "replicated or retained in
immutable release storage". [ADR-0015](0015-single-region-deployment.md) already records that no
hosting provider has been chosen, so there is no bucket, and [ADR-0034](0034-updates-are-asked-of-our-own-server.md)
puts the release _metadata_ in PostgreSQL.

The question left is where the bytes live and who is allowed to change them.

## Decision

A tagged release publishes its installers as GitHub Release assets, and the database records the URL,
the size and the digest of each one.

- One GitHub Release per version, named by the tag, carrying the macOS disk image, the Windows
  installer, the update bundles and their detached signatures.
- Assets are treated as immutable. A mistake is a new version, never a replaced asset, because a
  replaced asset would invalidate the digest recorded against the release row and would change what a
  client downloads without changing what it verified.
- The database holds the URL, the byte size, the SHA-256 digest and the update signature per platform.
  The digest is what the download page shows to a person who wants to check a download by hand; the
  signature is what the updater verifies.
- The download page links to the asset URL directly, so release-day traffic never touches the
  application server.
- Publication is one direction: the workflow uploads the assets, then tells the API where they are.
  If the second step fails the release exists but is not offered, which is the safe order.

## Consequences

### Positive

- No object storage account is needed to ship, and the retention story is GitHub's, which satisfies
  "immutable release storage" without new infrastructure.
- Digests and signatures are recorded away from the artifacts, so a swapped asset is detectable.
- Bandwidth is somebody else's problem.

### Negative

- The product's downloads depend on GitHub's availability. A mirror in object storage is a second
  artifact row per platform when a bucket exists, and the schema already allows more than one.
- Assets of a private repository need a token to fetch. The repository must be public before the
  download page can serve anonymous downloads, which is a launch step in the runbook, not a code
  change.

### Neutral

- Moving to object storage later changes the URL in a row and nothing else.

## Alternatives considered

### Object storage from the start

Deferred rather than rejected: it needs the provider that [ADR-0015](0015-single-region-deployment.md)
defers, and the schema is indifferent between the two.

### Serving installers from the application server

Rejected: it puts a large, bursty download load on a process whose job is matches, and it makes a
deployment a download outage.

### Committing installers to the repository

Rejected without discussion; binaries in git are a mistake that is hard to undo.

## References

- [`../product-spec.md`](../product-spec.md) sections 5.9, 22.3, 23, appendix P8
- [ADR-0015](0015-single-region-deployment.md), [ADR-0034](0034-updates-are-asked-of-our-own-server.md)
