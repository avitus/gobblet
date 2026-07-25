import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createLocalStore, type KeyValueStore } from "../storage/local-store";

/**
 * Local preferences. They are the only client state that survives a reload
 * (ADR-0020), and the sound channels are the ones section 13.5 requires.
 */
export type MotionPreference = "system" | "reduced" | "full";
export type RenderTierPreference = "auto" | "full" | "reduced" | "flat";

export type Settings = Readonly<{
  masterVolume: number;
  gameVolume: number;
  communicationVolume: number;
  soundMuted: boolean;
  motion: MotionPreference;
  renderTier: RenderTierPreference;
}>;

export type SettingsState = Settings &
  Readonly<{
    update: (patch: Partial<Settings>) => void;
    reset: () => void;
  }>;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  masterVolume: 0.7,
  gameVolume: 0.8,
  communicationVolume: 0.6,
  soundMuted: false,
  motion: "system",
  renderTier: "auto",
});

const SETTINGS_STORAGE_NAME = "gobblet.settings.v1";

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function readMotion(value: unknown): MotionPreference {
  return value === "reduced" || value === "full" ? value : "system";
}

function readTier(value: unknown): RenderTierPreference {
  return value === "full" || value === "reduced" || value === "flat" ? value : "auto";
}

export function readSettings(store: KeyValueStore): Settings {
  const raw = store.get(SETTINGS_STORAGE_NAME);
  if (raw === null) {
    return DEFAULT_SETTINGS;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_SETTINGS;
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      masterVolume: clampVolume(candidate.masterVolume, DEFAULT_SETTINGS.masterVolume),
      gameVolume: clampVolume(candidate.gameVolume, DEFAULT_SETTINGS.gameVolume),
      communicationVolume: clampVolume(
        candidate.communicationVolume,
        DEFAULT_SETTINGS.communicationVolume,
      ),
      soundMuted: candidate.soundMuted === true,
      motion: readMotion(candidate.motion),
      renderTier: readTier(candidate.renderTier),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(store: KeyValueStore, settings: Settings): void {
  store.set(SETTINGS_STORAGE_NAME, JSON.stringify(settings));
}

function currentSettings(state: SettingsState): Settings {
  return {
    masterVolume: state.masterVolume,
    gameVolume: state.gameVolume,
    communicationVolume: state.communicationVolume,
    soundMuted: state.soundMuted,
    motion: state.motion,
    renderTier: state.renderTier,
  };
}

export function createSettingsStore(
  store: KeyValueStore = createLocalStore(),
): UseBoundStore<StoreApi<SettingsState>> {
  return create<SettingsState>((set, get) => ({
    ...readSettings(store),
    update: (patch) => {
      const next: Settings = { ...currentSettings(get()), ...patch };
      persist(store, next);
      set(next);
    },
    reset: () => {
      persist(store, DEFAULT_SETTINGS);
      set(DEFAULT_SETTINGS);
    },
  }));
}

export const useSettingsStore = createSettingsStore();
