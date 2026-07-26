import {
  Badge,
  Banner,
  Button,
  Card,
  Spinner,
  SwitchField,
  TextField,
} from "@gobblet/design-system";
import type { ProfileSettings, UpdateProfileRequest } from "@gobblet/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { describeApiError } from "../api/errors";
import { useApi } from "../api/provider";
import { queryKeys, useMe, usePublicProfile } from "../api/queries";
import { useSessionStore } from "../session/store";
import styles from "./ProfileScreen.module.css";

function describeRecord(record: Readonly<{ wins: number; losses: number; draws: number }>): string {
  return `${String(record.wins)}W ${String(record.losses)}L ${String(record.draws)}D`;
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
        </dl>
      </Card>

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

  const { memberSince, countryCode, casual, ranked } = profile.data;
  return (
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
      </dl>
    </Card>
  );
}
