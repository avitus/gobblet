import { Badge, Banner, Button, Card, Spinner, TextField } from "@gobblet/design-system";
import type { MeResponse, PublicServerConfig } from "@gobblet/protocol";
import { useMutation, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
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

  const [guestName, setGuestName] = useState("");

  const startGuest = useMutation({
    mutationFn: (displayName: string) =>
      displayName === "" ? api.createGuest() : api.createGuest(displayName),
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
          <TextField
            label="Display name"
            value={guestName}
            data-testid="guest-name"
            hint="Optional. Leave it empty and the server picks one."
            onChange={(event) => {
              setGuestName(event.target.value);
            }}
          />
          <div className={styles.actions}>
            <Button
              busy={startGuest.isPending}
              onClick={() => {
                startGuest.mutate(guestName.trim());
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
          ) : (
            <AccountRecord query={me} />
          )}
          {session.kind === "account" && me.data?.account.emailVerified === false && (
            <Banner tone="warning" title="Email not verified">
              Ranked play needs a verified email. <Link to="/verify-email">Verify now</Link>.
            </Banner>
          )}
        </Card>
      )}

      <Card title="Server" compact>
        <ServerRecord query={config} />
      </Card>
    </div>
  );
}

function AccountRecord({
  query,
}: Readonly<{ query: UseQueryResult<MeResponse> }>): React.JSX.Element {
  if (query.isPending) {
    return <Spinner label="Loading your record" />;
  }
  if (query.isError) {
    return <Banner tone="error">{describeApiError(query.error)}</Banner>;
  }

  const { account, casual, ranked } = query.data;
  return (
    <dl className={styles.details} data-testid="account-record">
      <dt>Email</dt>
      <dd>{account.emailVerified ? "verified" : "unverified"}</dd>
      <dt>Casual</dt>
      <dd>
        {casual.wins}W {casual.losses}L {casual.draws}D
      </dd>
      <dt>Ranked</dt>
      <dd>
        {ranked === null
          ? "no ranked matches yet"
          : `${String(ranked.rating)} rating, ${String(ranked.wins)}W ${String(ranked.losses)}L ${String(ranked.draws)}D`}
      </dd>
    </dl>
  );
}

function ServerRecord({
  query,
}: Readonly<{ query: UseQueryResult<PublicServerConfig> }>): React.JSX.Element {
  if (query.isPending) {
    return <Spinner label="Checking the server" />;
  }
  if (query.isError) {
    return <Banner tone="error">{describeApiError(query.error)}</Banner>;
  }

  return (
    <dl className={styles.details}>
      <dt>Environment</dt>
      <dd>{query.data.appEnv}</dd>
      <dt>Build</dt>
      <dd>{query.data.appVersion}</dd>
      <dt>Modes</dt>
      <dd>{query.data.modes.join(", ")}</dd>
      <dt>Clocks</dt>
      <dd>{formatTimeControls(query.data.timeControlsSeconds)}</dd>
    </dl>
  );
}
