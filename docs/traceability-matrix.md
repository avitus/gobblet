# Traceability matrix

Maps every rule identifier in [`rules.md`](rules.md), every acceptance scenario of
[`product-spec.md` section 27](product-spec.md#27-initial-acceptance-scenarios) and
every explicit game-core test requirement of specification sections 20.1 and 20.2
to the automated checks that hold them.

- Test root: `packages/game-core/test`
- Run everything: `pnpm --filter @gobblet/game-core test`
- Coverage gate: `pnpm --filter @gobblet/game-core test:coverage` (100% statements, branches, functions and lines)
- Nightly property depth: `GOBBLET_PROPERTY_TRANSITIONS=100000 pnpm --filter @gobblet/game-core test:properties:nightly`

Status legend: `held` means at least one automated check fails if the rule is
broken. Every rule row in this document is `held`. Scenarios that depend on the
match runtime are listed with the phase that will hold them, so nothing in
specification section 27 is silently dropped.

## 1. Acceptance scenarios (spec 27)

| Scenario | Description                                                       | Where                                                                               |
| -------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A        | Ordinary placement from an external stack                         | `reserve-moves.test.ts` > `scenario A: ordinary reserve placement`                  |
| B        | Defensive gobble from an external stack onto a three-piece threat | `reserve-moves.test.ts` > `scenario B: defensive reserve gobble`                    |
| C        | Gobbling the mover's own smaller piece with a board move          | `board-moves.test.ts` > `scenario C: gobbles the mover's own smaller piece`         |
| D        | Revealing an opponent line and losing immediately                 | `reveal.test.ts` > `scenario D: revealing an opponent line and failing to block it` |
| E        | Revealing an opponent line and blocking it with the same move     | `reveal.test.ts` > `scenario E: revealing an opponent line and blocking it`         |
| F        | Threefold repetition draw                                         | `repetition.test.ts` > `scenario F: threefold repetition`                           |

The Elo half of scenario F (ranked players receive draw updates) is held by
`apps/server/test/rating-service.test.ts` > `records a draw as a draw for both sides` and the draw
vectors in `apps/server/test/elo.test.ts`.

Scenarios that need the server runtime are not engine scenarios and are held open
with their owning phase:

| Scenario | Description                     | Where or planned home                                                                                                    |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| G        | Timeout during disconnect       | `socket-gateway.test.ts` > `ends the match on time with no command from either player` (held)                            |
| H        | Retry after lost acknowledgment | `socket-gateway.test.ts` > `acknowledges a duplicate command without moving twice` (held)                                |
| I        | Guest claim                     | `phase3-exit-criteria.test.ts` > `moves the guest's match to the new account` (held)                                     |
| J        | Active match deployment         | `phase2-exit-criteria.test.ts` > `recovers the state, the clocks and the guest sessions`, hardened in Phase 7 with drain |

## 2. Equipment and setup

| Rule | Test file             | Test                                                                                                                                          |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1.1 | `setup.test.ts`       | exposes sixteen unique squares in canonical order                                                                                             |
| R1.2 | `setup.test.ts`       | defines twenty-four pieces, twelve per player                                                                                                 |
| R1.3 | `setup.test.ts`       | maps players to codes in both directions                                                                                                      |
| R1.4 | `setup.test.ts`       | gives every player three external stacks holding one piece of each size; starts with an empty board and three full external stacks per player |
| R1.5 | `setup.test.ts`       | starts with an empty board and three full external stacks per player                                                                          |
| R1.6 | `setup.test.ts`       | produces different position keys for each side to move                                                                                        |
| R1.7 | `board-moves.test.ts` | rejects covering a piece of equal size; rejects covering a larger piece                                                                       |

## 3. Coordinates, identities and notation

| Rule | Test file            | Test                                                                                                             |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R2.1 | `setup.test.ts`      | exposes sixteen unique squares in canonical order; resolves squares from coordinates and validates unknown input |
| R2.2 | `setup.test.ts`      | exposes the ten winning lines                                                                                    |
| R2.3 | `setup.test.ts`      | exposes the ten winning lines                                                                                    |
| R2.4 | `setup.test.ts`      | resolves pieces by identity; validates piece identifiers                                                         |
| R2.5 | `setup.test.ts`      | reports only the top piece of a stack; gives every player three external stacks holding one piece of each size   |
| R2.6 | `repetition.test.ts` | treats the three external stacks as interchangeable                                                              |

## 4. Turn order

| Rule | Test file               | Test                                                                                             |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| R3.1 | `reserve-moves.test.ts` | places the exposed piece on an empty square                                                      |
| R3.2 | `invariants.test.ts`    | rejects a ply that did not advance                                                               |
| R3.3 | `board-moves.test.ts`   | rejects a move of the opponent's visible piece                                                   |
| R3.4 | `invariants.test.ts`    | accepts a normal transition; rejects a nonterminal move that did not alternate the active player |
| R3.5 | `wins.test.ts`          | accepts no further moves once the game is won                                                    |

## 5. Visibility

| Rule | Test file               | Test                                                      |
| ---- | ----------------------- | --------------------------------------------------------- |
| R4.1 | `setup.test.ts`         | reports only the top piece of a stack                     |
| R4.2 | `setup.test.ts`         | exposes board level queries for previews                  |
| R4.3 | `wins.test.ts`          | ignores covered pieces when evaluating lines              |
| R4.4 | `reserve-moves.test.ts` | exposes the next smaller piece of the same external stack |

## 6. Entering a piece from an external stack

| Rule | Test file                             | Test                                                                                             |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| R5.1 | `reserve-moves.test.ts`               | places the exposed piece on an empty square; draws from each external stack of both players      |
| R5.2 | `reserve-moves.test.ts`               | offers every empty square as a destination for a reserve piece                                   |
| R5.3 | `reserve-moves.test.ts`               | rejects a reserve entry onto an occupied square without the defensive exception                  |
| R5.4 | `reserve-moves.test.ts`               | rejects entries from an exhausted external stack                                                 |
| R5.5 | `setup.test.ts`, `properties.test.ts` | reports an empty external stack as having no exposed piece; keeps every generated position sound |

## 7. The defensive exception

| Rule | Test file                                | Test                                                                                                                                   |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R6.1 | `reserve-moves.test.ts`                  | allows covering any of the three aligned opponent pieces                                                                               |
| R6.2 | `reserve-moves.test.ts`                  | rejects a reserve entry onto a piece that is not smaller                                                                               |
| R6.3 | `reserve-moves.test.ts`                  | never lets a reserve piece cover one of the mover's own pieces                                                                         |
| R6.4 | `reserve-moves.test.ts`, `setup.test.ts` | allows the threatened squares and the empty squares, and nothing else; detects lines where a player already shows three visible pieces |
| R6.5 | `reserve-moves.test.ts`                  | does not allow covering occupied squares outside a three-piece line                                                                    |

## 8. Moving a piece already on the board

| Rule | Test file             | Test                                                                                                                 |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| R7.1 | `board-moves.test.ts` | moves a visible piece to an empty square                                                                             |
| R7.2 | `board-moves.test.ts` | moves only the top piece when the mover covers one of their own pieces                                               |
| R7.3 | `board-moves.test.ts` | rejects a move onto the same square                                                                                  |
| R7.4 | `board-moves.test.ts` | offers every empty square and every strictly smaller piece as a destination                                          |
| R7.5 | `board-moves.test.ts` | scenario C: gobbles the mover's own smaller piece; gobbles a smaller opponent piece                                  |
| R7.6 | `board-moves.test.ts` | rejects covering a piece of equal size; rejects covering a larger piece                                              |
| R7.7 | `reveal.test.ts`      | marks every legal destination that fails to block as losing                                                          |
| R7.8 | `board-moves.test.ts` | rejects moving a covered piece because only the top piece is visible; rejects a move of the opponent's visible piece |

## 9. Winning

| Rule | Test file        | Test                                                                          |
| ---- | ---------------- | ----------------------------------------------------------------------------- |
| R8.1 | `wins.test.ts`   | recognises a light win on `row-0` .. `diagonal-1` (all ten lines)             |
| R8.2 | `wins.test.ts`   | ignores covered pieces when evaluating lines                                  |
| R8.3 | `reveal.test.ts` | continues the game when the moved piece covers another piece of the same line |
| R8.4 | `wins.test.ts`   | recognises a dark win and reports the line metadata                           |

## 10. Revealing a line and outcome priority

| Rule | Test file                              | Test                                                                                                                           |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R9.1 | `reveal.test.ts`                       | loses immediately for the mover                                                                                                |
| R9.2 | `reveal.test.ts`                       | loses immediately for the mover; loses whenever any revealed line stays unblocked                                              |
| R9.3 | `reveal.test.ts`                       | continues the game when the moved piece covers another piece of the same line; cannot block by covering an equally sized piece |
| R9.4 | `reveal.test.ts`                       | does not let the mover's own new line override an unblocked revealed line                                                      |
| R9.5 | `reveal.test.ts`, `repetition.test.ts` | terminal outcome priority (suite); draws when the same position with the same side to move occurs three times                  |
| R9.6 | `reveal.test.ts`                       | is reported before the move is applied; marks every legal destination that fails to block as losing                            |

Reserve entries never reveal anything, which is covered by `reveal.test.ts` >
`never reveals anything when entering a piece from a reserve`.

## 11. Draws

| Rule  | Test file            | Test                                                                                            |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------- |
| R10.1 | `repetition.test.ts` | draws when the same position with the same side to move occurs three times                      |
| R10.2 | `repetition.test.ts` | draws when the same position with the same side to move occurs three times                      |
| R10.3 | `repetition.test.ts` | counts the opening position as the first occurrence                                             |
| R10.4 | `reveal.test.ts`     | can win with the blocking move itself                                                           |
| R10.5 | `properties.test.ts` | keeps every generated position sound (a draw only ever appears with a thrice repeated position) |

## 12. Position identity

| Rule  | Test file            | Test                                                                                                                                  |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R11.1 | `repetition.test.ts` | distinguishes positions that differ only in remaining reserve pieces                                                                  |
| R11.2 | `repetition.test.ts` | ignores ply and repetition history when computing a position key                                                                      |
| R11.3 | `repetition.test.ts` | treats the three external stacks as interchangeable                                                                                   |
| R11.4 | `repetition.test.ts` | keeps positions with a different side to move separate; does not draw when a repeated position is reached with the other side to move |
| R11.5 | `setup.test.ts`      | produces different position keys for each side to move                                                                                |

## 13. State invariants

| Rule   | Test file            | Test                                                                                                               |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| R12.1  | `invariants.test.ts` | rejects duplicated pieces; rejects missing pieces                                                                  |
| R12.2  | `invariants.test.ts` | rejects missing pieces (piece count per player)                                                                    |
| R12.3  | `invariants.test.ts` | rejects board stacks that are not strictly ascending                                                               |
| R12.4  | `invariants.test.ts` | rejects external stacks that are not a 1..k prefix                                                                 |
| R12.5  | `invariants.test.ts` | rejects an in-progress state that already shows a line of four                                                     |
| R12.6  | `invariants.test.ts` | rejects a win without a visible line of four                                                                       |
| R12.7  | `invariants.test.ts` | rejects a draw without a repeated position                                                                         |
| R12.8  | `invariants.test.ts` | rejects impossible repetition counts                                                                               |
| R12.9  | `invariants.test.ts` | rejects an invalid ply; rejects a ply that did not advance                                                         |
| R12.10 | `invariants.test.ts` | accepts a terminal transition that keeps the mover on turn; rejects a terminal move that changed the active player |

## 14. Engine guarantees

| Rule  | Test file                                               | Test                                                                                                        |
| ----- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R14.1 | `properties.test.ts`, `eslint.config.mjs`               | applies the same move to the same state deterministically; the `game-core` purity lint boundary             |
| R14.2 | `setup.test.ts`, `freeze.test.ts`, `properties.test.ts` | returns immutable state; freezes nested objects and arrays; never mutates the state that was passed in      |
| R14.3 | `board-moves.test.ts`, `reserve-moves.test.ts`          | rejects malformed square references; rejects malformed reserve references                                   |
| R14.4 | `enumeration.test.ts`, `properties.test.ts`             | agrees with evaluateMove and applyMove for every candidate move; rejects every move that was not enumerated |
| R14.5 | `serialization.test.ts`                                 | is byte stable and independent of insertion order; round trips the opening position                         |
| R14.6 | `invariants.test.ts`                                    | throws an error that lists the violated codes; throws an error that lists the violated transition codes     |

## 15. Open questions

| Question                                       | Reading held by         | Test                                                                                   |
| ---------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| Q1 threat line runs through the covered square | `reserve-moves.test.ts` | does not allow covering occupied squares outside a three-piece line                    |
| Q2 both players complete a line                | `reveal.test.ts`        | does not let the mover's own new line override an unblocked revealed line              |
| Q3 position identity for repetition            | `repetition.test.ts`    | treats the three external stacks as interchangeable                                    |
| Q4 player with no legal move                   | `properties.test.ts`    | keeps every generated position sound (fails if a generated position has no legal move) |
| Q5 active player in terminal states            | `invariants.test.ts`    | accepts a terminal transition that keeps the mover on turn                             |

## 16. Specification test checklist for game-core (spec 20.1)

| Required test                   | Test file                                  | Test                                                                                                                               |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Initial setup                   | `setup.test.ts`                            | starts with an empty board and three full external stacks per player; accounts for all twenty-four pieces                          |
| External stack order            | `setup.test.ts`, `reserve-moves.test.ts`   | gives every player three external stacks holding one piece of each size; exposes the next smaller piece of the same external stack |
| Empty-square reserve placement  | `reserve-moves.test.ts`                    | places the exposed piece on an empty square                                                                                        |
| Illegal ordinary reserve gobble | `reserve-moves.test.ts`                    | rejects a reserve entry onto an occupied square without the defensive exception                                                    |
| Legal defensive reserve gobble  | `reserve-moves.test.ts`                    | allows covering any of the three aligned opponent pieces                                                                           |
| Board movement to empty square  | `board-moves.test.ts`                      | moves a visible piece to an empty square                                                                                           |
| Gobbling own smaller piece      | `board-moves.test.ts`                      | scenario C: gobbles the mover's own smaller piece                                                                                  |
| Gobbling opponent smaller piece | `board-moves.test.ts`                      | gobbles a smaller opponent piece                                                                                                   |
| Equal-size rejection            | `board-moves.test.ts`                      | rejects covering a piece of equal size                                                                                             |
| Larger-piece rejection          | `board-moves.test.ts`                      | rejects covering a larger piece                                                                                                    |
| Covered-piece rejection         | `board-moves.test.ts`                      | rejects moving a covered piece because only the top piece is visible                                                               |
| Every row win                   | `wins.test.ts`                             | recognises a light win on `row-0` to `row-3`                                                                                       |
| Every column win                | `wins.test.ts`                             | recognises a light win on `column-0` to `column-3`                                                                                 |
| Both diagonal wins              | `wins.test.ts`                             | recognises a light win on `diagonal-0` and `diagonal-1`                                                                            |
| Reveal loss                     | `reveal.test.ts`                           | scenario D: loses immediately for the mover                                                                                        |
| Reveal-and-block survival       | `reveal.test.ts`                           | scenario E: continues the game when the moved piece covers another piece of the same line                                          |
| Multiple revealed lines         | `reveal.test.ts`                           | loses whenever any revealed line stays unblocked; reports the partially blocked line but still loses                               |
| Threefold repetition            | `repetition.test.ts`                       | scenario F: draws when the same position with the same side to move occurs three times                                             |
| Piece conservation              | `invariants.test.ts`, `properties.test.ts` | rejects duplicated pieces; rejects missing pieces; keeps every generated position sound                                            |
| Terminal-state immutability     | `wins.test.ts`, `setup.test.ts`            | accepts no further moves once the game is won; returns immutable state                                                             |

## 17. Specification property checklist for game-core (spec 20.2)

| Required property                                              | Test file                       | Test                                                      |
| -------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| Applying a legal move preserves all piece invariants           | `properties.test.ts`            | keeps every generated position sound                      |
| Applying an enumerated legal move never throws                 | `properties.test.ts`            | keeps every generated position sound                      |
| Every move not enumerated is rejected                          | `properties.test.ts`            | rejects every move that was not enumerated                |
| Serialization and deserialization preserve canonical state     | `properties.test.ts`            | keeps every generated position sound                      |
| Position keys are deterministic                                | `properties.test.ts`            | keeps every generated position sound                      |
| No piece is duplicated, no piece disappears                    | `properties.test.ts`            | keeps every generated position sound                      |
| Board stacks remain strictly ordered                           | `properties.test.ts`            | keeps every generated position sound                      |
| Game result is deterministic                                   | `properties.test.ts`            | applies the same move to the same state deterministically |
| Transition reconstruction from a move log reproduces snapshots | `properties.test.ts`            | keeps every generated position sound (replays every game) |
| Random reachable states stay valid over long sequences         | `properties.test.ts`            | keeps every generated position sound (up to 250 plies)    |
| 100,000 generated transitions nightly                          | `.github/workflows/nightly.yml` | `pnpm test:properties:nightly`                            |
| Smaller deterministic seed set per pull request                | `.github/workflows/ci.yml`      | `pnpm test:coverage` runs the 2000-transition default     |
| Failing seeds persisted as regression tests                    | `properties.test.ts`            | recorded regression seeds (suite)                         |

## 18. Phase 0 exit criteria (spec 24)

| Criterion                                         | Evidence                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One command starts local web, server and database | `pnpm dev` (`scripts/dev.mjs`): PostgreSQL through Docker Compose when available, then `@gobblet/server` on port 4000 and `@gobblet/web` on port 5173                                           |
| CI passes                                         | `.github/workflows/ci.yml` runs `format:check`, `lint`, `typecheck`, `test:coverage`, `build`; locally `pnpm verify`                                                                            |
| Health endpoints                                  | `apps/server/test/health.test.ts` covers `/health/live`, `/health/ready` (ready, unavailable, throwing probe) and `/v1/config`                                                                  |
| Environment-variable schema                       | `packages/config/src/schema.ts`, `packages/config/test/server-config.test.ts`, documented in `.env.example`                                                                                     |
| Package boundaries                                | `eslint.config.mjs` purity boundary for `packages/game-core` (`lint` task)                                                                                                                      |
| ADRs for the required decisions                   | [`docs/adr/`](adr/) 0003 React/Vite, 0004 Tauri, 0005 Three.js, 0006 Fastify/Socket.IO, 0007 PostgreSQL/Drizzle, 0008 Auth0 (superseded by 0017), 0009 clocks, 0010 event persistence           |
| Staging health check is reachable                 | **Not met**: no hosting account or secrets exist yet, recorded in [`product-spec.md` appendix P0](product-spec.md#appendix-p0--phase-0-exit-criteria-not-yet-met-recorded-not-silently-skipped) |
| Empty Tauri shells build on macOS and Windows CI  | **Not met**: deferred to Phase 8 with the reason recorded in [`product-spec.md` appendix P0](product-spec.md#appendix-p0--phase-0-exit-criteria-not-yet-met-recorded-not-silently-skipped)      |

## 19. Phase 1 exit criteria (spec 24)

| Criterion                                       | Evidence                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 100% game-core coverage                         | `pnpm --filter @gobblet/game-core test:coverage`, thresholds in `packages/game-core/vitest.config.ts`                          |
| All official rule cases pass                    | Sections 1 to 17 of this document                                                                                              |
| 100,000-transition nightly property test passes | `pnpm test:properties:nightly` (about 30 seconds locally), scheduled in `.github/workflows/nightly.yml`                        |
| Pure package usable in Node and browser         | No dependencies in `packages/game-core/package.json`; `node:*` imports banned by `eslint.config.mjs`; ESM bundle built by tsup |
| No UI or server dependency                      | Purity lint boundary in `eslint.config.mjs`                                                                                    |
| Rules documentation with examples               | [`rules.md`](rules.md), worked edge cases in section 16                                                                        |
| Ambiguities recorded, not silently decided      | [`rules.md` section 13](rules.md#13-open-questions-and-interpretations), `product-spec.md` appendix P1                         |

## 20. Specification test checklist for the match runtime (spec 20.3, 20.4, 20.5)

Test roots: `apps/server/test`, `packages/db/test`, `packages/protocol/test`. Run everything
with `pnpm verify`. The server and database suites need PostgreSQL; `TEST_DATABASE_URL` selects
the database and each suite uses its own (`gobblet_test`, `gobblet_test_server`).

### 20.1 Protocol tests (spec 20.3)

| Required test                                          | Where                                                                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema compatibility                                   | `packages/protocol/test` (71 tests), `packages/config/test/protocol-alignment.test.ts`                                                                                                                                |
| Duplicate command IDs                                  | `phase2-exit-criteria.test.ts` > `applies one move when the same command arrives twice at once`; `match-runtime.test.ts` > `rejects a duplicate command without applying it twice`                                    |
| Stale expected versions                                | `phase2-exit-criteria.test.ts` > `accepts one of two different commands that claim the same version`; `socket-gateway.test.ts` > `rejects a stale version and returns the snapshot to correct the client`             |
| Out-of-order events                                    | `phase2-exit-criteria.test.ts` asserts a gapless `sequence`; `packages/db/test` unique `(match_id, sequence)`                                                                                                         |
| Reconnect during move                                  | `socket-gateway.test.ts` > `returns the authoritative snapshot to a participant`; `phase2-exit-criteria.test.ts` restart test resyncs mid-match                                                                       |
| Reconnect after move commit but before acknowledgement | `socket-gateway.test.ts` > `acknowledges a duplicate command without moving twice` (the retry receives the committed snapshot)                                                                                        |
| Match completion exactly once                          | `phase2-exit-criteria.test.ts` > `is committed once and refuses every later command`                                                                                                                                  |
| Rating update exactly once                             | `rating-service.test.ts` > `moves a rating once, even if completion is applied again`, `refuses to extend an audit that lost one of its two rows`; unique `(match_id, user_id)` in `packages/db/test/ratings.test.ts` |
| Achievement award exactly once                         | Phase 6, no achievement exists yet                                                                                                                                                                                    |

### 20.2 Clock tests (spec 20.4)

All clock tests inject a fake clock (`TestClock` in `apps/server/test/helpers/match-fixtures.ts`).

| Required test                          | Where                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Move immediately before timeout        | `match-runtime.test.ts` > `accepts a move that arrives one millisecond before the flag falls`                                                  |
| Move received at timeout               | `match-runtime.test.ts` > `settles a timeout when a command arrives too late`                                                                  |
| Clock after reconnect                  | `socket-gateway.test.ts` > `returns the authoritative snapshot to a participant`, cadence suite                                                |
| Clock after process restart            | `phase2-exit-criteria.test.ts` > `recovers the state, the clocks and the guest sessions`                                                       |
| Clock after system sleep               | `bootstrap.test.ts` > `settles matches whose clock expired while the process was down` (a clock jump is a sleep as far as the server can tell) |
| No increment                           | `match-runtime.test.ts` > `charges only the moving side and restarts the turn clock`, and the no-increment assertion in the pre-timeout test   |
| Every time control                     | `match-runtime.test.ts` > `gives both sides %i seconds and expires at exactly that budget` (180, 300, 600, 900)                                |
| Resignation while clock running        | `match-runtime.test.ts` > `stops the clock of the side that was thinking`                                                                      |
| Simultaneous timeout and move ordering | `match-runtime.test.ts` > `settles exactly once when two commands race`, `never settles twice`                                                 |

### 20.3 Integration tests (spec 20.5)

| Required test                                         | Where                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Guest casual match end to end                         | `phase2-exit-criteria.test.ts` > `commits every move and the terminal outcome once`                                                    |
| Planned deployment restart with active match recovery | `phase2-exit-criteria.test.ts` > `recovers the state, the clocks and the guest sessions`                                               |
| Account ranked match end to end                       | `phase4-exit-criteria.test.ts` > `pairs two verified accounts and rates the match they play`                                           |
| Guest claim                                           | `phase3-exit-criteria.test.ts` > `moves the guest's match to the new account`                                                          |
| Authentication connection mappings                    | `identity-api.test.ts`, `identity-service.test.ts`, `socket-gateway.test.ts` handshake suite; one connection type exists (appendix P3) |
| Matchmaking rating expansion                          | `phase4-exit-criteria.test.ts` > `widens the rating window until two distant accounts can meet`; `pairing.test.ts` window suite        |
| Rematch                                               | `phase4-exit-criteria.test.ts` > `alternates the colours and records the match it followed`; `rematch.test.ts`                         |
| Desktop deep-link callback                            | Phase 8                                                                                                                                |

Specification section 20.5 asks for the server and PostgreSQL in containers. CI runs the
`postgres:16-alpine` service container; locally the suites use a native PostgreSQL because this
machine has no container runtime, recorded in
[`product-spec.md` appendix P2](product-spec.md#appendix-p2--phase-2-decisions-and-deviations).

## 21. Phase 2 exit criteria (spec 24)

| Criterion                                                 | Evidence                                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two test clients complete a full match through the server | `phase2-exit-criteria.test.ts` > `commits every move and the terminal outcome once` (two sockets, real database)                                                                 |
| Restart during an active match recovers state and clocks  | `phase2-exit-criteria.test.ts` > `recovers the state, the clocks and the guest sessions`; `bootstrap.test.ts` > `settles matches whose clock expired while the process was down` |
| Duplicate move commands do not duplicate moves            | `phase2-exit-criteria.test.ts` > `applies one move when the same command arrives twice at once`                                                                                  |
| Terminal outcome committed exactly once                   | `phase2-exit-criteria.test.ts` > `is committed once and refuses every later command`; `match-runtime.test.ts` > `settles exactly once when two commands race`                    |
| Server-authoritative clock with no client trust           | `match-clock.test.ts`, `clock-broadcaster.test.ts`, `match-runtime.test.ts` > `uses the server clock, not the client timestamp`                                                  |
| Append-only event log per match                           | `packages/db/test`, `match-runtime.test.ts` sequence and state-hash assertions                                                                                                   |
| One copy of the rule logic                                | `eslint.config.mjs` purity boundary, `apps/server/src/match/state.ts` delegates every decision to `@gobblet/game-core`                                                           |

## 22. Phase 3 exit criteria (spec 24, as amended by appendix P3)

Test roots: `apps/server/test`, `packages/db/test`, `packages/protocol/test`, `packages/auth/test`.

| Criterion                                            | Evidence                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All auth methods work in staging                     | Reduced to the one delivered method (appendix P3) and held locally: `phase3-exit-criteria.test.ts` > `carries an account from sign-up through a completed match`. Staging remains blocked (appendix P0).                                                             |
| Desktop PKCE deep-link flow works                    | **Void** (appendix P3): there is no PKCE flow.                                                                                                                                                                                                                       |
| Guest can claim data                                 | `phase3-exit-criteria.test.ts` > `moves the guest's match to the new account`; `identity-api.test.ts` guest claim suite; `packages/db/test/guest-claim.test.ts`                                                                                                      |
| Duplicate username races are handled transactionally | `phase3-exit-criteria.test.ts` > `creates exactly one account and refuses the rest`; `identity-api.test.ts` > `holds the username when two registrations race for it`; `identity-service.test.ts` > `creates one account when two claims race for one guest session` |
| Suspended account cannot queue                       | `phase3-exit-criteria.test.ts` > `cannot be seated in a match and cannot act in one it is already in`; `socket-gateway.test.ts` suspension suite; `identity-api.test.ts` > `refuses to seat a suspended account`                                                     |

The Phase 3 product surfaces, and what holds each one:

| Specification requirement                                        | Where held                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 2.3: guests play casual only, ranked needs an account    | `apps/server/src/match/eligibility.ts`; `identity-api.test.ts` > `keeps a guest and an unverified account out of a ranked match`                                                                                                |
| Section 2.3: globally unique usernames, immutable after creation | `packages/db/src/schema.ts` unique `username_normalized`; `identity-api.test.ts` > `refuses a username that differs only by capitalisation`, `refuses an empty patch, a missing body, a plaintext avatar and a username change` |
| Section 5.6: email verification for password accounts            | `identity-api.test.ts` verify-email suite; `identity-service.test.ts` > `treats a token consumed after it was read as already used`                                                                                             |
| Section 5.6: verified email required before ranked play          | `apps/server/src/match/eligibility.ts`; `identity-api.test.ts` > `seats two verified accounts in a ranked match`                                                                                                                |
| Section 11.1: public profile shows only permitted fields         | `apps/server/src/routes/profiles.ts`; `identity-api.test.ts` > `shows the public fields of a profile to anyone`                                                                                                                 |
| Section 11.2: own match summaries without the event log          | `apps/server/src/routes/me.ts`; `identity-api.test.ts` > `lists the matches of the calling account, and none for a fresh guest`                                                                                                 |
| Section 15.3: only credential hashes are stored                  | `packages/auth/test/password.test.ts`, `packages/auth/test/tokens.test.ts`; `packages/db/test/user-sessions.test.ts`                                                                                                            |
| Section 19.3: suspended accounts cannot queue                    | `apps/server/src/socket/gateway.ts` per-command check; `phase3-exit-criteria.test.ts` suspension suite                                                                                                                          |

## 23. Phase 4 exit criteria (spec 24, as amended by appendix P4)

Test roots: `apps/server/test`, `packages/db/test`, `packages/protocol/test`.

| Criterion                                     | Evidence                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest casual matching works                   | `phase4-exit-criteria.test.ts` > `pairs two guests who never registered, and lets them play at once`, `tells a waiting guest what it is waiting for, and lets it leave`                                                                                                                                                  |
| Registered ranked matching works              | `phase4-exit-criteria.test.ts` > `pairs two verified accounts and rates the match they play`, `refuses a ranked queue to a guest and to an unverified account`                                                                                                                                                           |
| Elo calculations match reference test vectors | `elo.test.ts` (27 hand-computed vectors); `phase4-exit-criteria.test.ts` > `moves a 1000 who beats an 1800 by the full K factor, and the 1800 by the same`                                                                                                                                                               |
| Rematch alternates colors                     | `phase4-exit-criteria.test.ts` > `alternates the colours and records the match it followed`; `rematch.test.ts` > `creates a new match with the colours alternated and records the predecessor`                                                                                                                           |
| Queue restart behavior documented and tested  | [`operations.md` drain-and-reconnect](operations.md), [ADR-0018](adr/0018-in-process-matchmaking-and-rematch-offers.md); `phase4-exit-criteria.test.ts` > `releases waiting players when the process drains, and starts the next one empty`, `keeps the match a restart interrupted, but not the offer that followed it` |

The Phase 4 product surfaces, and what holds each one:

| Specification requirement                                        | Where held                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 9.1: separate queues per mode and time control           | `apps/server/src/matchmaking/pairing.ts`; `pairing.test.ts` > `separates queues by mode and by time control`; `matchmaking.test.ts` > `never pairs across a mode or a time control`                                                                     |
| Section 9.2: ±100 widening by 50 every 10 seconds, capped at 400 | `pairing.test.ts` window suite; appendix P4.10 records that the cap is reached exactly when the window is removed                                                                                                                                       |
| Section 9.2: any opponent after 60 seconds                       | `pairing.test.ts` > `stops limiting the search after a minute (spec section 9.2)`; `phase4-exit-criteria.test.ts` widening test                                                                                                                         |
| Section 9.2: never paired with itself                            | `pairing.test.ts` > `refuses to pair a player with itself, however it was queued twice`                                                                                                                                                                 |
| Section 9.3: casual uses rating as a soft preference             | `pairing.test.ts` casual suite; appendix P4.4                                                                                                                                                                                                           |
| Section 9.4: colour assignment stored                            | `packages/db/src/schema.ts` `matches.color_assignment`; `matchmaking.test.ts` > `records that the colours were chosen at random (spec section 9.4)`; `rematch.test.ts` colour alternation test                                                          |
| Section 10: K factor 32, rounded, floored at zero                | `apps/server/src/rating/elo.ts`; `elo.test.ts`                                                                                                                                                                                                          |
| Section 10: ranked only, both sides accounts                     | `rating-service.test.ts` > `leaves ratings alone in a casual match between two accounts`, `leaves ratings alone when a seat is a guest, even in a ranked match`                                                                                         |
| Section 10: rating and match completion in one transaction       | `apps/server/src/match/runtime.ts` `settle()`; [ADR-0019](adr/0019-elo-in-the-completion-transaction.md); `rating-service.test.ts`                                                                                                                      |
| Section 4.5: 30 second rematch offer, colours alternate          | `apps/server/src/matchmaking/rematch.ts`; `rematch.test.ts`; appendix P4.11                                                                                                                                                                             |
| Section 15.4: ratings aggregate                                  | `packages/db/src/schema.ts`; `packages/db/test/ratings.test.ts`                                                                                                                                                                                         |
| Section 17.1: queue metrics                                      | `apps/server/src/socket/gateway.ts` pairing log; `socket-gateway.test.ts` > `logs each pairing with the wait it ended and the queues left behind`; `matchmaking.test.ts` > `reports depth per mode and time control (spec section 17.1)`; appendix P4.9 |

## 24. Phase 5 exit criteria (spec 24, as amended by appendix P5)

Test roots: `apps/web/test`, `packages/game-ui/test`, `packages/design-system/test`, `e2e/tests`.

Run the browser suite with `pnpm test:e2e` after `pnpm test:e2e:browsers`. It runs every
specification in Chromium and WebKit ([ADR-0021](adr/0021-playwright-browser-end-to-end-tests.md)).

| Criterion                                                | Evidence                                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete match playable in supported browsers            | `e2e/tests/full-match.spec.ts` > `two guests queue, play a whole match and take a rematch`, in Chromium and WebKit; `apps/web/test/phase5-exit-criteria.test.tsx` > `plays a complete match through the ordinary interface` |
| Complete match playable in macOS and Windows shells      | Deferred to Phase 8 with the engine-level substitute of appendix P5.1: WebKit is the macOS web view and Chromium the Windows one, and both play a complete match in `e2e/tests/full-match.spec.ts`                          |
| Hidden pieces never leak visually                        | `e2e/tests/hidden-pieces.spec.ts`; `apps/web/test/phase5-exit-criteria.test.tsx` > `never leaks a hidden piece`; `packages/game-ui/test/flat-board.test.tsx` > `never draws or names a covered piece`; appendix P5.5        |
| Client cannot issue disallowed moves through ordinary UI | `apps/web/test/phase5-exit-criteria.test.tsx` > `offers no disallowed move through ordinary input`; `packages/game-ui/test/interaction.test.tsx`; `packages/game-ui/test/board-model.test.ts`                               |
| Snapshot recovery renders correct state                  | `apps/web/test/phase5-exit-criteria.test.tsx` > `renders the state a recovered snapshot names`; `e2e/tests/reconnect.spec.ts`; `apps/web/test/match-channel.test.ts`                                                        |

The Phase 5 deliverables, and what holds each one:

| Specification requirement                                    | Where held                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 13.1: board scene, piece models, external stacks     | `packages/game-ui/src/scene/{description,layout}.ts`, `packages/game-ui/test/{scene-description,layout}.test.*`; appendices P5.2 and P5.18                                                                                      |
| Section 13.1: constrained camera, local reserve nearest      | `packages/game-ui/src/scene/camera.ts`, `packages/game-ui/test/{camera,projection}.test.ts`; appendices P5.3 and P5.18                                                                                                          |
| Section 13.3: piece selection and legal destination display  | `packages/game-ui/src/interaction/*`, `packages/game-ui/test/{interaction,flat-board}.test.tsx`; appendix P5.19                                                                                                                 |
| Section 13.3: pointer path in the WebGL tiers                | `packages/game-ui/src/scene/{BoardScene.tsx,projection.ts}`, `packages/game-ui/test/{projection,scene-focus}.test.*`, `e2e/tests/scene-pointer.spec.ts`; appendix P5.17 and [ADR-0025](adr/0025-the-canvas-owns-the-pointer.md) |
| Section 13.3: reveal-loss warning display                    | `packages/game-ui/test/flat-board.test.tsx` > `warns on a destination that loses by reveal`; `e2e/tests/reveal-warning.spec.ts`                                                                                                 |
| Section 13.3: keyboard path, Tab, arrows or WASD, Enter, Esc | `packages/game-ui/src/interaction/{use-board-interaction,use-cursor-focus}.ts`, `packages/game-ui/test/{flat-board,scene-focus}.test.tsx`, `e2e/tests/keyboard.spec.ts`; appendices P5.15 and P5.16                             |
| Section 13.4: move animation and reduced motion              | `packages/game-ui/src/scene/animation.ts`, `packages/game-ui/test/animation.test.ts`; appendix P5.10                                                                                                                            |
| Section 13.5: sound, channels and volumes                    | `packages/game-ui/src/sound/engine.ts`, `packages/game-ui/test/sound.test.ts`, `apps/web/test/sound.test.tsx`; appendices P5.6 and P5.7                                                                                         |
| Section 8.3: clock UI                                        | `packages/game-ui/src/{clock,use-clock-display}.ts`, `packages/game-ui/test/{clock,use-clock-display}.test.ts`; appendices P5.13 and P5.14                                                                                      |
| Section 7.4: reconnect UI and match status                   | `apps/web/src/screens/MatchScreen.tsx`, `apps/web/test/match-screen.test.tsx`, `e2e/tests/reconnect.spec.ts`                                                                                                                    |
| Section 13.6: win, loss and draw presentation                | `apps/web/test/match-screen.test.tsx` result suite; `e2e/tests/full-match.spec.ts`                                                                                                                                              |
| Section 13: rendering fallback                               | `packages/game-ui/src/tier.ts`, `packages/game-ui/test/{tier,board-view}.test.tsx`, `e2e/tests/rendering.spec.ts`; appendix P5.4 and [ADR-0023](adr/0023-rendering-tiers-and-a-flat-fallback-board.md)                          |
| Section 12: responsive desktop layout                        | `packages/design-system/src/tokens.css`, `apps/web/test/layout.test.tsx`; appendix P5.9                                                                                                                                         |
| Sections 4.1, 5.6, 11.1, 11.2: the way in and the account UI | `apps/web/test/{auth-screens,account-screens,play-screen}.test.tsx`; appendix P5.11                                                                                                                                             |

## 25. Phase 6 exit criteria (spec 24, as amended by appendix P6)

Test roots: `apps/server/test`, `packages/db/test`, `packages/protocol/test`, `apps/web/test`,
`e2e/tests`.

| Criterion                                                | Evidence                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Communication works and respects mute                    | `phase6-exit-criteria.test.ts` > `relays both channels, withholds the muted one and keeps no record of either`; `communication.test.ts`; `e2e/tests/communication.spec.ts`; `apps/web/test/match-communication.test.tsx`                                                |
| Achievement evaluation is idempotent                     | `phase6-exit-criteria.test.ts` > `awards the first victory once, however often the evaluation runs`; `achievements.test.ts` > `is idempotent when the same completed match is evaluated again`; `packages/db/src/repositories/achievements.ts` `on conflict do nothing` |
| Leaderboards are correct under concurrent rating updates | `phase6-exit-criteria.test.ts` > `answers every read with one order, and pages it without a gap or a repeat`; `packages/db/test/leaderboards.test.ts`; `apps/server/test/leaderboards.test.ts`                                                                          |
| No match replay is exposed to players                    | `phase6-exit-criteria.test.ts` > `hands a player a summary and a final position, and no list of moves`; `match-history.test.ts`; [ADR-0026](adr/0026-communication-is-relayed-never-stored.md)                                                                          |

The Phase 6 deliverables, and what holds each one:

| Specification requirement                                 | Where held                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Section 12.1: eight preset messages                       | `packages/protocol/src/constants.ts` `PRESET_MESSAGE_KEYS`, `apps/web/src/match/communication.ts`; `packages/protocol/test/communication.test.ts`; appendix P6.4                                                                                                         |
| Section 12.2: five reactions, no free text                | `packages/protocol/src/constants.ts` `REACTION_KEYS`; `apps/server/src/socket/gateway.ts` relay; `communication.test.ts`; appendix P6.1                                                                                                                                  |
| Section 12.3: each channel muted independently            | `apps/server/src/socket/communication.ts` `ChannelMutes`; `apps/web/src/match/CommunicationPanel.tsx`; `communication.test.ts` mute suite; appendices P6.2 and P6.3                                                                                                      |
| Section 12.4: a muted channel is never rendered or played | The server withholds the event, so nothing arrives to hide: `communication.test.ts` > `withholds the muted channel from the recipient and leaves the other alone`; `e2e/tests/communication.spec.ts`; appendix P6.2                                                      |
| Section 11.1: profile, badges, rank and recent matches    | `apps/server/src/identity/service.ts` `publicProfile`, `apps/web/src/screens/ProfileScreen.tsx`; `identity-api.test.ts` > `shows the badges, the all-time rank and the last five finished matches`; `apps/web/test/account-screens.test.tsx`; appendices P6.12 and P6.13 |
| Section 11.2: separate ranked and casual statistics       | `apps/server/src/identity/service.ts` `getMe`; `identity-api.test.ts` > `returns the account, its settings and an empty casual record`                                                                                                                                   |
| Section 11.3: daily, weekly, monthly and all-time boards  | `apps/server/src/leaderboard/{periods,service}.ts`, `packages/db/src/repositories/leaderboards.ts`; `packages/db/test/leaderboards.test.ts`; appendices P6.9, P6.10 and P6.11; [ADR-0028](adr/0028-leaderboards-are-read-time-queries.md)                                |
| Section 11.4: achievement system and badges               | `apps/server/src/achievements/{rules,service,lines}.ts`, `packages/protocol/src/achievements.ts`; `achievements.test.ts`; appendices P6.5 to P6.8; [ADR-0027](adr/0027-achievements-awarded-in-the-completion-transaction.md)                                            |
| Section 11.2: recent match summaries without the move log | `apps/server/src/match/history.ts`; `match-history.test.ts`; `apps/web/src/screens/HistoryScreen.tsx`; appendix P6.12                                                                                                                                                    |
| Section 13.5: the reaction sound                          | `apps/web/src/match/use-communication.ts`; `apps/web/test/match-communication.test.tsx` > sound suite; appendix P6.14                                                                                                                                                    |

## 26. Phase 7 exit criteria (spec 24, as amended by appendix P7)

Test roots: `apps/server/test`, `packages/db/test`, `packages/protocol/test`, `apps/web/test`,
`e2e/tests`.

| Criterion                                              | Evidence                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin actions are audited                              | `phase7-exit-criteria.test.ts` > `writes the change and its record together, or neither`, `keeps the audit log append-only: no endpoint edits or deletes a record`; `admin-api.test.ts`; `admin-grant.test.ts`; [ADR-0029](adr/0029-administration-is-a-role-on-the-account.md) |
| Backup restores into staging                           | `packages/db/test/backup-restore.test.ts` > `restores into another database and hands back the same match`; the round trip runs on every CI build; [ADR-0032](adr/0032-backups-are-scripts-proved-by-a-restore.md)                                                              |
| Alerts fire in controlled failure tests                | `alert-rules.test.ts`, one suite per condition of section 17.4; `phase7-exit-criteria.test.ts` > `turns a broken database into a readiness alert over the real exposition`, `turns failing requests into an error-rate alert`                                                   |
| Production deploy preserves or recovers active matches | `phase7-exit-criteria.test.ts` > `drains the queue, keeps the match, and lets the next instance answer for it`; `.github/workflows/deploy.yml`; appendix P7.16                                                                                                                  |

The Phase 7 deliverables, and what holds each one:

| Specification requirement                                   | Where held                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 16.1: admin dashboard behind a role                 | `apps/web/src/admin/{AdminGate,useAdminAccess}.tsx`, `apps/server/src/admin/guard.ts`; `apps/web/test/admin-screens.test.tsx`; `admin-api.test.ts` > the role suite; appendix P7.1                                                                                    |
| Section 16.2: user lookup and detail                        | `apps/server/src/admin/service.ts` `searchUsers`, `userDetail`; `apps/web/src/admin/{AdminUsersScreen,AdminUserScreen}.tsx`; `admin-api.test.ts`; appendix P7.2                                                                                                       |
| Section 16.3: suspension and reinstatement                  | `AdminService.suspend`, `AdminService.reinstate`; `admin-api.test.ts` > the moderation suite; `apps/web/test/admin-screens.test.tsx`                                                                                                                                  |
| Section 16.4: match inspection with its event log           | `AdminService.matchDetail`; `apps/web/src/admin/AdminMatchScreen.tsx`; `admin-api.test.ts` > `shows every event of one match with its state hash`; appendix P7.3                                                                                                      |
| Section 16.5: corrective rating adjustment                  | `AdminService.adjustRating`, `rating_adjustments`; `admin-api.test.ts`; appendix P7.4                                                                                                                                                                                 |
| Section 16.6: achievement management                        | `AdminService.createAchievement`, `updateAchievement`; `apps/web/src/admin/AdminAchievementsScreen.tsx`; appendix P7.5                                                                                                                                                |
| Section 16.7: operational summary                           | `AdminService.metricsSummary`, SQL over the deployment rather than one instance; `admin-api.test.ts`; appendix P7.13                                                                                                                                                  |
| Section 14.4: every administrative mutation is audited      | `packages/db/src/repositories/audit.ts`, the mutation and its record in one transaction; `phase7-exit-criteria.test.ts`; appendix P7.18                                                                                                                               |
| Section 17.1: structured logs with the pseudonym            | `apps/server/src/observability/{pseudonym,http}.ts`; `observability.test.ts`; appendix P7.12                                                                                                                                                                          |
| Section 17.2: Sentry and product analytics behind ports     | `apps/server/src/observability/{error-reporting,analytics,telemetry}.ts`, `apps/web/src/telemetry/*`; `observability.test.ts`, `telemetry-api.test.ts`, `apps/web/test/telemetry.test.tsx`; [ADR-0030](adr/0030-telemetry-behind-ports-relayed-through-the-server.md) |
| Section 17.3: the metrics endpoint                          | `apps/server/src/observability/metrics.ts`, `src/routes/metrics.ts`; `metrics-route.test.ts`; [ADR-0031](adr/0031-metrics-are-a-prometheus-exposition.md)                                                                                                             |
| Section 17.4: the alert conditions                          | `apps/server/src/observability/alerts.ts` rendered to `ops/alerts/gobblet.rules.yml` by `pnpm ops:alerts`; `alert-rules.test.ts`; appendix P7.15                                                                                                                      |
| Section 22.2: staging then production with an approval gate | `.github/workflows/deploy.yml`, `apps/server/src/ops/smoke.ts`; `smoke.test.ts`; appendix P7.16                                                                                                                                                                       |
| Section 23: backups, restore and the recovery rule          | `packages/db/src/backup.ts` and its three CLIs; `packages/db/test/backup-restore.test.ts`; [`operations.md` section 10](operations.md); appendix P7.17                                                                                                                |
