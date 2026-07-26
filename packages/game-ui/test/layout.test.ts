import { describe, expect, it } from "vitest";
import {
  BOARD_HALF_SPAN,
  BOARD_SLAB_DEPTH,
  BOARD_SLAB_WIDTH,
  BOARD_SURFACE_HEIGHT,
  GROOVE_DEPTH,
  PIECE_DIMENSIONS,
  PIECE_TAPER,
  RESERVE_PITCH,
  RESERVE_ROW_OFFSET,
  RESERVE_ZONE_DEPTH,
  SELECTION_LIFT,
  SQUARE_PITCH,
  grooveHeights,
  inlayRadius,
  lift,
  pieceProfile,
  reservePosition,
  squarePosition,
} from "../src/scene/layout";
import type { PieceSizeKey } from "../src/scene/layout";

const SIZES: readonly PieceSizeKey[] = [1, 2, 3, 4];

describe("the board layout", () => {
  it("stands every piece on the playing surface", () => {
    expect(squarePosition("r0c0")).toEqual([
      -BOARD_HALF_SPAN,
      BOARD_SURFACE_HEIGHT,
      -BOARD_HALF_SPAN,
    ]);
    expect(squarePosition("r3c3")).toEqual([
      BOARD_HALF_SPAN,
      BOARD_SURFACE_HEIGHT,
      BOARD_HALF_SPAN,
    ]);
    expect(reservePosition("light", 1)[2]).toBe(RESERVE_ROW_OFFSET);
    expect(reservePosition("dark", 1)[2]).toBe(-RESERVE_ROW_OFFSET);
    expect(lift(squarePosition("r0c0"))[1]).toBeCloseTo(BOARD_SURFACE_HEIGHT + SELECTION_LIFT, 6);
  });

  it("keeps the largest piece inside its square", () => {
    expect(PIECE_DIMENSIONS[4].radius * 2).toBeLessThan(SQUARE_PITCH * 0.94);
  });

  it("carries the grid and both reserve rows on one slab", () => {
    const widest = PIECE_DIMENSIONS[4].radius;
    const gridEdge = BOARD_HALF_SPAN + SQUARE_PITCH / 2;

    expect(BOARD_SLAB_DEPTH / 2).toBeGreaterThanOrEqual(RESERVE_ROW_OFFSET + widest);
    expect(BOARD_SLAB_WIDTH / 2).toBeGreaterThan(gridEdge);
    expect(BOARD_SLAB_WIDTH / 2).toBeGreaterThan(RESERVE_PITCH + widest);
    expect(RESERVE_ROW_OFFSET - RESERVE_ZONE_DEPTH / 2).toBeGreaterThanOrEqual(gridEdge);
    expect(RESERVE_ZONE_DEPTH / 2).toBeGreaterThanOrEqual(widest);
  });

  it("separates the four sizes by both width and height", () => {
    for (const size of [2, 3, 4] as const) {
      const smaller = PIECE_DIMENSIONS[(size - 1) as PieceSizeKey];
      const larger = PIECE_DIMENSIONS[size];
      expect(larger.radius - smaller.radius).toBeGreaterThanOrEqual(0.07);
      expect(larger.height - smaller.height).toBeGreaterThanOrEqual(0.09);
      expect(inlayRadius(size)).toBeGreaterThan(inlayRadius((size - 1) as PieceSizeKey));
    }
  });
});

describe("the piece profile", () => {
  it("closes the surface at both ends, so a piece is solid from every angle", () => {
    for (const size of SIZES) {
      const profile = pieceProfile(size);
      const first = profile.at(0);
      const last = profile.at(-1);

      expect(first?.[0]).toBe(0);
      expect(first?.[1]).toBe(0);
      expect(last?.[0]).toBe(0);
      expect(last?.[1]).toBe(PIECE_DIMENSIONS[size].height);
    }
  });

  it("rises without ever turning back on itself", () => {
    for (const size of SIZES) {
      const heights = pieceProfile(size).map(([, height]) => height);
      for (let index = 1; index < heights.length; index += 1) {
        expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1] as number);
      }
    }
  });

  it("is widest at the open base and narrowest at the closed top", () => {
    for (const size of SIZES) {
      const { radius, height } = PIECE_DIMENSIONS[size];
      const radii = pieceProfile(size).map(([wall]) => wall);

      expect(Math.max(...radii)).toBeCloseTo(radius, 6);
      const nearTop = pieceProfile(size).filter(([, at]) => at > height * 0.9);
      for (const [wall] of nearTop) {
        expect(wall).toBeLessThanOrEqual(radius * PIECE_TAPER + 0.02);
      }
    }
  });

  it("turns one groove for the smallest piece and four for the largest", () => {
    for (const size of SIZES) {
      const grooves = grooveHeights(size);
      expect(grooves).toHaveLength(size);

      const { height } = PIECE_DIMENSIONS[size];
      for (const at of grooves) {
        expect(at).toBeGreaterThan(height * 0.15);
        expect(at).toBeLessThan(height * 0.85);
      }
      for (let index = 1; index < grooves.length; index += 1) {
        expect(grooves[index]).toBeGreaterThan(grooves[index - 1] as number);
      }
    }
  });

  it("cuts each groove into the wall rather than out of it", () => {
    const profile = pieceProfile(3);
    const grooves = grooveHeights(3);

    for (const at of grooves) {
      const index = profile.findIndex(([, height]) => height === at);
      const before = profile[index - 1];
      const groove = profile[index];
      const after = profile[index + 1];

      expect(groove?.[0]).toBeLessThan(before?.[0] as number);
      expect(groove?.[0]).toBeLessThan(after?.[0] as number);
      expect((before?.[0] as number) - (groove?.[0] as number)).toBeGreaterThanOrEqual(
        GROOVE_DEPTH - 0.01,
      );
    }
  });
});
