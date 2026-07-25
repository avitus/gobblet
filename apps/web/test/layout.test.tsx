import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../src/app/routes";
import { renderWithProviders } from "./helpers/render";

const CONFIG = {
  appEnv: "local",
  appVersion: "1.0.0",
  minSupportedClientVersion: "0.1.0",
  modes: ["casual", "ranked"],
  timeControlsSeconds: [180, 300, 600, 900],
};

/** Appendix P5.9: the layout is supported to 1024x640 and refuses below 768. */
function stubViewport(matchingQuery: string): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: query === matchingQuery,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("layout envelope", () => {
  it("asks for a wider window below the supported width", async () => {
    stubViewport("(max-width: 767px)");

    renderWithProviders(<AppRoutes />, { routes: { "GET /v1/config": { body: CONFIG } } });

    expect(
      await screen.findByRole("heading", { name: "A larger window is needed" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("renders the application at a supported width", async () => {
    stubViewport("(min-width: 1024px)");

    renderWithProviders(<AppRoutes />, { routes: { "GET /v1/config": { body: CONFIG } } });

    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});
