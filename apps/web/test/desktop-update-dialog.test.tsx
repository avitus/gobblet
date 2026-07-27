import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ClientAnalyticsEvent } from "@gobblet/protocol";
import type { UpdaterBridge } from "../src/desktop/bridge";
import { DesktopUpdates } from "../src/desktop/DesktopUpdates";
import { TelemetryProvider } from "../src/telemetry/provider";
import type { TelemetryReporter } from "../src/telemetry/reporter";
import { renderWithProviders } from "./helpers/render";

/**
 * What the player sees when an update is offered, and what the server is told about
 * how it ended. The outcome travels as an ordinary client event through the relay,
 * because no provider key reaches the desktop (appendix P8.10).
 */

function recordingTelemetry(): TelemetryReporter & { events: ClientAnalyticsEvent[] } {
  const events: ClientAnalyticsEvent[] = [];
  return {
    events,
    capture: (event) => events.push(event),
    reportError: () => undefined,
    flush: () => Promise.resolve(),
  };
}

function mount(bridge: UpdaterBridge): ReturnType<typeof recordingTelemetry> {
  const telemetry = recordingTelemetry();
  renderWithProviders(
    <TelemetryProvider reporter={telemetry}>
      <DesktopUpdates bridge={bridge} />
    </TelemetryProvider>,
  );
  return telemetry;
}

describe("the update prompt", () => {
  it("shows nothing at all when there is no update", async () => {
    mount({ check: () => Promise.resolve(null), relaunch: () => Promise.resolve() });

    await waitFor(() => {
      expect(screen.queryByTestId("update-dialog")).not.toBeInTheDocument();
    });
  });

  it("offers the new version, installs it and reports the outcome", async () => {
    const relaunch = vi.fn(() => Promise.resolve());
    const telemetry = mount({
      check: () => Promise.resolve({ version: "1.5.0", install: () => Promise.resolve() }),
      relaunch,
    });

    await userEvent.click(await screen.findByTestId("install-update"));

    await waitFor(() => {
      expect(telemetry.events).toContainEqual({
        name: "desktop-update-completed",
        outcome: "success",
        fromVersion: "0.1.0",
        toVersion: "1.5.0",
      });
    });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("closes without a word when the player postpones", async () => {
    const telemetry = mount({
      check: () => Promise.resolve({ version: "1.5.0", install: () => Promise.resolve() }),
      relaunch: () => Promise.resolve(),
    });

    await userEvent.click(await screen.findByTestId("postpone-update"));

    await waitFor(() => {
      expect(screen.queryByTestId("update-dialog")).not.toBeInTheDocument();
    });
    expect(telemetry.events.map((event) => event.name)).not.toContain("desktop-update-completed");
  });

  it("reports a failure and leaves the window running", async () => {
    const relaunch = vi.fn(() => Promise.resolve());
    const telemetry = mount({
      check: () =>
        Promise.resolve({
          version: "1.5.0",
          install: () => Promise.reject(new Error("the bundle did not verify")),
        }),
      relaunch,
    });

    await userEvent.click(await screen.findByTestId("install-update"));

    await waitFor(() => {
      expect(telemetry.events).toContainEqual({
        name: "desktop-update-completed",
        outcome: "failure",
        fromVersion: "0.1.0",
        toVersion: "1.5.0",
      });
    });
    expect(relaunch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("update-dialog")).not.toBeInTheDocument();
    });
  });

  it("renders nothing in a browser, where there is no shell to ask", () => {
    renderWithProviders(<DesktopUpdates />);

    expect(screen.queryByTestId("update-dialog")).not.toBeInTheDocument();
  });
});
