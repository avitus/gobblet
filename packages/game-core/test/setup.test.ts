import { describe, expect, it } from "vitest";
import {
  LINES,
  PIECES,
  PIECES_PER_PLAYER,
  PIECE_BY_ID,
  PIECE_SIZES,
  PLAYERS,
  PLAYER_BY_CODE,
  PLAYER_CODES,
  RESERVE_STACK_INDEXES,
  SQUARES,
  TOTAL_PIECES,
  canonicalPositionKey,
  createFullReserves,
  createInitialGame,
  getExposedReservePieceId,
  getPiece,
  getReserveStack,
  getStack,
  getVisibleOwner,
  getVisiblePieceId,
  getVisibleSize,
  getWinningLines,
  hasThreeInLineThrough,
  isGameOver,
  isPieceId,
  isPlayer,
  isReserveStackIndex,
  isSquare,
  otherPlayer,
  squareAt,
  topPieceOnBoard,
  visibleOwnerOnBoard,
  visibleSizeOnBoard,
  winningLinesOnBoard,
} from "../src/index";
import { buildState } from "./helpers/build-state";

describe("board geometry", () => {
  it("exposes sixteen unique squares in canonical order", () => {
    expect(SQUARES).toHaveLength(16);
    expect(new Set(SQUARES).size).toBe(16);
    expect(SQUARES[0]).toBe("r0c0");
    expect(SQUARES[15]).toBe("r3c3");
  });

  it("exposes the ten winning lines", () => {
    expect(LINES).toHaveLength(10);
    expect(LINES.filter((line) => line.kind === "row")).toHaveLength(4);
    expect(LINES.filter((line) => line.kind === "column")).toHaveLength(4);
    expect(LINES.filter((line) => line.kind === "diagonal")).toHaveLength(2);

    for (const line of LINES) {
      expect(line.squares).toHaveLength(4);
      expect(new Set(line.squares).size).toBe(4);
      for (const square of line.squares) {
        expect(isSquare(square)).toBe(true);
      }
    }

    expect(new Set(LINES.map((line) => line.id)).size).toBe(10);
  });

  it("resolves squares from coordinates and validates unknown input", () => {
    expect(squareAt(0, 0)).toBe("r0c0");
    expect(squareAt(2, 3)).toBe("r2c3");
    expect(isSquare("r0c0")).toBe(true);
    expect(isSquare("r4c0")).toBe(false);
    expect(isSquare(42)).toBe(false);
  });

  it("keeps geometry constants frozen", () => {
    expect(Object.isFrozen(SQUARES)).toBe(true);
    expect(Object.isFrozen(LINES)).toBe(true);
    expect(Object.isFrozen(LINES[0])).toBe(true);
  });
});

describe("piece model", () => {
  it("defines twenty-four pieces, twelve per player", () => {
    expect(PIECES).toHaveLength(TOTAL_PIECES);
    expect(new Set(PIECES.map((piece) => piece.id)).size).toBe(TOTAL_PIECES);

    for (const player of PLAYERS) {
      expect(PIECES.filter((piece) => piece.owner === player)).toHaveLength(PIECES_PER_PLAYER);
    }
  });

  it("gives every player three external stacks holding one piece of each size", () => {
    for (const player of PLAYERS) {
      for (const reserveStack of RESERVE_STACK_INDEXES) {
        const sizes = PIECES.filter(
          (piece) => piece.owner === player && piece.reserveStack === reserveStack,
        ).map((piece) => piece.size);
        expect([...sizes].sort()).toEqual([...PIECE_SIZES]);
      }
    }
  });

  it("resolves pieces by identity", () => {
    expect(getPiece("L04")).toEqual({ id: "L04", owner: "light", size: 4, reserveStack: 0 });
    expect(getPiece("D21")).toEqual({ id: "D21", owner: "dark", size: 1, reserveStack: 2 });
    expect(PIECE_BY_ID.L04.owner).toBe("light");
    expect(Object.isFrozen(PIECE_BY_ID.L04)).toBe(true);
  });

  it("validates piece identifiers", () => {
    expect(isPieceId("L04")).toBe(true);
    expect(isPieceId("L05")).toBe(false);
    expect(isPieceId("X04")).toBe(false);
    expect(isPieceId(4)).toBe(false);
  });

  it("validates reserve stack indexes", () => {
    expect(isReserveStackIndex(0)).toBe(true);
    expect(isReserveStackIndex(1)).toBe(true);
    expect(isReserveStackIndex(2)).toBe(true);
    expect(isReserveStackIndex(3)).toBe(false);
    expect(isReserveStackIndex("0")).toBe(false);
  });
});

describe("players", () => {
  it("maps players to codes in both directions", () => {
    expect(PLAYER_CODES.light).toBe("L");
    expect(PLAYER_CODES.dark).toBe("D");
    expect(PLAYER_BY_CODE.L).toBe("light");
    expect(PLAYER_BY_CODE.D).toBe("dark");
  });

  it("validates players and alternates them", () => {
    expect(isPlayer("light")).toBe(true);
    expect(isPlayer("dark")).toBe(true);
    expect(isPlayer("green")).toBe(false);
    expect(otherPlayer("light")).toBe("dark");
    expect(otherPlayer("dark")).toBe("light");
  });
});

describe("initial position", () => {
  it("starts with an empty board and three full external stacks per player", () => {
    const state = createInitialGame("light");

    for (const square of SQUARES) {
      expect(getStack(state, square)).toEqual([]);
      expect(getVisiblePieceId(state, square)).toBeNull();
      expect(getVisibleOwner(state, square)).toBeNull();
      expect(getVisibleSize(state, square)).toBeNull();
    }

    for (const player of PLAYERS) {
      for (const reserveStack of RESERVE_STACK_INDEXES) {
        const stack = getReserveStack(state, player, reserveStack);
        expect(stack.map((id) => getPiece(id).size)).toEqual([1, 2, 3, 4]);
        expect(getExposedReservePieceId(state, player, reserveStack)).toBe(stack[3]);
        expect(getPiece(stack[3]!).size).toBe(4);
      }
    }

    expect(state.activePlayer).toBe("light");
    expect(state.ply).toBe(0);
    expect(state.status).toEqual({ kind: "in-progress" });
    expect(isGameOver(state)).toBe(false);
    expect(state.repetition.counts).toEqual({ [canonicalPositionKey(state)]: 1 });
    expect(getWinningLines(state, "light")).toEqual([]);
    expect(getWinningLines(state, "dark")).toEqual([]);
  });

  it("accounts for all twenty-four pieces", () => {
    const state = createInitialGame("dark");
    const onBoard = SQUARES.flatMap((square) => [...getStack(state, square)]);
    const inReserve = PLAYERS.flatMap((player) =>
      RESERVE_STACK_INDEXES.flatMap((index) => [...getReserveStack(state, player, index)]),
    );

    expect(onBoard).toHaveLength(0);
    expect(inReserve).toHaveLength(TOTAL_PIECES);
    expect(new Set(inReserve).size).toBe(TOTAL_PIECES);
    expect(state.activePlayer).toBe("dark");
  });

  it("produces different position keys for each side to move", () => {
    expect(canonicalPositionKey(createInitialGame("light"))).not.toBe(
      canonicalPositionKey(createInitialGame("dark")),
    );
  });

  it("builds full reserves independently of any game state", () => {
    const reserves = createFullReserves();
    expect(reserves.light[0].map((id) => getPiece(id).size)).toEqual([1, 2, 3, 4]);
    expect(reserves.dark[2].map((id) => getPiece(id).reserveStack)).toEqual([2, 2, 2, 2]);
  });

  it("returns immutable state", () => {
    const state = createInitialGame("light");
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.board)).toBe(true);
    expect(Object.isFrozen(state.reserves.light)).toBe(true);
    expect(() => {
      (state as { ply: number }).ply = 5;
    }).toThrow(TypeError);
  });
});

describe("visibility queries", () => {
  const state = buildState({
    board: {
      r0c0: ["L2", "L4"],
      r1c1: ["D4"],
      r2c2: ["D3"],
      r3c3: ["D3"],
    },
    park: { light: ["r3c1"], dark: ["r1c0"] },
  });

  it("reports only the top piece of a stack", () => {
    expect(getStack(state, "r0c0")).toHaveLength(2);
    expect(getVisibleSize(state, "r0c0")).toBe(4);
    expect(getVisibleOwner(state, "r0c0")).toBe("light");
    expect(getVisibleOwner(state, "r0c1")).toBeNull();
  });

  it("exposes board level queries for previews", () => {
    expect(topPieceOnBoard(state.board, "r1c1")).toBe(getVisiblePieceId(state, "r1c1"));
    expect(visibleOwnerOnBoard(state.board, "r1c1")).toBe("dark");
    expect(visibleSizeOnBoard(state.board, "r1c1")).toBe(4);
    expect(visibleSizeOnBoard(state.board, "r0c3")).toBeNull();
    expect(winningLinesOnBoard(state.board, "dark")).toEqual([]);
  });

  it("detects lines where a player already shows three visible pieces", () => {
    // Dark shows r1c1, r2c2 and r3c3, so every square of that diagonal qualifies.
    expect(hasThreeInLineThrough(state.board, "dark", "r1c1")).toBe(true);
    expect(hasThreeInLineThrough(state.board, "dark", "r0c1")).toBe(false);
    expect(hasThreeInLineThrough(state.board, "light", "r0c0")).toBe(false);
  });

  it("reports an empty external stack as having no exposed piece", () => {
    const emptied = buildState({ board: { r0c0: ["L1", "L2", "L3", "L4"] } });
    expect(getReserveStack(emptied, "light", 0)).toEqual([]);
    expect(getExposedReservePieceId(emptied, "light", 0)).toBeNull();
    expect(getExposedReservePieceId(emptied, "light", 1)).not.toBeNull();
  });
});
