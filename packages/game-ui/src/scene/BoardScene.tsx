import { Canvas } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Player } from "@gobblet/game-core";
import type { BoardInteraction } from "../interaction/use-board-interaction";
import type { Origin } from "../interaction/board-model";
import { reserveLabel, squareLabel } from "../interaction/labels";
import { activatesItself, handleBoardKey } from "../interaction/use-board-interaction";
import { useCursorFocus } from "../interaction/use-cursor-focus";
import { placeCamera } from "./camera";
import type { CameraOrbit } from "./camera";
import { describeScene } from "./description";
import type { PieceNode, SquareNode } from "./description";
import { BOARD_THICKNESS, SQUARE_PITCH } from "./layout";
import type { TierSettings } from "../tier";
import styles from "./BoardScene.module.css";

export type BoardSceneProps = Readonly<{
  interaction: BoardInteraction;
  seat: Player | null;
  settings: TierSettings;
  orbit?: CameraOrbit | undefined;
  onContextLost?: (() => void) | undefined;
}>;

const HIGHLIGHT_COLOURS = Object.freeze({
  none: "#8a6238",
  legal: "#6fbf73",
  warning: "#d9736a",
  cursor: "#f0c987",
});

const PIECE_COLOURS = Object.freeze({ light: "#e4c79a", dark: "#6b4326" });

/**
 * The WebGL tiers. It renders the description `describeScene` produces and owns no
 * rule: pointer and keyboard events are handed to the interaction layer, which is
 * the same layer the flat tier uses (docs/adr/0023).
 */
export function BoardScene({
  interaction,
  seat,
  settings,
  orbit,
  onContextLost,
}: BoardSceneProps): React.JSX.Element {
  const description = useMemo(() => describeScene(interaction), [interaction]);
  const camera = useMemo(() => placeCamera(seat ?? "light", orbit), [seat, orbit]);
  const scene = useRef<HTMLDivElement>(null);
  const squareRefs = useCursorFocus(scene, interaction.cursor);

  return (
    <div
      ref={scene}
      className={styles.scene}
      data-testid="board-scene"
      data-tier={settings.tier}
      onKeyDown={(event) => {
        if (
          handleBoardKey(interaction, {
            key: event.key,
            shiftKey: event.shiftKey,
            onControl: activatesItself(event.target),
          })
        ) {
          event.preventDefault();
        }
      }}
    >
      <Canvas
        shadows={settings.shadows}
        dpr={[1, settings.pixelRatioCap]}
        gl={{ antialias: settings.antialias }}
        camera={{
          position: [...camera.position],
          fov: camera.fieldOfView,
        }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onContextLost?.();
          });
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[4, 8, 6]}
          intensity={1.15}
          castShadow={settings.shadows}
          shadow-mapSize-width={settings.shadows ? 2048 : 512}
          shadow-mapSize-height={settings.shadows ? 2048 : 512}
        />
        <directionalLight position={[-5, 4, -4]} intensity={0.35} />

        <mesh position={[0, -BOARD_THICKNESS / 2, 0]} receiveShadow={settings.shadows}>
          <boxGeometry args={[SQUARE_PITCH * 4.6, BOARD_THICKNESS, SQUARE_PITCH * 4.6]} />
          <meshStandardMaterial color="#4a3323" roughness={0.65} metalness={0.05} />
        </mesh>

        {description.squares.map((square) => (
          <SquareTile
            key={square.square}
            node={square}
            shadows={settings.shadows}
            onSelect={() => interaction.chooseSquare(square.square)}
            onHover={(entering) =>
              interaction.hover(entering ? { kind: "board", square: square.square } : null)
            }
          />
        ))}

        {description.pieces.map((piece) => (
          <PieceBody
            key={piece.key}
            node={piece}
            shadows={settings.shadows}
            onSelect={() => interaction.choose(piece.origin)}
            onHover={(entering) => interaction.hover(entering ? piece.origin : null)}
          />
        ))}
      </Canvas>

      <div className={styles.focusStops} aria-label="Board" role="grid">
        {description.squares.map((square, index) => {
          const visible = interaction.model.squares[index];
          const destination = interaction.destinationAt(square.square);
          return (
            <button
              key={square.square}
              ref={(element) => {
                squareRefs.current.set(square.square, element);
              }}
              type="button"
              role="gridcell"
              className={styles.focusStop}
              data-testid={`scene-square-${square.square}`}
              data-highlight={square.highlight}
              data-cursor={interaction.cursor === square.square ? "true" : "false"}
              disabled={!square.focusable}
              aria-label={
                visible === undefined
                  ? square.square
                  : squareLabel(visible, destination?.losesByReveal ?? false)
              }
              onFocus={() => {
                interaction.focusSquare(square.square);
                interaction.hover({ kind: "board", square: square.square });
              }}
              onClick={(event) => {
                event.currentTarget.focus();
                interaction.chooseSquare(square.square);
              }}
            >
              <span className={styles.hidden}>{square.square}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.reserveStops} aria-label="Reserves" role="group">
        {interaction.model.reserves.map((stack) => {
          const origin: Origin = {
            kind: "reserve",
            owner: stack.owner,
            reserveStack: stack.reserveStack,
          };
          return (
            <button
              key={`${stack.owner}-${String(stack.reserveStack)}`}
              type="button"
              className={styles.focusStop}
              data-testid={`scene-reserve-${stack.owner}-${String(stack.reserveStack)}`}
              data-owner={stack.owner}
              disabled={
                stack.piece === null || !interaction.isMovable(origin) || interaction.locked
              }
              aria-label={reserveLabel(stack)}
              onFocus={() => interaction.hover(origin)}
              onClick={(event) => {
                event.currentTarget.focus();
                interaction.choose(origin);
              }}
            >
              <span className={styles.hidden}>{reserveLabel(stack)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SquareTileProps = Readonly<{
  node: SquareNode;
  shadows: boolean;
  onSelect: () => void;
  onHover: (entering: boolean) => void;
}>;

function SquareTile({ node, shadows, onSelect, onHover }: SquareTileProps): React.JSX.Element {
  return (
    <mesh
      position={[node.position[0], 0.001, node.position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow={shadows}
      onClick={onSelect}
      onPointerOver={() => onHover(true)}
      onPointerOut={() => onHover(false)}
    >
      <planeGeometry args={[SQUARE_PITCH * 0.94, SQUARE_PITCH * 0.94]} />
      <meshStandardMaterial color={HIGHLIGHT_COLOURS[node.highlight]} roughness={0.8} />
    </mesh>
  );
}

type PieceBodyProps = Readonly<{
  node: PieceNode;
  shadows: boolean;
  onSelect: () => void;
  onHover: (entering: boolean) => void;
}>;

function PieceBody({ node, shadows, onSelect, onHover }: PieceBodyProps): React.JSX.Element {
  return (
    <mesh
      position={[node.position[0], node.position[1] + node.height / 2, node.position[2]]}
      castShadow={shadows}
      onClick={onSelect}
      onPointerOver={() => onHover(true)}
      onPointerOut={() => onHover(false)}
    >
      <cylinderGeometry args={[node.radius, node.radius * 0.92, node.height, 32, 1, true]} />
      <meshStandardMaterial color={PIECE_COLOURS[node.owner]} roughness={0.45} metalness={0.05} />
    </mesh>
  );
}
