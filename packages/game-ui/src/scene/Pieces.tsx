import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { DoubleSide, Vector2 } from "three";
import type { CameraPlacement } from "./camera";
import type { PieceNode, SquareNode } from "./description";
import {
  BOARD_SLAB_DEPTH,
  BOARD_SLAB_WIDTH,
  BOARD_THICKNESS,
  RESERVE_PITCH,
  RESERVE_ROW_OFFSET,
  RESERVE_ZONE_DEPTH,
  SQUARE_PITCH,
  TABLE_SPAN,
  inlayRadius,
  pieceProfile,
} from "./layout";

/**
 * Everything the WebGL tiers draw with Three.js. It is kept apart from the scene
 * component because it needs a graphics context, which means the browser suite of
 * ADR-0021 proves it rather than the unit suite.
 */

/**
 * The wood of a square, matching the flat tier's board token. The grid reads from the
 * darker slab showing between the squares, as it does on a real set, rather than from
 * alternating shades: two shades close enough to look like one wood were invisible,
 * and two far enough apart to see read as a draughts board (appendix P5.18).
 */
const SQUARE_COLOUR = "#8a6238";

/** Highlight colours, matching the destination and focus tokens of ADR-0013. */
const HIGHLIGHT_COLOURS = Object.freeze({
  legal: "#6fbf73",
  warning: "#d9736a",
  cursor: "#f0c987",
});

const TILE_SPAN = SQUARE_PITCH * 0.94;
/** Width of the marked rim, which leaves the wood of the square itself visible. */
const TILE_RIM = SQUARE_PITCH * 0.06;

const PIECE_COLOURS = Object.freeze({ light: "#e4c79a", dark: "#6b4326" });

/** The inlay on a piece's top, darker on light wood and lighter on dark wood. */
const INLAY_COLOURS = Object.freeze({ light: "#c19a63", dark: "#966438" });

/**
 * Aims the camera at the placement the seat asks for. React Three Fiber points a
 * camera it creates at the origin, and this scene looks slightly past it towards
 * the seated player's own reserve (appendix P5.18).
 */
export function CameraRig({ placement }: Readonly<{ placement: CameraPlacement }>): null {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    camera.position.set(...placement.position);
    camera.lookAt(...placement.target);
    camera.updateProjectionMatrix();
  }, [camera, placement]);

  return null;
}

/** The table the board stands on, so the slab reads as an object and not a void. */
export function Table(): React.JSX.Element {
  return (
    <mesh position={[0, -BOARD_THICKNESS - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[TABLE_SPAN, TABLE_SPAN]} />
      <meshStandardMaterial color="#2a1f18" roughness={0.95} />
    </mesh>
  );
}

/** The one slab that carries the grid and both reserve rows. */
export function BoardSlab({ shadows }: Readonly<{ shadows: boolean }>): React.JSX.Element {
  return (
    <mesh position={[0, -BOARD_THICKNESS / 2, 0]} receiveShadow={shadows}>
      <boxGeometry args={[BOARD_SLAB_WIDTH, BOARD_THICKNESS, BOARD_SLAB_DEPTH]} />
      <meshStandardMaterial color="#4a3323" roughness={0.65} metalness={0.05} />
    </mesh>
  );
}

/** The inlay that marks where a player's reserve stands on the slab. */
export function ReserveZone({ side }: Readonly<{ side: 1 | -1 }>): React.JSX.Element {
  return (
    <mesh position={[0, 0.001, RESERVE_ROW_OFFSET * side]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[RESERVE_PITCH * 2 + 1.05, RESERVE_ZONE_DEPTH]} />
      <meshStandardMaterial color="#5a4028" roughness={0.8} />
    </mesh>
  );
}

export type SquareTileProps = Readonly<{
  node: SquareNode;
  shadows: boolean;
  onSelect: () => void;
  onHover: (entering: boolean) => void;
}>;

/**
 * One square: wood, with a coloured rim when it is a legal destination, a warned one
 * or under the keyboard cursor. A rim rather than a flood fill keeps the board legible
 * when every square is legal, and is the treatment the flat tier already uses
 * (appendix P5.18).
 */
export function SquareTile({
  node,
  shadows,
  onSelect,
  onHover,
}: SquareTileProps): React.JSX.Element {
  return (
    <group
      position={[node.position[0], node.position[1], node.position[2]]}
      onClick={onSelect}
      onPointerOver={() => onHover(true)}
      onPointerOut={() => onHover(false)}
    >
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <planeGeometry args={[TILE_SPAN, TILE_SPAN]} />
        <meshStandardMaterial
          color={node.highlight === "none" ? SQUARE_COLOUR : HIGHLIGHT_COLOURS[node.highlight]}
          roughness={0.8}
        />
      </mesh>
      {node.highlight === "none" ? null : (
        <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[TILE_SPAN - TILE_RIM * 2, TILE_SPAN - TILE_RIM * 2]} />
          <meshStandardMaterial color={SQUARE_COLOUR} roughness={0.8} />
        </mesh>
      )}
    </group>
  );
}

export type PieceBodyProps = Readonly<{
  node: PieceNode;
  shadows: boolean;
  onSelect: () => void;
  onHover: (entering: boolean) => void;
}>;

/**
 * One piece: a closed cup turned from the profile in `layout.ts`, with an inlaid
 * disc on top. Both carry the size, and the surface is closed, so a piece is solid
 * from every angle.
 */
export function PieceBody({ node, shadows, onSelect, onHover }: PieceBodyProps): React.JSX.Element {
  const profile = useMemo(
    () => pieceProfile(node.size).map(([radius, height]) => new Vector2(radius, height)),
    [node.size],
  );
  const inlay = inlayRadius(node.size);

  return (
    <group
      position={[node.position[0], node.position[1], node.position[2]]}
      onClick={onSelect}
      onPointerOver={() => onHover(true)}
      onPointerOut={() => onHover(false)}
    >
      <mesh castShadow={shadows} receiveShadow={shadows}>
        <latheGeometry args={[profile, 48]} />
        <meshStandardMaterial
          color={PIECE_COLOURS[node.owner]}
          roughness={0.45}
          metalness={0.05}
          emissive={PIECE_COLOURS[node.owner]}
          emissiveIntensity={node.highlighted ? 0.3 : 0}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, node.height + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[inlay, 32]} />
        <meshStandardMaterial color={INLAY_COLOURS[node.owner]} roughness={0.6} />
      </mesh>
    </group>
  );
}
