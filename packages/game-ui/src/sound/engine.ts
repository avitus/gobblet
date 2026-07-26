/**
 * The ten sounds section 13.5 requires, synthesised rather than sampled, so no
 * binary asset enters the repository in this phase (docs/adr/0022). Everything the
 * engine needs from Web Audio is declared here as a narrow interface: a licensed
 * sample set replaces `createSoundEngine` without touching a caller.
 */
export const SOUND_CUES = Object.freeze([
  "piece-select",
  "placement",
  "gobble",
  "reveal",
  "match-found",
  "low-time",
  "win",
  "loss",
  "draw",
  "reaction",
] as const);

export type SoundCue = (typeof SOUND_CUES)[number];

/** Section 13.5 asks for independent master, game and communication controls. */
export type SoundChannel = "game" | "communication";

export type SoundSettings = Readonly<{
  masterVolume: number;
  gameVolume: number;
  communicationVolume: number;
  soundMuted: boolean;
}>;

export type SoundEngine = Readonly<{
  play: (cue: SoundCue) => void;
  applySettings: (settings: SoundSettings) => void;
  /** Browsers keep audio suspended until a gesture; call this from one. */
  resume: () => Promise<void>;
  close: () => Promise<void>;
}>;

type AudioParamLike = Readonly<{
  value: number;
  setValueAtTime: (value: number, when: number) => void;
  linearRampToValueAtTime: (value: number, when: number) => void;
}>;

type AudioNodeLike = Readonly<{
  connect: (destination: AudioNodeLike) => void;
  disconnect: () => void;
}>;

type GainLike = AudioNodeLike & Readonly<{ gain: AudioParamLike }>;

type OscillatorLike = AudioNodeLike &
  Readonly<{
    frequency: AudioParamLike;
    start: (when: number) => void;
    stop: (when: number) => void;
  }> & { type: OscillatorType };

export type AudioContextLike = Readonly<{
  currentTime: number;
  state: "suspended" | "running" | "closed";
  destination: AudioNodeLike;
  createGain: () => GainLike;
  createOscillator: () => OscillatorLike;
  resume: () => Promise<void>;
  close: () => Promise<void>;
}>;

type Voice = Readonly<{
  wave: OscillatorType;
  /** Starting frequency in hertz. */
  from: number;
  /** Frequency at the end of the voice; equal to `from` for a steady tone. */
  to: number;
  peak: number;
  durationMs: number;
  delayMs: number;
}>;

type Recipe = Readonly<{ channel: SoundChannel; voices: readonly Voice[] }>;

function voice(
  wave: OscillatorType,
  from: number,
  to: number,
  durationMs: number,
  peak: number,
  delayMs = 0,
): Voice {
  return { wave, from, to, durationMs, peak, delayMs };
}

const ATTACK_MS = 6;

/**
 * Short and unobtrusive, as section 13.5 asks: a click for selection, a knock for
 * a placement, falling pitch for a gobble, rising pitch for a reveal, and a triad
 * whose mood carries the result.
 */
const RECIPES: Readonly<Record<SoundCue, Recipe>> = Object.freeze({
  "piece-select": { channel: "game", voices: [voice("triangle", 620, 660, 60, 0.18)] },
  placement: {
    channel: "game",
    voices: [voice("square", 190, 120, 90, 0.22), voice("triangle", 380, 260, 70, 0.1, 10)],
  },
  gobble: {
    channel: "game",
    voices: [voice("sawtooth", 420, 140, 220, 0.2), voice("square", 150, 90, 120, 0.14, 90)],
  },
  reveal: {
    channel: "game",
    voices: [voice("triangle", 300, 720, 260, 0.2), voice("sine", 900, 940, 140, 0.12, 120)],
  },
  "match-found": {
    channel: "communication",
    voices: [
      voice("sine", 523, 523, 140, 0.16),
      voice("sine", 659, 659, 140, 0.16, 120),
      voice("sine", 784, 784, 220, 0.18, 240),
    ],
  },
  "low-time": {
    channel: "game",
    voices: [voice("square", 880, 880, 90, 0.16), voice("square", 880, 880, 90, 0.16, 160)],
  },
  win: {
    channel: "game",
    voices: [
      voice("triangle", 523, 523, 160, 0.18),
      voice("triangle", 659, 659, 160, 0.18, 130),
      voice("triangle", 1047, 1047, 320, 0.2, 260),
    ],
  },
  loss: {
    channel: "game",
    voices: [
      voice("triangle", 440, 440, 180, 0.16),
      voice("triangle", 349, 349, 180, 0.16, 150),
      voice("triangle", 262, 262, 340, 0.18, 300),
    ],
  },
  draw: {
    channel: "game",
    voices: [voice("sine", 392, 392, 200, 0.16), voice("sine", 392, 392, 260, 0.16, 220)],
  },
  reaction: { channel: "communication", voices: [voice("sine", 740, 880, 110, 0.14)] },
});

export type SoundEngineOptions = Readonly<{
  settings: SoundSettings;
  /** Injected in tests, and absent in a browser without Web Audio. */
  createContext?: () => AudioContextLike | null;
}>;

function defaultContext(): AudioContextLike | null {
  if (typeof globalThis.AudioContext === "undefined") {
    return null;
  }
  return new globalThis.AudioContext() as unknown as AudioContextLike;
}

function channelVolume(settings: SoundSettings, channel: SoundChannel): number {
  if (settings.soundMuted) {
    return 0;
  }
  const master = clampVolume(settings.masterVolume);
  const own = clampVolume(channel === "game" ? settings.gameVolume : settings.communicationVolume);
  return master * own;
}

function clampVolume(value: number): number {
  return Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
}

/**
 * A silent engine. Rendering tests and any environment without Web Audio use it,
 * so no caller has to ask whether sound exists.
 */
export const SILENT_ENGINE: SoundEngine = Object.freeze({
  play: () => undefined,
  applySettings: () => undefined,
  resume: () => Promise.resolve(),
  close: () => Promise.resolve(),
});

export function createSoundEngine(options: SoundEngineOptions): SoundEngine {
  const create = options.createContext ?? defaultContext;
  let settings = options.settings;
  let context: AudioContextLike | null = null;
  let unavailable = false;

  const acquire = (): AudioContextLike | null => {
    if (unavailable) {
      return null;
    }
    if (context === null) {
      context = create();
      if (context === null) {
        unavailable = true;
      }
    }
    return context;
  };

  return {
    play: (cue) => {
      const recipe = RECIPES[cue];
      const volume = channelVolume(settings, recipe.channel);
      if (volume === 0) {
        return;
      }
      const active = acquire();
      if (active === null || active.state === "closed") {
        return;
      }
      for (const item of recipe.voices) {
        schedule(active, item, volume);
      }
    },
    applySettings: (next) => {
      settings = next;
    },
    resume: async () => {
      const active = acquire();
      if (active === null || active.state !== "suspended") {
        return;
      }
      await active.resume();
    },
    close: async () => {
      const active = context;
      context = null;
      if (active === null || active.state === "closed") {
        return;
      }
      await active.close();
    },
  };
}

function schedule(context: AudioContextLike, item: Voice, volume: number): void {
  const start = context.currentTime + item.delayMs / 1000;
  const attack = start + ATTACK_MS / 1000;
  const end = start + item.durationMs / 1000;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(item.peak * volume, attack);
  gain.gain.linearRampToValueAtTime(0, end);
  gain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = item.wave;
  oscillator.frequency.setValueAtTime(item.from, start);
  oscillator.frequency.linearRampToValueAtTime(item.to, end);
  oscillator.connect(gain);
  oscillator.start(start);
  oscillator.stop(end);
}
