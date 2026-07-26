import {
  Badge,
  Banner,
  Button,
  Card,
  SelectField,
  Spinner,
  SwitchField,
  TextField,
} from "@gobblet/design-system";
import { ACHIEVEMENT_BADGE_TIERS, ACHIEVEMENT_CATALOGUE } from "@gobblet/protocol";
import type { AchievementBadgeTier, AchievementCode, AdminAchievement } from "@gobblet/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeApiError } from "../api/errors";
import { useApi } from "../api/provider";
import { queryKeys, useAdminAchievements } from "../api/queries";
import styles from "./Admin.module.css";

const REASON_MIN = 8;

const BADGE_OPTIONS = ACHIEVEMENT_BADGE_TIERS.map((tier) => ({ value: tier, label: tier }));

/**
 * The catalogue as metadata over rules that live in code: a row can only be created
 * for a code the server can evaluate, nothing is deleted because accounts may
 * already hold the badge, and a change is recorded with its reason (appendix P7.3).
 */
export function AdminAchievementsScreen(): React.JSX.Element {
  const catalogue = useAdminAchievements(true);

  if (catalogue.isPending) {
    return (
      <Card title="Achievements">
        <Spinner label="Reading the catalogue" />
      </Card>
    );
  }

  if (catalogue.isError) {
    return (
      <Card title="Achievements">
        <Banner tone="error">{describeApiError(catalogue.error)}</Banner>
      </Card>
    );
  }

  return <Catalogue achievements={catalogue.data.achievements} />;
}

function Catalogue({
  achievements,
}: Readonly<{ achievements: readonly AdminAchievement[] }>): React.JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = (): void => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminAchievements });
  };

  const held = new Set(achievements.map((achievement) => achievement.code));
  const missing = ACHIEVEMENT_CATALOGUE.filter((entry) => !held.has(entry.code));
  const [firstMissing] = missing;

  return (
    <div className={styles.layout} data-testid="admin-achievements">
      <Card title="Achievements" description="Nothing is deleted: an entry is enabled or disabled.">
        <table className={styles.table} data-testid="admin-achievements-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Badge</th>
              <th scope="col">Awarded</th>
              <th scope="col">State</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {achievements.map((achievement) => (
              <tr key={achievement.code} data-testid={`admin-achievement-${achievement.code}`}>
                <td>{achievement.code}</td>
                <td>{achievement.name}</td>
                <td>
                  <Badge>{achievement.badge}</Badge>
                </td>
                <td className={styles.numeric}>{achievement.awarded}</td>
                <td>{achievement.enabled ? "enabled" : "disabled"}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(
                        editing === achievement.achievementId ? null : achievement.achievementId,
                      );
                    }}
                    data-testid={`admin-achievement-edit-${achievement.code}`}
                  >
                    {editing === achievement.achievementId ? "Close" : "Edit"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {achievements
        .filter((achievement) => achievement.achievementId === editing)
        .map((achievement) => (
          <EditAchievement
            key={achievement.achievementId}
            achievement={achievement}
            onSaved={refresh}
            save={(patch) => api.updateAchievement(achievement.achievementId, patch)}
          />
        ))}

      {firstMissing !== undefined && (
        <CreateAchievement
          missing={missing}
          fallback={firstMissing}
          onCreated={refresh}
          create={(input) => api.createAchievement(input)}
        />
      )}
    </div>
  );
}

type EditProps = Readonly<{
  achievement: AdminAchievement;
  onSaved: () => void;
  save: (patch: {
    name?: string;
    description?: string;
    badge?: AchievementBadgeTier;
    enabled?: boolean;
    reason: string;
  }) => Promise<AdminAchievement>;
}>;

function EditAchievement({ achievement, onSaved, save }: EditProps): React.JSX.Element {
  const [name, setName] = useState(achievement.name);
  const [description, setDescription] = useState(achievement.description);
  const [badge, setBadge] = useState<AchievementBadgeTier>(achievement.badge);
  const [enabled, setEnabled] = useState(achievement.enabled);
  const [reason, setReason] = useState("");

  const update = useMutation({
    mutationFn: () => save({ name, description, badge, enabled, reason }),
    onSuccess: onSaved,
  });

  return (
    <Card title={`Edit ${achievement.code}`}>
      {update.error !== null && <Banner tone="error">{describeApiError(update.error)}</Banner>}
      <div className={styles.form}>
        <TextField
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          data-testid="achievement-name"
        />
        <TextField
          label="Description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          data-testid="achievement-description"
        />
        <SelectField
          label="Badge"
          value={badge}
          options={BADGE_OPTIONS}
          onChange={(event) => {
            setBadge(event.target.value as AchievementBadgeTier);
          }}
          data-testid="achievement-badge"
        />
        <SwitchField
          label="Offered to players"
          checked={enabled}
          onCheckedChange={setEnabled}
          id="achievement-enabled"
        />
        <TextField
          label="Reason"
          hint="At least eight characters, for the audit log."
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          data-testid="achievement-reason"
        />
        <div className={styles.actions}>
          <Button
            disabled={reason.trim().length < REASON_MIN || update.isPending}
            onClick={() => {
              update.mutate();
            }}
            data-testid="achievement-save"
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

type CatalogueEntry = Readonly<{
  code: AchievementCode;
  name: string;
  description: string;
  badge: AchievementBadgeTier;
}>;

type CreateProps = Readonly<{
  missing: readonly CatalogueEntry[];
  /** The entry the form starts on, so no code has to be invented as a default. */
  fallback: CatalogueEntry;
  onCreated: () => void;
  create: (input: {
    code: AchievementCode;
    name: string;
    description: string;
    badge: AchievementBadgeTier;
    reason: string;
  }) => Promise<AdminAchievement>;
}>;

function CreateAchievement({
  missing,
  fallback,
  onCreated,
  create,
}: CreateProps): React.JSX.Element {
  const [chosen, setChosen] = useState<CatalogueEntry>(fallback);
  const [reason, setReason] = useState("");

  const add = useMutation({
    mutationFn: () =>
      create({
        code: chosen.code,
        name: chosen.name,
        description: chosen.description,
        badge: chosen.badge,
        reason,
      }),
    onSuccess: onCreated,
  });

  return (
    <Card
      title="Offer another achievement"
      description="Only codes the server has a rule for can be offered."
    >
      {add.error !== null && <Banner tone="error">{describeApiError(add.error)}</Banner>}
      <div className={styles.form}>
        <SelectField
          label="Code"
          value={chosen.code}
          options={missing.map((entry) => ({ value: entry.code, label: entry.code }))}
          onChange={(event) => {
            for (const entry of missing) {
              if (entry.code === event.target.value) {
                setChosen(entry);
              }
            }
          }}
          data-testid="achievement-create-code"
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          data-testid="achievement-create-reason"
        />
        <div className={styles.actions}>
          <Button
            disabled={reason.trim().length < REASON_MIN || add.isPending}
            onClick={() => {
              add.mutate();
            }}
            data-testid="achievement-create"
          >
            Offer it
          </Button>
        </div>
      </div>
    </Card>
  );
}
