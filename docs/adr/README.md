# Architecture decision records

An architecture decision record (ADR) captures a single significant decision: the context that
forced the choice, the choice itself, the consequences accepted with it, and the alternatives
rejected. ADRs are written once and then treated as immutable history. When a decision changes,
a new ADR supersedes the old one; the old file is never rewritten to pretend the earlier
decision never happened.

The format used here is a MADR-style template: title, status, date, context, decision,
consequences, alternatives considered, references. Start from
[`0000-template.md`](0000-template.md).

## When an ADR is required

An ADR is required for any material or architectural change, specifically:

- Adding, replacing or removing a technology, framework, hosting provider or managed service.
- Changing package boundaries, the dependency direction, or the build and publish strategy for
  internal packages.
- Changing the wire protocol: command envelopes, acknowledgement reason codes, event catalogue
  semantics, versioning policy or authorization rules.
- Changing the data model in a way that affects match state, ratings, audit records or
  persistence guarantees.
- Interpreting or deviating from the printed Gobblet rules, including any digital adaptation.
- Changing operational posture: regions, scaling model, backup or recovery commitments, release
  and signing procedure.
- Changing a testing or quality gate that other decisions depend on, such as the purity or
  coverage requirements of `@gobblet/game-core`.

An ADR is not required for routine implementation work, refactors that preserve boundaries and
contracts, dependency version bumps, or copy and asset changes.

## Process

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-kebab-title.md` using the next
   free four-digit number. Numbers are allocated sequentially and never reused.
2. Open the pull request with the ADR in status `Proposed`.
3. Discuss in the pull request. Revisions to a `Proposed` ADR are normal.
4. On approval, set the status to `Accepted` and set the date to the acceptance date.
5. A pull request that makes a material or architectural change without an accompanying ADR
   does not pass review. This is a review gate, enforced by reviewers.

Statuses:

| Status     | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| Proposed   | Under discussion, not yet binding                                 |
| Accepted   | Binding. Implementation must follow it                            |
| Superseded | Replaced by a later ADR, kept for history                         |
| Rejected   | Considered and declined, kept so the reasoning is not relitigated |

Superseding a decision:

1. Write the new ADR. Its context must state what changed since the earlier decision.
2. In the new ADR, reference the ADR it replaces.
3. In the old ADR, change the status line to `Superseded by ADR-NNNN` and add nothing else.
4. Update the index table below.

## Index

| Number | Title                                                                                                                      | Status                 | Date       |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------- |
| 0001   | [Record architecture decisions](0001-record-architecture-decisions.md)                                                     | Accepted               | 2026-07-24 |
| 0002   | [TypeScript monorepo with pnpm workspaces and Turborepo](0002-typescript-monorepo-pnpm-turborepo.md)                       | Accepted               | 2026-07-24 |
| 0003   | [React and Vite web client](0003-react-vite-web-client.md)                                                                 | Accepted               | 2026-07-24 |
| 0004   | [Tauri v2 desktop shell](0004-tauri-v2-desktop-shell.md)                                                                   | Accepted               | 2026-07-24 |
| 0005   | [Three.js via React Three Fiber](0005-threejs-react-three-fiber.md)                                                        | Accepted               | 2026-07-24 |
| 0006   | [Fastify HTTP API with Socket.IO real-time transport](0006-fastify-socketio-server.md)                                     | Accepted               | 2026-07-24 |
| 0007   | [PostgreSQL with Drizzle ORM](0007-postgresql-drizzle.md)                                                                  | Accepted               | 2026-07-24 |
| 0008   | [Auth0 for identity](0008-auth0-identity.md)                                                                               | Superseded by ADR-0017 | 2026-07-24 |
| 0009   | [Server-authoritative clocks](0009-server-authoritative-clocks.md)                                                         | Accepted               | 2026-07-24 |
| 0010   | [Match event persistence](0010-match-event-persistence.md)                                                                 | Accepted               | 2026-07-24 |
| 0011   | [Versioned idempotent commands](0011-versioned-idempotent-commands.md)                                                     | Accepted               | 2026-07-24 |
| 0012   | [Pure shared rules engine](0012-pure-shared-rules-engine.md)                                                               | Accepted               | 2026-07-24 |
| 0013   | [CSS Modules with design tokens instead of Tailwind](0013-css-modules-design-tokens.md)                                    | Accepted               | 2026-07-24 |
| 0014   | [Selection is a preview, not a binding touch-move](0014-selection-is-preview-not-touch-move.md)                            | Accepted               | 2026-07-24 |
| 0015   | [Single-region deployment with replaceable scaling interfaces](0015-single-region-deployment.md)                           | Accepted               | 2026-07-24 |
| 0016   | [ESM-only internal packages built with tsup](0016-esm-tsup-internal-packages.md)                                           | Accepted               | 2026-07-24 |
| 0017   | [First-party email and password authentication](0017-first-party-email-password-authentication.md)                         | Accepted               | 2026-07-25 |
| 0018   | [In-process matchmaking queues and rematch offers](0018-in-process-matchmaking-and-rematch-offers.md)                      | Accepted               | 2026-07-25 |
| 0019   | [Elo written in the match completion transaction](0019-elo-in-the-completion-transaction.md)                               | Accepted               | 2026-07-25 |
| 0020   | [Client match state is the server snapshot](0020-client-match-state-is-the-server-snapshot.md)                             | Accepted               | 2026-07-25 |
| 0021   | [Playwright browser end-to-end tests](0021-playwright-browser-end-to-end-tests.md)                                         | Accepted               | 2026-07-25 |
| 0022   | [Procedural placeholder assets and synthesised sound](0022-procedural-placeholder-assets.md)                               | Accepted               | 2026-07-25 |
| 0023   | [Rendering tiers and a flat fallback board](0023-rendering-tiers-and-a-flat-fallback-board.md)                             | Accepted               | 2026-07-25 |
| 0024   | [Browser-only packages ship TypeScript source](0024-browser-only-packages-ship-source.md)                                  | Accepted               | 2026-07-25 |
| 0025   | [The canvas owns the pointer, and the focus stops are projected](0025-the-canvas-owns-the-pointer.md)                      | Accepted               | 2026-07-25 |
| 0026   | [Preset communication is relayed, never stored](0026-communication-is-relayed-never-stored.md)                             | Accepted               | 2026-07-26 |
| 0027   | [Achievements are awarded in the completion transaction](0027-achievements-awarded-in-the-completion-transaction.md)       | Accepted               | 2026-07-26 |
| 0028   | [Leaderboards are read-time queries over the rating audit](0028-leaderboards-are-read-time-queries.md)                     | Accepted               | 2026-07-26 |
| 0029   | [Administration is a role on the account](0029-administration-is-a-role-on-the-account.md)                                 | Accepted               | 2026-07-26 |
| 0030   | [Telemetry sits behind ports and is relayed through the server](0030-telemetry-behind-ports-relayed-through-the-server.md) | Accepted               | 2026-07-26 |
| 0031   | [Metrics are a Prometheus exposition from prom-client](0031-metrics-are-a-prometheus-exposition.md)                        | Accepted               | 2026-07-26 |
| 0032   | [Backups are scripts proved by a restore round trip](0032-backups-are-scripts-proved-by-a-restore.md)                      | Accepted               | 2026-07-26 |
| 0033   | [The desktop application is the web build in a window](0033-the-desktop-application-is-the-web-build-in-a-window.md)       | Accepted               | 2026-07-26 |
| 0034   | [Updates are asked of our own server](0034-updates-are-asked-of-our-own-server.md)                                         | Accepted               | 2026-07-26 |
| 0035   | [Installers live in GitHub Releases](0035-artifacts-live-in-github-releases.md)                                            | Accepted               | 2026-07-26 |
| 0036   | [Signing is a workflow step that fails loudly](0036-signing-is-a-workflow-step-that-fails-loudly.md)                       | Accepted               | 2026-07-26 |

Decisions recorded here are reflected in [`../architecture.md`](../architecture.md),
[`../protocol.md`](../protocol.md) and [`../operations.md`](../operations.md). Those documents
describe the current state and the phase each part belongs to; the ADRs explain why.
