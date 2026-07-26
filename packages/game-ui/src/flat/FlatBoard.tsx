import type { Player } from "@gobblet/game-core";
import type { BoardInteraction } from "../interaction/use-board-interaction";
import type { Origin, VisibleReserveStack, VisibleSquare } from "../interaction/board-model";
import { handleBoardKey } from "../interaction/use-board-interaction";
import styles from "./FlatBoard.module.css";

export type FlatBoardProps = Readonly<{
  interaction: BoardInteraction;
  /** The seat the local player holds, or `null` while watching. */
  seat: Player | null;
}>;

const SIZE_LABELS = Object.freeze({ 1: "smallest", 2: "small", 3: "large", 4: "largest" });

function pieceLabel(owner: Player, size: 1 | 2 | 3 | 4): string {
  return `${owner} ${SIZE_LABELS[size]}`;
}

/**
 * The tier that needs no WebGL (docs/adr/0023). It draws only the top piece of a
 * stack, so a covered piece is neither shown nor described (appendix P5.5), and it
 * is a first-class target: the end-to-end suite plays a whole match here.
 */
export function FlatBoard({ interaction, seat }: FlatBoardProps): React.JSX.Element {
  const { model } = interaction;
  const rows = [0, 1, 2, 3].map((row) => model.squares.slice(row * 4, row * 4 + 4));
  const reservesFor = (owner: Player): readonly VisibleReserveStack[] =>
    model.reserves.filter((stack) => stack.owner === owner);
  const opponent: Player = seat === "dark" ? "light" : "dark";
  const near: Player = seat ?? "light";

  return (
    <div
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
              <SquareCell key={square.square} square={square} interaction={interaction} />
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
            aria-label={
              stack.piece === null
                ? `${stack.owner} reserve stack ${String(stack.reserveStack + 1)}, empty`
                : `${pieceLabel(stack.owner, stack.piece.size)}, ${String(stack.remaining)} left`
            }
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
}>;

function SquareCell({ square, interaction }: SquareCellProps): React.JSX.Element {
  const origin: Origin = { kind: "board", square: square.square };
  const destination = interaction.destinationAt(square.square);
  const selected =
    interaction.selected?.kind === "board" && interaction.selected.square === square.square;
  const movable = interaction.isMovable(origin);

  return (
    <button
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
      aria-label={describeSquare(square, destination?.losesByReveal ?? false)}
      aria-pressed={selected}
      disabled={interaction.locked || (!movable && destination === null)}
      onMouseEnter={() => interaction.hover(origin)}
      onMouseLeave={() => interaction.hover(null)}
      onClick={() => interaction.chooseSquare(square.square)}
    >
      <span aria-hidden="true">{square.piece === null ? "" : String(square.piece.size)}</span>
    </button>
  );
}

/**
 * Names only what is visible. The height of a stack is describable because a
 * player can see it, but the identity of a covered piece is not (appendix P5.5).
 */
function describeSquare(square: VisibleSquare, losesByReveal: boolean): string {
  const place = `Square ${square.square}`;
  const content =
    square.piece === null
      ? "empty"
      : `${pieceLabel(square.piece.owner, square.piece.size)}${square.height > 1 ? `, covering ${String(square.height - 1)}` : ""}`;
  return losesByReveal ? `${place}, ${content}, loses by reveal` : `${place}, ${content}`;
}
