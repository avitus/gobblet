# ADR-0031: Metrics are a Prometheus exposition from prom-client, on a guarded endpoint

## Status

Accepted

## Date

2026-07-26

## Context

[Section 17.3](../product-spec.md) lists the minimum metrics: HTTP request count and latency, socket
connections and reconnects, active matches, queue depth, matchmaking wait, move validation latency,
database transaction latency, command rejection reasons, clock timeout count, completed matches by
end reason, error count, desktop version distribution and the deployment version.
[Section 17.4](../product-spec.md) lists the conditions to alert on, all of which are expressions
over those metrics. [Section 16](../product-spec.md) also requires a human-readable summary in the
dashboard: daily active users, completion and abandonment rates, average matchmaking wait, queue
depth, active matches and health.

Two different readers, then: a scrape by a monitoring system, and an administrator reading a page.
They want different shapes. The scrape wants counters and histograms that only ever grow within a
process lifetime; the page wants figures over a window, computed from the product tables so that a
restart does not erase them.

The environment has no monitoring system to point at the endpoint, so the exposition must be
verifiable on its own terms, and the alert rules must be verifiable without a live Prometheus.

## Decision

Process metrics are a Prometheus text exposition built with `prom-client`, and the dashboard summary
is a separate set of SQL aggregates.

- One registry per server instance, created with the process and carrying the deployment version and
  the environment as default labels, so a scrape identifies the build it came from.
- The metric names and label sets are declared in one module. Labels are bounded vocabularies:
  route templates rather than paths, mode and time control rather than a queue key, rejection reason
  codes, end reasons. No metric is labelled with a user id, a match id or anything else unbounded,
  because a cardinality explosion is an outage.
- `GET /metrics` serves the exposition. It answers `404` unless `METRICS_ENABLED` is set, and when a
  `METRICS_TOKEN` is configured it requires that bearer token, so the surface is off by default and
  guarded when on. It is not part of `/v1`, since it is an operational endpoint rather than a product
  one.
- Instrumentation lives at the edges the numbers describe: a Fastify hook for request count and
  latency, the socket gateway for connections, reconnects and rejections, the runtime for move
  validation and clock timeouts, the repository layer for transaction latency, and the queues for
  depth and wait. Nothing in `@gobblet/game-core` is instrumented; it stays pure
  ([ADR-0012](0012-pure-shared-rules-engine.md)).
- Gauges that describe live state, active matches and queue depth, are read from the in-process
  runtime at collection time rather than pushed on every change, so they cannot drift from the truth
  they describe.
- The administrative summary is not derived from the registry. It is a small number of SQL aggregates
  over matches, ratings, sessions and audit rows, so it survives a restart, covers a stated window
  and agrees with what a player would see. The dashboard reads the summary; a monitoring system
  reads the exposition.
- Alert rules are a file in the repository (`ops/alerts/gobblet.rules.yml`) expressed over the metric
  names, and each rule is exercised by a test that drives the metrics into the failing state and
  evaluates the rule's expression against the exposition. The delivery of an alert is a deployment
  concern and is deferred with the rest of the hosted topology; the condition and the expression are
  not deferred.
- Desktop version distribution is declared and served, and stays empty until a desktop client exists
  in Phase 8.

## Consequences

### Positive

- The exposition is what every hosted monitor already understands, so alerting, dashboards and
  retention are somebody else's solved problem.
- `prom-client` brings correct histograms, a registry, default process metrics and the text format,
  none of which is worth reimplementing.
- Bounded label vocabularies make the scrape cost predictable.
- The dashboard summary is honest across restarts and deployments, because it is computed from the
  data rather than from process counters.

### Negative

- A second dependency in the server, and a second definition of some figures: matchmaking wait
  appears as a histogram and as an average in the summary. The definitions are documented side by
  side, and both are tested.
- Counters reset when a process restarts, which is normal for the format but surprising to anybody
  reading `/metrics` by hand.
- Instrumentation touches many call sites, so a new metric usually means a new seam rather than a
  new line.

### Neutral

- With no monitoring system here, the endpoint is proved by tests and by reading it. That is the same
  position as the hosted topology of [ADR-0015](0015-single-region-deployment.md).
- The endpoint is unauthenticated when no token is configured, which is the usual arrangement for a
  metrics port on a private network and is called out in the runbook.

## Alternatives considered

### A hand-rolled registry

Rejected. Counters and gauges are easy; correct histogram buckets, exposition escaping and the
default process metrics are not, and none of it is this product's problem to solve.

### JSON metrics on an admin endpoint only

Rejected: it would satisfy the dashboard and nothing else. Section 17.4's alerts need a format a
monitor can scrape, and a bespoke format would need a bespoke exporter.

### Reading the dashboard summary from the registry

Rejected: process counters are reset by every deployment, so the completion rate on the dashboard
would fall to zero on release day and the daily active users figure would be wrong by definition.

### OpenTelemetry metrics with an exporter

Rejected for this phase as more moving parts than the deployment has: a collector to run and
configure for a single instance. The instrumentation points chosen here are the same ones an
OpenTelemetry migration would use.

## References

- [`../product-spec.md`](../product-spec.md) sections 16, 17.3, 17.4, 21.3, appendix P7
- [ADR-0006](0006-fastify-socketio-server.md), [ADR-0012](0012-pure-shared-rules-engine.md),
  [ADR-0015](0015-single-region-deployment.md)
- [`../operations.md`](../operations.md) sections 3 and 9
