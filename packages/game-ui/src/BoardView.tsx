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
  /**
   * Reports the tier this board settled on and whether the machine or the player
   * decided it, so a caller can record the choice without asking how it was made.
   */
  onTierSelected?: (tier: RenderTier, source: "detected" | "chosen") => void;
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
  onTierSelected,
  initialTier,
}: BoardViewProps): React.JSX.Element {
  const [tier, setTier] = useState<RenderTier | null>(initialTier ?? null);
  const interaction = useBoardInteraction({ state, seat, locked, onSubmit });
  const selectionRef = useRef<Origin | null>(null);
  // Callers pass inline callbacks, so their identity changes on every render. Neither
  // effect below may depend on that identity: detection asks the machine for a
  // graphics context, and a board re-renders with every clock tick.
  const report = useRef({ onSelectionChange, onTierSelected });
  report.current = { onSelectionChange, onTierSelected };

  useEffect(() => {
    if (selectionRef.current === interaction.selected) {
      return;
    }
    selectionRef.current = interaction.selected;
    report.current.onSelectionChange?.(interaction.selected);
  }, [interaction.selected]);

  useEffect(() => {
    if (initialTier !== undefined) {
      setTier(initialTier);
      report.current.onTierSelected?.(initialTier, "chosen");
      return;
    }
    const resolved = resolveTier(detectCapabilities(), preference);
    setTier(resolved);
    report.current.onTierSelected?.(resolved, preference === "auto" ? "detected" : "chosen");
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
