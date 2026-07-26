import { Badge, Banner, Button, Card, Dialog, Spinner, cx } from "@gobblet/design-system";
import { BoardView, formatClock, isLowTime, useClockDisplay } from "@gobblet/game-ui";
import type {
  MatchEndedEvent,
  MatchPlayer,
  MatchRatingChanges,
  MatchSnapshot,
  Player,
} from "@gobblet/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { COMPLETED_MATCH_QUERY_KEYS } from "../api/queries";
import { CommunicationPanel } from "../match/CommunicationPanel";
import { opponentOf, seatOf } from "../match/seat";
import { useCommunication } from "../match/use-communication";
import { useMatchChannel } from "../match/use-match-channel";
import type { MatchChannel } from "../match/use-match-channel";
import { useMatchSounds } from "../match/use-match-sounds";
import { useRematch } from "../match/use-rematch";
import { useSessionStore } from "../session/store";
import { useSettingsStore } from "../settings/store";
import { useSoundEngine } from "../sound/provider";
import styles from "./MatchScreen.module.css";

const END_REASONS: Readonly<Record<MatchEndedEvent["reason"], string>> = Object.freeze({
  line: "four in a line",
  "revealed-line": "a line revealed by lifting a piece",
  timeout: "the clock ran out",
  resignation: "a resignation",
  repetition: "the same position three times",
  admin: "an administrator",
});

/**
 * The match itself: the board, the two clocks and the result. Every fact shown here
 * comes from the snapshot the server sent, and the only local additions are the
 * clock interpolation and the pending-move preview (docs/adr/0020).
 */
export function MatchScreen(): React.JSX.Element {
  const { matchId = null } = useParams<{ matchId: string }>();
  const channel = useMatchChannel(matchId);
  const { state, view } = channel;

  if (matchId === null) {
    return <Banner tone="error">This address does not name a match</Banner>;
  }

  if (view === null) {
    return (
      <div className={styles.loading}>
        {state.phase === "lost" ? (
          <Banner tone="error" title="The match could not be opened">
            {state.notice}
          </Banner>
        ) : (
          <Spinner label="Opening the match" />
        )}
      </div>
    );
  }

  return <MatchBoard matchId={matchId} channel={channel} view={view} />;
}

type MatchBoardProps = Readonly<{
  matchId: string;
  channel: MatchChannel;
  view: MatchSnapshot;
}>;

/** Everything below here has a snapshot to draw, so nothing about it is optional. */
function MatchBoard({ matchId, channel, view }: MatchBoardProps): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actor = useSessionStore((state) => state.actor);
  const renderTier = useSettingsStore((state) => state.renderTier);
  const engine = useSoundEngine();

  const { state } = channel;
  const actorId = actor?.actorId ?? null;
  const seat = seatOf(view, actorId);
  const ended = state.ended;
  // Subscribed from the start: an offer can follow the end of a match immediately,
  // and a subscription that waited for the end would miss it.
  const rematch = useRematch(matchId, actorId);
  const communication = useCommunication(matchId, seat);

  const running = view.status === "active" && ended === null;
  const clocks = useClockDisplay({
    clocks: view.clocks,
    activePlayer: view.activePlayer,
    running,
  });
  const remainingFor = (colour: Player): number =>
    colour === "light" ? clocks.lightRemainingMs : clocks.darkRemainingMs;

  useMatchSounds({
    snapshot: state.snapshot,
    ended,
    seat,
    lowTime: running && isLowTime(remainingFor(seat ?? "light")),
  });

  useEffect(() => {
    if (rematch.nextMatchId !== null) {
      void navigate(`/match/${rematch.nextMatchId}`);
    }
  }, [rematch.nextMatchId, navigate]);

  useEffect(() => {
    if (ended === null) {
      return;
    }
    for (const queryKey of COMPLETED_MATCH_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [ended, queryClient]);

  const near = seat ?? "light";
  const far = opponentOf(near);
  const theirOffer = rematch.status?.state === "offered" && !rematch.offeredByMe;

  return (
    <div className={styles.layout} data-testid="match-screen">
      <div className={styles.boardColumn}>
        {state.phase === "reconnecting" && (
          <Banner tone="warning" data-testid="reconnecting">
            The connection dropped. The board is frozen until it returns.
          </Banner>
        )}
        {state.notice !== null && (
          <Banner tone="warning" data-testid="match-notice">
            <span className={styles.notice}>
              {state.notice}
              <Button size="sm" variant="ghost" onClick={channel.dismissNotice}>
                Dismiss
              </Button>
            </span>
          </Banner>
        )}
        <BoardView
          state={view.state}
          seat={seat}
          locked={channel.inputLocked || ended !== null}
          onSubmit={channel.submitMove}
          preference={renderTier}
          onSelectionChange={(origin) => {
            if (origin !== null) {
              engine.play("piece-select");
            }
          }}
        />
      </div>

      <div className={styles.side}>
        <PlayerPanel
          player={view.players[far]}
          colour={far}
          remainingMs={remainingFor(far)}
          toMove={view.activePlayer === far && running}
          you={false}
        />
        <PlayerPanel
          player={view.players[near]}
          colour={near}
          remainingMs={remainingFor(near)}
          toMove={view.activePlayer === near && running}
          you={seat !== null}
        />

        <Card title="Match" compact>
          <dl className={styles.details}>
            <dt>Mode</dt>
            <dd data-testid="match-mode">{view.mode}</dd>
            <dt>Clock</dt>
            <dd>{`${String(view.timeControlSeconds / 60)} min`}</dd>
            <dt>Move</dt>
            <dd data-testid="match-version">{view.version}</dd>
            <dt>Connection</dt>
            <dd data-testid="match-phase">{state.phase}</dd>
          </dl>
          {seat !== null && ended === null && (
            <Button
              variant="secondary"
              size="sm"
              disabled={channel.inputLocked}
              onClick={channel.resign}
              data-testid="resign"
            >
              Resign
            </Button>
          )}
        </Card>

        {seat !== null && (
          <CommunicationPanel
            communication={communication}
            opponentName={view.players[far].displayName}
          />
        )}
      </div>

      <Dialog
        open={ended !== null}
        title={resultTitle(ended, seat)}
        data-testid="result-dialog"
        footer={
          <div className={styles.dialogActions}>
            {seat !== null && (
              <Button
                busy={rematch.pending}
                onClick={
                  theirOffer
                    ? () => {
                        rematch.respond(true);
                      }
                    : rematch.offer
                }
                data-testid="rematch"
              >
                {theirOffer ? "Accept rematch" : "Offer a rematch"}
              </Button>
            )}
            {theirOffer && (
              <Button
                variant="ghost"
                onClick={() => {
                  rematch.respond(false);
                }}
                data-testid="decline-rematch"
              >
                Decline
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void navigate("/")}
              data-testid="leave-match"
            >
              Back to play
            </Button>
          </div>
        }
      >
        {ended === null ? null : (
          <div className={styles.result}>
            <p data-testid="result-reason">Decided by {END_REASONS[ended.reason]}.</p>
            {ended.ratings != null && (
              <p data-testid="result-ratings">{describeRatings(ended.ratings, view.players)}</p>
            )}
            {rematch.notice !== null && <Banner tone="warning">{rematch.notice}</Banner>}
            {rematch.status?.state === "offered" && rematch.offeredByMe && (
              <p data-testid="rematch-waiting">Waiting for your opponent to answer.</p>
            )}
            {rematch.status?.state === "declined" && <p>Your opponent declined.</p>}
            {rematch.status?.state === "expired" && <p>The offer expired.</p>}
          </div>
        )}
      </Dialog>
    </div>
  );
}

type PlayerPanelProps = Readonly<{
  player: MatchPlayer;
  colour: Player;
  remainingMs: number;
  toMove: boolean;
  you: boolean;
}>;

function PlayerPanel({
  player,
  colour,
  remainingMs,
  toMove,
  you,
}: PlayerPanelProps): React.JSX.Element {
  const low = isLowTime(remainingMs);

  return (
    <div
      className={cx(styles.player, toMove && styles.playerToMove)}
      data-testid={`player-${colour}`}
      data-to-move={toMove ? "true" : "false"}
    >
      <div className={styles.playerHead}>
        <span className={styles.playerColour} data-colour={colour} aria-hidden="true" />
        <span className={styles.playerName}>{player.displayName}</span>
        {player.isGuest && <Badge>guest</Badge>}
        {you && <Badge tone="accent">you</Badge>}
      </div>
      <div
        className={cx(styles.clock, low && styles.clockLow)}
        data-testid={`clock-${colour}`}
        data-low={low ? "true" : "false"}
        aria-label={`${colour} clock`}
      >
        {formatClock(remainingMs)}
      </div>
      <div className={styles.playerRating}>
        {player.rating === null ? "unrated" : `${String(player.rating)} rating`}
      </div>
    </div>
  );
}

function resultTitle(ended: MatchEndedEvent | null, seat: Player | null): string {
  if (ended === null) {
    return "";
  }
  if (ended.result === "draw") {
    return "A draw";
  }
  if (seat === null) {
    return `${ended.result === "light" ? "Light" : "Dark"} won`;
  }
  return ended.result === seat ? "You won" : "You lost";
}

function describeRatings(
  ratings: MatchRatingChanges,
  players: Readonly<Record<Player, MatchPlayer>>,
): string {
  return (["light", "dark"] as const)
    .map((colour) => {
      const change = ratings[colour];
      const sign = change.delta >= 0 ? "+" : "";
      return `${players[colour].displayName} ${String(change.after)} (${sign}${String(change.delta)})`;
    })
    .join(", ");
}
