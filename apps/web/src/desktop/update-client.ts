import type { UpdateOutcome } from "@gobblet/protocol";
import type { UpdaterBridge } from "./bridge";

/**
 * The client's half of ADR-0034: ask on start and every six hours, install when
 * the player agrees, report how it ended. Verification and the atomic replacement
 * are the updater's, not ours; every failure here is a report and a dismissal, so
 * a broken update leaves the running application exactly as it was (P8.7, P8.8).
 */

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateReport = Readonly<{
  outcome: UpdateOutcome;
  fromVersion: string;
  toVersion: string;
}>;

export type UpdateClientOptions = Readonly<{
  updater: UpdaterBridge;
  currentVersion: string;
  /** Asks the player whether to install now; declining is not a failure. */
  confirm: (version: string) => Promise<boolean>;
  report: (report: UpdateReport) => void;
  /** Injected so a suite can drive six hours without waiting for them. */
  schedule?: (run: () => void, delayMs: number) => number;
  cancel?: (handle: number) => void;
}>;

export type UpdateClient = Readonly<{
  /** One check. Answers what happened, which is what the tests assert on. */
  checkNow: () => Promise<"none" | "declined" | UpdateOutcome>;
  start: () => void;
  stop: () => void;
}>;

export function createUpdateClient(options: UpdateClientOptions): UpdateClient {
  const schedule = options.schedule ?? ((run, delayMs) => window.setInterval(run, delayMs));
  const cancel =
    options.cancel ??
    ((handle) => {
      window.clearInterval(handle);
    });
  let timer: number | null = null;
  let running = false;

  const attempt = async (): Promise<"none" | "declined" | UpdateOutcome> => {
    try {
      const update = await options.updater.check();
      if (update === null) {
        return "none";
      }
      if (!(await options.confirm(update.version))) {
        return "declined";
      }
      try {
        await update.install();
      } catch {
        options.report({
          outcome: "failure",
          fromVersion: options.currentVersion,
          toVersion: update.version,
        });
        return "failure";
      }
      options.report({
        outcome: "success",
        fromVersion: options.currentVersion,
        toVersion: update.version,
      });
      await options.updater.relaunch();
      return "success";
    } catch {
      // A check that cannot reach the server is not worth telling the player
      // about: the next one is in six hours and nothing has changed meanwhile.
      return "none";
    }
  };

  const checkNow = async (): Promise<"none" | "declined" | UpdateOutcome> => {
    if (running) {
      return "none";
    }
    running = true;
    const outcome = await attempt();
    running = false;
    return outcome;
  };

  return {
    checkNow,
    start: () => {
      if (timer !== null) {
        return;
      }
      void checkNow();
      timer = schedule(() => void checkNow(), UPDATE_CHECK_INTERVAL_MS);
    },
    stop: () => {
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    },
  };
}
