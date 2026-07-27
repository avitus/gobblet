import { describe, expect, it } from "vitest";
import { drainAndClose, sleep } from "../src/shutdown";

/**
 * The drain is the only part of a deployment that a player can feel, so it is tested
 * as behaviour: pairing stops first, matches get their window, and the window ends.
 */

type Harness = Readonly<{
  drain: () => void;
  activeMatchCount: () => number;
  events: string[];
  clock: { now: number };
  wait: (ms: number) => Promise<void>;
}>;

function harness(matches: number[]): Harness {
  const events: string[] = [];
  const clock = { now: 1_000 };
  const remaining = [...matches];
  let current = remaining.shift() ?? 0;

  return {
    events,
    clock,
    drain: () => {
      events.push("stopped pairing");
    },
    activeMatchCount: () => current,
    // Every wait advances the injected clock and reveals the next reading, so a
    // window is exercised without a single millisecond of real time.
    wait: (ms: number) => {
      clock.now += ms;
      events.push(`waited ${String(ms)}`);
      current = remaining.shift() ?? current;
      return Promise.resolve();
    },
  };
}

describe("drainAndClose", () => {
  it("stops pairing before it waits for anything", async () => {
    const target = harness([1, 0]);
    const events = target.events;

    await drainAndClose({
      gateway: target,
      close: () => {
        events.push("closed");
        return Promise.resolve();
      },
      windowMs: 30_000,
      now: () => target.clock.now,
      wait: target.wait,
    });

    expect(events).toEqual(["stopped pairing", "waited 500", "closed"]);
  });

  it("closes at once when no match is running", async () => {
    const target = harness([0]);

    const report = await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 30_000,
      now: () => target.clock.now,
      wait: target.wait,
    });

    expect(report).toEqual({ abandoned: 0, waitedMs: 0 });
    expect(target.events).toEqual(["stopped pairing"]);
  });

  it("waits until the last match ends, and reports a clean drain", async () => {
    const target = harness([3, 3, 2, 0]);

    const report = await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 30_000,
      now: () => target.clock.now,
      wait: target.wait,
      pollMs: 1_000,
    });

    expect(report).toEqual({ abandoned: 0, waitedMs: 3_000 });
  });

  it("gives up when the window runs out, and says how many were still playing", async () => {
    const target = harness([2]);

    const report = await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 2_000,
      now: () => target.clock.now,
      wait: target.wait,
      pollMs: 1_000,
    });

    expect(report).toEqual({ abandoned: 2, waitedMs: 2_000 });
  });

  it("never waits past the window, even with a poll longer than it", async () => {
    const target = harness([1]);

    const report = await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 1_500,
      now: () => target.clock.now,
      wait: target.wait,
      pollMs: 10_000,
    });

    expect(target.events).toEqual(["stopped pairing", "waited 1500"]);
    expect(report.waitedMs).toBe(1_500);
  });

  it("closes without waiting when the window is zero", async () => {
    const target = harness([4]);

    const report = await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 0,
      now: () => target.clock.now,
      wait: target.wait,
    });

    expect(report).toEqual({ abandoned: 4, waitedMs: 0 });
    expect(target.events).toEqual(["stopped pairing"]);
  });

  it("tells the log what it did", async () => {
    const target = harness([1, 0]);
    const lines: string[] = [];

    await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 5_000,
      now: () => target.clock.now,
      wait: target.wait,
      log: (_context, message) => lines.push(message),
    });

    expect(lines).toEqual(["draining", "drained"]);
  });

  it("says the window elapsed rather than that it drained", async () => {
    const target = harness([1]);
    const lines: string[] = [];

    await drainAndClose({
      gateway: target,
      close: () => Promise.resolve(),
      windowMs: 500,
      now: () => target.clock.now,
      wait: target.wait,
      log: (_context, message) => lines.push(message),
    });

    expect(lines).toEqual(["draining", "drain window elapsed"]);
  });

  it("propagates a failure to close, so a shutdown does not report success", async () => {
    const target = harness([0]);

    await expect(
      drainAndClose({
        gateway: target,
        close: () => Promise.reject(new Error("pool would not close")),
        windowMs: 1_000,
        now: () => target.clock.now,
        wait: target.wait,
      }),
    ).rejects.toThrow("pool would not close");
  });
});

describe("sleep", () => {
  it("resolves, and does not hold the process open", async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
