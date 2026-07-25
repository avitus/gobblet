/**
 * Throttle for the credential endpoints, the mitigation
 * [ADR-0017](../../../../docs/adr/0017-first-party-email-password-authentication.md)
 * accepts for owning password verification. It is per process and in memory: a
 * single instance is the deployment shape of this phase
 * (docs/adr/0015-single-region-deployment.md), and a shared store can replace the
 * `AttemptLimiter` interface without touching the routes.
 */

export type AttemptLimiterOptions = Readonly<{
  /** Attempts allowed inside one window. */
  limit: number;
  windowMs: number;
  now?: () => number;
}>;

type Window = { count: number; resetAt: number };

export class AttemptLimiter {
  private readonly limit: number;

  private readonly windowMs: number;

  private readonly clock: () => number;

  private readonly windows = new Map<string, Window>();

  constructor(options: AttemptLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.now ?? ((): number => Date.now());
  }

  /**
   * Records an attempt and reports the seconds to wait when the caller is over
   * the limit. Callers that succeed can hand the budget back with {@link forgive},
   * so a player who signs in correctly is not punished for a typo earlier.
   */
  check(
    key: string,
  ): Readonly<{ allowed: true }> | Readonly<{ allowed: false; retryAfter: number }> {
    const now = this.clock();
    this.evict(now);

    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }

    if (window.count >= this.limit) {
      return { allowed: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
    }

    window.count += 1;
    return { allowed: true };
  }

  forgive(key: string): void {
    this.windows.delete(key);
  }

  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
