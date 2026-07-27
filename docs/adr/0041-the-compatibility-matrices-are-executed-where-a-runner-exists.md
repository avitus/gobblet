# ADR-0041: The compatibility matrices are executed where a runner exists and declared where they are manual

## Status

Accepted

## Date

2026-07-27

## Context

Phase 9 asks for a browser matrix and a desktop compatibility matrix. Section 20.7 names Safari,
Chrome, Firefox, Edge and the two desktop web views, and asks for integrated and discrete GPUs where
available. [ADR-0021](0021-playwright-browser-end-to-end-tests.md) chose Chromium and WebKit for the
suite that runs on every push, because two engines already cost most of the wall-clock time of the
build, and it recorded Firefox as a manual pass.

Three phases later that manual pass has never happened, which is the predictable fate of a promise
with no runner attached. Meanwhile Phase 8 added a nightly workflow that already builds the desktop
shell on macOS and on Windows, so there is now somewhere for slower, broader checks to live.

## Decision

Every engine that a hosted runner can run is run, nightly rather than per push, and everything that
genuinely needs a human or a machine we do not have is written down as a manual matrix row with what
it covers and when it was last done.

- The browser suite gains Firefox as a third Playwright project. The two-engine suite still runs on
  every push; the three-engine run is a nightly job, so a Firefox regression is found within a day
  without adding minutes to every pull request.
- Edge is not a separate project. It is Chromium with a different shell, and the specification's
  concern is the engine; the matrix says so rather than pretending a fourth project adds coverage.
- Safari is covered by WebKit in the suite. The matrix records that a real Safari pass on macOS is a
  manual row, because Playwright's WebKit is not Safari and the difference that matters is the one
  nobody can automate here.
- The desktop web views are covered by the nightly shell build on macOS and Windows plus a launch
  check, which is what a build machine can prove. Installing and playing a match in the packaged
  application on each platform stays a manual row, alongside the two signing criteria already
  deferred in [ADR-0036](0036-signing-is-a-workflow-step-that-fails-loudly.md).
- The GPU rows are manual and honest: hosted runners render with software rasterisation, which is why
  the scene test already needs extra time there. The matrix records the tier the client selects in
  each case and the fallback that makes an unsupported machine playable
  ([ADR-0023](0023-rendering-tiers-and-a-flat-fallback-board.md)).
- Both matrices live in [`../compatibility.md`](../compatibility.md) with a status and a date per row,
  and the automated rows name the job that proves them, so a reader can tell at a glance which rows
  are claims and which are results.

## Consequences

### Positive

- Firefox stops being a promise and becomes a nightly result.
- The manual rows are a short, dated list rather than an implied "everything works".
- Nothing is added to the per-push build, which is the constraint that produced the two-engine suite
  in the first place.

### Negative

- A nightly failure is found up to a day after the change that caused it.
- The manual rows go stale by definition. Each carries the date it was last performed, so staleness is
  visible.

### Neutral

- Adding a fourth engine later is a project entry and a matrix row.

## Alternatives considered

### Running three engines on every push

Rejected: it adds several minutes to every pull request to catch a class of failure that is rare and
that a nightly run catches within a day.

### A hosted device farm

Rejected for this phase: it needs an account, a budget and credentials, all of which are deferred with
the host ([ADR-0015](0015-single-region-deployment.md)). The matrix names it as the way the manual
rows become automated rows.

### Dropping the manual rows

Rejected. The specification asks for a matrix, and a matrix that lists only what is automated would
claim the untested parts do not exist.

## References

- [`../product-spec.md`](../product-spec.md) sections 20.6, 20.7, 24 (Phase 9)
- [ADR-0021](0021-playwright-browser-end-to-end-tests.md),
  [ADR-0023](0023-rendering-tiers-and-a-flat-fallback-board.md)
- [`../compatibility.md`](../compatibility.md)
