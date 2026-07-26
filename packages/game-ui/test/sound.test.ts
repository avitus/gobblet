import { describe, expect, it, vi } from "vitest";
import {
  SILENT_ENGINE,
  SOUND_CUES,
  createSoundEngine,
  type AudioContextLike,
  type SoundSettings,
} from "../src/sound/engine";

const LOUD: SoundSettings = {
  masterVolume: 1,
  gameVolume: 1,
  communicationVolume: 1,
  soundMuted: false,
};

type ScheduledVoice = {
  wave: string;
  from: number;
  to: number;
  peak: number;
  startsAt: number;
  endsAt: number;
};

function fakeContext(): AudioContextLike & {
  readonly voices: readonly ScheduledVoice[];
  readonly resumed: () => number;
  readonly closed: () => number;
  suspend: () => void;
} {
  const voices: ScheduledVoice[] = [];
  let resumes = 0;
  let closes = 0;
  let state: "suspended" | "running" | "closed" = "running";
  const destination = { connect: () => undefined, disconnect: () => undefined };

  return {
    get currentTime() {
      return 10;
    },
    get state() {
      return state;
    },
    destination,
    createGain: () => {
      const current: ScheduledVoice = {
        wave: "",
        from: 0,
        to: 0,
        peak: 0,
        startsAt: 0,
        endsAt: 0,
      };
      voices.push(current);
      return {
        gain: {
          value: 1,
          setValueAtTime: (_value: number, when: number) => {
            current.startsAt = when;
          },
          linearRampToValueAtTime: (value: number, when: number) => {
            current.peak = Math.max(current.peak, value);
            current.endsAt = Math.max(current.endsAt, when);
          },
        },
        connect: () => undefined,
        disconnect: () => undefined,
      };
    },
    createOscillator: () => {
      const current = voices.at(-1);
      if (current === undefined) {
        throw new Error("a voice needs a gain stage first");
      }
      return {
        set type(value: OscillatorType) {
          current.wave = value;
        },
        get type() {
          return current.wave as OscillatorType;
        },
        frequency: {
          value: 0,
          setValueAtTime: (value: number) => {
            current.from = value;
          },
          linearRampToValueAtTime: (value: number) => {
            current.to = value;
          },
        },
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      };
    },
    resume: () => {
      resumes += 1;
      state = "running";
      return Promise.resolve();
    },
    close: () => {
      closes += 1;
      state = "closed";
      return Promise.resolve();
    },
    voices,
    resumed: () => resumes,
    closed: () => closes,
    suspend: () => {
      state = "suspended";
    },
  };
}

describe("the sound engine", () => {
  it("offers the ten sounds section 13.5 requires", () => {
    expect(SOUND_CUES).toHaveLength(10);
    expect([...SOUND_CUES]).toEqual([
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
    ]);
  });

  it("synthesises every sound without loading an asset", () => {
    const context = fakeContext();
    const engine = createSoundEngine({ settings: LOUD, createContext: () => context });

    for (const cue of SOUND_CUES) {
      engine.play(cue);
    }

    expect(context.voices.length).toBeGreaterThanOrEqual(SOUND_CUES.length);
    expect(context.voices.every((item) => item.endsAt > item.startsAt)).toBe(true);
    expect(context.voices.every((item) => item.peak > 0)).toBe(true);
  });

  it("falls in pitch for a gobble and rises for a reveal", () => {
    const context = fakeContext();
    const engine = createSoundEngine({ settings: LOUD, createContext: () => context });

    engine.play("gobble");
    const gobble = context.voices[0];
    engine.play("reveal");
    const reveal = context.voices.at(2);

    expect(gobble?.to).toBeLessThan(gobble?.from ?? 0);
    expect(reveal?.to).toBeGreaterThan(reveal?.from ?? 0);
  });

  it("plays the later voices of a chord after the first", () => {
    const context = fakeContext();
    const engine = createSoundEngine({ settings: LOUD, createContext: () => context });

    engine.play("win");

    const [first, second, third] = context.voices;
    expect(second?.startsAt).toBeGreaterThan(first?.startsAt ?? 0);
    expect(third?.startsAt).toBeGreaterThan(second?.startsAt ?? 0);
  });

  it("scales a game sound by the master and the game volume", () => {
    const context = fakeContext();
    const engine = createSoundEngine({
      settings: { ...LOUD, masterVolume: 0.5, gameVolume: 0.5 },
      createContext: () => context,
    });

    engine.play("piece-select");

    const loud = fakeContext();
    createSoundEngine({ settings: LOUD, createContext: () => loud }).play("piece-select");

    expect(context.voices[0]?.peak).toBeCloseTo((loud.voices[0]?.peak ?? 0) * 0.25, 6);
  });

  it("keeps the communication channel independent of the game channel", () => {
    const context = fakeContext();
    const engine = createSoundEngine({
      settings: { ...LOUD, gameVolume: 0, communicationVolume: 1 },
      createContext: () => context,
    });

    engine.play("placement");
    expect(context.voices).toHaveLength(0);

    engine.play("match-found");
    expect(context.voices.length).toBeGreaterThan(0);
  });

  it("plays nothing at all while muted, and takes a settings change immediately", () => {
    const context = fakeContext();
    const engine = createSoundEngine({
      settings: { ...LOUD, soundMuted: true },
      createContext: () => context,
    });

    engine.play("win");
    expect(context.voices).toHaveLength(0);

    engine.applySettings(LOUD);
    engine.play("win");
    expect(context.voices.length).toBeGreaterThan(0);
  });

  it("asks for a context only when there is something to play", () => {
    const create = vi.fn(() => fakeContext());
    const engine = createSoundEngine({
      settings: { ...LOUD, soundMuted: true },
      createContext: create,
    });

    engine.play("win");
    expect(create).not.toHaveBeenCalled();

    engine.applySettings(LOUD);
    engine.play("win");
    engine.play("draw");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on a machine with no Web Audio, and asks only once", () => {
    const create = vi.fn(() => null);
    const engine = createSoundEngine({ settings: LOUD, createContext: create });

    expect(() => {
      engine.play("win");
      engine.play("loss");
    }).not.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context once, and never a running one", async () => {
    const context = fakeContext();
    const engine = createSoundEngine({ settings: LOUD, createContext: () => context });

    context.suspend();
    await engine.resume();
    expect(context.resumed()).toBe(1);

    await engine.resume();
    expect(context.resumed()).toBe(1);
  });

  it("has nothing to resume when the machine offers no Web Audio", async () => {
    const engine = createSoundEngine({ settings: LOUD, createContext: () => null });

    await expect(engine.resume()).resolves.toBeUndefined();
  });

  it("closes the context, and refuses to play or close afterwards", async () => {
    const context = fakeContext();
    const engine = createSoundEngine({ settings: LOUD, createContext: () => context });

    engine.play("draw");
    const played = context.voices.length;

    await engine.close();
    expect(context.closed()).toBe(1);

    await engine.close();
    expect(context.closed()).toBe(1);

    engine.play("draw");
    expect(context.voices).toHaveLength(played);
  });

  it("treats a volume outside the range as the nearest allowed value", () => {
    const quiet = fakeContext();
    createSoundEngine({
      settings: { ...LOUD, masterVolume: Number.NaN },
      createContext: () => quiet,
    }).play("win");
    expect(quiet.voices).toHaveLength(0);

    const clamped = fakeContext();
    createSoundEngine({
      settings: { ...LOUD, masterVolume: 4, gameVolume: 4 },
      createContext: () => clamped,
    }).play("piece-select");

    const loud = fakeContext();
    createSoundEngine({ settings: LOUD, createContext: () => loud }).play("piece-select");
    expect(clamped.voices[0]?.peak).toBeCloseTo(loud.voices[0]?.peak ?? 0, 6);
  });

  it("offers a silent engine for tests and for a browser without audio", async () => {
    expect(() => {
      SILENT_ENGINE.play("win");
      SILENT_ENGINE.applySettings(LOUD);
    }).not.toThrow();
    await expect(SILENT_ENGINE.resume()).resolves.toBeUndefined();
    await expect(SILENT_ENGINE.close()).resolves.toBeUndefined();
  });

  it("uses the browser's own AudioContext when none is injected", () => {
    const construct = vi.fn();
    class FakeAudioContext {
      constructor() {
        construct();
      }
      readonly state = "closed";
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);

    createSoundEngine({ settings: LOUD }).play("win");
    expect(construct).toHaveBeenCalledTimes(1);

    vi.stubGlobal("AudioContext", undefined);
    const withoutAudio = createSoundEngine({ settings: LOUD });
    expect(() => {
      withoutAudio.play("win");
    }).not.toThrow();

    vi.unstubAllGlobals();
  });
});
