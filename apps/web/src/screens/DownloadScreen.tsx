import { Badge, Banner, Card, Spinner } from "@gobblet/design-system";
import { UPDATE_TARGETS } from "@gobblet/protocol";
import type { ReleaseSummary, UpdateTarget } from "@gobblet/protocol";
import { describeApiError } from "../api/errors";
import { useLatestReleases } from "../api/queries";
import styles from "./DownloadScreen.module.css";

const TARGET_LABELS: Readonly<Record<UpdateTarget, string>> = Object.freeze({
  "darwin-aarch64": "macOS, Apple silicon",
  "darwin-x86_64": "macOS, Intel",
  "windows-x86_64": "Windows, 64-bit",
});

/** What the browser says about itself, which is only used to order the list. */
export function guessTarget(agent: string): UpdateTarget {
  if (/windows/i.test(agent)) {
    return "windows-x86_64";
  }
  if (/intel mac os x/i.test(agent)) {
    return "darwin-x86_64";
  }
  return "darwin-aarch64";
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export type DownloadScreenProps = Readonly<{
  /** Injected by the tests, because jsdom's user agent is neither platform. */
  userAgent?: string;
}>;

/**
 * The direct-download page of section 24, reading the same release records the
 * updater reads so the two cannot disagree (appendix P8.13). The digest is shown
 * because a person who wants to check a download by hand needs it.
 */
export function DownloadScreen({ userAgent }: DownloadScreenProps = {}): React.JSX.Element {
  const releases = useLatestReleases();
  const agent = userAgent ?? navigator.userAgent;
  const preferred = guessTarget(agent);

  if (releases.isPending) {
    return (
      <Card title="Download Gobblet Online">
        <Spinner label="Looking up the current version" />
      </Card>
    );
  }

  if (releases.isError) {
    return (
      <Card title="Download Gobblet Online">
        <Banner tone="error">{describeApiError(releases.error)}</Banner>
      </Card>
    );
  }

  const stable: ReleaseSummary | null = releases.data.stable;
  if (stable === null) {
    return (
      <Card title="Download Gobblet Online">
        <p data-testid="download-none">
          There is no published build yet. The game runs in this browser in the meantime.
        </p>
      </Card>
    );
  }

  const ordered = [
    ...stable.artifacts.filter((artifact) => artifact.target === preferred),
    ...stable.artifacts.filter((artifact) => artifact.target !== preferred),
  ];
  const missing = UPDATE_TARGETS.filter(
    (target) => !stable.artifacts.some((artifact) => artifact.target === target),
  );

  return (
    <Card
      title="Download Gobblet Online"
      description={`Version ${stable.version}, published ${stable.publishedAt.slice(0, 10)}.`}
      actions={<Badge>{stable.channel}</Badge>}
    >
      <ul className={styles.builds} data-testid="download-list">
        {ordered.map((artifact) => (
          <li key={artifact.target} className={styles.build}>
            <div>
              <p className={styles.platform} data-testid={`download-${artifact.target}`}>
                {TARGET_LABELS[artifact.target]}
                {artifact.target === preferred && <Badge>your platform</Badge>}
              </p>
              <p className={styles.detail}>
                {megabytes(artifact.sizeBytes)}
                <span className={styles.digest} data-testid={`digest-${artifact.target}`}>
                  SHA-256 {artifact.sha256}
                </span>
              </p>
            </div>
            <a
              className={styles.download}
              href={artifact.downloadUrl}
              data-testid={`download-link-${artifact.target}`}
            >
              Download
            </a>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className={styles.detail} data-testid="download-missing">
          Not built for {missing.map((target) => TARGET_LABELS[target]).join(", ")} in this version.
        </p>
      )}
      {stable.notes !== "" && (
        <section className={styles.notes}>
          <h3>What changed</h3>
          <p data-testid="download-notes">{stable.notes}</p>
        </section>
      )}
    </Card>
  );
}
