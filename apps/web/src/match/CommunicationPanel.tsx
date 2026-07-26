import { Banner, Button, Card, SwitchField } from "@gobblet/design-system";
import {
  PRESET_MESSAGE_ORDER,
  PRESET_MESSAGE_TEXT,
  REACTION_GLYPHS,
  REACTION_LABELS,
  REACTION_ORDER,
  describeFeedItem,
} from "./communication";
import type { CommunicationView } from "./use-communication";
import styles from "./CommunicationPanel.module.css";

export type CommunicationPanelProps = Readonly<{
  communication: CommunicationView;
  opponentName: string;
}>;

/**
 * The eight phrases and five reactions of section 12, and the two mutes of section
 * 12.3. A muted channel is withheld by the server, so these switches ask it to stop
 * sending rather than hiding what has arrived (ADR-0026).
 */
export function CommunicationPanel({
  communication,
  opponentName,
}: CommunicationPanelProps): React.JSX.Element {
  const { feed, mutes } = communication;

  return (
    <Card title="Say something" compact>
      <div className={styles.panel}>
        <ul
          className={styles.feed}
          data-testid="communication-feed"
          aria-live="polite"
          aria-label="Messages and reactions"
        >
          {feed.length === 0 ? (
            <li className={styles.empty} data-testid="communication-empty">
              Nothing said yet.
            </li>
          ) : (
            feed.map((item) => (
              <li key={item.id} className={styles.item} data-testid={`feed-item-${item.id}`}>
                <span className={styles.author}>{item.mine ? "You" : opponentName}</span>
                <span>
                  {item.body.kind === "reaction" && (
                    <span className={styles.glyph} aria-hidden="true">
                      {REACTION_GLYPHS[item.body.reactionKey]}
                    </span>
                  )}
                  {describeFeedItem(item)}
                </span>
              </li>
            ))
          )}
        </ul>

        {communication.notice !== null && (
          <Banner tone="warning" data-testid="communication-notice">
            <span className={styles.notice}>
              {communication.notice}
              <Button size="sm" variant="ghost" onClick={communication.dismissNotice}>
                Dismiss
              </Button>
            </span>
          </Banner>
        )}

        <div className={styles.messages}>
          {PRESET_MESSAGE_ORDER.map((key) => (
            <Button
              key={key}
              size="sm"
              variant="secondary"
              data-testid={`message-${key}`}
              onClick={() => {
                communication.sendMessage(key);
              }}
            >
              {PRESET_MESSAGE_TEXT[key]}
            </Button>
          ))}
        </div>

        <div className={styles.reactions}>
          {REACTION_ORDER.map((key) => (
            <Button
              key={key}
              size="sm"
              variant="ghost"
              aria-label={REACTION_LABELS[key]}
              data-testid={`reaction-${key}`}
              onClick={() => {
                communication.sendReaction(key);
              }}
            >
              <span aria-hidden="true">{REACTION_GLYPHS[key]}</span>
            </Button>
          ))}
        </div>

        <div className={styles.mutes}>
          <SwitchField
            label="Mute their messages"
            checked={mutes.presetMessagesMuted}
            id="mute-preset-messages"
            onCheckedChange={(checked) => {
              communication.setMutes({ ...mutes, presetMessagesMuted: checked });
            }}
          />
          <SwitchField
            label="Mute their reactions"
            checked={mutes.reactionsMuted}
            id="mute-reactions"
            onCheckedChange={(checked) => {
              communication.setMutes({ ...mutes, reactionsMuted: checked });
            }}
          />
        </div>
      </div>
    </Card>
  );
}
