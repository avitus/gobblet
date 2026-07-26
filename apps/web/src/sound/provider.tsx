import { SILENT_ENGINE, createSoundEngine } from "@gobblet/game-ui";
import type { SoundEngine } from "@gobblet/game-ui";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useSettingsStore } from "../settings/store";

const SoundContext = createContext<SoundEngine | null>(null);

export type SoundProviderProps = Readonly<{
  children: ReactNode;
  /** Injected by tests, which use the silent engine so nothing schedules audio. */
  engine?: SoundEngine;
}>;

/**
 * Owns the one sound engine and keeps it in step with the stored preferences. A
 * browser refuses to start audio before a gesture, so the first pointer or key
 * press resumes it (docs/adr/0022).
 */
export function SoundProvider({ children, engine }: SoundProviderProps): React.JSX.Element {
  const masterVolume = useSettingsStore((state) => state.masterVolume);
  const gameVolume = useSettingsStore((state) => state.gameVolume);
  const communicationVolume = useSettingsStore((state) => state.communicationVolume);
  const soundMuted = useSettingsStore((state) => state.soundMuted);

  const settings = useMemo(
    () => ({ masterVolume, gameVolume, communicationVolume, soundMuted }),
    [masterVolume, gameVolume, communicationVolume, soundMuted],
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const active = useMemo(
    () => engine ?? createSoundEngine({ settings: settingsRef.current }),
    [engine],
  );

  useEffect(() => {
    active.applySettings(settings);
  }, [active, settings]);

  useEffect(() => {
    const resume = (): void => {
      void active.resume();
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [active]);

  return <SoundContext.Provider value={active}>{children}</SoundContext.Provider>;
}

/** The engine, or a silent one when a screen is rendered outside the provider. */
export function useSoundEngine(): SoundEngine {
  return useContext(SoundContext) ?? SILENT_ENGINE;
}
