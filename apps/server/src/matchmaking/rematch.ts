import type {
  MatchMode,
  MatchSnapshot,
  RematchRejectionReason,
  RematchStatusEvent,
} from "@gobblet/protocol";
import { REMATCH_OFFER_MS } from "@gobblet/protocol";
import { checkParticipant } from "../match/eligibility";
import type { Ineligibility } from "../match/eligibility";
import type { MatchRuntime } from "../match/runtime";
import type { Actor } from "../match/snapshot";
import type { IdentityService } from "../identity/service";
import { seatedMatchOf } from "./service";
import type { SeatedMatch } from "./service";

export type RematchOptions = Readonly<{
  runtime: MatchRuntime;
  identity: IdentityService;
  now?: () => number;
}>;

/** A status every participant of the finished match must be told about. */
export type RematchBroadcast = Readonly<{
  actorIds: readonly string[];
  status: RematchStatusEvent;
  /** The mode the offer is about, which is what an analytics event records. */
  mode: MatchMode;
  /** Present only when the answer created the next match. */
  next?: SeatedMatch;
}>;

export type RematchResult =
  | Readonly<{ ok: true; broadcast: RematchBroadcast }>
  | Readonly<{ ok: false; reason: RematchRejectionReason; ineligibility?: Ineligibility }>;

type Offer = {
  readonly matchId: string;
  readonly mode: MatchMode;
  readonly requestedBy: Actor;
  readonly opponent: Actor;
  readonly expiresAt: number;
};

/**
 * Rematch offers, held in the process against the match they follow (ADR-0018).
 * An offer is a coordination fact with a 30 second life, so it is never written
 * down; the match an accepted offer produces records its predecessor instead.
 */
export class RematchService {
  private readonly runtime: MatchRuntime;

  private readonly identity: IdentityService;

  private readonly clock: () => number;

  private readonly offersByMatch = new Map<string, Offer>();

  /** One open offer per player, so a client cannot hold two post-match rooms. */
  private readonly matchIdsByActor = new Map<string, string>();

  constructor(options: RematchOptions) {
    this.runtime = options.runtime;
    this.identity = options.identity;
    this.clock = options.now ?? ((): number => Date.now());
  }

  /**
   * Offers a rematch of a finished match. If the opponent has already offered one,
   * this accepts it rather than refusing, so two players who both press rematch
   * get a match instead of an error (appendix P4.11).
   */
  async request(actor: Actor, matchId: string): Promise<RematchResult> {
    const standing = this.offersByMatch.get(matchId);
    if (standing) {
      if (sameActor(standing.requestedBy, actor)) {
        return { ok: false, reason: "already-offered" };
      }
      return this.respond(actor, matchId, true);
    }
    if (this.matchIdsByActor.has(actor.actorId)) {
      return { ok: false, reason: "already-offered" };
    }

    const finished = await this.finishedMatch(actor, matchId);
    if (!finished.ok) {
      return finished;
    }
    const readiness = await this.readyToPlay(actor, finished.snapshot);
    if (!readiness.ok) {
      return readiness;
    }

    const offer: Offer = {
      matchId,
      mode: finished.snapshot.mode,
      requestedBy: actor,
      opponent: opponentOf(finished.snapshot, actor),
      expiresAt: this.clock() + REMATCH_OFFER_MS,
    };
    this.offersByMatch.set(matchId, offer);
    this.matchIdsByActor.set(actor.actorId, matchId);

    return { ok: true, broadcast: this.broadcast(offer, "offered") };
  }

  /**
   * Answers a standing offer. The player who made it may withdraw it by declining;
   * only the opponent can accept.
   */
  async respond(actor: Actor, matchId: string, accept: boolean): Promise<RematchResult> {
    const offer = this.offersByMatch.get(matchId);
    if (!offer || !this.isParticipant(offer, actor)) {
      return { ok: false, reason: "no-offer" };
    }

    if (sameActor(offer.requestedBy, actor)) {
      if (accept) {
        return { ok: false, reason: "no-offer" };
      }
      this.forget(offer);
      return { ok: true, broadcast: this.broadcast(offer, "cancelled") };
    }

    if (!accept) {
      this.forget(offer);
      return { ok: true, broadcast: this.broadcast(offer, "declined") };
    }

    const finished = await this.finishedMatch(actor, matchId);
    if (!finished.ok) {
      return finished;
    }
    for (const side of [actor, offer.requestedBy]) {
      const readiness = await this.readyToPlay(side, finished.snapshot);
      if (!readiness.ok) {
        return readiness;
      }
    }

    // Removed before the match is created, so an offer cannot be answered twice.
    this.forget(offer);
    const next = await this.createAlternated(finished.snapshot);

    return { ok: true, broadcast: { ...this.broadcast(offer, "accepted", next.snapshot), next } };
  }

  /** Offers whose deadline has passed, removed and reported once (spec section 4.5). */
  sweep(): readonly RematchBroadcast[] {
    const now = this.clock();
    const expired: RematchBroadcast[] = [];
    for (const offer of [...this.offersByMatch.values()]) {
      if (offer.expiresAt <= now) {
        this.forget(offer);
        expired.push(this.broadcast(offer, "expired"));
      }
    }
    return expired;
  }

  /** A disconnect ends any offer the player was part of (ADR-0018). */
  cancelFor(actorId: string): readonly RematchBroadcast[] {
    const cancelled: RematchBroadcast[] = [];
    for (const offer of [...this.offersByMatch.values()]) {
      if (offer.requestedBy.actorId === actorId || offer.opponent.actorId === actorId) {
        this.forget(offer);
        cancelled.push(this.broadcast(offer, "cancelled"));
      }
    }
    return cancelled;
  }

  /** A restart, or a drain, leaves no offer behind (ADR-0018). */
  forgetAll(): readonly RematchBroadcast[] {
    const cancelled = [...this.offersByMatch.values()].map((offer) =>
      this.broadcast(offer, "cancelled"),
    );
    this.offersByMatch.clear();
    this.matchIdsByActor.clear();
    return cancelled;
  }

  private async finishedMatch(
    actor: Actor,
    matchId: string,
  ): Promise<
    | Readonly<{ ok: true; snapshot: MatchSnapshot }>
    | Readonly<{ ok: false; reason: RematchRejectionReason }>
  > {
    const snapshot = await this.runtime.getSnapshotForActor(matchId, actor);
    if (!snapshot) {
      return { ok: false, reason: "not-participant" };
    }
    if (snapshot.status === "active" || snapshot.status === "queued") {
      return { ok: false, reason: "match-not-ended" };
    }
    return { ok: true, snapshot };
  }

  /**
   * Both sides must still be allowed to play the same mode, and neither may already
   * hold a clock, because a rematch would otherwise be a player's second match.
   */
  private async readyToPlay(
    actor: Actor,
    snapshot: MatchSnapshot,
  ): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "ineligible" }>> {
    const verdict = await checkParticipant(this.identity, actor, snapshot.mode);
    if (!verdict.eligible) {
      return { ok: false, reason: "ineligible" };
    }
    if (await this.runtime.hasUnfinishedMatch(actor)) {
      return { ok: false, reason: "ineligible" };
    }
    return { ok: true };
  }

  /** The colours alternate: whoever played dark now plays light (spec section 4.5). */
  private async createAlternated(previous: MatchSnapshot): Promise<SeatedMatch> {
    const light = previous.players.dark;
    const dark = previous.players.light;
    const snapshot = await this.runtime.createMatch({
      mode: previous.mode,
      timeControlSeconds: previous.timeControlSeconds,
      light: { actorType: light.actorType, actorId: light.actorId, displayName: light.displayName },
      dark: { actorType: dark.actorType, actorId: dark.actorId, displayName: dark.displayName },
      colorAssignment: "alternated",
      rematchOfMatchId: previous.matchId,
    });

    return seatedMatchOf(snapshot, 0);
  }

  private broadcast(
    offer: Offer,
    state: RematchStatusEvent["state"],
    next?: MatchSnapshot,
  ): RematchBroadcast {
    return {
      actorIds: [offer.requestedBy.actorId, offer.opponent.actorId],
      mode: offer.mode,
      status: {
        matchId: offer.matchId,
        state,
        requestedBy: offer.requestedBy.actorId,
        expiresAt: offer.expiresAt,
        nextMatchId: next?.matchId ?? null,
      },
    };
  }

  private isParticipant(offer: Offer, actor: Actor): boolean {
    return sameActor(offer.requestedBy, actor) || sameActor(offer.opponent, actor);
  }

  private forget(offer: Offer): void {
    this.offersByMatch.delete(offer.matchId);
    this.matchIdsByActor.delete(offer.requestedBy.actorId);
  }
}

function opponentOf(snapshot: MatchSnapshot, actor: Actor): Actor {
  const { light, dark } = snapshot.players;
  const other =
    light.actorId === actor.actorId && light.actorType === actor.actorType ? dark : light;
  return { actorType: other.actorType, actorId: other.actorId };
}

function sameActor(left: Actor, right: Actor): boolean {
  return left.actorType === right.actorType && left.actorId === right.actorId;
}
