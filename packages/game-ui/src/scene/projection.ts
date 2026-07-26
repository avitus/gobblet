import { PerspectiveCamera, Vector3 as ThreeVector3 } from "three";
import { SQUARES } from "@gobblet/game-core";
import type { Player, ReserveStackIndex, Square } from "@gobblet/game-core";
import type { CameraPlacement } from "./camera";
import { RESERVE_PITCH, SQUARE_PITCH, reservePosition, squarePosition } from "./layout";
import type { Vector3 } from "./layout";

/**
 * The aspect ratio the scene container fixes in CSS. Because the ratio is fixed
 * rather than measured, where a square lands on screen is a pure function of the
 * camera placement, which is what makes this module testable without a browser.
 */
export const SCENE_ASPECT = 4 / 3;

/** A point on the canvas, in percentages of its width and height. */
export type ScreenPoint = Readonly<{ x: number; y: number }>;

/** A box on the canvas, in percentages, as CSS positions it. */
export type ScreenBox = Readonly<{ left: number; top: number; width: number; height: number }>;

export type SquareStop = Readonly<{ square: Square; box: ScreenBox }>;

export type ReserveStop = Readonly<{
  owner: Player;
  reserveStack: ReserveStackIndex;
  box: ScreenBox;
}>;

export type ProjectedStops = Readonly<{
  squares: readonly SquareStop[];
  reserves: readonly ReserveStop[];
}>;

/** How tall a reserve stop is made, in world units, so a piece fits inside it. */
const RESERVE_STOP_HEIGHT = 0.55;

const RESERVE_STACKS: readonly ReserveStackIndex[] = Object.freeze([0, 1, 2] as const);

function createCamera(placement: CameraPlacement, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(placement.fieldOfView, aspect, 0.1, 100);
  camera.position.set(...placement.position);
  camera.lookAt(new ThreeVector3(...placement.target));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function projectWith(camera: PerspectiveCamera, point: Vector3): ScreenPoint {
  const projected = new ThreeVector3(...point).project(camera);
  return { x: (projected.x + 1) * 50, y: (1 - projected.y) * 50 };
}

/** Where a world point lands on the canvas the same camera draws. */
export function projectPoint(
  placement: CameraPlacement,
  point: Vector3,
  aspect: number = SCENE_ASPECT,
): ScreenPoint {
  return projectWith(createCamera(placement, aspect), point);
}

function boxAround(centre: ScreenPoint, width: number, height: number): ScreenBox {
  return {
    left: centre.x - width / 2,
    top: centre.y - height / 2,
    width,
    height,
  };
}

/**
 * Where each square and each reserve stack lands on the canvas, so the transparent
 * keyboard stops can be laid over what is actually drawn. A stop is as wide as one
 * square pitch is at that depth, which is how a perspective board is approximated
 * by boxes: the near row is drawn wider than the far row, and so is its stop.
 */
export function projectStops(
  placement: CameraPlacement,
  aspect: number = SCENE_ASPECT,
): ProjectedStops {
  const camera = createCamera(placement, aspect);

  const squares = SQUARES.map((square): SquareStop => {
    const base = squarePosition(square);
    const centre = projectWith(camera, base);
    const acrossColumn = projectWith(camera, [base[0] + SQUARE_PITCH, base[1], base[2]]);
    const acrossRow = projectWith(camera, [base[0], base[1], base[2] + SQUARE_PITCH]);
    return {
      square,
      box: boxAround(centre, Math.abs(acrossColumn.x - centre.x), Math.abs(acrossRow.y - centre.y)),
    };
  });

  const reserves = (["light", "dark"] as const).flatMap((owner) =>
    RESERVE_STACKS.map((reserveStack): ReserveStop => {
      const base = reservePosition(owner, reserveStack);
      const centre = projectWith(camera, base);
      const neighbour = projectWith(camera, [base[0] + RESERVE_PITCH, base[1], base[2]]);
      const raised = projectWith(camera, [base[0], base[1] + RESERVE_STOP_HEIGHT, base[2]]);
      const height = Math.abs(raised.y - centre.y);
      return {
        owner,
        reserveStack,
        box: boxAround(
          { x: centre.x, y: centre.y - height / 2 },
          Math.abs(neighbour.x - centre.x),
          height,
        ),
      };
    }),
  );

  return { squares, reserves };
}
