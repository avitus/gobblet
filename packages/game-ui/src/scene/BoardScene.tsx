import { Canvas } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Player, Square } from "@gobblet/game-core";
import type { BoardInteraction } from "../interaction/use-board-interaction";
import type { Origin } from "../interaction/board-model";
import { reserveLabel, squareLabel } from "../interaction/labels";
import { activatesItself, choosePiece, handleBoardKey } from "../interaction/use-board-interaction";
import { useCursorFocus } from "../interaction/use-cursor-focus";
import { placeCamera } from "./camera";
import type { CameraOrbit } from "./camera";
import { describeScene } from "./description";
import { BoardSlab, CameraRig, PieceBody, ReserveZone, SquareTile, Table } from "./Pieces";
import { projectStops } from "./projection";
import type { ScreenBox } from "./projection";
import type { TierSettings } from "../tier";
import styles from "./BoardScene.module.css";

export type BoardSceneProps = Readonly<{
  interaction: BoardInteraction;
  seat: Player | null;
  settings: TierSettings;
  orbit?: CameraOrbit | undefined;
  onContextLost?: (() => void) | undefined;
}>;

function boxStyle(box: ScreenBox): React.CSSProperties {
  return {
    left: `${String(box.left)}%`,
    top: `${String(box.top)}%`,
    width: `${String(box.width)}%`,
    height: `${String(box.height)}%`,
  };
}

/**
 * The WebGL tiers. It renders the description `describeScene` produces and owns no
 * rule: pointer and keyboard events are handed to the interaction layer, which is
 * the same layer the flat tier uses (docs/adr/0023).
 *
 * The canvas owns the pointer, because only a ray cast against what is drawn can
 * say which square was clicked. The stops over it are the keyboard and assistive
 * surface, take no pointer event, and are placed where the camera projects each
 * square, so a focus ring lands on the square it names (docs/adr/0025).
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
  const stops = useMemo(() => projectStops(camera), [camera]);
  const scene = useRef<HTMLDivElement>(null);
  const squareRefs = useCursorFocus(scene, interaction.cursor);
  const rows = [0, 1, 2, 3];

  /**
   * A pointer gesture on the canvas moves nothing into focus by itself, so the
   * stop it acted on is focused: the keyboard then continues from where the pointer
   * left off, in every engine (appendix P5.16).
   */
  const focusStop = (square: Square): void => {
    const stop = squareRefs.current.get(square) ?? null;
    if (stop instanceof HTMLButtonElement && !stop.disabled) {
      stop.focus();
      return;
    }
    scene.current?.focus();
  };

  return (
    <div
      ref={scene}
      className={styles.scene}
      data-testid="board-scene"
      data-tier={settings.tier}
      tabIndex={-1}
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
        <CameraRig placement={camera} />
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[4, 8, 6]}
          intensity={1.15}
          castShadow={settings.shadows}
          shadow-mapSize-width={settings.shadows ? 2048 : 512}
          shadow-mapSize-height={settings.shadows ? 2048 : 512}
        />
        <directionalLight position={[-5, 4, -4]} intensity={0.45} />

        <Table />
        <BoardSlab shadows={settings.shadows} />
        <ReserveZone side={1} />
        <ReserveZone side={-1} />

        {description.squares.map((square) => (
          <SquareTile
            key={square.square}
            node={square}
            shadows={settings.shadows}
            onSelect={() => {
              focusStop(square.square);
              interaction.chooseSquare(square.square);
            }}
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
            onSelect={() => {
              if (piece.origin.kind === "board") {
                focusStop(piece.origin.square);
              }
              choosePiece(interaction, piece.origin);
            }}
            onHover={(entering) => interaction.hover(entering ? piece.origin : null)}
          />
        ))}
      </Canvas>

      <div className={styles.focusStops} aria-label="Board" role="grid">
        {rows.map((row) => (
          <div className={styles.row} role="row" key={`row-${String(row)}`}>
            {description.squares.slice(row * 4, row * 4 + 4).map((square, column) => {
              const index = row * 4 + column;
              const visible = interaction.model.squares[index];
              const stop = stops.squares[index];
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
                  style={stop === undefined ? undefined : boxStyle(stop.box)}
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
                  onClick={() => {
                    interaction.chooseSquare(square.square);
                  }}
                >
                  <span className={styles.hidden}>{square.square}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.reserveStops} aria-label="Reserves" role="group">
        {interaction.model.reserves.map((stack) => {
          const origin: Origin = {
            kind: "reserve",
            owner: stack.owner,
            reserveStack: stack.reserveStack,
          };
          const stop = stops.reserves.find(
            (candidate) =>
              candidate.owner === stack.owner && candidate.reserveStack === stack.reserveStack,
          );
          return (
            <button
              key={`${stack.owner}-${String(stack.reserveStack)}`}
              type="button"
              className={styles.focusStop}
              style={stop === undefined ? undefined : boxStyle(stop.box)}
              data-testid={`scene-reserve-${stack.owner}-${String(stack.reserveStack)}`}
              data-owner={stack.owner}
              disabled={
                stack.piece === null || !interaction.isMovable(origin) || interaction.locked
              }
              aria-label={reserveLabel(stack)}
              onFocus={() => interaction.hover(origin)}
              onClick={() => {
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
