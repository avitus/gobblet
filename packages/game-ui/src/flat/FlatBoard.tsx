import type { Player } from "@gobblet/game-core";
import { useRef } from "react";
import type { BoardInteraction } from "../interaction/use-board-interaction";
import type { Origin, VisibleReserveStack, VisibleSquare } from "../interaction/board-model";
import { reserveLabel, squareLabel } from "../interaction/labels";
import { handleBoardKey } from "../interaction/use-board-interaction";
import { useCursorFocus } from "../interaction/use-cursor-focus";
import styles from "./FlatBoard.module.css";

export type FlatBoardProps = Readonly<{
  interaction: BoardInteraction;
  /** The seat the local player holds, or `null` while watching. */
  seat: Player | null;
}>;

/**
 * The tier that needs no WebGL (docs/adr/0023). It draws only the top piece of a
 * stack, so a covered piece is neither shown nor described (appendix P5.5), and it
 * is a first-class target: the end-to-end suite plays a whole match here.
 */
export function FlatBoard({ interaction, seat }: FlatBoardProps): React.JSX.Element {
  const { model } = interaction;
  const board = useRef<HTMLDivElement>(null);
  const squareRefs = useCursorFocus(board, interaction.cursor);
  const rows = [0, 1, 2, 3].map((row) => model.squares.slice(row * 4, row * 4 + 4));
  const reservesFor = (owner: Player): readonly VisibleReserveStack[] =>
    model.reserves.filter((stack) => stack.owner === owner);
  const opponent: Player = seat === "dark" ? "light" : "dark";
  const near: Player = seat ?? "light";

  return (
    <div
      ref={board}
      className={styles.board}
      data-testid="flat-board"
      data-tier="flat"
      onKeyDown={(event) => {
        if (handleBoardKey(interaction, { key: event.key, shiftKey: event.shiftKey })) {
          event.preventDefault();
        }
      }}
    >
      <ReserveRow
        label={`${opponent} reserve`}
        stacks={reservesFor(opponent)}
        interaction={interaction}
      />

      <div className={styles.grid} role="grid" aria-label="Board">
        {rows.map((row, index) => (
          <div className={styles.row} role="row" key={`row-${String(index)}`}>
            {row.map((square) => (
              <SquareCell
                key={square.square}
                square={square}
                interaction={interaction}
                register={(element) => {
                  squareRefs.current.set(square.square, element);
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <ReserveRow label={`${near} reserve`} stacks={reservesFor(near)} interaction={interaction} />
    </div>
  );
}

type ReserveRowProps = Readonly<{
  label: string;
  stacks: readonly VisibleReserveStack[];
  interaction: BoardInteraction;
}>;

function ReserveRow({ label, stacks, interaction }: ReserveRowProps): React.JSX.Element {
  return (
    <div className={styles.reserves} aria-label={label} role="group">
      {stacks.map((stack) => {
        const origin: Origin = {
          kind: "reserve",
          owner: stack.owner,
          reserveStack: stack.reserveStack,
        };
        const movable = interaction.isMovable(origin);
        const selected =
          interaction.selected?.kind === "reserve" && movable
            ? interaction.selected.reserveStack === stack.reserveStack &&
              interaction.selected.owner === stack.owner
            : false;

        return (
          <button
            key={`${stack.owner}-${String(stack.reserveStack)}`}
            type="button"
            className={styles.reserveStack}
            data-testid={`reserve-${stack.owner}-${String(stack.reserveStack)}`}
            data-owner={stack.owner}
            data-size={stack.piece === null ? undefined : String(stack.piece.size)}
            data-movable={movable ? "true" : "false"}
            data-selected={selected ? "true" : "false"}
            data-hovered={interaction.isHovered(origin) ? "true" : "false"}
            disabled={stack.piece === null || !movable || interaction.locked}
            aria-label={reserveLabel(stack)}
            onMouseEnter={() => interaction.hover(origin)}
            onMouseLeave={() => interaction.hover(null)}
            onClick={() => interaction.choose(origin)}
          >
            {stack.piece === null ? "" : String(stack.piece.size)}
          </button>
        );
      })}
    </div>
  );
}

type SquareCellProps = Readonly<{
  square: VisibleSquare;
  interaction: BoardInteraction;
  register: (element: HTMLButtonElement | null) => void;
}>;

function SquareCell({ square, interaction, register }: SquareCellProps): React.JSX.Element {
  const origin: Origin = { kind: "board", square: square.square };
  const destination = interaction.destinationAt(square.square);
  const selected =
    interaction.selected?.kind === "board" && interaction.selected.square === square.square;
  const movable = interaction.isMovable(origin);

  return (
    <button
      ref={register}
      type="button"
      role="gridcell"
      className={styles.square}
      data-testid={`square-${square.square}`}
      data-square={square.square}
      data-owner={square.piece?.owner ?? "empty"}
      data-size={square.piece === null ? undefined : String(square.piece.size)}
      data-movable={movable ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-hovered={interaction.isHovered(origin) ? "true" : "false"}
      data-destination={destination ? "true" : "false"}
      data-reveal-loss={destination?.losesByReveal ? "true" : "false"}
      data-cursor={interaction.cursor === square.square ? "true" : "false"}
      aria-label={squareLabel(square, destination?.losesByReveal ?? false)}
      aria-pressed={selected}
      disabled={interaction.locked || (!movable && destination === null)}
      onMouseEnter={() => interaction.hover(origin)}
      onMouseLeave={() => interaction.hover(null)}
      onFocus={() => interaction.focusSquare(square.square)}
      onClick={() => interaction.chooseSquare(square.square)}
    >
      <span aria-hidden="true">{square.piece === null ? "" : String(square.piece.size)}</span>
    </button>
  );
}
