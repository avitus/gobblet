import { Badge, Banner, Button, Card, Spinner } from "@gobblet/design-system";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { useApi } from "../api/provider";
import { useMe, useServerConfig } from "../api/queries";
import { describeApiError } from "../api/errors";
import { storedSessionFromGuest } from "../session/apply-auth";
import { useSessionStore } from "../session/store";
import styles from "./HomeScreen.module.css";

function formatTimeControls(seconds: readonly number[]): string {
  return seconds.map((value) => `${String(value / 60)} min`).join(", ");
}

export function HomeScreen(): React.JSX.Element {
  const session = useSessionStore((state) => state.session);
  const signedIn = useSessionStore((state) => state.signedIn);
  const api = useApi();
  const navigate = useNavigate();
  const config = useServerConfig();
  const me = useMe(session?.kind === "account");

  const startGuest = useMutation({
    mutationFn: () => api.createGuest(),
    onSuccess: (guest) => {
      signedIn(storedSessionFromGuest(guest));
    },
  });

  return (
    <div className={styles.layout}>
      {session === null ? (
        <Card
          title="Play Gobblet"
          description="Four sizes, sixteen squares, and a piece that can swallow another."
        >
          {startGuest.isError && <Banner tone="error">{describeApiError(startGuest.error)}</Banner>}
          <div className={styles.actions}>
            <Button
              busy={startGuest.isPending}
              onClick={() => {
                startGuest.mutate();
              }}
              data-testid="play-as-guest"
            >
              Play as guest
            </Button>
            <Button variant="secondary" onClick={() => void navigate("/sign-in")}>
              Sign in
            </Button>
            <Button variant="ghost" onClick={() => void navigate("/register")}>
              Create account
            </Button>
          </div>
          <p>
            A guest can play casual matches straight away. Ranked play needs an account with a
            verified email address.
          </p>
        </Card>
      ) : (
        <Card
          title={session.displayName}
          description={
            session.kind === "guest"
              ? "Guest session. Casual matches only, and the session ends when it expires."
              : "Signed in."
          }
          actions={session.kind === "guest" ? <Badge>guest</Badge> : undefined}
        >
          {session.kind === "guest" ? (
            <div className={styles.actions}>
              <Button onClick={() => void navigate("/register")}>Keep this history</Button>
            </div>
          ) : me.isLoading ? (
            <Spinner label="Loading your record" />
          ) : me.isError ? (
            <Banner tone="error">{describeApiError(me.error)}</Banner>
          ) : me.data === undefined ? null : (
            <dl className={styles.details} data-testid="account-record">
              <dt>Email</dt>
              <dd>{me.data.account.emailVerified ? "verified" : "unverified"}</dd>
              <dt>Casual</dt>
              <dd>
                {me.data.casual.wins}W {me.data.casual.losses}L {me.data.casual.draws}D
              </dd>
              <dt>Ranked</dt>
              <dd>
                {me.data.ranked === null
                  ? "no ranked matches yet"
                  : `${String(me.data.ranked.rating)} rating, ${String(me.data.ranked.wins)}W ${String(me.data.ranked.losses)}L ${String(me.data.ranked.draws)}D`}
              </dd>
            </dl>
          )}
          {session.kind === "account" && me.data?.account.emailVerified === false && (
            <Banner tone="warning" title="Email not verified">
              Ranked play needs a verified email. <Link to="/verify-email">Verify now</Link>.
            </Banner>
          )}
        </Card>
      )}

      <Card title="Server" compact>
        {config.isLoading ? (
          <Spinner label="Checking the server" />
        ) : config.isError ? (
          <Banner tone="error">{describeApiError(config.error)}</Banner>
        ) : config.data === undefined ? null : (
          <dl className={styles.details}>
            <dt>Environment</dt>
            <dd>{config.data.appEnv}</dd>
            <dt>Build</dt>
            <dd>{config.data.appVersion}</dd>
            <dt>Modes</dt>
            <dd>{config.data.modes.join(", ")}</dd>
            <dt>Clocks</dt>
            <dd>{formatTimeControls(config.data.timeControlsSeconds)}</dd>
          </dl>
        )}
      </Card>
    </div>
  );
}
