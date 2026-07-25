# ADR-0021: Prove browser play with Playwright in Chromium and WebKit

## Status

Accepted

## Date

2026-07-25

## Context

Phase 5's exit criteria are behavioural: "a complete match is playable end to end in supported
browsers" and "a complete match is playable end to end in the macOS and Windows shells"
([section 22](../product-spec.md)). Neither can be held by unit tests. The existing test estate is
Vitest in Node: excellent for the rules engine, the protocol and the server, and structurally
unable to answer whether a WebGL scene renders, whether a click lands on the intended square, or
whether the clock keeps counting after a reconnect.

Constraints that shape the answer:

- The desktop shells are packaged from the same web build ([ADR-0004](0004-tauri-v2-desktop-shell.md))
  and run in the operating system web view: WebKit on macOS, Chromium-based WebView2 on Windows.
  Testing those two engines therefore also exercises the code path the shells will use, even before
  the shells exist in Phase 8.
- Supported browsers are the last two versions of Chrome, Edge, Firefox and Safari
  ([section 2.9](../product-spec.md)). Chromium covers Chrome and Edge; WebKit covers Safari and
  the macOS shell.
- The end-to-end path needs a real server and a real database, which continuous integration
  already provides for the server suites.
- A browser test that plays a whole match needs two players, so it needs two independent browser
  contexts in one test.

## Decision

Browser behaviour is proven by Playwright, running the production client build against a real
server, in Chromium and WebKit.

- Playwright lives at the repository root as `e2e/`, with its own configuration and its own script
  (`pnpm test:e2e`). It is not part of `turbo run test`, because it needs browsers, a database and
  two long-running processes, and because a unit test loop must stay fast.
- Two projects run every specification: `chromium` and `webkit`. A failure in either fails the
  suite. Firefox is not run: it shares no engine with the shells, and the client uses no
  engine-specific API, so the cost of a third browser download is not yet justified. This is
  recorded as a deviation in [Appendix P5](../product-spec.md).
- The suite serves the client from `vite preview` over the build output, not the dev server, so
  what is tested is what ships.
- The server under test is started by the suite through the same `bootstrapServer` entry point the
  production process uses, with a test database and a fixed configuration.
- The mandatory specification is a complete match: two contexts sign in, queue, get paired, play
  to a decided result, see the result and take a rematch. Reconnection, the reveal-loss warning and
  the keyboard path are separate specifications in the same suite.
- Continuous integration runs the suite as a separate job that installs only the two browsers it
  needs. A red end-to-end job blocks the merge exactly like a red unit job.
- Tests address the interface through stable `data-testid` attributes and accessible roles, never
  through class names or scene-graph internals, so the visual work of later phases does not break
  them.

## Consequences

### Positive

- The Phase 5 exit criterion is held by evidence rather than by assertion, and the evidence is
  reproducible locally.
- Two of the three rendering targets the product must support (Safari's engine and Chrome's) are
  covered before the desktop shells are built, which moves the risk of an engine surprise out of
  Phase 8.
- A full-match specification is the cheapest possible regression net for the whole stack: it fails
  if the protocol, the gateway, the clock, the renderer or the interaction breaks.

### Negative

- Browser binaries are a large download and add one to two minutes to continuous integration.
- End-to-end tests are the slowest and flakiest kind. Keeping them trustworthy requires
  discipline: no arbitrary sleeps, wait for observable state, and no dependence on animation
  timing.
- A second test runner exists in the repository, with its own configuration and its own idioms.

### Neutral

- Coverage thresholds stay a Vitest concern. The end-to-end suite is a behavioural gate, not a
  coverage instrument.
- Phase 8 will extend rather than replace this decision: the shells add a packaged-application
  smoke test, and the browser suite remains the engine-level proof.

## Alternatives considered

### Vitest browser mode

Vitest can drive a real browser through Playwright's driver, which would keep one runner.
Rejected for the end-to-end path: the scenario needs two independent sessions, a real server and
navigation across routes, which is a Playwright test rather than a component test. Component-level
browser tests may still be added later without contradicting this decision.

### Cypress

Rejected: a single browser engine per run and no WebKit parity with Safari, which is precisely the
engine most likely to differ and the engine the macOS shell uses.

### jsdom component tests only

Rejected: jsdom has no WebGL and no layout, so it cannot answer either exit criterion. It remains
the right tool for reducers, hooks and non-scene components, and it keeps that role.

### Manual verification in real browsers

Rejected as the primary proof: it cannot run on every commit, and the phase's criterion is
permanent, not a one-off sign-off. Manual passes still happen before a release
([section 20](../product-spec.md)).

## References

- [`../product-spec.md`](../product-spec.md) sections 2.9, 13, 20.5, 22
- [ADR-0004](0004-tauri-v2-desktop-shell.md), [ADR-0005](0005-threejs-react-three-fiber.md)
- [`../operations.md`](../operations.md)
