import { Badge, Banner, Button, Card, SelectField, Spinner } from "@gobblet/design-system";
import type { MatchMode, TimeControl } from "@gobblet/protocol";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../api/errors";
import { useMe, useServerConfig } from "../api/queries";
import { useQueue } from "../match/use-queue";
import { useSessionStore } from "../session/store";
import { useSoundEngine } from "../sound/provider";
import styles from "./PlayScreen.module.css";

function describeTimeControl(seconds: number): string {
  return `${String(seconds / 60)} minutes`;
}

/**
 * Choosing a queue and waiting in it (docs/product-spec.md section 9). Ranked play
 * needs a verified account, so the choice is refused here as well as on the server,
 * which keeps the reason in front of the player instead of in an error.
 */
export function PlayScreen(): React.JSX.Element {
  const session = useSessionStore((state) => state.session);
  const navigate = useNavigate();
  const config = useServerConfig();
  const me = useMe(session?.kind === "account");
  const queue = useQueue();
  const engine = useSoundEngine();

  const [mode, setMode] = useState<MatchMode>("casual");
  const [timeControl, setTimeControl] = useState<TimeControl>(300);

  const rankedAllowed = session?.kind === "account" && me.data?.account.emailVerified === true;

  useEffect(() => {
    if (queue.found === null) {
      return;
    }
    engine.play("match-found");
    void navigate(`/match/${queue.found.matchId}`);
  }, [queue.found, engine, navigate]);

  if (session === null) {
    return (
      <Card title="Play Gobblet" description="A guest may play casual matches straight away.">
        <div className={styles.actions}>
          <Button onClick={() => void navigate("/")} data-testid="need-session">
            Start a session first
          </Button>
        </div>
      </Card>
    );
  }

  const waiting = queue.phase === "waiting" || queue.phase === "joining";

  return (
    <div className={styles.layout}>
      <Card
        title="Find a match"
        description="A queue is a mode and a clock. The first pair the server can make starts a match."
      >
        {queue.notice !== null && (
          <Banner tone="warning" data-testid="queue-notice">
            {queue.notice}
          </Banner>
        )}

        <div className={styles.fields}>
          <SelectField
            label="Mode"
            value={mode}
            data-testid="mode"
            disabled={waiting}
            onChange={(event) => {
              setMode(event.target.value === "ranked" ? "ranked" : "casual");
            }}
            options={[
              { value: "casual", label: "Casual" },
              { value: "ranked", label: "Ranked" },
            ]}
            hint={
              rankedAllowed
                ? "Ranked matches move your rating."
                : "Ranked play needs an account with a verified email address."
            }
          />
          <SelectField
            label="Clock"
            value={String(timeControl)}
            data-testid="time-control"
            disabled={waiting}
            onChange={(event) => {
              setTimeControl(Number(event.target.value) as TimeControl);
            }}
            options={(config.data?.timeControlsSeconds ?? [180, 300, 600, 900]).map((seconds) => ({
              value: String(seconds),
              label: describeTimeControl(seconds),
            }))}
          />
        </div>

        <div className={styles.actions}>
          {waiting ? (
            <>
              <Spinner label="Looking for an opponent" />
              <Button variant="secondary" onClick={queue.leave} data-testid="leave-queue">
                Stop searching
              </Button>
            </>
          ) : (
            <Button
              disabled={mode === "ranked" && !rankedAllowed}
              onClick={() => {
                queue.join({ mode, timeControlSeconds: timeControl });
              }}
              data-testid="join-queue"
            >
              Find a match
            </Button>
          )}
        </div>

        {queue.status !== null && (
          <dl className={styles.status} data-testid="queue-status">
            <dt>Waiting</dt>
            <dd>{`${String(Math.round(queue.status.waitingMs / 1000))} s`}</dd>
            <dt>In this queue</dt>
            <dd>{queue.status.depth}</dd>
            <dt>Rating band</dt>
            <dd>
              {queue.status.ratingWindow === null
                ? "any"
                : `${String(queue.status.ratingWindow.minimum)} to ${String(queue.status.ratingWindow.maximum)}`}
            </dd>
          </dl>
        )}
      </Card>

      <Card title="You" compact actions={session.kind === "guest" ? <Badge>guest</Badge> : null}>
        {config.isError ? (
          <Banner tone="error">{describeApiError(config.error)}</Banner>
        ) : (
          <dl className={styles.status}>
            <dt>Name</dt>
            <dd>{session.displayName}</dd>
            <dt>Ranked</dt>
            <dd>{rankedAllowed ? "available" : "unavailable"}</dd>
          </dl>
        )}
      </Card>
    </div>
  );
}
