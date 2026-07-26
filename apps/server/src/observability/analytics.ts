import { PostHog } from "posthog-node";
import type { AnalyticsEvent } from "@gobblet/protocol";

/**
 * Product analytics behind a port
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md). The server
 * is the only thing that talks to a provider, no provider software reaches a
 * browser, and without an API key the port is inert: that is how the suites and a
 * developer machine run.
 */

/** The pseudonym of appendix P7.12, or `null` for a caller with no identity yet. */
export type AnalyticsIdentity = string | null;

export interface AnalyticsPort {
  capture(identity: AnalyticsIdentity, event: AnalyticsEvent): void;
  flush(): Promise<void>;
}

/** An analytics port that keeps nothing, for a deployment with no key configured. */
export class NullAnalytics implements AnalyticsPort {
  capture(): void {
    // A deployment without a key sends nothing, which is the documented default.
  }

  async flush(): Promise<void> {
    // Nothing was buffered, so there is nothing to send.
  }
}

/**
 * The event as a provider sees it: a name and scalar properties, with the pseudonym
 * as the distinct id. An event with no identity is attributed to one anonymous id
 * rather than invented per request, because a per-request id would make every event
 * a new person.
 */
export const ANONYMOUS_DISTINCT_ID = "anonymous";

export type PostHogClient = Readonly<{
  capture: (payload: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => void;
  shutdown: () => Promise<void>;
}>;

export class PostHogAnalytics implements AnalyticsPort {
  private readonly client: PostHogClient;

  constructor(client: PostHogClient) {
    this.client = client;
  }

  capture(identity: AnalyticsIdentity, event: AnalyticsEvent): void {
    const { name, ...properties } = event;
    this.client.capture({
      distinctId: identity ?? ANONYMOUS_DISTINCT_ID,
      event: name,
      properties,
    });
  }

  async flush(): Promise<void> {
    await this.client.shutdown();
  }
}

export type AnalyticsOptions = Readonly<{
  apiKey: string | null;
  host: string;
}>;

/** Builds the configured transport, or the inert one when there is no key. */
export function createAnalytics(options: AnalyticsOptions): AnalyticsPort {
  if (options.apiKey === null) {
    return new NullAnalytics();
  }
  return new PostHogAnalytics(new PostHog(options.apiKey, { host: options.host }));
}
