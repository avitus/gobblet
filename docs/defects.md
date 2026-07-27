# Known defects

Every known defect in Gobblet Online, one row each. The release gate of
[`product-spec.md` section 21.2](product-spec.md) reads this file: an open row at `critical` or
`high` fails `pnpm gates`. The format is fixed because a program parses it
([ADR-0039](adr/0039-the-defect-register-is-a-gate.md)).

Severity, and what it means here:

| Severity   | Meaning                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| `critical` | Data loss, a wrong match result, an accepted illegal move, or the service being unusable |
| `high`     | A player cannot complete a normal journey, or a documented promise is broken             |
| `medium`   | A journey is completeable but degraded, or a promise holds only on some platforms        |
| `low`      | Cosmetic, or an inconvenience with an obvious workaround                                 |

Status, and what it means here:

| Status     | Meaning                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `open`     | Present in the current build                                                   |
| `fixed`    | Fixed, with the fix named in the evidence column                               |
| `accepted` | Present, deliberately not fixed for this release, with who accepted it and why |

A row at `critical` or `high` cannot be waved through by marking it `accepted`. Accepting it means
arguing the severity down, in this file, where the argument is reviewable.

| ID     | Severity | Status   | Area          | Description                                                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                           |
| ------ | -------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0001 | medium   | open     | web client    | The main JavaScript chunk is about 1.9 MB before compression, over Vite's 500 kB warning, because Three.js is not split                                                                                                                                                                                                                                                     | `pnpm --filter @gobblet/web run build` prints the warning; the flat tier still renders without WebGL                                                                               |
| D-0002 | low      | accepted | accessibility | No screen reader pass has been performed. Accepted for the release candidate by the maintainer: the board exposes roles and labels and the keyboard journey is tested, but VoiceOver and NVDA have not been driven by a person                                                                                                                                              | `e2e/tests/keyboard.spec.ts`, `packages/game-ui/test/scene-description.test.tsx`; `docs/compatibility.md` section 4                                                                |
| D-0003 | low      | accepted | packaging     | Some GitHub actions still run on Node 20 and print a deprecation warning in every workflow. Accepted by the maintainer: it is noise in the log, and the actions are pinned to majors that will move themselves                                                                                                                                                              | Any workflow run's annotations                                                                                                                                                     |
| D-0004 | low      | accepted | database      | Six branches in `packages/db/src/backup.ts` are still uncovered: fallbacks on aggregate rows that PostgreSQL always returns, and index lookups that exist only for `noUncheckedIndexedAccess`. Accepted by the maintainer: reaching them means injecting a client into a module that deliberately opens its own, which is a change to production code for a coverage number | `pnpm --filter @gobblet/db run test:coverage` reports 100 percent of statements, functions and lines and 98.25 percent of branches; `@gobblet/config` is at 100 percent throughout |
