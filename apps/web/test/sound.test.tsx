import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SoundCue, SoundEngine, SoundSettings } from "@gobblet/game-ui";
import type { MatchEndedEvent, MatchSnapshot, Player } from "@gobblet/protocol";
import { useMatchSounds } from "../src/match/use-match-sounds";
import { DEFAULT_SETTINGS, useSettingsStore } from "../src/settings/store";
import { SoundProvider, useSoundEngine } from "../src/sound/provider";
import { MATCH_ID, makeSnapshot } from "./helpers/match";
import { serializedAfter } from "./helpers/state";

type Recorder = SoundEngine & {
  readonly played: SoundCue[];
  readonly applied: SoundSettings[];
  readonly resumes: () => number;
};

function recorder(): Recorder {
  const played: SoundCue[] = [];
  const applied: SoundSettings[] = [];
  let resumes = 0;
  return {
    played,
    applied,
    resumes: () => resumes,
    play: (cue) => {
      played.push(cue);
    },
    applySettings: (settings) => {
      applied.push(settings);
    },
    resume: () => {
      resumes += 1;
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}

function afterMove(from: MatchSnapshot, move: MatchSnapshot["lastMove"]): MatchSnapshot {
  return { ...from, version: from.version + 1, lastMove: move };
}

type SoundsHarnessProps = Readonly<{
  snapshot: MatchSnapshot | null;
  ended?: MatchEndedEvent | null;
  seat?: Player | null;
  lowTime?: boolean;
}>;

function SoundsHarness({
  snapshot,
  ended = null,
  seat = "light",
  lowTime = false,
}: SoundsHarnessProps): null {
  useMatchSounds({ snapshot, ended, seat, lowTime });
  return null;
}

describe("the sound provider", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("hands the engine to a screen and keeps it in step with the settings", () => {
    const engine = recorder();

    function Probe(): React.JSX.Element {
      const active = useSoundEngine();
      return (
        <button
          type="button"
          data-testid="play"
          onClick={() => {
            active.play("placement");
          }}
        >
          play
        </button>
      );
    }

    render(
      <SoundProvider engine={engine}>
        <Probe />
      </SoundProvider>,
    );

    expect(engine.applied.at(-1)).toEqual({
      masterVolume: DEFAULT_SETTINGS.masterVolume,
      gameVolume: DEFAULT_SETTINGS.gameVolume,
      communicationVolume: DEFAULT_SETTINGS.communicationVolume,
      soundMuted: DEFAULT_SETTINGS.soundMuted,
    });

    act(() => {
      useSettingsStore.getState().update({ masterVolume: 0.2, soundMuted: true });
    });

    expect(engine.applied.at(-1)).toEqual({
      masterVolume: 0.2,
      gameVolume: DEFAULT_SETTINGS.gameVolume,
      communicationVolume: DEFAULT_SETTINGS.communicationVolume,
      soundMuted: true,
    });
  });

  it("resumes the engine on the first gesture only", async () => {
    const engine = recorder();
    render(
      <SoundProvider engine={engine}>
        <button type="button" data-testid="anything">
          anything
        </button>
      </SoundProvider>,
    );

    expect(engine.resumes()).toBe(0);

    await userEvent.click(screen.getByTestId("anything"));
    expect(engine.resumes()).toBe(1);

    await userEvent.click(screen.getByTestId("anything"));
    expect(engine.resumes()).toBe(1);
  });

  it("answers with a silent engine outside the provider", () => {
    let engine: SoundEngine | null = null;

    function Probe(): null {
      engine = useSoundEngine();
      return null;
    }

    render(<Probe />);
    expect(() => {
      engine?.play("win");
    }).not.toThrow();
  });

  it("builds its own engine when none is injected", () => {
    const construct = vi.fn();
    class FakeAudioContext {
      constructor() {
        construct();
      }
      readonly state = "closed";
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);

    function Probe(): null {
      useSoundEngine().play("win");
      return null;
    }

    render(
      <SoundProvider>
        <Probe />
      </SoundProvider>,
    );

    expect(construct).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("the sounds a match makes", () => {
  it("plays a placement on a move to an empty square", () => {
    const engine = recorder();
    const first = makeSnapshot();
    const view = render(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={first} />
      </SoundProvider>,
    );

    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness
          snapshot={afterMove(first, {
            move: { kind: "reserve", reserveStack: 0, to: "r0c0" },
            version: 0,
          })}
        />
      </SoundProvider>,
    );

    expect(engine.played).toEqual(["placement"]);
  });

  it("plays a gobble when the destination already held a piece", () => {
    const engine = recorder();
    const occupied = makeSnapshot({
      state: serializedAfter(
        { kind: "reserve", reserveStack: 0, to: "r0c0" },
        { kind: "reserve", reserveStack: 0, to: "r0c1" },
        { kind: "reserve", reserveStack: 0, to: "r1c0" },
        { kind: "reserve", reserveStack: 0, to: "r1c1" },
      ),
    });
    const view = render(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={occupied} />
      </SoundProvider>,
    );

    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness
          snapshot={afterMove(occupied, {
            move: { kind: "board", from: "r0c0", to: "r1c0" },
            version: 0,
          })}
        />
      </SoundProvider>,
    );

    expect(engine.played).toEqual(["gobble"]);
  });

  it("plays a reveal when the piece that moved was covering another", () => {
    const engine = recorder();
    const covering = makeSnapshot({
      state: serializedAfter(
        { kind: "reserve", reserveStack: 0, to: "r0c0" },
        { kind: "reserve", reserveStack: 0, to: "r0c1" },
        { kind: "reserve", reserveStack: 0, to: "r1c0" },
        { kind: "reserve", reserveStack: 0, to: "r1c1" },
        { kind: "board", from: "r0c0", to: "r1c0" },
        { kind: "reserve", reserveStack: 1, to: "r2c2" },
      ),
    });
    const view = render(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={covering} />
      </SoundProvider>,
    );

    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness
          snapshot={afterMove(covering, {
            move: { kind: "board", from: "r1c0", to: "r2c0" },
            version: 0,
          })}
        />
      </SoundProvider>,
    );

    expect(engine.played).toEqual(["reveal"]);
  });

  it("says nothing about a snapshot that is not a successor", () => {
    const engine = recorder();
    const first = makeSnapshot({ version: 4 });
    const view = render(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={first} />
      </SoundProvider>,
    );

    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={{ ...first, version: 3 }} />
      </SoundProvider>,
    );
    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={{ ...first, version: 5, lastMove: null }} />
      </SoundProvider>,
    );
    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness
          snapshot={{
            ...first,
            matchId: "66666666-6666-4666-8666-666666666666",
            version: 5,
            lastMove: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" }, version: 4 },
          }}
        />
      </SoundProvider>,
    );

    expect(engine.played).toEqual([]);
  });

  it("plays the result once, from the seat's point of view", () => {
    const engine = recorder();
    const ended: MatchEndedEvent = {
      matchId: MATCH_ID,
      version: 9,
      result: "dark",
      reason: "line",
    };

    const view = render(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} ended={ended} seat="light" />
      </SoundProvider>,
    );
    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} ended={ended} seat="light" />
      </SoundProvider>,
    );

    expect(engine.played).toEqual(["loss"]);
  });

  it("plays a win for the winner, and for an onlooker", () => {
    const won = recorder();
    const ended: MatchEndedEvent = {
      matchId: MATCH_ID,
      version: 9,
      result: "dark",
      reason: "line",
    };

    render(
      <SoundProvider engine={won}>
        <SoundsHarness snapshot={makeSnapshot()} ended={ended} seat="dark" />
      </SoundProvider>,
    );
    expect(won.played).toEqual(["win"]);

    const watched = recorder();
    render(
      <SoundProvider engine={watched}>
        <SoundsHarness snapshot={makeSnapshot()} ended={ended} seat={null} />
      </SoundProvider>,
    );
    expect(watched.played).toEqual(["win"]);
  });

  it("plays a draw for both players", () => {
    const engine = recorder();
    render(
      <SoundProvider engine={engine}>
        <SoundsHarness
          snapshot={makeSnapshot()}
          ended={{ matchId: MATCH_ID, version: 9, result: "draw", reason: "repetition" }}
        />
      </SoundProvider>,
    );

    expect(engine.played).toEqual(["draw"]);
  });

  it("warns once per crossing of the low-time threshold", () => {
    const engine = recorder();
    const view = render(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} lowTime={false} />
      </SoundProvider>,
    );

    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} lowTime />
      </SoundProvider>,
    );
    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} lowTime />
      </SoundProvider>,
    );
    expect(engine.played).toEqual(["low-time"]);

    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} lowTime={false} />
      </SoundProvider>,
    );
    view.rerender(
      <SoundProvider engine={engine}>
        <SoundsHarness snapshot={makeSnapshot()} lowTime />
      </SoundProvider>,
    );
    expect(engine.played).toEqual(["low-time", "low-time"]);
  });
});
