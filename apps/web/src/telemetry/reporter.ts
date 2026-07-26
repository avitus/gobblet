import { TELEMETRY_BATCH_MAX, TELEMETRY_STACK_MAX_LENGTH } from "@gobblet/protocol";
import type { ClientAnalyticsEvent, TelemetryErrorRequest } from "@gobblet/protocol";
import type { ApiClient } from "../api/client";

/**
 * What the browser tells the server about itself: the three client events of spec
 * section 17.1 and the failures of section 17.2. Nothing is sent to a provider from
 * here, because no provider software reaches the browser
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 *
 * Events are batched, since a page that reports every click separately is a page
 * that spends its network budget on telemetry. A failure to deliver is dropped: the
 * player is playing a game, and telemetry may never interrupt that.
 */
export type TelemetryReporter = Readonly<{
  capture: (event: ClientAnalyticsEvent) => void;
  reportError: (report: TelemetryErrorRequest) => void;
  /** Sends whatever is waiting. Awaited by tests and by the page going away. */
  flush: () => Promise<void>;
}>;

export type TelemetryReporterOptions = Readonly<{
  api: ApiClient;
  /**
   * When the batch is sent. The default runs at the end of the current task, so a
   * burst on one render becomes one request; a test passes its own to decide.
   */
  schedule?: (send: () => void) => void;
}>;

const MESSAGE_MAX = 300;

export function createTelemetryReporter(options: TelemetryReporterOptions): TelemetryReporter {
  const schedule = options.schedule ?? ((send: () => void): void => queueMicrotask(send));
  let pending: ClientAnalyticsEvent[] = [];
  let scheduled = false;
  let inFlight: Promise<void> = Promise.resolve();

  const send = (): void => {
    scheduled = false;
    const batch = pending;
    pending = [];
    if (batch.length === 0) {
      return;
    }
    inFlight = inFlight.then(() => options.api.sendTelemetryEvents(batch).catch(() => undefined));
  };

  return {
    capture: (event) => {
      pending.push(event);
      if (pending.length >= TELEMETRY_BATCH_MAX) {
        send();
        return;
      }
      if (!scheduled) {
        scheduled = true;
        schedule(send);
      }
    },
    reportError: (report) => {
      inFlight = inFlight.then(() =>
        options.api.reportClientError(truncate(report)).catch(() => undefined),
      );
    },
    flush: async () => {
      send();
      await inFlight;
    },
  };
}

/** The server refuses an oversized report; the client would rather send a short one. */
function truncate(report: TelemetryErrorRequest): TelemetryErrorRequest {
  return {
    ...report,
    name: report.name.slice(0, 120),
    message: report.message.slice(0, MESSAGE_MAX),
    ...(report.stack === undefined
      ? {}
      : { stack: report.stack.slice(0, TELEMETRY_STACK_MAX_LENGTH) }),
  };
}
