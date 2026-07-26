import { Badge, Banner, Button, Card, Spinner, TextField } from "@gobblet/design-system";
import type { AdminUserDetail } from "@gobblet/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { useApi } from "../api/provider";
import { describeApiError } from "../api/errors";
import { queryKeys, useAdminUser } from "../api/queries";
import { describePlayerResult } from "../match/summary";
import styles from "./Admin.module.css";

/** The schema requires a reason of at least this length, so the form asks for one. */
const REASON_MIN = 8;

export function AdminUserScreen(): React.JSX.Element {
  const { userId = null } = useParams<{ userId: string }>();

  if (userId === null) {
    return (
      <Card title="Account">
        <Banner tone="error">That address names no account.</Banner>
      </Card>
    );
  }

  return <AccountReader userId={userId} />;
}

function AccountReader({ userId }: Readonly<{ userId: string }>): React.JSX.Element {
  const detail = useAdminUser(userId, true);

  if (detail.isPending) {
    return (
      <Card title="Account">
        <Spinner label="Reading the account" />
      </Card>
    );
  }

  if (detail.isError) {
    return (
      <Card title="Account">
        <Banner tone="error">{describeApiError(detail.error)}</Banner>
      </Card>
    );
  }

  return <AccountDetail userId={userId} detail={detail.data} />;
}

type AccountDetailProps = Readonly<{ userId: string; detail: AdminUserDetail }>;

/**
 * One account as an administrator sees it: the address on this page only, what the
 * player has played, every moderation action taken against them, and the three
 * changes that can be made, each carrying the reason that becomes the audit record
 * (appendices P7.2, P7.4 and P7.18).
 */
function AccountDetail({ userId, detail }: AccountDetailProps): React.JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [rating, setRating] = useState(String(detail.ranked?.rating ?? 1200));

  const settled = (): void => {
    setReason("");
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminUser(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin });
  };

  const suspend = useMutation({
    mutationFn: () => api.suspendUser(userId, reason),
    onSuccess: settled,
  });
  const reinstate = useMutation({
    mutationFn: () => api.reinstateUser(userId, reason),
    onSuccess: settled,
  });
  const correct = useMutation({
    mutationFn: () => api.adjustRating(userId, { rating: Number(rating), reason }),
    onSuccess: settled,
  });

  const failure = suspend.error ?? reinstate.error ?? correct.error;
  const reasonGiven = reason.trim().length >= REASON_MIN;
  const busy = suspend.isPending || reinstate.isPending || correct.isPending;

  return (
    <div className={styles.layout} data-testid="admin-user-detail">
      <Card
        title={detail.user.username}
        description={detail.displayName}
        actions={
          <Badge tone={detail.user.status === "active" ? "ok" : "warn"}>{detail.user.status}</Badge>
        }
      >
        <dl className={styles.readings}>
          <dt>Email</dt>
          <dd data-testid="admin-user-email">{detail.email}</dd>
          <dt>Verified</dt>
          <dd>{detail.user.emailVerified ? "yes" : "no"}</dd>
          <dt>Role</dt>
          <dd>{detail.user.role}</dd>
          <dt>Joined</dt>
          <dd>{detail.user.createdAt.slice(0, 10)}</dd>
          <dt>Last seen</dt>
          <dd>{detail.user.lastSeenAt.slice(0, 10)}</dd>
          <dt>Active sessions</dt>
          <dd data-testid="admin-user-sessions">{detail.activeSessions}</dd>
          <dt>Casual</dt>
          <dd>{`${String(detail.casual.wins)}W ${String(detail.casual.losses)}L ${String(detail.casual.draws)}D`}</dd>
          <dt>Ranked</dt>
          <dd data-testid="admin-user-rating">
            {detail.ranked === null
              ? "unrated"
              : `${String(detail.ranked.rating)} after ${String(detail.ranked.played)}`}
          </dd>
          {detail.suspendedReason !== null && (
            <>
              <dt>Suspended for</dt>
              <dd data-testid="admin-user-suspended-reason">{detail.suspendedReason}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card title="Act on this account" description="Every change is recorded with its reason.">
        {failure !== null && <Banner tone="error">{describeApiError(failure)}</Banner>}
        <div className={styles.form}>
          <TextField
            label="Reason"
            hint="At least eight characters. It is stored in the audit log."
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            data-testid="admin-reason"
          />
          <div className={styles.actions}>
            {detail.user.status === "active" ? (
              <Button
                variant="danger"
                disabled={!reasonGiven || busy}
                onClick={() => {
                  suspend.mutate();
                }}
                data-testid="admin-suspend"
              >
                Suspend
              </Button>
            ) : (
              <Button
                disabled={!reasonGiven || busy}
                onClick={() => {
                  reinstate.mutate();
                }}
                data-testid="admin-reinstate"
              >
                Reinstate
              </Button>
            )}
          </div>
          <TextField
            label="Corrected rating"
            type="number"
            value={rating}
            onChange={(event) => {
              setRating(event.target.value);
            }}
            data-testid="admin-rating"
          />
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!reasonGiven || busy || detail.ranked === null}
              onClick={() => {
                correct.mutate();
              }}
              data-testid="admin-correct-rating"
            >
              Correct the rating
            </Button>
          </div>
          {detail.ranked === null && <p>There is no rating to correct until this account plays.</p>}
        </div>
      </Card>

      <Card title="Moderation history">
        {detail.moderation.length === 0 ? (
          <p data-testid="admin-moderation-empty">Nothing has been done to this account.</p>
        ) : (
          <table className={styles.table} data-testid="admin-moderation">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">By</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {detail.moderation.map((entry) => (
                <tr key={`${entry.action}-${entry.createdAt}`}>
                  <td>{entry.createdAt.slice(0, 10)}</td>
                  <td>{entry.action}</td>
                  <td>{entry.adminUsername ?? "the console"}</td>
                  <td>{entry.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Recent matches">
        {detail.recentMatches.length === 0 ? (
          <p data-testid="admin-user-matches-empty">No matches yet.</p>
        ) : (
          <table className={styles.table} data-testid="admin-user-matches">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Mode</th>
                <th scope="col">Opponent</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentMatches.map((match) => (
                <tr key={match.matchId}>
                  <td>{match.createdAt.slice(0, 10)}</td>
                  <td>{match.mode}</td>
                  <td>{match.players[match.side === "light" ? "dark" : "light"].displayName}</td>
                  <td>{describePlayerResult(match)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
