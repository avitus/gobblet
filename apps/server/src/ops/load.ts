import { randomUUID } from "node:crypto";
import {
  applyMove,
  enumerateMoves,
  fromSerializableGameState,
  isGameOver,
} from "@gobblet/game-core";
import type { GameState, Move, Player } from "@gobblet/game-core";
import type { MatchSnapshot } from "@gobblet/protocol";

/**
 * The load target of specification section 20.8, as a harness we own
 * (docs/adr/0037-the-load-harness-is-ours.md). What is measured is what the target
 * is about: acknowledgement latency under concurrency, no committed move lost, no
 * match completing twice.
 *
 * The transport is a port. Everything that decides what to send, when to send it,
 * and whether the run passed lives here, where a test can drive it without a socket;
 * `load-socket.ts` is the one implementation and is exercised against a real server.
 */

/** The scale section 20.8 names. A run below it says so in the report, loudly. */
export const SPECIFIED_SCALE = Object.freeze({ clients: 1_000, matches: 500 });

/** Section 20.8, "p95 action-to-acknowledgement latency under 100 ms". */
export const LOAD_TARGETS = Object.freeze({
  moveAckP95Ms: 100,
  moveAckP99Ms: 250,
});

export type LoadPlan = Readonly<{
  /** Concurrent matches. Two clients are connected for each. */
  matches: number;
  /** Moves each match attempts before it is torn down. */
  movesPerMatch: number;
  /** Matches are opened in waves of this size, so a run ramps instead of stampeding. */
  waveSize: number;
  /** Makes a run reproducible: the same seed picks the same moves. */
  seed: number;
}>;

export type LoadMoveAck = Readonly<{
  ok: boolean;
  /** The version the server committed, when it accepted the move. */
  newVersion: number | null;
  /** The rejection reason, when it did not. */
  reason: string | null;
}>;

/** One paired match, both seats driven by the harness. */
export type LoadMatchHandle = Readonly<{
  matchId: string;
  snapshot: MatchSnapshot;
  submit: (
    seat: Player,
    move: Move,
    envelope: Readonly<{ commandId: string; matchId: string; expectedVersion: number }>,
  ) => Promise<LoadMoveAck>;
  /** The most `match:ended` events either seat has seen. One is a normal finish. */
  completions: () => number;
  close: () => Promise<void>;
}>;

export type LoadPort = Readonly<{
  /** Connects two clients, queues them, and resolves when they are paired. */
  openMatch: (index: number) => Promise<LoadMatchHandle>;
  now: () => number;
}>;

export type MatchOutcome = Readonly<{
  index: number;
  matchId: string | null;
  latenciesMs: readonly number[];
  movesAccepted: number;
  movesRejected: number;
  /** A committed move the server numbered other than one past the last version. */
  lostMoves: number;
  /** More than one end event for a single match. */
  duplicateCompletions: number;
  finished: boolean;
  error: string | null;
}>;

export type LoadSummary = Readonly<{
  plan: LoadPlan;
  clients: number;
  matchesOpened: number;
  matchesFailed: number;
  matchesFinished: number;
  movesAccepted: number;
  movesRejected: number;
  lostMoves: number;
  duplicateCompletions: number;
  latency: Readonly<{
    count: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    mean: number;
  }>;
  durationMs: number;
  errors: readonly string[];
}>;

export type LoadVerdict = Readonly<{
  ok: boolean;
  /** True only when the run was at least as large as section 20.8 asks for. */
  atSpecifiedScale: boolean;
  failures: readonly string[];
}>;

/** A small deterministic generator, so a failing run can be replayed exactly. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] as number;
}

/**
 * Advances the harness's own copy of the game. The move came from `enumerateMoves`,
 * so a refusal means the harness and the engine disagree, which is worth failing the
 * run over rather than counting as a server-side rejection.
 */
export function advance(state: GameState, move: Move): GameState {
  const result = applyMove(state, move);
  if (!result.ok) {
    throw new Error(`the harness produced an illegal move: ${result.reason}`);
  }
  return result.state;
}

/**
 * Plays one match to the plan, tracking the game with the same engine the server
 * uses so the harness only ever sends legal moves. An illegal move would measure the
 * rejection path, which is not what the target is about.
 */
export async function playMatch(
  port: LoadPort,
  index: number,
  plan: LoadPlan,
  pick: () => number,
): Promise<MatchOutcome> {
  const latenciesMs: number[] = [];
  let handle: LoadMatchHandle | null = null;
  let movesAccepted = 0;
  let movesRejected = 0;
  let lostMoves = 0;
  let finished = false;

  try {
    handle = await port.openMatch(index);
    let state: GameState = fromSerializableGameState(handle.snapshot.state);
    let version = handle.snapshot.version;

    for (let move = 0; move < plan.movesPerMatch; move += 1) {
      // `enumerateMoves` is empty exactly when the game is over, so this is both the
      // bounds check and the end-of-game check.
      const legal = enumerateMoves(state);
      const chosen = legal[Math.floor(pick() * legal.length)];
      if (chosen === undefined) {
        finished = true;
        break;
      }
      const startedAt = port.now();
      const ack = await handle.submit(state.activePlayer, chosen.move, {
        commandId: randomUUID(),
        matchId: handle.matchId,
        expectedVersion: version,
      });
      latenciesMs.push(port.now() - startedAt);

      if (!ack.ok || ack.newVersion === null) {
        movesRejected += 1;
        break;
      }
      // Persist-before-acknowledge means the version advances by exactly one. Anything
      // else is a move the server did not record where the harness thinks it did.
      if (ack.newVersion !== version + 1) {
        lostMoves += 1;
      }
      version = ack.newVersion;
      movesAccepted += 1;
      state = advance(state, chosen.move);
      finished = isGameOver(state);
    }

    const completions = handle.completions();
    const outcome: MatchOutcome = {
      index,
      matchId: handle.matchId,
      latenciesMs,
      movesAccepted,
      movesRejected,
      lostMoves,
      duplicateCompletions: Math.max(completions - 1, 0),
      finished,
      error: null,
    };
    await handle.close();
    return outcome;
  } catch (error) {
    await handle?.close();
    return {
      index,
      matchId: handle?.matchId ?? null,
      latenciesMs,
      movesAccepted,
      movesRejected,
      lostMoves,
      duplicateCompletions: 0,
      finished: false,
      error: (error as Error).message,
    };
  }
}

export async function runLoad(port: LoadPort, plan: LoadPlan): Promise<LoadSummary> {
  const startedAt = port.now();
  const outcomes: MatchOutcome[] = [];

  for (let first = 0; first < plan.matches; first += plan.waveSize) {
    const wave = Array.from(
      { length: Math.min(plan.waveSize, plan.matches - first) },
      (_, offset) => first + offset,
    );
    outcomes.push(
      ...(await Promise.all(
        wave.map((index) => playMatch(port, index, plan, seededRandom(plan.seed + index))),
      )),
    );
  }

  return summarise(plan, outcomes, port.now() - startedAt);
}

export function summarise(
  plan: LoadPlan,
  outcomes: readonly MatchOutcome[],
  durationMs: number,
): LoadSummary {
  const latencies = outcomes.flatMap((outcome) => outcome.latenciesMs);
  const total = latencies.reduce((sum, sample) => sum + sample, 0);
  const failed = outcomes.filter((outcome) => outcome.error !== null);

  return {
    plan,
    clients: outcomes.length * 2,
    matchesOpened: outcomes.length - failed.length,
    matchesFailed: failed.length,
    matchesFinished: outcomes.filter((outcome) => outcome.finished).length,
    movesAccepted: sum(outcomes, (outcome) => outcome.movesAccepted),
    movesRejected: sum(outcomes, (outcome) => outcome.movesRejected),
    lostMoves: sum(outcomes, (outcome) => outcome.lostMoves),
    duplicateCompletions: sum(outcomes, (outcome) => outcome.duplicateCompletions),
    latency: {
      count: latencies.length,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length === 0 ? 0 : Math.max(...latencies),
      mean: latencies.length === 0 ? 0 : total / latencies.length,
    },
    durationMs,
    errors: [
      ...new Set(outcomes.flatMap((outcome) => (outcome.error === null ? [] : [outcome.error]))),
    ],
  };
}

function sum(outcomes: readonly MatchOutcome[], of: (outcome: MatchOutcome) => number): number {
  return outcomes.reduce((total, outcome) => total + of(outcome), 0);
}

export function judgeLoad(
  summary: LoadSummary,
  targets: typeof LOAD_TARGETS = LOAD_TARGETS,
): LoadVerdict {
  const failures: string[] = [];

  if (summary.matchesFailed > 0) {
    failures.push(
      `${String(summary.matchesFailed)} matches never started: ${summary.errors.join("; ")}`,
    );
  }
  if (summary.movesRejected > 0) {
    failures.push(`${String(summary.movesRejected)} legal moves were rejected`);
  }
  if (summary.lostMoves > 0) {
    failures.push(`${String(summary.lostMoves)} committed moves were lost`);
  }
  if (summary.duplicateCompletions > 0) {
    failures.push(`${String(summary.duplicateCompletions)} matches completed more than once`);
  }
  if (summary.latency.count === 0) {
    failures.push("no move was acknowledged, so there is nothing to measure");
  } else {
    if (summary.latency.p95 > targets.moveAckP95Ms) {
      failures.push(
        `p95 acknowledgement latency was ${format(summary.latency.p95)} ms, over the ${String(targets.moveAckP95Ms)} ms target`,
      );
    }
    if (summary.latency.p99 > targets.moveAckP99Ms) {
      failures.push(
        `p99 acknowledgement latency was ${format(summary.latency.p99)} ms, over the ${String(targets.moveAckP99Ms)} ms target`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    atSpecifiedScale:
      summary.clients >= SPECIFIED_SCALE.clients &&
      summary.matchesOpened >= SPECIFIED_SCALE.matches,
    failures,
  };
}

function format(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * The report always states the scale it ran at, so a small run on a shared runner can
 * never be read as the target being met (appendix P9.2).
 */
export function formatLoadReport(summary: LoadSummary, verdict: LoadVerdict): string {
  const scale = verdict.atSpecifiedScale
    ? `at the scale specification section 20.8 asks for (${String(SPECIFIED_SCALE.clients)} clients, ${String(SPECIFIED_SCALE.matches)} matches)`
    : `at ${String(Math.round((summary.matchesOpened / SPECIFIED_SCALE.matches) * 100))} percent of the scale specification section 20.8 asks for, which is ${String(SPECIFIED_SCALE.clients)} clients in ${String(SPECIFIED_SCALE.matches)} matches`;

  return [
    "Load run, specification section 20.8",
    `  ${String(summary.clients)} clients in ${String(summary.matchesOpened)} matches, ${scale}`,
    `  ${String(summary.movesAccepted)} moves accepted, ${String(summary.movesRejected)} rejected, ${String(summary.lostMoves)} lost`,
    `  ${String(summary.matchesFinished)} matches played to a result, ${String(summary.duplicateCompletions)} completed twice`,
    `  acknowledgement latency p50 ${format(summary.latency.p50)} ms, p95 ${format(summary.latency.p95)} ms, p99 ${format(summary.latency.p99)} ms, max ${format(summary.latency.max)} ms`,
    `  run took ${format(summary.durationMs / 1_000)} s`,
    verdict.ok ? "  PASS against the latency and correctness targets" : "  FAIL",
    ...verdict.failures.map((failure) => `    ${failure}`),
    verdict.atSpecifiedScale
      ? ""
      : "  This run does not prove the target at its stated scale. Run it against a host with the scale set to 500 matches.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
