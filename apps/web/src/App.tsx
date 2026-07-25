import { useEffect, useState } from "react";
import { createInitialGame, enumerateMoves } from "@gobblet/game-core";
import styles from "./App.module.css";
import { fetchServerConfig } from "./api/server-config";
import type { PublicServerConfig } from "./api/server-config";

type ServerStatus =
  | { kind: "loading" }
  | { kind: "online"; config: PublicServerConfig }
  | { kind: "offline"; message: string };

const OPENING_MOVE_COUNT = enumerateMoves(createInitialGame("light")).length;

function formatTimeControls(seconds: readonly number[]): string {
  return seconds.map((value) => `${String(value / 60)} min`).join(", ");
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<ServerStatus>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchServerConfig(controller.signal)
      .then((config) => {
        setStatus({ kind: "online", config });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setStatus({
          kind: "offline",
          message: error instanceof Error ? error.message : "unknown error",
        });
      });

    return () => {
      controller.abort();
    };
  }, []);

  const dotClass =
    status.kind === "online"
      ? `${styles.dot} ${styles.dotOnline}`
      : status.kind === "offline"
        ? `${styles.dot} ${styles.dotOffline}`
        : styles.dot;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>Gobblet Online</h1>
        <p className={styles.subtitle}>
          Delivery skeleton. The authoritative rules engine already runs here; the real-time runtime
          and the 3D board are still ahead.
        </p>

        <p className={styles.statusRow}>
          <span aria-hidden="true" className={dotClass} />
          <span>
            {status.kind === "loading" && "checking API..."}
            {status.kind === "online" && `API reachable (${status.config.appEnv})`}
            {status.kind === "offline" && `API unreachable: ${status.message}`}
          </span>
        </p>

        <dl className={styles.details}>
          <dt>Rules engine</dt>
          <dd>{OPENING_MOVE_COUNT} legal opening moves</dd>
          <dt>Server build</dt>
          <dd>{status.kind === "online" ? status.config.appVersion : "unknown"}</dd>
          <dt>Time controls</dt>
          <dd>
            {status.kind === "online"
              ? formatTimeControls(status.config.timeControlsSeconds)
              : "unknown"}
          </dd>
        </dl>

        <ul className={styles.phaseList}>
          <li>Phase 2 adds persistence and the authoritative match runtime.</li>
          <li>Phase 5 replaces this page with the playable 3D board.</li>
        </ul>
      </section>
    </main>
  );
}
