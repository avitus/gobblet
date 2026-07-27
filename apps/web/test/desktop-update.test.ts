import { describe, expect, it, vi } from "vitest";
import type { DownloadedUpdate, UpdaterBridge } from "../src/desktop/bridge";
import {
  UPDATE_CHECK_INTERVAL_MS,
  createUpdateClient,
  type UpdateReport,
} from "../src/desktop/update-client";

/**
 * The client's half of an update (ADR-0034, appendices P8.7 and P8.8): what it does
 * with an offer, what it does with a refusal, and what it does with each way an
 * installation can fail. Nothing here waits for six hours; the schedule is injected.
 */

type Harness = Readonly<{
  updater: UpdaterBridge;
  reports: UpdateReport[];
  asked: string[];
  relaunched: () => number;
}>;

function harness(
  options: Readonly<{
    update?: DownloadedUpdate | null;
    checkFails?: boolean;
    answer?: boolean;
  }> = {},
): Harness {
  const reports: UpdateReport[] = [];
  const asked: string[] = [];
  let relaunches = 0;
  return {
    updater: {
      check: () =>
        options.checkFails === true
          ? Promise.reject(new Error("the server could not be reached"))
          : Promise.resolve(options.update ?? null),
      relaunch: () => {
        relaunches += 1;
        return Promise.resolve();
      },
    },
    reports,
    asked,
    relaunched: () => relaunches,
  };
}

function client(
  scene: Harness,
  overrides: Partial<Parameters<typeof createUpdateClient>[0]> = {},
): ReturnType<typeof createUpdateClient> {
  return createUpdateClient({
    updater: scene.updater,
    currentVersion: "1.2.0",
    confirm: (version) => {
      scene.asked.push(version);
      return Promise.resolve(true);
    },
    report: (report) => scene.reports.push(report),
    ...overrides,
  });
}

/** Lets every pending microtask settle, which is all these clients ever wait on. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function offer(install: () => Promise<void>): DownloadedUpdate {
  return { version: "1.3.0", install };
}

describe("checking for an update", () => {
  it("does nothing, and says nothing, when the running version is current", async () => {
    const scene = harness({ update: null });

    expect(await client(scene).checkNow()).toBe("none");
    expect(scene.asked).toEqual([]);
    expect(scene.reports).toEqual([]);
  });

  it("asks before installing, and installs what the player accepted", async () => {
    const installed: string[] = [];
    const scene = harness({
      update: offer(() => {
        installed.push("1.3.0");
        return Promise.resolve();
      }),
    });

    expect(await client(scene).checkNow()).toBe("success");
    expect(scene.asked).toEqual(["1.3.0"]);
    expect(installed).toEqual(["1.3.0"]);
    expect(scene.reports).toEqual([
      { outcome: "success", fromVersion: "1.2.0", toVersion: "1.3.0" },
    ]);
    expect(scene.relaunched()).toBe(1);
  });

  it("leaves the installation alone when the player says not now", async () => {
    const scene = harness({ update: offer(() => Promise.reject(new Error("never called"))) });

    const outcome = await client(scene, { confirm: () => Promise.resolve(false) }).checkNow();

    expect(outcome).toBe("declined");
    expect(scene.reports).toEqual([]);
    expect(scene.relaunched()).toBe(0);
  });

  it("reports a failed installation and keeps the running application", async () => {
    const scene = harness({
      update: offer(() => Promise.reject(new Error("the signature did not verify"))),
    });

    expect(await client(scene).checkNow()).toBe("failure");
    expect(scene.reports).toEqual([
      { outcome: "failure", fromVersion: "1.2.0", toVersion: "1.3.0" },
    ]);
    // Nothing was replaced and nothing was restarted, which is what P8.8 asks for.
    expect(scene.relaunched()).toBe(0);
  });

  it("says nothing to the player when the check itself cannot reach the server", async () => {
    const scene = harness({ checkFails: true });

    expect(await client(scene).checkNow()).toBe("none");
    expect(scene.asked).toEqual([]);
    expect(scene.reports).toEqual([]);
  });

  it("does not start a second check while the first is still waiting for an answer", async () => {
    const pending: { answer?: (install: boolean) => void } = {};
    const scene = harness({ update: offer(() => Promise.resolve()) });
    const updates = client(scene, {
      confirm: () =>
        new Promise<boolean>((resolve) => {
          pending.answer = resolve;
        }),
    });

    const first = updates.checkNow();
    expect(await updates.checkNow()).toBe("none");
    pending.answer?.(false);

    expect(await first).toBe("declined");
    expect(scene.reports).toEqual([]);
  });
});

describe("the six-hour schedule", () => {
  it("checks on start and then on the interval, and stops when told to", async () => {
    const scene = harness({ update: null });
    const scheduled: { run: () => void; delay: number }[] = [];
    const cancelled: number[] = [];
    const check = vi.spyOn(scene.updater, "check");
    const updates = client(scene, {
      schedule: (run, delay) => scheduled.push({ run, delay }),
      cancel: (handle) => cancelled.push(handle),
    });

    updates.start();
    updates.start();
    await flush();
    scheduled[0]?.run();
    await flush();
    updates.stop();
    updates.stop();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(UPDATE_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(cancelled).toEqual([1]);
  });

  it("uses the window's own timer when no schedule is supplied", () => {
    const scene = harness({ update: null });
    const set = vi.spyOn(window, "setInterval");
    const clear = vi.spyOn(window, "clearInterval");
    const updates = client(scene);

    updates.start();
    updates.stop();

    expect(set).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_INTERVAL_MS);
    expect(clear).toHaveBeenCalledTimes(1);
    set.mockRestore();
    clear.mockRestore();
  });
});
