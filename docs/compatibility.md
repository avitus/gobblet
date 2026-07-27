# Compatibility

The rendering matrix of [`product-spec.md` section 20.7](product-spec.md). A row is executed by a
runner where one exists, and dated by a person where none does
([ADR-0041](adr/0041-the-compatibility-matrices-are-executed-where-a-runner-exists.md)). A row with
no date and no runner is not a passing row; it is an unanswered question, and it says so.

## 1. Browser engines

| Engine   | How it is covered                                                                                    | Runs                                     | Last result                              |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Chromium | Playwright project `chromium`, the whole browser suite                                               | Every push, `.github/workflows/ci.yml`   | Green, 16 specs                          |
| WebKit   | Playwright project `webkit`, the whole browser suite                                                 | Every push, `.github/workflows/ci.yml`   | Green, 16 specs                          |
| Firefox  | Playwright project `firefox`, the whole browser suite                                                | Nightly, `.github/workflows/nightly.yml` | Green, 16 specs, 2026-07-27, locally     |
| Chrome   | Chromium with Google's additions; no rendering difference the client depends on                      | Covered by the Chromium row              | Covered by Chromium                      |
| Edge     | Chromium with Microsoft's additions; the same                                                        | Covered by the Chromium row              | Covered by Chromium                      |
| Safari   | WebKit is the engine, but Safari's own compositor and colour handling are not WebKit's in Playwright | Manual                                   | **Not yet run.** Needs a person on macOS |

The suite drives the production build against a real server and a real database, so a passing row
means the journeys of section 20.6 completed in that engine, not that a page loaded.

## 2. Desktop web views

The desktop is the web build in a window ([ADR-0033](adr/0033-the-desktop-application-is-the-web-build-in-a-window.md)),
so the engine is the platform's, not one we ship.

| Web view          | Engine   | How it is covered                                                                      | Last result                                                  |
| ----------------- | -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| macOS `WKWebView` | WebKit   | The shell compiles and links nightly; the journeys are covered by the WebKit project   | Shell builds nightly. Journeys in the shell: **not yet run** |
| Windows WebView2  | Chromium | The shell compiles and links nightly; the journeys are covered by the Chromium project | Shell builds nightly. Journeys in the shell: **not yet run** |

Driving the packaged application needs a signed build on a clean machine, which is deferred with the
signing identities recorded in [`operations.md` section 13](operations.md). What is proved today is
that the shell builds on both platforms and that the same client passes in both engines.

## 3. Graphics

The client picks a rendering tier from what the browser reports and lets a player override it
([ADR-0023](adr/0023-rendering-tiers-and-a-flat-fallback-board.md)). The flat tier needs no WebGL at all,
which is the fallback section 20.7 asks for, and `e2e/tests/rendering.spec.ts` proves the choice and
the override in every engine above.

| Hardware                     | How it is covered                                              | Last result                         |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| Software rendering, no GPU   | The Linux runners have no GPU: the suite runs there every push | Green, every push                   |
| Apple silicon integrated GPU | Manual, on the maintainer's machine                            | Green, 2026-07-27, 16 specs locally |
| Intel integrated GPU         | Manual                                                         | **Not yet run**                     |
| Discrete NVIDIA or AMD GPU   | Manual                                                         | **Not yet run**                     |

## 4. Screen readers

| Reader                                 | How it is covered                                                                                                                | Last result                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Roles, names and keyboard reachability | `packages/game-ui/test/scene-description.test.tsx`, `packages/game-ui/test/flat-board.test.tsx` and `e2e/tests/keyboard.spec.ts` | Green, every push                                                   |
| VoiceOver on macOS                     | Manual                                                                                                                           | **Not yet run**, registered as D-0002 in [`defects.md`](defects.md) |
| NVDA on Windows                        | Manual                                                                                                                           | **Not yet run**, registered as D-0002 in [`defects.md`](defects.md) |

## 5. How to add a result

Run the suite, then edit the row: the date and what happened, in the same words a reader would use.
A row that is claimed without a run is worse than an empty row, because an empty row still asks the
question.

```bash
pnpm test:e2e            # Chromium and WebKit
pnpm test:e2e:firefox    # Firefox, after pnpm test:e2e:browsers:firefox
```
