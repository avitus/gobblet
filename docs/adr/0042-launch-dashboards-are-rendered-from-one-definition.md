# ADR-0042: Launch dashboards are rendered from one definition, against the series that exist

## Status

Accepted

## Date

2026-07-27

## Context

Phase 9 asks for launch dashboards. Section 17.3 already fixes the exposition
([ADR-0031](0031-metrics-are-a-prometheus-exposition.md)), and section 17.4's alert conditions are
already a TypeScript definition rendered into `ops/alerts/gobblet.rules.yml` with a test that drives
every rule into its failing state and asserts that every series it names is actually emitted.

A dashboard has the same failure mode as an alert and a worse consequence: a panel whose query names
a metric that was renamed shows an empty graph, and an empty graph during an incident reads as "the
system is quiet". There is no Grafana here to import one into, because there is no host, but the
dashboard definition itself does not need one.

## Decision

The launch dashboards are one TypeScript definition, rendered into a Grafana dashboard JSON, checked
against the running server's exposition by a test.

- `apps/server/src/observability/dashboards.ts` defines the panels: title, unit, the query, and the
  question the panel answers. Panels are grouped into the three boards the launch needs, service
  health, gameplay and the desktop rollout, so an operator opens the one that matches the question.
- `pnpm ops:dashboards` renders `ops/dashboards/*.json`, and continuous integration fails if the
  rendered file differs from the definition, exactly as it already does for the alert rules.
- A test extracts every metric name referenced by every panel query and asserts that a running server
  emits it, with the same single exemption the alert test already carries for the backup timestamp
  that a script writes into a textfile collector rather than the server.
- Every production target of section 21.3 that can be read from the exposition has a panel, and the
  panel's description names the target, so the dashboard states what "good" is rather than leaving it
  to memory.
- Importing the JSON into a Grafana instance is a runbook step, deferred with the host and named as
  such.

## Consequences

### Positive

- A renamed metric fails a test rather than emptying a panel during an incident.
- The dashboards exist and are reviewable before there is anywhere to display them, which is the same
  bargain the alert rules already took.
- The definition names the target for each panel, so the launch dashboard and the production targets
  cannot drift.

### Negative

- The rendered JSON is a Grafana schema written by hand-rolled code rather than exported from a
  running instance, so it uses the small subset of the schema we need and will look plain.
- Nobody has seen these dashboards rendered.

### Neutral

- Another tool that reads PromQL can use the same definition; only the renderer is Grafana-shaped.

## Alternatives considered

### Exporting JSON from a Grafana instance and committing it

Rejected because there is no instance, and because an exported dashboard is a large generated
document that nobody reviews and that drifts from the metrics silently.

### Provisioning dashboards later, with the host

Rejected as the same mistake the alert rules avoided: the definition is the part we can get right now,
and it is the part that encodes what to watch.

### Relying on the administrative dashboard already in the client

Rejected as a different thing. `/admin` reports the deployment's state from SQL for an operator with a
role; a launch dashboard reads the time series a scrape produces, including the ones no database can
answer, such as request latency percentiles.

## References

- [`../product-spec.md`](../product-spec.md) sections 17.3, 17.4, 21.3, 24 (Phase 9)
- [ADR-0031](0031-metrics-are-a-prometheus-exposition.md)
- [`../operations.md`](../operations.md) section 12
