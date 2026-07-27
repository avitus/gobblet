import { createInitialGame, toSerializableGameState } from "@gobblet/game-core";
import type { Move, Player } from "@gobblet/game-core";
import type { MatchSnapshot } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import {
  LOAD_TARGETS,
  SPECIFIED_SCALE,
  advance,
  formatLoadReport,
  judgeLoad,
  percentile,
  playMatch,
  runLoad,
  seededRandom,
  summarise,
} from "../src/ops/load";
import type { LoadMatchHandle, LoadPlan, LoadPort, MatchOutcome } from "../src/ops/load";

/**
 * The harness is driven against a fake transport here: every way a run can go wrong
 * is produced deliberately, which is the only way to know the verdict means anything
 * (appendix P9.1). The transport itself is exercised against a real server in
 * load-integration.test.ts.
 */

const PLAN: LoadPlan = { matches: 2, movesPerMatch: 3, waveSize: 2, seed: 7 };

function snapshotFixture(matchId: string): MatchSnapshot {
  return {
    matchId,
    version: 0,
    status: "active",
    mode: "casual",
    timeControlSeconds: 300,
    players: {
      light: {
        actorType: "guest",
        actorId: "1",
        displayName: "light",
        isGuest: true,
        rating: null,
      },
      dark: { actorType: "guest", actorId: "2", displayName: "dark", isGuest: true, rating: null },
    },
    state: toSerializableGameState(createInitialGame("light")),
    activePlayer: "light",
    clocks: {
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      turnStartedAt: null,
      serverTime: 0,
    },
    result: null,
    lastMove: null,
  };
}

type FakeOptions = Readonly<{
  latencyMs?: number;
  /** Version increments the server reports, in order. A 2 is a lost move. */
  increments?: readonly number[];
  rejectAt?: number;
  completions?: number;
  failToOpen?: string;
  onSubmit?: (seat: Player, move: Move) => void;
}>;

function fakePort(options: FakeOptions = {}): { port: LoadPort; closed: () => number } {
  let clock = 0;
  let closed = 0;
  const port: LoadPort = {
    now: () => clock,
    openMatch: (index) => {
      if (options.failToOpen !== undefined) {
        return Promise.reject(new Error(options.failToOpen));
      }
      let submitted = 0;
      let version = 0;
      const handle: LoadMatchHandle = {
        matchId: `match-${String(index)}`,
        snapshot: snapshotFixture(`match-${String(index)}`),
        completions: () => options.completions ?? 1,
        close: () => {
          closed += 1;
          return Promise.resolve();
        },
        submit: (seat, move) => {
          options.onSubmit?.(seat, move);
          clock += options.latencyMs ?? 10;
          submitted += 1;
          if (options.rejectAt === submitted) {
            return Promise.resolve({ ok: false, newVersion: null, reason: "version_conflict" });
          }
          version += options.increments?.[submitted - 1] ?? 1;
          return Promise.resolve({ ok: true, newVersion: version, reason: null });
        },
      };
      return Promise.resolve(handle);
    },
  };
  return { port, closed: () => closed };
}

describe("the deterministic generator", () => {
  it("gives the same sequence for the same seed", () => {
    const first = seededRandom(42);
    const second = seededRandom(42);

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("gives a different sequence for a different seed", () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });

  it("stays inside the unit interval", () => {
    const draw = seededRandom(9);
    for (let index = 0; index < 200; index += 1) {
      const value = draw();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("percentiles", () => {
  it("is zero when there is nothing to measure", () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it("takes the sample at the rank, on unsorted input", () => {
    expect(percentile([50, 10, 20, 40, 30], 0.5)).toBe(30);
    expect(percentile([50, 10, 20, 40, 30], 0.95)).toBe(50);
  });

  it("never falls off either end", () => {
    expect(percentile([5], 0)).toBe(5);
    expect(percentile([5], 1)).toBe(5);
  });
});

describe("advancing the harness's own copy of the game", () => {
  it("returns the state after a legal move", () => {
    const state = advance(createInitialGame("light"), {
      kind: "reserve",
      reserveStack: 0,
      to: "r0c0",
    });

    expect(state.activePlayer).toBe("dark");
    expect(state.ply).toBe(1);
  });

  it("throws when the engine refuses, because that means the harness is wrong", () => {
    expect(() =>
      advance(createInitialGame("light"), { kind: "board", from: "r0c0", to: "r1c1" }),
    ).toThrow(/the harness produced an illegal move/);
  });
});

describe("playing one match", () => {
  it("plays legal moves, alternating seats, and measures each acknowledgement", async () => {
    const seats: Player[] = [];
    const { port, closed } = fakePort({ latencyMs: 8, onSubmit: (seat) => seats.push(seat) });

    const outcome = await playMatch(port, 0, PLAN, seededRandom(1));

    expect(outcome.movesAccepted).toBe(3);
    expect(outcome.latenciesMs).toEqual([8, 8, 8]);
    expect(seats).toEqual(["light", "dark", "light"]);
    expect(outcome.error).toBeNull();
    expect(closed()).toBe(1);
  });

  it("counts a version that skips as a lost move", async () => {
    const { port } = fakePort({ increments: [1, 2, 1] });

    const outcome = await playMatch(port, 0, PLAN, seededRandom(1));

    expect(outcome.lostMoves).toBe(1);
    expect(outcome.movesAccepted).toBe(3);
  });

  it("stops at a rejection and records it", async () => {
    const { port } = fakePort({ rejectAt: 2 });

    const outcome = await playMatch(port, 0, PLAN, seededRandom(1));

    expect(outcome.movesRejected).toBe(1);
    expect(outcome.movesAccepted).toBe(1);
  });

  it("counts a second end event as a duplicate completion", async () => {
    const { port } = fakePort({ completions: 2 });

    const outcome = await playMatch(port, 0, PLAN, seededRandom(1));

    expect(outcome.duplicateCompletions).toBe(1);
  });

  it("does not count a single end event as a duplicate", async () => {
    const { port } = fakePort({ completions: 0 });

    const outcome = await playMatch(port, 0, PLAN, seededRandom(1));

    expect(outcome.duplicateCompletions).toBe(0);
  });

  it("records a failure after the match opened, keeping the identifier", async () => {
    const port: LoadPort = {
      now: () => 0,
      openMatch: (index) =>
        Promise.resolve({
          matchId: `match-${String(index)}`,
          snapshot: snapshotFixture(`match-${String(index)}`),
          completions: () => 1,
          close: () => Promise.resolve(),
          submit: () => Promise.reject(new Error("the socket closed mid-move")),
        }),
    };

    const outcome = await playMatch(port, 5, PLAN, seededRandom(1));

    expect(outcome.error).toBe("the socket closed mid-move");
    expect(outcome.matchId).toBe("match-5");
  });

  it("records a match that never opened, without throwing", async () => {
    const { port, closed } = fakePort({ failToOpen: "the server refused the connection" });

    const outcome = await playMatch(port, 3, PLAN, seededRandom(1));

    expect(outcome.error).toBe("the server refused the connection");
    expect(outcome.matchId).toBeNull();
    expect(closed()).toBe(0);
  });

  it("stops when the game is over rather than sending into a finished match", async () => {
    const { port } = fakePort();
    // Long enough that a random game reaches a result inside the budget.
    const outcome = await playMatch(
      port,
      0,
      { ...PLAN, movesPerMatch: 400 },
      seededRandom(20_260_727),
    );

    expect(outcome.finished).toBe(true);
    expect(outcome.movesAccepted).toBeLessThan(400);
  });
});

describe("running a plan", () => {
  it("opens every match and totals the run", async () => {
    const { port, closed } = fakePort({ latencyMs: 5 });

    const summary = await runLoad(port, { matches: 4, movesPerMatch: 2, waveSize: 1, seed: 3 });

    expect(summary.clients).toBe(8);
    expect(summary.matchesOpened).toBe(4);
    expect(summary.matchesFailed).toBe(0);
    expect(summary.movesAccepted).toBe(8);
    expect(summary.latency.count).toBe(8);
    expect(summary.latency.mean).toBe(5);
    expect(closed()).toBe(4);
  });

  it("runs a partial wave rather than overshooting the plan", async () => {
    const { port, closed } = fakePort();

    await runLoad(port, { matches: 3, movesPerMatch: 1, waveSize: 2, seed: 3 });

    expect(closed()).toBe(3);
  });

  it("collects the failures without stopping the run", async () => {
    const { port } = fakePort({ failToOpen: "connection refused" });

    const summary = await runLoad(port, { matches: 2, movesPerMatch: 1, waveSize: 1, seed: 3 });

    expect(summary.matchesFailed).toBe(2);
    expect(summary.matchesOpened).toBe(0);
    expect(summary.errors).toEqual(["connection refused"]);
  });

  it("measures how long the run took", async () => {
    const { port } = fakePort({ latencyMs: 20 });

    const summary = await runLoad(port, { matches: 2, movesPerMatch: 2, waveSize: 1, seed: 3 });

    expect(summary.durationMs).toBe(80);
  });
});

describe("the verdict", () => {
  function summaryOf(outcomes: readonly Partial<MatchOutcome>[], durationMs = 1_000) {
    const filled = outcomes.map((outcome, index) => ({
      index,
      matchId: `match-${String(index)}`,
      latenciesMs: [],
      movesAccepted: 0,
      movesRejected: 0,
      lostMoves: 0,
      duplicateCompletions: 0,
      finished: false,
      error: null,
      ...outcome,
    }));
    return summarise(PLAN, filled, durationMs);
  }

  it("passes a clean run inside the latency target", () => {
    const verdict = judgeLoad(summaryOf([{ latenciesMs: [10, 20, 30], movesAccepted: 3 }]));

    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("fails when a match never started", () => {
    const verdict = judgeLoad(summaryOf([{ error: "connection refused" }]));

    expect(verdict.failures[0]).toContain("1 matches never started");
  });

  it("fails when a legal move was rejected", () => {
    const verdict = judgeLoad(summaryOf([{ latenciesMs: [5], movesRejected: 1 }]));

    expect(verdict.failures).toContain("1 legal moves were rejected");
  });

  it("fails when a committed move was lost", () => {
    const verdict = judgeLoad(summaryOf([{ latenciesMs: [5], lostMoves: 2 }]));

    expect(verdict.failures).toContain("2 committed moves were lost");
  });

  it("fails when a match completed twice", () => {
    const verdict = judgeLoad(summaryOf([{ latenciesMs: [5], duplicateCompletions: 1 }]));

    expect(verdict.failures).toContain("1 matches completed more than once");
  });

  it("fails when nothing was measured", () => {
    const verdict = judgeLoad(summaryOf([{}]));

    expect(verdict.failures).toContain("no move was acknowledged, so there is nothing to measure");
  });

  it("fails on the p95 target of section 20.8", () => {
    const slow = Array.from({ length: 100 }, (_, index) => (index < 94 ? 10 : 500));
    const verdict = judgeLoad(summaryOf([{ latenciesMs: slow }]));

    expect(verdict.failures.some((failure) => failure.includes("p95"))).toBe(true);
    expect(LOAD_TARGETS.moveAckP95Ms).toBe(100);
  });

  it("fails on the p99 target even when the p95 holds", () => {
    const spiky = Array.from({ length: 100 }, (_, index) => (index < 98 ? 10 : 900));
    const verdict = judgeLoad(summaryOf([{ latenciesMs: spiky }]));

    expect(verdict.failures.some((failure) => failure.includes("p99"))).toBe(true);
    expect(verdict.failures.some((failure) => failure.includes("p95"))).toBe(false);
  });

  it("knows a small run is not the specified scale", () => {
    expect(judgeLoad(summaryOf([{ latenciesMs: [5] }])).atSpecifiedScale).toBe(false);
  });

  it("knows a run at the specified scale is one", () => {
    const outcomes = Array.from({ length: SPECIFIED_SCALE.matches }, () => ({
      latenciesMs: [5],
    }));

    expect(judgeLoad(summaryOf(outcomes)).atSpecifiedScale).toBe(true);
  });
});

describe("the report", () => {
  const summary = summarise(
    PLAN,
    [
      {
        index: 0,
        matchId: "match-0",
        latenciesMs: [10, 20],
        movesAccepted: 2,
        movesRejected: 0,
        lostMoves: 0,
        duplicateCompletions: 0,
        finished: true,
        error: null,
      },
    ],
    2_000,
  );

  it("states the scale it ran at, as a share of the target", () => {
    const text = formatLoadReport(summary, judgeLoad(summary));

    expect(text).toContain("2 clients in 1 matches");
    expect(text).toContain("percent of the scale specification section 20.8 asks for");
    expect(text).toContain("does not prove the target at its stated scale");
  });

  it("reports the latency distribution and the duration", () => {
    const text = formatLoadReport(summary, judgeLoad(summary));

    expect(text).toContain("p50 10.0 ms, p95 20.0 ms, p99 20.0 ms, max 20.0 ms");
    expect(text).toContain("run took 2.0 s");
    expect(text).toContain("PASS against the latency and correctness targets");
  });

  it("lists what failed", () => {
    const failing = { ...summary, lostMoves: 1 };
    const text = formatLoadReport(failing, judgeLoad(failing));

    expect(text).toContain("FAIL");
    expect(text).toContain("1 committed moves were lost");
  });

  it("says so plainly when the run was at the specified scale", () => {
    const large = {
      ...summary,
      clients: SPECIFIED_SCALE.clients,
      matchesOpened: SPECIFIED_SCALE.matches,
    };
    const text = formatLoadReport(large, judgeLoad(large));

    expect(text).toContain("at the scale specification section 20.8 asks for");
    expect(text).not.toContain("does not prove the target");
  });
});
