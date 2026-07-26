import * as Sentry from "@sentry/node";

/**
 * Error reporting behind a port
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md). A browser
 * error arrives as a report through the server rather than from a provider bundle in
 * the page, and without a DSN the port is inert.
 */

export type ErrorContext = Readonly<{
  /** The pseudonym of appendix P7.12, never an account id or an address. */
  actor: string | null;
  route: string;
  /** `browser` for a relayed client report, `server` for one raised here. */
  origin: "browser" | "server";
  matchId?: string | undefined;
}>;

export interface ErrorReportingPort {
  report(
    error: Readonly<{ name: string; message: string; stack?: string }>,
    context: ErrorContext,
  ): void;
  flush(): Promise<void>;
}

export class NullErrorReporting implements ErrorReportingPort {
  report(): void {
    // A deployment without a DSN reports nothing, which is the documented default.
  }

  async flush(): Promise<void> {
    // Nothing was buffered, so there is nothing to send.
  }
}

/** The narrow slice of the SDK this project uses, so a test can stand in for it. */
export type SentryClient = Readonly<{
  captureEvent: (event: Sentry.Event) => void;
  flush: (timeout?: number) => Promise<boolean>;
}>;

const FLUSH_TIMEOUT_MS = 2_000;

export class SentryErrorReporting implements ErrorReportingPort {
  private readonly client: SentryClient;

  constructor(client: SentryClient) {
    this.client = client;
  }

  report(
    error: Readonly<{ name: string; message: string; stack?: string }>,
    context: ErrorContext,
  ): void {
    const extra: Record<string, unknown> = {};
    if (error.stack !== undefined) {
      extra.stack = error.stack;
    }
    if (context.matchId !== undefined) {
      extra.matchId = context.matchId;
    }

    this.client.captureEvent({
      level: "error",
      exception: { values: [{ type: error.name, value: error.message }] },
      tags: { route: context.route, origin: context.origin },
      ...(context.actor === null ? {} : { user: { id: context.actor } }),
      ...(Object.keys(extra).length === 0 ? {} : { extra }),
    });
  }

  async flush(): Promise<void> {
    await this.client.flush(FLUSH_TIMEOUT_MS);
  }
}

export type ErrorReportingOptions = Readonly<{
  dsn: string | null;
  release: string;
  environment: string;
}>;

export function createErrorReporting(options: ErrorReportingOptions): ErrorReportingPort {
  if (options.dsn === null) {
    return new NullErrorReporting();
  }
  Sentry.init({
    dsn: options.dsn,
    release: options.release,
    environment: options.environment,
    // Traces belong to the hosted monitoring of ADR-0015; errors are what is asked for.
    tracesSampleRate: 0,
  });
  // The SDK functions are passed as they are, so nothing sits between them and the
  // port that a test would have to reach through the network to exercise.
  return new SentryErrorReporting({ captureEvent: Sentry.captureEvent, flush: Sentry.flush });
}
