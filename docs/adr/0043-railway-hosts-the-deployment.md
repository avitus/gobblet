# ADR-0043: Railway hosts the deployment, as a container we define

## Status

Accepted. Supersedes the deferral in [ADR-0015](0015-single-region-deployment.md), which fixed
the shape of the deployment and left the provider open.

## Date

2026-07-27

## Context

ADR-0015 decided one region, one authoritative Socket.IO origin, one writer, and named the
provider as the thing still to choose. Everything downstream of that choice has been waiting:
automated backups, point-in-time recovery, an off-site copy, alert delivery, the load run at the
scale of section 20.8, and the production readiness review. `docs/launch-blockers.md` lists
eleven items behind it.

What the code already requires of a host is narrow and known:

- A long-lived process. Matches hold sockets and in-process clocks, so a per-request function
  model cannot serve them.
- `SIGTERM` before the process is killed, with enough time to stop matchmaking and let commands
  in flight finish.
- Health probes on `GET /health/live` and `GET /health/ready`.
- A managed PostgreSQL 16 whose backups are the provider's job, because ours are scripts proved
  by a restore ([ADR-0032](0032-backups-are-scripts-proved-by-a-restore.md)) and not a schedule.
- One replica. The queue, presence and socket fan-out are in-process today
  ([`../architecture.md`](../architecture.md) section 12), so a second replica would silently
  split matchmaking.

The candidates that meet those requirements are ordinary: Railway, Render, Fly.io, or a virtual
machine we administer. The differences that mattered were how much of the operational surface
comes with the platform rather than with us, and how little of the repository has to know which
platform it is.

## Decision

Host on Railway, and make the unit of deployment a container this repository defines.

- **Provider**: Railway, one project, region `us-east4-eqdc4a`. ADR-0015 recommended US Central
  as a latency compromise; Railway has no central region, and of what it offers the eastern
  United States is the compromise between North America and Europe.
- **Two services**: `gobblet-server`, the Fastify and Socket.IO process, and `gobblet-web`, the
  built client served as static files. They are separate origins, which is why `CORS_ORIGINS`
  and `VITE_API_BASE_URL` exist.
- **One replica**, stated in configuration rather than assumed, until the seams named in
  ADR-0015 are replaced.
- **A Dockerfile per service**, not a provider buildpack. The provider then owns scheduling,
  TLS, the database and the metrics pipeline, and owns nothing about how the artefact is
  built. Moving to another container host is a change of credentials and one workflow step.
- **`node` is the process**, started directly rather than through pnpm. A package manager as
  PID 1 swallows `SIGTERM`, and a drain that never runs is worse than no drain, because it
  looks like one.
- **Production first, staging when it is worth its cost.** The deploy workflow gates production
  on a staging rehearsal; until staging exists, that gate is skipped by an explicit input that
  is recorded in the run and named in the approval. A skipped rehearsal is visible, not
  implicit.
- **Migrations run from CI**, over the database's public proxy address, before the new container
  is released. The service itself reaches the database over the provider's private network, so
  the public address exists for the migration and backup jobs and for nothing else.
- **The client's API address is baked into its image** at build time, because Vite substitutes
  it at build time. An image is therefore specific to one environment, and a build without the
  variable fails rather than shipping a client that talks to localhost.

## Consequences

- The two placeholder steps in `.github/workflows/deploy.yml` become `railway up --ci`, which
  returns when the build finishes rather than when the new container serves. The workflow
  therefore waits for the released version to answer `GET /health/live` before it smokes, which
  is `pnpm --filter @gobblet/server await-release`, a tested module rather than a sleep.
- `SHUTDOWN_DRAIN_SECONDS` becomes real configuration. It was named in the deploy workflow's
  comments and implemented nowhere, which is the kind of claim this repository is not allowed to
  make. On `SIGTERM` the server now stops matchmaking, waits up to that window for active
  matches to settle, and only then closes the sockets and the pool. Railway's `drainingSeconds`
  is set above the window, so the platform does not kill the process mid-drain.
- Backups, point-in-time recovery and the off-site copy are now configurable rather than
  deferred, which is what unblocks B3 and B9 of `docs/launch-blockers.md`.
- A single region and a single replica remain, so the failure modes ADR-0015 accepted are
  unchanged: a regional outage is downtime, and a deploy is a drain rather than a handover.
- Railway bills by usage, so an idle staging environment is cheap but not free. That is the
  reason staging is deferred rather than the shape of the pipeline changing.
- The provider's own metrics are not the ones the alert rules read. `GET /metrics` still needs a
  scrape and the rules still need an evaluator, which stays B4.

## Alternatives considered

- **Render**: comparable, with static hosting and Postgres in one account. Rejected on cost at
  two environments and because its build model is less explicit than a Dockerfile we own.
- **Fly.io**: the cheapest always-on machine and good socket behaviour, but its managed Postgres
  story has changed more than once, and B3 is the item this decision most needs to be dull.
- **A virtual machine we administer**: the cheapest and the most controllable, and it would put
  TLS, deploys, backups, retention and recovery back on the operator by hand. ADR-0015 chose a
  surface one person can reason about during an incident; this would be the opposite.
- **Serving the client from the Fastify process**: fewer moving parts, but it couples a static
  asset roll-out to a server deploy and makes the drain window matter for a CSS change.
