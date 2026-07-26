import { SQUARES } from "@gobblet/game-core";
import { describe, expect, it } from "vitest";
import {
  CAMERA_AZIMUTH_LIMIT_DEGREES,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  placeCamera,
} from "../src/scene/camera";
import type { CameraOrbit } from "../src/scene/camera";
import {
  BOARD_SLAB_DEPTH,
  BOARD_SLAB_WIDTH,
  PIECE_DIMENSIONS,
  SQUARE_PITCH,
  reservePosition,
  squarePosition,
} from "../src/scene/layout";
import type { Vector3 } from "../src/scene/layout";
import { SCENE_ASPECT, projectPoint, projectStops } from "../src/scene/projection";
import type { ScreenBox } from "../src/scene/projection";

function centre(box: ScreenBox): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function stopFor(square: string, placement = placeCamera("light")): ScreenBox {
  const stop = projectStops(placement).squares.find((candidate) => candidate.square === square);
  if (stop === undefined) {
    throw new Error(`no stop for ${square}`);
  }
  return stop.box;
}

/** The outline of a largest piece standing on each reserve stack of both players. */
const RESERVE_SILHOUETTE: readonly Vector3[] = (["light", "dark"] as const).flatMap((owner) =>
  ([0, 1, 2] as const).flatMap((reserveStack): Vector3[] => {
    const [x, y, z] = reservePosition(owner, reserveStack);
    const { radius, height } = PIECE_DIMENSIONS[4];
    return [
      [x, y, z + radius],
      [x, y, z - radius],
      [x - radius, y, z],
      [x + radius, y, z],
      [x, y + height, z],
    ];
  }),
);

describe("projecting the board onto the canvas", () => {
  it("puts a stop where the camera draws its square", () => {
    const placement = placeCamera("light");

    for (const square of SQUARES) {
      const drawn = projectPoint(placement, squarePosition(square));
      const middle = centre(stopFor(square, placement));
      expect(middle.x).toBeCloseTo(drawn.x, 9);
      expect(middle.y).toBeCloseTo(drawn.y, 9);
    }
  });

  it("keeps every stop inside the canvas", () => {
    for (const seat of ["light", "dark"] as const) {
      const stops = projectStops(placeCamera(seat));
      for (const { box } of [...stops.squares, ...stops.reserves]) {
        expect(box.left).toBeGreaterThan(0);
        expect(box.top).toBeGreaterThan(0);
        expect(box.left + box.width).toBeLessThan(100);
        expect(box.top + box.height).toBeLessThan(100);
      }
    }
  });

  it("draws the near row lower and wider than the far row, as perspective does", () => {
    const far = stopFor("r0c0");
    const near = stopFor("r3c0");

    expect(centre(near).y).toBeGreaterThan(centre(far).y);
    expect(near.width).toBeGreaterThan(far.width);
    expect(centre(stopFor("r0c0")).x).toBeLessThan(centre(stopFor("r0c3")).x);
  });

  it("mirrors the board for a player seated as dark", () => {
    const light = projectStops(placeCamera("light"));
    const dark = projectStops(placeCamera("dark"));
    const lightNear = light.squares.find((stop) => stop.square === "r3c0")?.box;
    const darkNear = dark.squares.find((stop) => stop.square === "r0c3")?.box;

    expect(lightNear).toBeDefined();
    expect(darkNear).toBeDefined();
    expect(centre(darkNear as ScreenBox).y).toBeCloseTo(centre(lightNear as ScreenBox).y, 6);
    expect(centre(darkNear as ScreenBox).x).toBeCloseTo(centre(lightNear as ScreenBox).x, 6);
  });

  it("places the local reserve below the board and the opponent's above it", () => {
    const stops = projectStops(placeCamera("light"));
    const own = stops.reserves.filter((stop) => stop.owner === "light");
    const other = stops.reserves.filter((stop) => stop.owner === "dark");
    const nearRow = centre(stopFor("r3c0")).y;

    expect(own).toHaveLength(3);
    for (const stop of own) {
      expect(centre(stop.box).y).toBeGreaterThan(nearRow);
    }
    for (const stop of other) {
      expect(centre(stop.box).y).toBeLessThan(centre(stopFor("r0c0")).y);
    }
    expect(centre(own[0]?.box as ScreenBox).x).toBeLessThan(centre(own[2]?.box as ScreenBox).x);
  });

  it("reads the aspect ratio the scene container fixes, and any other it is given", () => {
    const placement = placeCamera("light");
    const wide = projectPoint(placement, squarePosition("r0c3"), 2);
    const standard = projectPoint(placement, squarePosition("r0c3"), SCENE_ASPECT);

    expect(SCENE_ASPECT).toBeCloseTo(4 / 3, 6);
    expect(wide.x - 50).toBeLessThan(standard.x - 50);
    expect(wide.y).toBeCloseTo(standard.y, 6);
  });

  it("frames the whole slab and every reserve piece, cropping neither row", () => {
    const halfWidth = BOARD_SLAB_WIDTH / 2;
    const halfDepth = BOARD_SLAB_DEPTH / 2;
    const corners: Vector3[] = [
      [-halfWidth, 0, halfDepth],
      [halfWidth, 0, halfDepth],
      [-halfWidth, 0, -halfDepth],
      [halfWidth, 0, -halfDepth],
    ];

    for (const seat of ["light", "dark"] as const) {
      const placement = placeCamera(seat);
      for (const point of [...corners, ...RESERVE_SILHOUETTE]) {
        const { x, y } = projectPoint(placement, point);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(100);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(100);
      }
    }
  });

  /**
   * A piece the camera has cropped cannot be picked up with the pointer, so the orbit
   * range is only as wide as keeps every piece on screen (appendix P5.18).
   */
  it("keeps every square and every reserve piece on screen throughout the orbit range", () => {
    const limit = CAMERA_AZIMUTH_LIMIT_DEGREES;
    const orbits: CameraOrbit[] = [
      { azimuthDegrees: 0, zoom: CAMERA_MAX_ZOOM },
      { azimuthDegrees: limit, zoom: CAMERA_MAX_ZOOM },
      { azimuthDegrees: -limit, zoom: CAMERA_MAX_ZOOM },
      { azimuthDegrees: limit, zoom: CAMERA_MIN_ZOOM },
      { azimuthDegrees: -limit, zoom: CAMERA_MIN_ZOOM },
    ];
    const points = [...SQUARES.map(squarePosition), ...RESERVE_SILHOUETTE];

    for (const seat of ["light", "dark"] as const) {
      for (const orbit of orbits) {
        const placement = placeCamera(seat, orbit);
        for (const point of points) {
          const { x, y } = projectPoint(placement, point);
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(100);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(100);
        }
      }
    }
  });

  /**
   * The lens is long enough that the reserve nearest the camera is not drawn far
   * larger than the one across the board (appendix P5.18).
   */
  it("draws the near reserve close in size to the far reserve", () => {
    const placement = placeCamera("light");
    const heightOf = (owner: "light" | "dark"): number => {
      const base = reservePosition(owner, 1);
      const foot = projectPoint(placement, base);
      const top = projectPoint(placement, [base[0], base[1] + PIECE_DIMENSIONS[4].height, base[2]]);
      return foot.y - top.y;
    };

    const ratio = heightOf("light") / heightOf("dark");
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.45);
  });

  it("keeps a square's stop no wider than the square it names", () => {
    const placement = placeCamera("light");
    const box = stopFor("r1c1", placement);
    const neighbour = projectPoint(placement, [
      squarePosition("r1c1")[0] + SQUARE_PITCH,
      squarePosition("r1c1")[1],
      squarePosition("r1c1")[2],
    ]);

    expect(box.width).toBeCloseTo(Math.abs(neighbour.x - centre(box).x), 6);
  });
});
