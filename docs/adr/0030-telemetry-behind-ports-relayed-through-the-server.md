# ADR-0030: Telemetry sits behind ports, is silent unless configured, and the client reports through the server

## Status

Accepted

## Date

2026-07-26

## Context

[Section 17.1](../product-spec.md) requires anonymous or pseudonymous product analytics over a named
list of events, and forbids sending move-by-move board state, email addresses, authentication tokens,
free-form user data or IP-derived precise location. [Section 17.2](../product-spec.md) requires
structured JSON logs with a named list of fields and forbids logging tokens, passwords, magic links
and authorization headers. [Section 2.8](../product-spec.md) names Sentry for error reporting.

Half of the event list is a client fact: the application launched, the renderer chose a tier, a
setting changed. The other half is a server fact: a queue was joined, a match was found, a match
completed for a reason. So either both halves talk to the provider, or one relays through the other.

The provider accounts do not exist in this environment, and the phase must still be finishable and
testable. A telemetry call that fails, blocks or throws must never be able to spoil the operation it
was describing.

## Decision

Analytics and error reporting are ports with one implementation each, they are inert unless
configured, and the browser never talks to a provider directly.

- `AnalyticsPort` has one method, `capture(event)`, and `ErrorReportingPort` has one method,
  `report(error, context)`. The server depends on the ports; the transports depend on the providers.
- The transports are PostHog (`posthog-node`) and Sentry (`@sentry/node`). Without
  `POSTHOG_API_KEY` or `SENTRY_DSN` the ports resolve to implementations that record nothing and
  make no network call, which is how every test and every developer machine runs.
- Events are a closed set. `analyticsEventSchema` in `@gobblet/protocol` names each event of section
  17.1 and the properties it may carry, and the properties are scalars from fixed vocabularies:
  modes, time controls, end reasons, rendering tiers, setting names. There is no property bag, so
  free-form user data has nowhere to sit.
- The identity on an event is a pseudonymous id: a keyed hash of the account or guest id, stable for
  that subject, meaningless outside this deployment, and impossible to reverse into an email address.
  A subject that has neither is reported as an anonymous session id.
- The client posts its events to `POST /v1/telemetry/events`, which validates them against the same
  schema, discards anything it does not recognise, attaches the pseudonymous id from the session
  rather than from the body, and hands them to the port. The browser holds no provider key, and the
  deny-list is enforced in one place on the server.
- Client errors are reported the same way, through `POST /v1/telemetry/errors`, carrying a message,
  a type and a bounded stack. No browser Sentry SDK is shipped, so the client has no provider
  dependency, no second bundle and no ability to send what the server would refuse.
- The intake is rate limited per subject and the payload is bounded: a page may send at most a small
  batch per request, and an oversized or malformed batch is refused as a validation failure rather
  than partially accepted.
- Every telemetry call is fire and forget from the caller's point of view. Failures are caught,
  counted in a metric and logged at debug level. No request, move or completion can fail because a
  provider was slow or absent.
- Structured logs carry the fields of section 17.2 and the logger redacts the authorization and
  cookie headers, as it already did. The pseudonymous id is the only subject identifier in a log
  line.

## Consequences

### Positive

- The forbidden data cannot be sent, because the schema has no place to put it and the server, not
  the browser, decides what an event contains.
- The product is fully runnable and testable with no provider account, and adding a key later is a
  configuration change rather than a code change.
- One dependency instead of two: no browser SDK, so the client bundle does not grow and the desktop
  shell inherits nothing new.
- A provider outage is invisible to players.

### Negative

- Client events cost a request to our own server, and events sent while offline are lost rather than
  queued by a provider SDK.
- A closed event schema means a new event is a protocol change with a test, which is deliberate
  friction.
- Browser errors arrive with less context than a browser SDK would collect: no breadcrumbs, no
  automatic session replay, no source-mapped frames beyond the stack we send.

### Neutral

- The pseudonymous id needs a key (`TELEMETRY_PSEUDONYM_SECRET`). Rotating it detaches new events
  from old ones, which is the intended property of a pseudonym rather than a defect.
- Only the two ports know a provider name, so replacing PostHog or Sentry is a file each.

## Alternatives considered

### A browser SDK talking to the provider directly

Rejected. It puts a project key in the bundle, sends the browser's IP address to a third party on
every event, and moves the deny-list into code we cannot enforce from the server. It would also add
a sizeable dependency to a bundle that is already the largest asset the product serves.

### A local analytics table as the only sink

Rejected as the destination, since the decision is to use a real provider when a key exists. A
Postgres table would duplicate what the provider does and grow without bound; the operational
figures the dashboard needs come from the product tables instead.

### Sending events synchronously and failing the request on error

Rejected: it makes an observability dependency into an availability dependency.

### Free-form properties with a redaction pass

Rejected: redaction is a filter that must anticipate every mistake. A closed schema cannot carry the
mistake in the first place.

## References

- [`../product-spec.md`](../product-spec.md) sections 2.8, 17.1, 17.2, 19.2, appendix P7
- [ADR-0015](0015-single-region-deployment.md), [ADR-0029](0029-administration-is-a-role-on-the-account.md)
- [`../protocol.md`](../protocol.md) section 9.7, [`../operations.md`](../operations.md) section 3
