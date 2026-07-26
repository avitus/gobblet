import type { Player } from "@gobblet/game-core";
import type {
  MatchFoundEvent,
  MatchSnapshot,
  QueueKey,
  QueueRejectionReason,
  QueueStatus,
} from "@gobblet/protocol";
import { checkParticipant } from "../match/eligibility";
import type { Ineligibility } from "../match/eligibility";
import type { MatchRuntime } from "../match/runtime";
import type { Actor } from "../match/snapshot";
import type { IdentityService } from "../identity/service";
import { findPairing, orderingRating, queueKeyOf, ratingWindowFor } from "./pairing";
import type { Pairing, QueueEntry } from "./pairing";

export type QueueCandidate = Readonly<{
  actor: Actor;
  displayName: string;
}>;

/** A pairing that has become a match, with the event each player must receive. */
export type SeatedMatch = Readonly<{
  snapshot: MatchSnapshot;
  /** How long the longer-waiting player waited, which is the metric worth logging. */
  waitedMs: number;
  events: readonly Readonly<{ actorId: string; event: MatchFoundEvent }>[];
}>;

export type JoinResult =
  | Readonly<{ outcome: "queued"; status: QueueStatus }>
  | Readonly<{ outcome: "seated"; seated: SeatedMatch }>
  | Readonly<{ outcome: "refused"; reason: QueueRejectionReason; ineligibility?: Ineligibility }>;

export type QueueDepth = QueueKey & Readonly<{ depth: number }>;

export type TickResult = Readonly<{
  seated: readonly SeatedMatch[];
  statuses: readonly Readonly<{ actorId: string; status: QueueStatus }>[];
}>;

/**
 * The seam ADR-0018 requires: everything the gateway needs from matchmaking,
 * so a shared store can replace the in-process implementation without the
 * gateway noticing.
 */
export interface MatchmakingQueue {
  join(candidate: QueueCandidate, key: QueueKey): Promise<JoinResult>;
  leave(actorId: string): boolean;
  statusOf(actorId: string): QueueStatus | null;
  tick(): Promise<TickResult>;
  depths(): readonly QueueDepth[];
  /** Closes the queue and returns the players it released, so each can be told. */
  stopAcceptingEntries(): readonly string[];
}

export type MatchmakingOptions = Readonly<{
  runtime: MatchRuntime;
  identity: IdentityService;
  now?: () => number;
  /** Injected so a test can fix which player takes light (spec section 9.4). */
  random?: () => number;
  /** How often a waiting player is told the depth and window it is searching in. */
  statusIntervalMs?: number;
}>;

type QueuedEntry = QueueEntry &
  Readonly<{ key: QueueKey }> & {
    /** When this player was last told what it is waiting for. */
    lastStatusAt: number;
  };

const DEFAULT_STATUS_INTERVAL_MS = 2_000;

export class MatchmakingService implements MatchmakingQueue {
  private readonly runtime: MatchRuntime;

  private readonly identity: IdentityService;

  private readonly clock: () => number;

  private readonly random: () => number;

  private readonly statusIntervalMs: number;

  /** One list per `(mode, timeControlSeconds)`, ordered by arrival. */
  private readonly queues = new Map<string, QueuedEntry[]>();

  /** One entry per player, so a client cannot occupy two queues (ADR-0018). */
  private readonly byActor = new Map<string, QueuedEntry>();

  private accepting = true;

  constructor(options: MatchmakingOptions) {
    this.runtime = options.runtime;
    this.identity = options.identity;
    this.clock = options.now ?? ((): number => Date.now());
    this.random = options.random ?? Math.random;
    this.statusIntervalMs = options.statusIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS;
  }

  async join(candidate: QueueCandidate, key: QueueKey): Promise<JoinResult> {
    if (!this.accepting) {
      return { outcome: "refused", reason: "queue-closed" };
    }

    const verdict = await checkParticipant(this.identity, candidate.actor, key.mode);
    if (!verdict.eligible) {
      return { outcome: "refused", reason: "ineligible", ineligibility: verdict.reason };
    }

    if (await this.runtime.hasUnfinishedMatch(candidate.actor)) {
      return { outcome: "refused", reason: "already-in-match" };
    }

    const rating = await this.ratingOf(candidate.actor);
    const now = this.clock();
    // A join while already queued replaces the entry, which is how a player
    // changes mode or time control without a second entry appearing.
    this.leave(candidate.actor.actorId);
    const entry: QueuedEntry = {
      actor: candidate.actor,
      displayName: candidate.displayName,
      rating,
      joinedAt: now,
      key,
      lastStatusAt: now,
    };
    this.entriesOf(key).push(entry);
    this.byActor.set(entry.actor.actorId, entry);

    // This player's eligibility was read a moment ago, so the pairing attempt does
    // not read it again; that also means a join can only ever answer with the queue
    // it created or the match it produced.
    const seated = await this.attemptPairing(key, entry.actor.actorId);
    if (seated?.events.some((published) => published.actorId === entry.actor.actorId)) {
      return { outcome: "seated", seated };
    }

    return { outcome: "queued", status: this.statusFor(entry) };
  }

  leave(actorId: string): boolean {
    const entry = this.byActor.get(actorId);
    if (!entry) {
      return false;
    }
    this.remove(entry);
    return true;
  }

  statusOf(actorId: string): QueueStatus | null {
    const entry = this.byActor.get(actorId);
    return entry ? this.statusFor(entry) : null;
  }

  private statusFor(entry: QueuedEntry): QueueStatus {
    const now = this.clock();
    return {
      mode: entry.key.mode,
      timeControlSeconds: entry.key.timeControlSeconds,
      rating: orderingRating(entry),
      waitingMs: Math.max(0, now - entry.joinedAt),
      ratingWindow: ratingWindowFor(entry.key.mode, entry, now),
      depth: this.entriesOf(entry.key).length,
      serverTime: now,
    };
  }

  /**
   * One cadence step. Waiting alone can make a pair legal, because the window
   * widens with time, so pairing is retried here as well as on join.
   */
  async tick(): Promise<TickResult> {
    const seated: SeatedMatch[] = [];
    for (const key of this.activeKeys()) {
      let match = await this.attemptPairing(key);
      while (match) {
        seated.push(match);
        match = await this.attemptPairing(key);
      }
    }
    return { seated, statuses: this.statusesDue() };
  }

  depths(): readonly QueueDepth[] {
    const depths: QueueDepth[] = [];
    for (const entries of this.queues.values()) {
      const first = entries[0];
      if (first) {
        depths.push({ ...first.key, depth: entries.length });
      }
    }
    return depths;
  }

  /** Draining stops new entries and releases everyone waiting (spec section 7.6). */
  stopAcceptingEntries(): readonly string[] {
    this.accepting = false;
    const released = [...this.byActor.keys()];
    this.queues.clear();
    this.byActor.clear();
    return released;
  }

  /**
   * Selection and removal are one synchronous step, with no `await` between them,
   * so two concurrent attempts cannot seat the same player twice (ADR-0018).
   * Eligibility is re-read first, because a suspension may have landed while the
   * player waited (appendix P4).
   */
  private async attemptPairing(key: QueueKey, justChecked?: string): Promise<SeatedMatch | null> {
    await this.dropIneligible(key, justChecked);

    const pairing = findPairing(this.entriesOf(key), key.mode, this.clock());
    if (!pairing) {
      return null;
    }
    this.remove(pairing.first);
    this.remove(pairing.second);

    return this.seat(pairing, key);
  }

  private async seat(pairing: Pairing, key: QueueKey): Promise<SeatedMatch> {
    const seats = this.assignSeats(pairing);
    const snapshot = await this.runtime.createMatch({
      mode: key.mode,
      timeControlSeconds: key.timeControlSeconds,
      light: { ...seats.light.actor, displayName: seats.light.displayName },
      dark: { ...seats.dark.actor, displayName: seats.dark.displayName },
      colorAssignment: "random",
      pairingWaitMs: pairing.waitedMs,
    });

    return seatedMatchOf(snapshot, pairing.waitedMs);
  }

  /** A first match assigns colours at random (spec section 9.4). */
  private assignSeats(pairing: Pairing): Readonly<Record<Player, QueueEntry>> {
    return this.random() < 0.5
      ? { light: pairing.first, dark: pairing.second }
      : { light: pairing.second, dark: pairing.first };
  }

  private async dropIneligible(key: QueueKey, justChecked?: string): Promise<void> {
    for (const entry of [...this.entriesOf(key)]) {
      if (entry.actor.actorId === justChecked) {
        continue;
      }
      const verdict = await checkParticipant(this.identity, entry.actor, key.mode);
      if (!verdict.eligible) {
        this.remove(entry);
      }
    }
  }

  private async ratingOf(actor: Actor): Promise<number | null> {
    if (actor.actorType !== "user") {
      return null;
    }
    const ranked = await this.identity.rankedRecord(actor.actorId);
    return ranked?.rating ?? null;
  }

  private statusesDue(): readonly Readonly<{ actorId: string; status: QueueStatus }>[] {
    const now = this.clock();
    const due: Readonly<{ actorId: string; status: QueueStatus }>[] = [];

    for (const entry of this.byActor.values()) {
      if (now - entry.lastStatusAt < this.statusIntervalMs) {
        continue;
      }
      entry.lastStatusAt = now;
      due.push({ actorId: entry.actor.actorId, status: this.statusFor(entry) });
    }

    return due;
  }

  private entriesOf(key: QueueKey): QueuedEntry[] {
    const identifier = queueKeyOf(key);
    const existing = this.queues.get(identifier);
    if (existing) {
      return existing;
    }
    const created: QueuedEntry[] = [];
    this.queues.set(identifier, created);
    return created;
  }

  private activeKeys(): readonly QueueKey[] {
    const keys: QueueKey[] = [];
    for (const entries of this.queues.values()) {
      const first = entries[0];
      if (first) {
        keys.push(first.key);
      }
    }
    return keys;
  }

  /** Removal is idempotent: a disconnect, a `queue:leave` and a pairing may race. */
  private remove(entry: QueueEntry): void {
    const queued = this.byActor.get(entry.actor.actorId);
    if (queued) {
      const entries = this.entriesOf(queued.key);
      const index = entries.indexOf(queued);
      if (index >= 0) {
        entries.splice(index, 1);
      }
      this.byActor.delete(entry.actor.actorId);
    }
  }
}

/**
 * The two `match:found` events a new match implies, one per seat. A rematch uses
 * this too, so both ways of starting a match publish the same shape.
 */
export function seatedMatchOf(snapshot: MatchSnapshot, waitedMs: number): SeatedMatch {
  return {
    snapshot,
    waitedMs,
    events: [
      {
        actorId: snapshot.players.light.actorId,
        event: foundEvent(snapshot, "light", waitedMs),
      },
      { actorId: snapshot.players.dark.actorId, event: foundEvent(snapshot, "dark", waitedMs) },
    ],
  };
}

function foundEvent(snapshot: MatchSnapshot, side: Player, waitedMs: number): MatchFoundEvent {
  const opponent = snapshot.players[side === "light" ? "dark" : "light"];
  return {
    matchId: snapshot.matchId,
    mode: snapshot.mode,
    timeControlSeconds: snapshot.timeControlSeconds,
    yourColor: side,
    opponent: {
      actorType: opponent.actorType,
      displayName: opponent.displayName,
      rating: opponent.rating,
    },
    waitedMs,
    snapshot,
  };
}
