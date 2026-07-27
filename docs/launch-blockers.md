# Launch blockers

Everything that stands between the current build and a public launch, and none of it is code.
Each item says what it is, what it unblocks, where the repository already expects it, and what
"done" looks like. Nothing here is a design decision left open: the decisions are made and the
seams exist; these are purchases, accounts and judgements only a person can supply.

The order below is the order that unblocks the most: the host first, because eleven items wait
on it, then the signing identities, then the reviews.

Related: [`operations.md` section 17](operations.md) is the launch checklist,
[`compatibility.md`](compatibility.md) is the matrix, [`defects.md`](defects.md) is the register.

## 1. Summary

| #   | Item                                | Kind     | Unblocks                                   | Where the repository expects it                     |
| --- | ----------------------------------- | -------- | ------------------------------------------ | --------------------------------------------------- |
| B1  | Hosting provider and environments   | Host     | 11 items, including the whole deploy path  | [ADR-0015](adr/0015-single-region-deployment.md)    |
| B2  | Domain name and TLS                 | Purchase | Public URLs, CORS, the desktop update feed | `PUBLIC_WEB_URL`, `CORS_ORIGINS`                    |
| B3  | Managed PostgreSQL                  | Host     | Backups, retention, point-in-time recovery | [`operations.md` section 10](operations.md)         |
| B4  | Monitoring and paging               | Host     | Alerts reaching a human, the dashboards    | [`operations.md` sections 11 and 12](operations.md) |
| B5  | Error and analytics accounts        | Purchase | `SENTRY_DSN`, `POSTHOG_API_KEY`            | [`operations.md` section 12](operations.md)         |
| B6  | Transactional email sender          | Purchase | Account verification, password reset       | [appendix P3](product-spec.md)                      |
| B7  | Apple Developer Program and cert    | Purchase | Signed and notarized macOS build           | [`operations.md` section 13](operations.md)         |
| B8  | Windows code-signing certificate    | Purchase | Signed Windows installer                   | [`operations.md` section 13](operations.md)         |
| B9  | Object storage for off-site backups | Host     | The monthly encrypted export               | [`operations.md` section 10](operations.md)         |
| B10 | Load run at the stated scale        | Host     | The section 20.8 baseline                  | [`operations.md` section 16](operations.md)         |
| B11 | Manual compatibility rows           | Person   | Safari, packaged shells, GPUs              | [`compatibility.md`](compatibility.md)              |
| B12 | Screen reader pass                  | Person   | Defect D-0002                              | [`defects.md`](defects.md)                          |
| B13 | Legal identity and review           | Person   | The operator name on the legal pages       | `apps/web/src/legal/content.ts`                     |
| B14 | Support address that receives mail  | Purchase | The support page and the incident workflow | `apps/web/src/legal/content.ts`                     |
| B15 | Product owner: visual approval      | Person   | Phase 9 exit criterion                     | [`operations.md` section 17.2](operations.md)       |
| B16 | Product owner: rule approval        | Person   | Phase 9 exit criterion                     | [`operations.md` section 17.2](operations.md)       |
| B17 | Production readiness sign-off       | Person   | Phase 9 exit criterion                     | [`operations.md` section 17.2](operations.md)       |

## 2. The host, and everything waiting on it

### B1. Hosting provider and environments

[ADR-0015](adr/0015-single-region-deployment.md) fixed the shape (single region, one process
serving both HTTP and sockets, stateless behind a managed database) and deliberately left the
provider open. Choosing one is a new ADR that supersedes that deferral, not a change of design.

What the deployment must give us, because the code already assumes it:

- Two environments, `staging` and `production`, each with its own database.
- A long-lived process, not a per-request function: matches hold sockets and in-process clocks.
- Sticky routing is not needed today, because there is one process
  ([`architecture.md` section 12](architecture.md)).
- `SIGTERM` then a drain window: the server stops matchmaking, lets active matches settle and
  tells clients to reconnect ([`architecture.md` section 11](architecture.md)).
- Health probes on `GET /health/live` and `GET /health/ready`.

Done when: `pnpm --filter @gobblet/server smoke` passes against both environments, and the
GitHub environment variables `STAGING_URL` and `PRODUCTION_URL` and the secret `DATABASE_URL`
are set. The deploy workflow's release commands are the only steps still marked as placeholders.

Waiting on it: B3, B4, B9, B10, the staging and production runbooks
([`operations.md` sections 7, 8 and 9](operations.md)), the paging half of incident response,
the dashboards, and B17.

### B2. Domain name and TLS

A registered domain, DNS to the deployment, and a certificate the platform renews. The desktop
updater refuses a non-https endpoint, so the update feed cannot be tested end to end without it.

Sets: `PUBLIC_WEB_URL`, `CORS_ORIGINS`, `VITE_API_BASE_URL`, and the `endpoints` entry in
`apps/desktop/src-tauri/tauri.conf.json`.

Done when: the client loads over https, a socket connects from that origin, and
`GET /v1/updates/stable` answers over https.

### B3. Managed PostgreSQL 16

The schema and migrations are ours; the schedule, retention and recovery are the provider's.
[`operations.md` section 10](operations.md) lists exactly what to switch on: daily automated
backups, point-in-time recovery where supported, 14 day minimum retention.

Done when: a restore drill runs against a copy of the production database and the row counts
match, which `pnpm db:restore` and `pnpm --filter @gobblet/db run test` already do in CI against
a local instance.

### B4. Monitoring and paging

Every alert condition exists and is proved against a real exposition by
`apps/server/test/alert-rules.test.ts`; `ops/alerts/gobblet.rules.yml` and
`ops/dashboards/*.json` are generated from those definitions. What is missing is something that
scrapes `GET /metrics`, evaluates the rules and wakes somebody.

Needed: a Prometheus-compatible scrape (with `METRICS_TOKEN` set), a Grafana instance to import
the three dashboards into, and a notification path with an on-call contact.

Done when: `GobbletErrorRegressionAfterDeploy` fires into a channel a person reads, and the
three dashboards render against live data.

### B9. Object storage for off-site backups

A bucket outside the database provider, plus a key the backup job can use, for the monthly
encrypted export `pnpm db:export-critical` already produces.

Done when: the export lands in the bucket on a schedule and one file has been restored from it.

### B10. Load run at the stated scale

`pnpm load` runs today and passes, but at a scale a laptop or a shared runner can carry: the
report always says what fraction of the target it reached. Section 20.8 asks for 1,000 connected
clients across 500 concurrent matches with a p95 acknowledgement latency under 100 ms.

Run, once a host exists, from a machine near it:

```bash
LOAD_MATCHES=500 LOAD_MOVES_PER_MATCH=20 LOAD_WAVE_SIZE=50 pnpm load https://<host>
```

Done when: a run at 500 matches passes with no rejected move, no lost move and no duplicate
completion, and the numbers are recorded in [`operations.md` section 16](operations.md).

## 3. Purchases

### B5. Error reporting and product analytics

Both sit behind ports and a deployment without keys reports nothing and fails nothing, so this
is optional for launch but wanted for it. Accounts needed for `SENTRY_DSN` and
`POSTHOG_API_KEY` (plus `POSTHOG_HOST` if self-hosted). Also set
`TELEMETRY_PSEUDONYM_SECRET`, which is what keeps a player unnamed across logs, analytics and
error reports.

Done when: a deliberate error appears in the reporter tagged with the release and environment
the server reports on `GET /v1/config`.

### B6. Transactional email sender

Registration writes a verification token; in production it is stored and never returned, so no
account can verify until something can send mail
([appendix P3](product-spec.md)). Password reset is in the same position.

Needed: a sending domain with SPF, DKIM and DMARC, and an API key.

Done when: registering an account delivers a verification mail and the link completes the flow
against production.

### B7. Apple Developer Program membership and Developer ID

An annual membership, then a Developer ID Application certificate exported as a `.p12`, and an
app-specific password for notarization. The workflow step exists and fails with the name of what
is missing rather than producing an unsigned build
([ADR-0036](adr/0036-signing-is-a-workflow-step-that-fails-loudly.md)).

Set these repository secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`.

Done when: a `.dmg` from the release workflow installs on a machine that has never seen the app,
with no Gatekeeper warning. That is the Phase 8 exit criterion still recorded as deferred.

### B8. Windows code-signing certificate

An organisation-validated or extended-validation certificate. OV reputation accrues with
downloads, so a first release may still show SmartScreen until it does; EV avoids that and costs
more. This is the one item that cannot be fully proved before publication.

Set: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`.

Done when: the installer is signed, and the SmartScreen behaviour on a clean machine is recorded
in [`compatibility.md`](compatibility.md) whichever way it goes.

### B14. A support address that receives mail

`apps/web/src/legal/content.ts` publishes `support@gobblet.example`, which is a placeholder and
goes nowhere. The support page and the incident workflow both point at it.

Done when: the address exists, a person reads it, and the constant is replaced.

Also needed for the desktop release: `RELEASE_ADMIN_TOKEN`, a session token for an account
holding the `admin` role, granted with `pnpm admin:grant`. That one needs no purchase, only a
deployment to grant it against.

## 4. People

### B11. The manual compatibility rows

[`compatibility.md`](compatibility.md) lists four unanswered rows. Each needs someone on the
hardware running `pnpm test:e2e` or the packaged application, then editing the row with the date
and what happened.

| Row                        | Needs                                              |
| -------------------------- | -------------------------------------------------- |
| Safari                     | A Mac, the real browser rather than Playwright     |
| macOS `WKWebView` journeys | A signed build on a clean Mac (waits on B7)        |
| Windows WebView2 journeys  | A signed build on a clean Windows machine (B8)     |
| Intel and discrete GPU     | A machine with each, for the rendering tier choice |

### B12. Screen reader pass

Registered as D-0002 in [`defects.md`](defects.md), accepted at low severity for the release
candidate. Roles, names and keyboard reachability are tested; nobody has driven VoiceOver or
NVDA through a match. A pass means: reach the board, understand the position, select and place a
piece, and hear the result, in both readers.

Done when: both rows in [`compatibility.md`](compatibility.md) section 4 carry a date, and D-0002
is closed or its severity is re-argued in the register.

### B13. Legal identity and a review

Both legal pages say plainly that they have not been reviewed by a lawyer and that the operator
is `the maintainer of this repository`, which is the placeholder in
`apps/web/src/legal/content.ts`. Two decisions are needed: who operates the service in law, and
whether a lawyer reviews the wording before launch.

Done when: `OPERATOR_PLACEHOLDER` is replaced with the real operator and the pages carry a date
of review. `apps/web/test/legal-pages.test.tsx` asserts the content, so the change is one edit
and one test update.

### B15. Product owner approves visual quality

The scripted route list, the two viewports and the two themes are in
[`operations.md` section 17.2](operations.md), so the review is the same review every time.

### B16. Product owner approves official-rule behavior

Every rule is stated in [`rules.md`](rules.md) and asserted by the `@gobblet/game-core` suite.
Section 17.2 lists the four rules a player feels, to be confirmed in a two-window play-through.

### B17. Production readiness review is signed off

Waits on B1: the review is of a deployment. Its checklist is
[`operations.md` section 17.1](operations.md) plus whatever remains blocked in section 17.3.

## 5. What is not blocked

Everything else. The suites, the gates, the load harness, the defect register, the secret scan,
the dashboards and alert rules, the backup and restore round trip, the desktop build, and the
browser matrix in Chromium, WebKit and Firefox all run today from a checkout with a local
PostgreSQL:

```bash
pnpm gates release-candidate
```
