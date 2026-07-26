import {
  Button,
  Card,
  RangeField,
  SelectField,
  SwitchField,
  usePrefersReducedMotion,
} from "@gobblet/design-system";
import { RENDER_TIERS } from "@gobblet/game-ui";
import { useSettingsStore } from "../settings/store";
import type { MotionPreference, RenderTierPreference } from "../settings/store";
import { useSoundEngine } from "../sound/provider";
import { useTelemetry } from "../telemetry/provider";
import styles from "./SettingsScreen.module.css";

const TIER_LABELS: Readonly<Record<RenderTierPreference, string>> = Object.freeze({
  auto: "Chosen for this machine",
  full: "Full: shadows and the sharpest board",
  reduced: "Reduced: no shadows, lighter board",
  flat: "Flat: no 3D at all",
});

const MOTION_LABELS: Readonly<Record<MotionPreference, string>> = Object.freeze({
  system: "Follow the system setting",
  reduced: "Reduce motion",
  full: "Full motion",
});

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

/**
 * The local preferences of sections 12.3 and 13. They are the only client state
 * that survives a reload (docs/adr/0020), and each sound channel is independent as
 * section 13.5 requires.
 */
export function SettingsScreen(): React.JSX.Element {
  const settings = useSettingsStore();
  const systemReducedMotion = usePrefersReducedMotion();
  const engine = useSoundEngine();
  const telemetry = useTelemetry();

  return (
    <div className={styles.layout}>
      <Card title="Sound" description="Master, game and communication volumes are independent.">
        <div className={styles.fields}>
          <SwitchField
            label="Mute everything"
            checked={settings.soundMuted}
            onCheckedChange={(checked) => {
              settings.update({ soundMuted: checked });
              telemetry.capture({
                name: "setting-changed",
                setting: "sound-muted",
                enabled: checked,
              });
            }}
            id="sound-muted"
          />
          <RangeField
            label="Master"
            value={settings.masterVolume}
            formatValue={percent}
            disabled={settings.soundMuted}
            onValueChange={(value) => {
              settings.update({ masterVolume: value });
            }}
            id="master-volume"
          />
          <RangeField
            label="Game"
            value={settings.gameVolume}
            formatValue={percent}
            disabled={settings.soundMuted}
            onValueChange={(value) => {
              settings.update({ gameVolume: value });
            }}
            id="game-volume"
          />
          <RangeField
            label="Communication"
            value={settings.communicationVolume}
            formatValue={percent}
            disabled={settings.soundMuted}
            onValueChange={(value) => {
              settings.update({ communicationVolume: value });
            }}
            id="communication-volume"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void engine.resume();
              engine.play("placement");
            }}
            data-testid="test-sound"
          >
            Play a test sound
          </Button>
        </div>
      </Card>

      <Card
        title="Communication"
        description="A muted channel is not sent to this browser at all, so nothing arrives to hide."
      >
        <div className={styles.fields}>
          <SwitchField
            label="Mute preset messages"
            checked={settings.presetMessagesMuted}
            onCheckedChange={(checked) => {
              settings.update({ presetMessagesMuted: checked });
              telemetry.capture({
                name: "setting-changed",
                setting: "preset-messages-muted",
                enabled: checked,
              });
            }}
            id="preset-messages-muted-local"
          />
          <SwitchField
            label="Mute reactions"
            checked={settings.reactionsMuted}
            onCheckedChange={(checked) => {
              settings.update({ reactionsMuted: checked });
              telemetry.capture({
                name: "setting-changed",
                setting: "reactions-muted",
                enabled: checked,
              });
            }}
            id="reactions-muted-local"
          />
        </div>
      </Card>

      <Card title="Presentation" description="Both settings take effect on the next board opened.">
        <div className={styles.fields}>
          <SelectField
            label="Board rendering"
            value={settings.renderTier}
            data-testid="render-tier"
            onChange={(event) => {
              const preference = event.target.value as RenderTierPreference;
              settings.update({ renderTier: preference });
              // "auto" is a request to detect rather than a tier, so it is reported
              // as a change with no tier on it.
              telemetry.capture({
                name: "setting-changed",
                setting: "render-tier",
                ...(preference === "auto" ? {} : { tier: preference }),
              });
            }}
            options={(["auto", ...RENDER_TIERS] as const).map((tier) => ({
              value: tier,
              label: TIER_LABELS[tier],
            }))}
          />
          <SelectField
            label="Motion"
            value={settings.motion}
            data-testid="motion"
            hint={
              settings.motion === "system"
                ? systemReducedMotion
                  ? "The system asks for reduced motion."
                  : "The system allows full motion."
                : undefined
            }
            onChange={(event) => {
              const motion = event.target.value as MotionPreference;
              settings.update({ motion });
              telemetry.capture({
                name: "setting-changed",
                setting: "reduced-motion",
                enabled: motion === "reduced",
              });
            }}
            options={(["system", "reduced", "full"] as const).map((option) => ({
              value: option,
              label: MOTION_LABELS[option],
            }))}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            settings.reset();
          }}
          data-testid="reset-settings"
        >
          Restore the defaults
        </Button>
      </Card>
    </div>
  );
}
