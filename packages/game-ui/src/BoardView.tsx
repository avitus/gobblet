import type { Move, Player, SerializedGameState } from "@gobblet/game-core";
import { useEffect, useRef, useState } from "react";
import { FlatBoard } from "./flat/FlatBoard";
import type { Origin } from "./interaction/board-model";
import { useBoardInteraction } from "./interaction/use-board-interaction";
import { BoardScene } from "./scene/BoardScene";
import type { CameraOrbit } from "./scene/camera";
import { detectCapabilities, downgradeTier, resolveTier, tierSettings } from "./tier";
import type { RenderTier, RenderTierPreference } from "./tier";

export type BoardViewProps = Readonly<{
  state: SerializedGameState;
  seat: Player | null;
  locked: boolean;
  onSubmit: (move: Move) => void;
  preference?: RenderTierPreference;
  orbit?: CameraOrbit;
  /** Called when the lifted piece changes, so a caller can play the select sound. */
  onSelectionChange?: (origin: Origin | null) => void;
  /** Injected in tests so tier selection needs no graphics context. */
  initialTier?: RenderTier;
}>;

/**
 * Chooses a presentation tier once, then renders the match through it. The
 * interaction layer is created here, above the tiers, so every tier obeys the same
 * selection, legality and locking rules (docs/adr/0023).
 */
export function BoardView({
  state,
  seat,
  locked,
  onSubmit,
  preference = "auto",
  orbit,
  onSelectionChange,
  initialTier,
}: BoardViewProps): React.JSX.Element {
  const [tier, setTier] = useState<RenderTier | null>(initialTier ?? null);
  const interaction = useBoardInteraction({ state, seat, locked, onSubmit });
  const selectionRef = useRef<Origin | null>(null);

  useEffect(() => {
    if (selectionRef.current === interaction.selected) {
      return;
    }
    selectionRef.current = interaction.selected;
    onSelectionChange?.(interaction.selected);
  }, [interaction.selected, onSelectionChange]);

  useEffect(() => {
    if (initialTier !== undefined) {
      setTier(initialTier);
      return;
    }
    setTier(resolveTier(detectCapabilities(), preference));
  }, [initialTier, preference]);

  if (tier === null || tier === "flat") {
    return <FlatBoard interaction={interaction} seat={seat} />;
  }

  return (
    <BoardScene
      interaction={interaction}
      seat={seat}
      settings={tierSettings(tier)}
      orbit={orbit}
      onContextLost={() => {
        setTier(downgradeTier(tier));
      }}
    />
  );
}
