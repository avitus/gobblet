import { TELEMETRY_BATCH_MAX } from "@gobblet/protocol";
import type { ClientAnalyticsEvent } from "@gobblet/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { ApiProvider } from "../src/api/provider";
import { AppErrorBoundary } from "../src/telemetry/ErrorBoundary";
import { TelemetryProvider, useTelemetry } from "../src/telemetry/provider";
import { createTelemetryReporter } from "../src/telemetry/reporter";
import type { TelemetryReporter } from "../src/telemetry/reporter";
import { routePattern } from "../src/telemetry/route-pattern";
import { fakeFetch, testQueryClient } from "./helpers/render";
import { MemoryRouter } from "react-router";

/**
 * What the browser tells the server about itself (spec section 17.1 and 17.2). No
 * provider is contacted from here: the client posts to the server, which decides
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */

const LAUNCH: ClientAnalyticsEvent = {
  name: "app-launched",
  platform: "web",
  clientVersion: "0.1.0",
};

/** A reporter over a fake server, with the batch sent when the test says so. */
function reporterOverFake(
  routes = { "POST /v1/telemetry/events": {}, "POST /v1/telemetry/errors": {} },
): {
  reporter: TelemetryReporter;
  sent: { key: string; body: unknown }[];
  drain: () => void;
} {
  const { fetch, sent } = fakeFetch(routes);
  const api = new ApiClient({ baseUrl: "http://server.test", fetch });
  const scheduled: (() => void)[] = [];
  const reporter = createTelemetryReporter({
    api,
    schedule: (send) => scheduled.push(send),
  });
  return {
    reporter,
    sent,
    drain: () => {
      for (const send of scheduled.splice(0)) {
        send();
      }
    },
  };
}

describe("the telemetry reporter", () => {
  it("sends a burst of events as one batch", async () => {
    const { reporter, sent, drain } = reporterOverFake();
    reporter.capture(LAUNCH);
    reporter.capture({ name: "setting-changed", setting: "sound-muted", enabled: true });

    expect(sent).toEqual([]);

    drain();
    await reporter.flush();

    expect(sent).toEqual([
      {
        key: "POST /v1/telemetry/events",
        body: {
          events: [LAUNCH, { name: "setting-changed", setting: "sound-muted", enabled: true }],
        },
      },
    ]);
  });

  it("sends without waiting once the batch is as large as the server accepts", async () => {
    const { reporter, sent } = reporterOverFake();
    for (let index = 0; index < TELEMETRY_BATCH_MAX; index += 1) {
      reporter.capture(LAUNCH);
    }
    await reporter.flush();

    expect(sent).toHaveLength(1);
    expect((sent[0]?.body as { events: unknown[] }).events).toHaveLength(TELEMETRY_BATCH_MAX);
  });

  it("sends nothing when nothing was captured", async () => {
    const { reporter, sent, drain } = reporterOverFake();
    drain();
    await reporter.flush();

    expect(sent).toEqual([]);
  });

  it("reports an error at once, shortened to what the server accepts", async () => {
    const { reporter, sent } = reporterOverFake();
    reporter.reportError({
      name: "TypeError".padEnd(200, "!"),
      message: "x".repeat(400),
      stack: "y".repeat(5_000),
      route: "/match/:id",
    });
    await reporter.flush();

    const body = sent[0]?.body as { name: string; message: string; stack: string; route: string };
    expect(sent[0]?.key).toBe("POST /v1/telemetry/errors");
    expect(body.name).toHaveLength(120);
    expect(body.message).toHaveLength(300);
    expect(body.stack).toHaveLength(4_000);
    expect(body.route).toBe("/match/:id");
  });

  it("keeps a report without a stack as one without a stack", async () => {
    const { reporter, sent } = reporterOverFake();
    reporter.reportError({ name: "Error", message: "no stack", route: "/" });
    await reporter.flush();

    expect(sent[0]?.body).toEqual({ name: "Error", message: "no stack", route: "/" });
  });

  it("swallows a server that refuses telemetry, because a player is playing", async () => {
    const { reporter, drain } = reporterOverFake({
      "POST /v1/telemetry/events": { status: 429, body: {} },
      "POST /v1/telemetry/errors": { status: 429, body: {} },
    });
    reporter.capture(LAUNCH);
    reporter.reportError({ name: "Error", message: "ignored", route: "/" });
    drain();

    await expect(reporter.flush()).resolves.toBeUndefined();
  });

  it("batches on its own schedule when none is given", async () => {
    const { fetch, sent } = fakeFetch({ "POST /v1/telemetry/events": {} });
    const reporter = createTelemetryReporter({
      api: new ApiClient({ baseUrl: "http://server.test", fetch }),
    });
    reporter.capture(LAUNCH);
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    await reporter.flush();

    expect(sent).toHaveLength(1);
  });
});

describe("routePattern", () => {
  it("names the lobby", () => {
    expect(routePattern("/")).toBe("/");
  });

  it("keeps a path that carries no identifier", () => {
    expect(routePattern("/leaderboard")).toBe("/leaderboard");
  });

  it("replaces an id, so no report names a match or an account", () => {
    expect(routePattern("/match/2b1f3d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f")).toBe("/match/:id");
    expect(routePattern("/admin/users/2b1f3d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f")).toBe(
      "/admin/users/:id",
    );
  });

  it("replaces a username, which names a person just as well", () => {
    expect(routePattern("/profile/ada")).toBe("/profile/:username");
  });
});

function Provided({ reporter }: Readonly<{ reporter?: TelemetryReporter }>): React.JSX.Element {
  const { fetch } = fakeFetch({
    "POST /v1/telemetry/events": {},
    "POST /v1/telemetry/errors": {},
  });
  return (
    <ApiProvider
      client={new ApiClient({ baseUrl: "http://server.test", fetch })}
      queryClient={testQueryClient()}
    >
      <TelemetryProvider {...(reporter === undefined ? {} : { reporter })}>
        <Reader />
      </TelemetryProvider>
    </ApiProvider>
  );
}

function Reader(): React.JSX.Element {
  const telemetry = useTelemetry();
  return (
    <button
      onClick={() => {
        telemetry.capture({ name: "setting-changed", setting: "reactions-muted", enabled: true });
      }}
    >
      change a setting
    </button>
  );
}

function recording(): TelemetryReporter & { events: ClientAnalyticsEvent[]; errors: unknown[] } {
  const events: ClientAnalyticsEvent[] = [];
  const errors: unknown[] = [];
  return {
    events,
    errors,
    capture: (event) => events.push(event),
    reportError: (report) => errors.push(report),
    flush: () => Promise.resolve(),
  };
}

describe("the telemetry provider", () => {
  it("reports the launch of the page once", () => {
    const reporter = recording();
    render(<Provided reporter={reporter} />);

    expect(reporter.events).toEqual([
      { name: "app-launched", platform: "web", clientVersion: "0.1.0" },
    ]);
  });

  it("gives every component the same reporter", async () => {
    const reporter = recording();
    render(<Provided reporter={reporter} />);

    await userEvent.click(screen.getByRole("button", { name: "change a setting" }));

    expect(reporter.events[1]).toEqual({
      name: "setting-changed",
      setting: "reactions-muted",
      enabled: true,
    });
  });

  it("reports an uncaught error with the route it happened on", () => {
    const reporter = recording();
    render(<Provided reporter={reporter} />);

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "board is not defined",
        error: Object.assign(new ReferenceError("board is not defined"), { stack: "at play" }),
      }),
    );

    expect(reporter.errors).toEqual([
      {
        name: "ReferenceError",
        message: "board is not defined",
        stack: "at play",
        route: "/",
      },
    ]);
  });

  it("reports an uncaught error that carries neither an error nor a message", () => {
    const reporter = recording();
    render(<Provided reporter={reporter} />);

    window.dispatchEvent(new ErrorEvent("error", { message: "" }));

    expect(reporter.errors).toEqual([{ name: "Error", message: "An uncaught error", route: "/" }]);
  });

  it("reports a rejected promise, whatever it was rejected with", () => {
    const reporter = recording();
    render(<Provided reporter={reporter} />);

    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("the socket went away");
    window.dispatchEvent(rejection);

    const plain = new Event("unhandledrejection") as Event & { reason?: unknown };
    plain.reason = "no reason object";
    window.dispatchEvent(plain);

    expect(reporter.errors).toEqual([
      {
        name: "Error",
        message: "the socket went away",
        stack: expect.any(String) as unknown,
        route: "/",
      },
      { name: "UnhandledRejection", message: "no reason object", route: "/" },
    ]);
  });

  it("sends what it is holding when the page goes away", async () => {
    const flushed: number[] = [];
    const reporter = {
      ...recording(),
      flush: () => {
        flushed.push(1);
        return Promise.resolve();
      },
    };
    render(<Provided reporter={reporter} />);

    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();

    expect(flushed).toEqual([1]);
  });

  it("stops listening once it is gone", () => {
    const reporter = recording();
    const view = render(<Provided reporter={reporter} />);
    view.unmount();

    window.dispatchEvent(new ErrorEvent("error", { message: "after the page" }));

    expect(reporter.errors).toEqual([]);
  });

  it("builds its own reporter when it is given none", async () => {
    render(<Provided />);
    await userEvent.click(screen.getByRole("button", { name: "change a setting" }));

    expect(screen.getByRole("button", { name: "change a setting" })).toBeInTheDocument();
  });

  it("offers a reporter that does nothing when there is nowhere to report", async () => {
    const { SILENT_REPORTER } = await import("../src/telemetry/provider");
    SILENT_REPORTER.capture(LAUNCH);
    SILENT_REPORTER.reportError({ name: "Error", message: "nowhere", route: "/" });

    await expect(SILENT_REPORTER.flush()).resolves.toBeUndefined();
  });

  it("captures nothing outside a provider, rather than failing", async () => {
    render(<Reader />);
    await userEvent.click(screen.getByRole("button", { name: "change a setting" }));

    expect(screen.getByRole("button", { name: "change a setting" })).toBeInTheDocument();
  });
});

function Boom(): React.JSX.Element {
  throw new Error("the board could not be drawn");
}

describe("the error boundary", () => {
  it("shows a page instead of a blank document, and reports the failure", async () => {
    const reporter = recording();
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={["/match/2b1f3d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f"]}>
        <TelemetryProviderStub reporter={reporter}>
          <AppErrorBoundary>
            <Boom />
          </AppErrorBoundary>
        </TelemetryProviderStub>
      </MemoryRouter>,
    );

    expect(screen.getByText("Something in the page failed")).toBeInTheDocument();
    expect(reporter.errors).toEqual([
      {
        name: "Error",
        message: "the board could not be drawn",
        stack: expect.any(String) as unknown,
        route: "/match/:id",
      },
    ]);

    await userEvent.click(screen.getByTestId("boundary-retry"));
    expect(screen.getByText("Something in the page failed")).toBeInTheDocument();
    failure.mockRestore();
  });

  it("reports a failure that carries no stack", () => {
    const reporter = recording();
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Stackless(): React.JSX.Element {
      const error = new Error("no stack here");
      delete error.stack;
      throw error;
    }
    render(
      <MemoryRouter>
        <TelemetryProviderStub reporter={reporter}>
          <AppErrorBoundary>
            <Stackless />
          </AppErrorBoundary>
        </TelemetryProviderStub>
      </MemoryRouter>,
    );

    expect(reporter.errors).toEqual([{ name: "Error", message: "no stack here", route: "/" }]);
    failure.mockRestore();
  });

  it("renders what it was given while nothing fails", () => {
    render(
      <MemoryRouter>
        <AppErrorBoundary>
          <p>the board</p>
        </AppErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText("the board")).toBeInTheDocument();
  });
});

/** The boundary reads the reporter from context, so the test supplies one directly. */
function TelemetryProviderStub({
  reporter,
  children,
}: Readonly<{ reporter: TelemetryReporter; children: React.ReactNode }>): React.JSX.Element {
  const { fetch } = fakeFetch({});
  return (
    <ApiProvider
      client={new ApiClient({ baseUrl: "http://server.test", fetch })}
      queryClient={testQueryClient()}
    >
      <TelemetryProvider reporter={reporter}>{children}</TelemetryProvider>
    </ApiProvider>
  );
}
