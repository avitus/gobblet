/**
 * The drain of specification section 22.2, as a function rather than a comment in a
 * workflow. A deployment replaces this process while people are mid-match, so the
 * order matters: stop pairing anyone new, give the matches already running a window
 * to finish on their own, then close the sockets and the pool.
 *
 * Nothing here sleeps by itself. The clock and the wait are injected, so a test can
 * drive a thirty second window in microseconds and a real process can pass the ones
 * that block (docs/adr/0043-railway-hosts-the-deployment.md).
 */

export type DrainTarget = Readonly<{
  /** Stops accepting queue entries and ends open rematch offers. */
  drain: () => void;
  /** Matches this process is still serving. */
  activeMatchCount: () => number;
}>;

export type DrainOptions = Readonly<{
  gateway: DrainTarget;
  close: () => Promise<void>;
  windowMs: number;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  pollMs?: number;
  log?: (context: Readonly<Record<string, unknown>>, message: string) => void;
}>;

export type DrainReport = Readonly<{
  /** Matches still running when the window ran out. Zero is a clean drain. */
  abandoned: number;
  waitedMs: number;
}>;

const DEFAULT_POLL_MS = 500;

export async function drainAndClose(options: DrainOptions): Promise<DrainReport> {
  const { gateway, close, windowMs, now, wait } = options;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const log = options.log ?? ((): void => {});
  const startedAt = now();

  gateway.drain();
  log({ activeMatches: gateway.activeMatchCount(), windowMs }, "draining");

  while (gateway.activeMatchCount() > 0 && now() - startedAt < windowMs) {
    await wait(Math.min(pollMs, Math.max(0, windowMs - (now() - startedAt))));
  }

  const abandoned = gateway.activeMatchCount();
  const waitedMs = now() - startedAt;
  // A match left running is not a match lost: it is persisted, its clock is settled
  // on the next boot, and a client that reconnects calls match:sync. Saying how many
  // there were is the difference between a drain and a hope.
  log({ abandoned, waitedMs }, abandoned === 0 ? "drained" : "drain window elapsed");

  await close();
  return { abandoned, waitedMs };
}

/** The wait a real process passes to {@link drainAndClose}. */
export function sleep(ms: number): Promise<void> {
  return new Promise((settle) => {
    setTimeout(settle, ms).unref();
  });
}
