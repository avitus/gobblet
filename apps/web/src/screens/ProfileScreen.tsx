import {
  Badge,
  Banner,
  Button,
  Card,
  Spinner,
  SwitchField,
  TextField,
} from "@gobblet/design-system";
import type {
  AchievementProgress,
  PlayerMatchSummary,
  ProfileBadge,
  ProfileSettings,
  UpdateProfileRequest,
} from "@gobblet/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { describeApiError } from "../api/errors";
import { useApi } from "../api/provider";
import { queryKeys, useAchievements, useMe, usePublicProfile } from "../api/queries";
import { describePlayerResult, describeRatingDelta } from "../match/summary";
import { useSessionStore } from "../session/store";
import styles from "./ProfileScreen.module.css";

function describeRecord(record: Readonly<{ wins: number; losses: number; draws: number }>): string {
  return `${String(record.wins)}W ${String(record.losses)}L ${String(record.draws)}D`;
}

function describeRank(rank: number | null): string {
  return rank === null ? "unranked" : `#${String(rank)} all time`;
}

/** A badge is a code rendered from the tokens, never an image (appendix P6.8). */
function BadgeList({ badges }: Readonly<{ badges: readonly ProfileBadge[] }>): React.JSX.Element {
  if (badges.length === 0) {
    return <p data-testid="no-badges">No achievements yet.</p>;
  }
  return (
    <ul className={styles.badges} data-testid="profile-badges">
      {badges.map((badge) => (
        <li key={badge.code} data-testid={`badge-${badge.code}`} data-tier={badge.badge}>
          <Badge tone={badge.badge === "gold" ? "accent" : "neutral"}>{badge.name}</Badge>
          <span className={styles.badgeDate}>{badge.earnedAt.slice(0, 10)}</span>
        </li>
      ))}
    </ul>
  );
}

function RecentMatches({
  matches,
}: Readonly<{ matches: readonly PlayerMatchSummary[] }>): React.JSX.Element {
  if (matches.length === 0) {
    return <p data-testid="no-recent-matches">No completed matches yet.</p>;
  }
  return (
    <ul className={styles.recent} data-testid="recent-matches">
      {matches.map((match) => (
        <li key={match.matchId} data-testid={`recent-${match.matchId}`}>
          <span>{match.createdAt.slice(0, 10)}</span>
          <span>{match.mode}</span>
          <span>as {match.side}</span>
          <span>{describePlayerResult(match)}</span>
          <span>{describeRatingDelta(match.ratingDelta)}</span>
          <span>{`${String(match.moveCount)} moves`}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A public profile (section 11.1) and, for the signed-in player, the settings that
 * belong to the account rather than to this browser: the mute preferences section
 * 12.3 keeps in the profile as well as locally.
 */
export function ProfileScreen(): React.JSX.Element {
  const { username } = useParams<{ username: string }>();
  const session = useSessionStore((state) => state.session);

  return username === undefined || username === session?.username ? (
    <OwnProfile />
  ) : (
    <OtherProfile username={username} />
  );
}

function OwnProfile(): React.JSX.Element {
  const session = useSessionStore((state) => state.session);
  const me = useMe(session?.kind === "account");
  const api = useApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<UpdateProfileRequest | null>(null);

  const save = useMutation({
    mutationFn: (patch: UpdateProfileRequest) => api.updateProfile(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.me, updated);
      setDraft(null);
    },
  });

  if (session === null) {
    return <Card title="Profile">Start a session to see your profile.</Card>;
  }

  if (session.kind === "guest") {
    return (
      <Card title={session.displayName} actions={<Badge>guest</Badge>}>
        <p>A guest has no profile. Create an account to keep a record and a username.</p>
      </Card>
    );
  }

  if (me.isPending) {
    return (
      <Card title="Your profile">
        <Spinner label="Loading your profile" />
      </Card>
    );
  }

  if (me.isError) {
    return (
      <Card title="Your profile">
        <Banner tone="error">{describeApiError(me.error)}</Banner>
      </Card>
    );
  }

  const stored: ProfileSettings = me.data.profile;
  // A key the draft holds wins even when it holds null, which is how a country code
  // is removed rather than reset to the stored one.
  const field = <K extends keyof ProfileSettings>(key: K): ProfileSettings[K] =>
    draft !== null && key in draft ? (draft[key] as ProfileSettings[K]) : stored[key];

  return (
    <div className={styles.layout}>
      <Card
        title={me.data.account.username}
        description={`Member since ${me.data.account.createdAt.slice(0, 7)}`}
      >
        <dl className={styles.details} data-testid="own-profile">
          <dt>Email</dt>
          <dd>{me.data.account.emailVerified ? "verified" : "unverified"}</dd>
          <dt>Casual</dt>
          <dd>{describeRecord(me.data.casual)}</dd>
          <dt>Ranked</dt>
          <dd data-testid="own-ranked">
            {me.data.ranked === null
              ? "no ranked matches yet"
              : `${String(me.data.ranked.rating)} rating, ${describeRecord(me.data.ranked)}`}
          </dd>
          <dt>Rank</dt>
          <dd data-testid="own-rank">{describeRank(me.data.rank)}</dd>
        </dl>
      </Card>

      <OwnAchievements />

      <Card
        title="Account settings"
        description="Kept with the account, so they follow you to another machine."
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft !== null) {
              save.mutate(draft);
            }
          }}
        >
          <TextField
            label="Country code"
            value={field("countryCode") ?? ""}
            maxLength={2}
            data-testid="country-code"
            hint="Two letters, or empty to remove it."
            onChange={(event) => {
              const value = event.target.value.toUpperCase();
              setDraft((current) => ({ ...current, countryCode: value === "" ? null : value }));
            }}
          />
          <SwitchField
            label="Mute preset messages"
            checked={field("presetMessagesMuted")}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, presetMessagesMuted: checked }));
            }}
            id="preset-messages-muted"
          />
          <SwitchField
            label="Mute reactions"
            checked={field("reactionsMuted")}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, reactionsMuted: checked }));
            }}
            id="reactions-muted"
          />
          <SwitchField
            label="Mute game sounds"
            checked={field("gameSoundMuted")}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, gameSoundMuted: checked }));
            }}
            id="game-sound-muted"
          />
          <SwitchField
            label="Reduce motion"
            checked={field("reducedMotion")}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, reducedMotion: checked }));
            }}
            id="reduced-motion"
          />
          {save.isError && <Banner tone="error">{describeApiError(save.error)}</Banner>}
          {save.isSuccess && <Banner tone="success">Saved.</Banner>}
          <Button
            type="submit"
            busy={save.isPending}
            disabled={draft === null}
            data-testid="save-profile"
          >
            Save
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** The whole catalogue with this account's progress, earned or not (section 11.4). */
function OwnAchievements(): React.JSX.Element {
  const achievements = useAchievements(true);

  return (
    <Card title="Achievements" description="Earned by playing; nothing can be bought.">
      {achievements.isPending ? (
        <Spinner label="Loading your achievements" />
      ) : achievements.isError ? (
        <Banner tone="error">{describeApiError(achievements.error)}</Banner>
      ) : (
        <ul className={styles.achievements} data-testid="own-achievements">
          {achievements.data.achievements.map((entry) => (
            <li
              key={entry.code}
              data-testid={`achievement-${entry.code}`}
              data-earned={entry.earnedAt === null ? "false" : "true"}
              className={entry.earnedAt === null ? styles.unearned : undefined}
            >
              <Badge tone={entry.earnedAt === null ? "neutral" : "accent"}>{entry.name}</Badge>
              <span>{entry.description}</span>
              <span className={styles.badgeDate}>{describeProgress(entry)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function describeProgress(entry: AchievementProgress): string {
  return entry.earnedAt === null ? "not yet" : entry.earnedAt.slice(0, 10);
}

function OtherProfile({ username }: Readonly<{ username: string }>): React.JSX.Element {
  const profile = usePublicProfile(username);

  if (profile.isPending) {
    return (
      <Card title={username}>
        <Spinner label="Loading the profile" />
      </Card>
    );
  }

  if (profile.isError) {
    return (
      <Card title={username}>
        <Banner tone="error">{describeApiError(profile.error)}</Banner>
      </Card>
    );
  }

  const { memberSince, countryCode, casual, ranked, rank, badges, recentMatches } = profile.data;
  return (
    <div className={styles.layout}>
      <Card title={username}>
        <dl className={styles.details} data-testid="public-profile">
          <dt>Member since</dt>
          <dd>{memberSince}</dd>
          <dt>Country</dt>
          <dd>{countryCode ?? "not given"}</dd>
          <dt>Casual</dt>
          <dd>{describeRecord(casual)}</dd>
          <dt>Ranked</dt>
          <dd>
            {ranked === null
              ? "no ranked matches yet"
              : `${String(ranked.rating)} rating, ${describeRecord(ranked)}`}
          </dd>
          <dt>Rank</dt>
          <dd data-testid="public-rank">{describeRank(rank)}</dd>
        </dl>
      </Card>

      <Card title="Achievements">
        <BadgeList badges={badges} />
      </Card>

      <Card
        title="Recent matches"
        description="The five most recent completed matches, without the moves."
      >
        <RecentMatches matches={recentMatches} />
        <p>
          <Link to="/leaderboard">See the leaderboard</Link>
        </p>
      </Card>
    </div>
  );
}
