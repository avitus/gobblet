# ADR-0040: The privacy policy, the terms and the support page are routes in the client

## Status

Accepted

## Date

2026-07-27

## Context

Phase 9 asks for a privacy policy, terms of service, and a support and incident workflow, and the
release-candidate gates require the privacy and terms pages to be published. The specification names
no marketing site and no content system; the package list in section 5 is the web client, the server
and the desktop application.

The text also has to be true about this product specifically. What is stored, for how long, and what
leaves the deployment are decisions already made and recorded: opaque session tokens hashed at rest
([ADR-0017](0017-first-party-email-password-authentication.md)), pseudonymised identifiers in logs
and analytics ([ADR-0030](0030-telemetry-behind-ports-relayed-through-the-server.md)), no free text
between players at all ([ADR-0026](0026-communication-is-relayed-never-stored.md)), a settings key
and a session key in the browser's local storage, and the operating system credential store on the
desktop ([ADR-0033](0033-the-desktop-application-is-the-web-build-in-a-window.md)). A policy written
somewhere else would describe a different product within a month.

## Decision

The three documents are routes in the web client, and their text lives in the repository beside the
code it describes.

- `/privacy`, `/terms` and `/support` are ordinary routes, reachable without a session, linked from a
  footer that is present on every screen. The desktop shows the same routes, because it is the same
  build.
- The text is a typed content module: a document with a title, an effective date and sections. One
  module renders any of them, so a fourth document is data rather than a screen.
- The effective date is part of the content, not the build date, so a reader can tell when the terms
  last changed and a test can assert that the date moves when the text does.
- The policy states the four things a reader actually needs and this product can honestly answer:
  what is stored, where it goes, how long it stays, and how to have it deleted. Where a Phase 9
  answer depends on a host that does not exist, the page says so plainly rather than promising a
  retention period nobody can enforce yet.
- Analytics and error reporting are described as what they are: off unless the deployment configures
  a key, pseudonymous when on, and never carrying a username, an email address or the content of a
  match beyond its result. No consent banner is shown, because nothing that requires consent is
  loaded; the page says which storage keys exist and why each is strictly necessary.
- Support is an address and a workflow, not a form: what to include, what happens next, and the
  severities and response times that the incident runbook already defines, so the promise on the page
  and the promise in [`../operations.md`](../operations.md) are the same promise.
- The addresses and the operator's legal identity are the one part that cannot be invented. They are
  a single configuration record with obvious placeholders, and a test asserts the placeholders are
  still recognisable as placeholders, so publishing them by accident is loud.

## Consequences

### Positive

- The policy sits in the same review as the change that makes it untrue.
- The pages ship with the application, on the web and on the desktop, with no second deployment.
- Rendering documents from data makes the pages testable: a test can assert that every section of the
  policy is reachable and that the effective date is displayed.

### Negative

- Legal text in a repository is edited by engineers. It says, in the page itself, that it has not been
  reviewed by a lawyer, which is the honest state and is recorded in the appendix.
- A change to the terms is a deployment.

### Neutral

- Moving to a content system later means replacing one module.

## Alternatives considered

### A separate marketing site

Rejected: the specification does not ask for one, and it would put the legally binding text furthest
from the code that determines whether it is true.

### Markdown files rendered at build time

Rejected as unnecessary: it adds a loader and a parser to gain formatting nobody needs. The typed
content module is a small array of sections.

### Linking to a generated policy from a template service

Rejected: those describe products in general. The specific claims here, no free text between players,
no advertising identifiers, pseudonymous analytics, are the ones a reader cares about.

## References

- [`../product-spec.md`](../product-spec.md) sections 21.2, 24 (Phase 9)
- [ADR-0026](0026-communication-is-relayed-never-stored.md),
  [ADR-0030](0030-telemetry-behind-ports-relayed-through-the-server.md)
- [`../operations.md`](../operations.md) sections 11 and 17
