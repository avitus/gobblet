import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/errors";
import { ApiProvider, createQueryClient, useApi } from "../src/api/provider";
import { useServerConfig } from "../src/api/queries";

const CONFIG = {
  appEnv: "local",
  appVersion: "1.0.0",
  minSupportedClientVersion: "0.1.0",
  modes: ["casual", "ranked"],
  timeControlsSeconds: [180, 300, 600, 900],
};

function retryDecision(failureCount: number, error: Error): boolean {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") {
    throw new Error("The query client must decide retries itself");
  }
  return retry(failureCount, error);
}

function Probe(): React.JSX.Element {
  const config = useServerConfig();
  return <span data-testid="probe">{config.data?.appVersion ?? "..."}</span>;
}

describe("query client defaults", () => {
  it("retries a transport or server fault", () => {
    for (const code of [
      "network_unreachable",
      "internal_error",
      "dependency_unavailable",
    ] as const) {
      expect(retryDecision(0, new ApiError({ code, message: "x", status: 0 }))).toBe(true);
    }
  });

  it("does not retry an answer the player has to act on", () => {
    expect(
      retryDecision(0, new ApiError({ code: "unauthenticated", message: "x", status: 401 })),
    ).toBe(false);
    expect(retryDecision(0, new Error("not an API error"))).toBe(false);
  });

  it("gives up after two attempts", () => {
    expect(
      retryDecision(2, new ApiError({ code: "network_unreachable", message: "x", status: 0 })),
    ).toBe(false);
  });
});

describe("ApiProvider", () => {
  it("builds a client from the bundled configuration when none is injected", async () => {
    const requested: string[] = [];
    const stub = vi.fn((input: string) => {
      requested.push(input);
      return Promise.resolve(
        new Response(JSON.stringify(CONFIG), { headers: { "content-type": "application/json" } }),
      );
    });
    vi.stubGlobal("fetch", stub);

    render(
      <ApiProvider>
        <Probe />
      </ApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("1.0.0");
    });
    expect(requested).toEqual(["http://localhost:4000/v1/config"]);
    vi.unstubAllGlobals();
  });

  it("refuses to work outside a provider", () => {
    function Orphan(): React.JSX.Element {
      useApi();
      return <span />;
    }

    expect(() => render(<Orphan />)).toThrow("outside an ApiProvider");
  });
});
