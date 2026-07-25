# Gobblet rules, formal statement

Status: authoritative for implementation.

Rule sources:

- Blue Orange Games, official English Gobblet rules:
  https://blueorangegames.eu/wp-content/uploads/2023/04/Gobblet-Rules-EN.pdf
- [`product-spec.md` section 3](product-spec.md#3-official-rules-as-software-requirements),
  which is the controlling restatement of those rules for this product.

This document describes standard 4x4 Gobblet as implemented by
`packages/game-core`, with stable rule identifiers so tests, code comments and
reviews can cite a single line. Each section names the specification subsection it
restates. Where the rules leave room for interpretation, the chosen reading is
recorded in [section 13](#13-open-questions-and-interpretations), also listed in
`product-spec.md` appendix P1, and referenced from the affected rule.

Every rule below is machine checked. `docs/traceability-matrix.md` maps each
identifier to the tests that hold it. [Section 16](#16-worked-edge-cases) works
through the edge cases with board diagrams, and
[section 17](#17-explicit-digital-adaptations) lists the deliberate departures
from the printed rules.

---

## 1. Equipment and setup (spec 3.1, 3.2)

| ID   | Rule                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| R1.1 | The board has 16 squares in a 4x4 grid.                                                                                  |
| R1.2 | Each player owns 12 pieces: sizes 1, 2, 3 and 4, three of each size.                                                     |
| R1.3 | The two players are named `light` and `dark`. Colour is a presentation concern; the engine uses these names.             |
| R1.4 | Each player's 12 pieces start off the board in three external stacks of four, ordered 1, 2, 3, 4 from bottom to top.     |
| R1.5 | The board starts empty.                                                                                                  |
| R1.6 | The first player is a match parameter. `light` is the default, `dark` is legal, and no rule depends on which one starts. |
| R1.7 | Sizes are strictly ordered: 1 < 2 < 3 < 4.                                                                               |

## 2. Coordinates, identities and notation (spec 3.2, 3.3)

| ID   | Rule                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2.1 | Squares are addressed `r<row>c<column>` with row and column in 0..3, for example `r0c0` and `r3c3`.                                                                                                 |
| R2.2 | Rows increase downwards and columns increase to the right, from the perspective of a fixed board frame that both clients share.                                                                     |
| R2.3 | There are exactly 10 lines: 4 rows (`row-0`..`row-3`), 4 columns (`column-0`..`column-3`) and 2 diagonals (`diagonal-0` = `r0c0`,`r1c1`,`r2c2`,`r3c3`; `diagonal-1` = `r0c3`,`r1c2`,`r2c1`,`r3c0`). |
| R2.4 | Every piece has a stable identity `<owner code><external stack><size>`, for example `L24` is the light size-4 piece that started in external stack 2. Identities never change during a match.       |
| R2.5 | A board square holds a stack of pieces ordered bottom to top. An external stack is ordered bottom to top as well.                                                                                   |
| R2.6 | Piece identity is presentation and audit data only. No rule distinguishes two pieces of the same owner and size (see R11.3).                                                                        |

## 3. Turn order (spec 3.3, 3.11)

| ID   | Rule                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| R3.1 | Players alternate turns.                                                                                          |
| R3.2 | A turn consists of exactly one move. There is no passing and no multi-move turn.                                  |
| R3.3 | The move must be made by the player to move; a move that references the opponent's pieces is illegal, not a pass. |
| R3.4 | After a nonterminal move the turn passes to the opponent.                                                         |
| R3.5 | After a terminal move the game ends and no further move is legal.                                                 |

## 4. Visibility (spec 3.3, 3.7)

| ID   | Rule                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4.1 | Only the topmost piece of a board stack is visible.                                                                                                |
| R4.2 | A square's visible owner and visible size are the owner and size of its topmost piece; an empty square has neither.                                |
| R4.3 | Covered pieces have no effect on lines, on legality of covering, or on winning, for as long as they stay covered.                                  |
| R4.4 | Only the topmost piece of an external stack is available to enter the board, so a player can enter sizes only in descending order from each stack. |

## 5. Move kind one: entering a piece from an external stack (spec 3.4, 3.5)

| ID   | Rule                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| R5.1 | The mover may take the exposed (topmost) piece of any of their non-empty external stacks and place it on the board.            |
| R5.2 | Entering onto an empty square is always legal.                                                                                 |
| R5.3 | Entering onto an occupied square is illegal, except under the defensive exception R6.1.                                        |
| R5.4 | An empty external stack cannot be used.                                                                                        |
| R5.5 | Entering a piece never moves anything else and never returns a piece to an external stack. Pieces never go back off the board. |

## 6. The defensive exception for entering pieces (spec 3.5)

| ID   | Rule                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6.1 | A piece entering from an external stack may cover an opponent piece only when the covered square belongs to a line in which the opponent already shows exactly three visible pieces.                          |
| R6.2 | The entering piece must still be strictly larger than the visible piece it covers.                                                                                                                            |
| R6.3 | A piece entering from an external stack may never cover one of the mover's own pieces, whatever the sizes are.                                                                                                |
| R6.4 | The three visible opponent pieces may lie in any row, column or diagonal that contains the covered square, and the covered square itself counts towards the three when the opponent's piece is visible on it. |
| R6.5 | The exception is evaluated on the position before the move. Threats that appear only after the move do not authorise it.                                                                                      |

Reading note: R6.4 counts exactly three visible opponent pieces on the line. A
line already holding four visible opponent pieces means the game has already
ended, so no such state can be the input of a move (see R12.4). Interpretation
Q1 records why "exactly three" and not "at least three".

## 7. Move kind two: moving a piece already on the board (spec 3.4, 3.6)

| ID   | Rule                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R7.1 | The mover may take the visible piece of a square whose visible piece they own, and place it on another square.                                                     |
| R7.2 | Only the visible piece moves. Pieces underneath stay where they are and the piece directly beneath becomes visible.                                                |
| R7.3 | The destination must be a different square than the source.                                                                                                        |
| R7.4 | The destination may be empty.                                                                                                                                      |
| R7.5 | The destination may hold a strictly smaller visible piece, which is then covered. This is legal whether the covered piece belongs to the opponent or to the mover. |
| R7.6 | Covering a visible piece of the same size or larger is illegal.                                                                                                    |
| R7.7 | A move that lifts a piece and reveals a line of four for the opponent is legal, but see R9.2.                                                                      |
| R7.8 | Moving a piece whose visible owner is the opponent is illegal, even when the mover owns a covered piece in that stack.                                             |

## 8. Winning (spec 3.7)

| ID   | Rule                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------- |
| R8.1 | A player wins when four of their pieces are visible on all four squares of a row, a column or a diagonal. |
| R8.2 | Visibility is what counts (R4.1): a line of four covered pieces is not a win.                             |
| R8.3 | A line is evaluated after the whole move is complete, never in the middle of it.                          |
| R8.4 | More than one line can be completed by a single move; all of them are reported, and the win is the same.  |

## 9. Revealing a line while moving, and outcome priority (spec 3.8, 3.11)

| ID   | Rule                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9.1 | Lifting a piece from a board square can reveal a covered piece and thereby complete a line of four for the opponent.                                                                                      |
| R9.2 | If, after the mover's complete move, the opponent shows a line of four, the opponent wins immediately, even though it was the mover's turn.                                                               |
| R9.3 | The mover may block the revealed line with the same move: if the piece is placed on a square of the revealed line and the line no longer shows four opponent pieces afterwards, the reveal has no effect. |
| R9.4 | If the completed move shows a line of four for both players, the opponent wins. The mover cannot win by uncovering the opponent's line.                                                                   |
| R9.5 | Outcome priority for a completed move is therefore: (1) opponent line of four, (2) mover line of four, (3) threefold repetition draw, (4) game continues.                                                 |
| R9.6 | The reveal loss is not a special move restriction: such moves stay legal and are offered to the mover, together with the information that they lose.                                                      |

## 10. Draws (spec 3.9)

| ID    | Rule                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------ |
| R10.1 | The game is drawn when the same position with the same player to move occurs for the third time. |
| R10.2 | The draw is automatic. Neither player has to claim it.                                           |
| R10.3 | The count is taken over positions reached during the match, including the starting position.     |
| R10.4 | A win takes precedence over a repetition draw reached by the same move (R9.5).                   |
| R10.5 | There is no material draw, no stalemate draw and no draw by agreement in this specification.     |

## 11. Position identity for repetition (spec 3.9)

| ID    | Rule                                                                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R11.1 | A position consists of the visible and covered contents of all 16 squares, the contents of the external stacks, and the player to move.                                                                                  |
| R11.2 | Clocks, ply counters, move history and player identities are not part of a position.                                                                                                                                     |
| R11.3 | The three external stacks of a player are interchangeable: what matters is how many pieces each still holds, not which physical stack they are. Position keys therefore encode the remaining counts in descending order. |
| R11.4 | Two states share a position key exactly when they are physically indistinguishable and the same player is to move.                                                                                                       |
| R11.5 | The canonical key format is `gp1:<16 squares>:<reserves>:<side to move>`, with squares separated by `/`, empty squares written `-`, and stacks written bottom to top as `<owner code><size>` pairs.                      |

## 12. State invariants (spec 6.3)

These hold for every state the engine produces or accepts.

| ID     | Rule                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| R12.1  | All 24 pieces are accounted for exactly once, either on the board or in an external stack.                                              |
| R12.2  | Each player owns exactly 12 pieces.                                                                                                     |
| R12.3  | A board stack is strictly ascending in size from bottom to top.                                                                         |
| R12.4  | An external stack holds sizes 1..k bottom to top for some k in 0..4; pieces leave it top first and never return.                        |
| R12.5  | An `in-progress` state shows no line of four for either player.                                                                         |
| R12.6  | A `win` state shows a line of four for the recorded winner.                                                                             |
| R12.7  | A `draw` state has a position whose occurrence count reached three.                                                                     |
| R12.8  | Occurrence counts are integers of at least one.                                                                                         |
| R12.9  | `ply` is a non-negative integer and increases by exactly one per accepted move.                                                         |
| R12.10 | The active player alternates after a nonterminal move and stays the mover on a terminal move, so the last mover is always identifiable. |

## 13. Open questions and interpretations

Each entry records an ambiguity, the reading this implementation uses, and how a
different reading would surface. The same list is recorded in `product-spec.md`
appendix P1, as required by specification section 30.

### Q1. "Potential winning line" for the defensive exception (spec 3.5)

The specification allows entering a piece from an external stack on top of an
opponent piece when the opponent "already has three visible pieces aligned in a
potential winning row, column, or diagonal", and requires the covered piece to be
part of that line. It does not say whether a line still counts as potentially
winning when its fourth square already holds one of the mover's pieces.

Chosen reading: it counts. The opponent can complete such a line by covering the
mover's piece, so the defensive entry stays available (R6.1, R6.4). Because the
covered piece is itself a visible opponent piece on the line, it is always one of
the three, which is exactly the requirement of section 3.5. Counting exactly
three rather than at least three makes no difference: a line showing four visible
opponent pieces cannot be the input of a move because that state is already
terminal (R12.5).

Reading not chosen: requiring the fourth square of the threat line to be empty.
That is a one-condition change in `hasThreeInLineThrough` and would remove
defensive entries in exactly the positions where the opponent threatens to gobble
into a win. Moves rejected under the chosen reading report
`reserve-cover-requires-opponent-three-line`.

### Q2. Reveal that completes lines for both players (spec 3.8, 3.11)

Section 3.8 states that completing the mover's own line elsewhere does not
override an unblocked revealed opponent line, and section 3.11 evaluates the
revealed line first. The engine follows that order, so the opponent wins (R9.4,
R9.5).

Recorded because the two statements could be read as conflicting with the
intuition that a completed line always wins, and because the priority is only
observable in this single combination. Step 7 of section 3.11 (opponent shows a
line that the mover did not reveal) is unreachable: a move only ever adds one of
the mover's own pieces to the top of a stack, so every opponent line visible after
a move was revealed by the lift phase.

### Q3. Position identity for repetition (spec 3.9)

Section 3.9 requires the canonical position to include "all external stacks in
order". An external stack always holds sizes 1..k bottom to top, so its whole
content is described by how many pieces remain, and the three stacks of a player
are physically interchangeable piles.

Chosen reading: the counts are sorted descending, so two physically
indistinguishable positions share one key (R11.1 to R11.4). Piece identity is
excluded, so entering the size-4 piece of stack 0 rather than stack 2 does not
create a "new" position.

Reading not chosen: keying on the stack index, which would treat the physically
identical positions "stack 0 empty" and "stack 2 empty" as different and would
delay or prevent some repetition draws. This is a one-line change in
`encodeReserves`.

### Q4. A player with no legal move (spec 3.4 to 3.6, 3.11)

No section describes a position in which the player to move has no legal move.
It requires all 12 of that player's pieces to be on the board with every one of
them covered.

Chosen reading: the engine reports zero legal moves and does not invent an
outcome. No such position has been produced by the nightly property runs. If the
match runtime ever observes one, the intended resolution is a draw, and it must
be added here and to the engine as an explicit rule rather than handled
implicitly by the server.

### Q5. Terminal states and the active player (spec 3.11)

Step 9 of section 3.11 switches turns only when the game continues, and nothing
states whose turn it is once the match has ended.

Chosen reading: a terminal state keeps the last mover as `activePlayer`
(R12.10), so clients and audit logs can attribute the final move without
consulting the event log.

## 14. Engine guarantees (spec 6.1, 6.2, 6.4)

These are implementation obligations that follow from the rules, and are held by
the same test suite.

| ID    | Rule                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R14.1 | The engine is pure: same input state and move gives the same output, with no clock, randomness, environment or I/O access.                    |
| R14.2 | States are deeply immutable. Applying a move returns a new state and never mutates the input.                                                 |
| R14.3 | Illegal moves are reported as typed reasons, never as exceptions.                                                                             |
| R14.4 | Every legal move is enumerable, and enumeration agrees with single-move evaluation for all 304 syntactically possible moves.                  |
| R14.5 | Serialization is canonical: equal states serialize to byte identical JSON, and a round trip restores an equal state.                          |
| R14.6 | The engine asserts its own state and transition invariants for every accepted move, so a rule bug fails loudly instead of corrupting a match. |

## 15. Formal state representation (spec 6.1)

```ts
type GameState = Readonly<{
  version: 1;
  board: Readonly<Record<Square, readonly PieceId[]>>; // bottom to top, R12.3
  reserves: Readonly<Record<Player, readonly [ReserveStack, ReserveStack, ReserveStack]>>;
  activePlayer: Player; // R3.1, R12.10
  ply: number; // R12.9
  repetition: Readonly<{ counts: Readonly<Record<string, number>> }>; // R10.1, R11.5
  status:
    | Readonly<{ kind: "in-progress" }>
    | Readonly<{ kind: "win"; winner: Player; reason: "line" | "revealed-line" }>
    | Readonly<{ kind: "draw"; reason: "threefold-repetition" }>;
}>;

type Square = `r${0 | 1 | 2 | 3}c${0 | 1 | 2 | 3}`; // R2.1
type PieceId = `${"L" | "D"}${0 | 1 | 2}${1 | 2 | 3 | 4}`; // R2.4
type Move =
  | Readonly<{ kind: "reserve"; reserveStack: 0 | 1 | 2; to: Square }> // section 5
  | Readonly<{ kind: "board"; from: Square; to: Square }>; // section 7
```

Reading the state:

- The visible piece of a square is the last entry of its stack (R4.1).
- The exposed piece of an external stack is its last entry, always the largest one
  still in that stack (R4.4, R12.4).
- A position key is derived from the board, the external stacks and the side to
  move only (R11.1, R11.5). It is the key used in `repetition.counts`.
- A move is described entirely by the state and the move value: the engine holds no
  selection state, no clock and no history (R14.1, section 17).

## 16. Worked edge cases

Diagrams show visible pieces only. `.` is an empty square, `L4` is a light size-4
piece, `(D3)` under a square lists a covered piece bottom to top. Rows run from
`r0` at the top to `r3` at the bottom.

### 16.1 Defensive entry from an external stack (spec 3.5, scenario B)

```
      c0    c1    c2    c3
r0 |  D3    D3    D3    .
r1 |  .     .     .     .
r2 |  .     D4    .     .
r3 |  D4    .     .     D4      light to move, exposed reserve size 4
```

Dark shows three visible pieces in `row-0`, so `row-0` is a potential winning line
through `r0c0`, `r0c1` and `r0c2`.

- Entering the size-4 reserve piece on `r0c3` is an ordinary empty-square entry
  (R5.2) that also removes the threat.
- Entering it on `r0c0`, `r0c1` or `r0c2` is the defensive exception (R6.1): the
  covered piece is smaller (R6.2) and lies on the threat line (R6.4).
- Entering it on `r2c1`, `r3c0` or `r3c3` is rejected with
  `reserve-cover-requires-opponent-three-line`: those squares carry no
  three-piece threat, and they hold size-4 pieces anyway (R6.2).
- With only two dark pieces in `row-0`, all covering entries are rejected (R5.3).

### 16.2 Reveal loss (spec 3.8, scenario D)

```
      c0    c1    c2    c3
r0 |  D3    D4    D4    L4        (r0c3 covers D3)
r1 |  .     .     .     .
r2 |  .     .     .     .
r3 |  .     .     .     .         light to move
```

Lifting `L4` from `r0c3` uncovers the dark size-3 piece and completes `row-0` for
dark (R9.1).

- Placing it on any square outside `row-0`, for example `r2c2`, leaves the line
  standing, so dark wins immediately with reason `revealed-line` (R9.2). The
  evaluation reports `consequence: "loses-by-reveal"` before the move is applied,
  so the client can warn (R9.6).
- The losing state keeps `light` as the active player, so the last mover stays
  identifiable (R12.10, Q5).

### 16.3 Reveal and block (spec 3.8, scenario E)

Same position as 16.2.

- Placing the lifted `L4` on `r0c0` covers a different dark piece of the same
  line, so `row-0` no longer shows four dark pieces and the game continues
  (R9.3). The evaluation reports the line in both `revealedOpponentLines` and
  `blockedOpponentLines`.
- `r0c1` cannot be used to block: its visible dark piece is also size 4, so
  covering it is rejected with `destination-piece-not-smaller` (R7.6).
- If the same blocking move completes a light line elsewhere, for example with
  light pieces already on `r1c1`, `r2c2` and `r3c3`, light wins by `line`
  (R9.5, priority 2).

### 16.4 Two revealed lines (spec 3.8)

```
      c0    c1    c2    c3
r0 |  L4    D4    D4    D4        (r0c0 covers D2)
r1 |  D3    .     .     .
r2 |  D3    .     .     .
r3 |  D3    .     .     .         light to move
```

Lifting `L4` from `r0c0` reveals a dark size-2 piece and completes both `row-0`
and `column-0`.

- Every destination of that piece loses, because a single placement can break at
  most one of the two lines (R9.2).
- Moving to `r1c0` blocks `column-0` only. The evaluation reports `column-0` in
  `blockedOpponentLines` and still ends the game for dark (R9.2).

### 16.5 Outcome priority when both players complete a line (spec 3.11, Q2)

```
      c0    c1    c2    c3
r0 |  .     L4    L4    L3
r1 |  .     .     .     .
r2 |  .     .     .     .
r3 |  D4    D4    D4    L4        (r3c3 covers D3)
```

Light moves the piece on `r3c3` to `r0c0`, which completes `row-0` for light and
`row-3` for dark at the same time. Dark wins: an unblocked revealed line outranks
the mover's own line (R9.4, R9.5).

### 16.6 Threefold repetition (spec 3.9, scenario F)

Two pieces shuffling between two empty squares return the position to a previous
one. The starting position counts as the first occurrence (R10.3), so the third
occurrence of the same position with the same side to move ends the match as a
draw (R10.1) without any claim (R10.2). Positions that differ only in which side
is to move are different positions (R11.4), and positions that differ in how many
pieces remain in the external stacks are different too (R11.1).

## 17. Explicit digital adaptations

| Adaptation                                             | Source    | Effect on the engine                                                                                                                                        |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection is a preview, not a touched-piece commitment | spec 3.10 | The engine has no notion of selection. A move exists only when a complete `Move` value is submitted, so cancelling a selection is a client concern (R14.1). |
| Automatic threefold repetition draw                    | spec 3.9  | Added on top of the printed rules to keep online matches finite. Implemented as a state-level counter, not a claim (R10.1, R10.2).                          |
| No draw by mutual agreement                            | spec 3.9  | The printed rules allow it; the MVP has no draw-offer control, so the engine has no draw offer (R10.5).                                                     |
| Resignation and timeout                                | spec 3.11 | Not board moves. They are match-level events owned by the server runtime and never enter the engine (spec 3.4).                                             |
| Colour naming                                          | spec 3.2  | Players are `light` and `dark` rather than physical colours, so presentation can change without touching the rules (R1.3).                                  |
