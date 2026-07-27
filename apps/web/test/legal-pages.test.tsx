import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../src/app/routes";
import {
  LEGAL_DOCUMENTS,
  OPERATOR_PLACEHOLDER,
  PRIVACY,
  SUPPORT,
  SUPPORT_ADDRESS,
  TERMS,
} from "../src/legal/content";
import { renderWithProviders } from "./helpers/render";

/**
 * The release gate of section 21.2 says the privacy and terms pages are published,
 * which means reachable from the running client without a session, saying what is
 * stored and what is not, and honest about not having been reviewed by a lawyer
 * (appendix P9.5 and P9.6).
 */

const CONFIG = {
  appEnv: "local",
  appVersion: "1.0.0",
  minSupportedClientVersion: "0.1.0",
  modes: ["casual", "ranked"],
  timeControlsSeconds: [180, 300, 600, 900],
};

function stubWideViewport(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: query === "(min-width: 1024px)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function renderAt(path: string) {
  stubWideViewport();
  return renderWithProviders(<AppRoutes />, {
    routes: { "GET /v1/config": { body: CONFIG } },
    initialPath: path,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  if ("__TAURI_INTERNALS__" in window) {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
});

describe("the documents themselves", () => {
  it("has a privacy policy, terms and a support page, each at its own address", () => {
    expect(LEGAL_DOCUMENTS.map((document) => document.path)).toEqual([
      "/privacy",
      "/terms",
      "/support",
    ]);
  });

  it("says who runs the service, without inventing a company", () => {
    expect(PRIVACY.intro).toContain(OPERATOR_PLACEHOLDER);
    expect(TERMS.intro).toContain(OPERATOR_PLACEHOLDER);
  });

  it("admits that no lawyer has read the privacy policy or the terms", () => {
    expect(PRIVACY.intro).toContain("not been reviewed by a lawyer");
    expect(TERMS.intro).toContain("not been reviewed by a lawyer");
  });

  it("dates every document and gives each section something to say", () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(document.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.sections.length).toBeGreaterThan(2);
      for (const section of document.sections) {
        expect(section.heading).not.toBe("");
        expect(section.paragraphs.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the privacy policy", () => {
  it("renders at /privacy for a visitor with no session", async () => {
    renderAt("/privacy");

    expect(await screen.findByRole("heading", { name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByTestId("legal-privacy")).toBeInTheDocument();
  });

  it("lists every storage key the client writes, with why it is needed", async () => {
    renderAt("/privacy");
    const page = await screen.findByTestId("legal-privacy");

    for (const key of ["gobblet.session", "gobblet.settings", "gobblet.telemetry"]) {
      expect(within(page).getByText(new RegExp(key.replace(".", "\\.")))).toBeInTheDocument();
    }
  });

  it("says there are no cookies, which is why there is no consent banner", async () => {
    renderAt("/privacy");
    const page = await screen.findByTestId("legal-privacy");

    expect(within(page).getByText(/No cookies are used/)).toBeInTheDocument();
    expect(screen.queryByText(/accept all cookies/i)).toBeNull();
  });

  it("makes a claim the client keeps: rendering it writes no cookie", async () => {
    expect(document.cookie).toBe("");

    renderAt("/privacy");
    await screen.findByTestId("legal-privacy");

    expect(document.cookie).toBe("");
  });

  it("says that analytics are off until they are turned on", async () => {
    renderAt("/privacy");

    expect(await screen.findByText(/off until you turn them on/)).toBeInTheDocument();
  });
});

describe("the terms", () => {
  it("renders at /terms", async () => {
    renderAt("/terms");

    expect(await screen.findByRole("heading", { name: "Terms of use" })).toBeInTheDocument();
  });

  it("names the game's designer and publisher, and disclaims affiliation", async () => {
    renderAt("/terms");
    const page = await screen.findByTestId("legal-terms");

    expect(within(page).getByText(/Thierry Denoual/)).toBeInTheDocument();
    expect(within(page).getByText(/not affiliated with or endorsed by/)).toBeInTheDocument();
  });

  it("states the fair-play rules a suspension can follow from", async () => {
    renderAt("/terms");
    const page = await screen.findByTestId("legal-terms");

    expect(within(page).getByText(/No engines, scripts or assistance/)).toBeInTheDocument();
  });
});

describe("the support page", () => {
  it("renders at /support and gives an address to write to", async () => {
    renderAt("/support");
    const page = await screen.findByTestId("legal-support");

    expect(within(page).getByText(new RegExp(SUPPORT_ADDRESS))).toBeInTheDocument();
    expect(SUPPORT.sections.some((section) => section.heading === "Known problems")).toBe(true);
  });
});

describe("the footer", () => {
  it("is on every screen, so the pages can be found from anywhere", async () => {
    renderAt("/");
    const footer = await screen.findByRole("navigation", { name: "Legal and support" });

    for (const document of LEGAL_DOCUMENTS) {
      expect(within(footer).getByRole("link", { name: document.label })).toBeInTheDocument();
    }
  });

  it("shows the build version, which is what a support message needs", async () => {
    renderAt("/");

    expect(await screen.findByTestId("build-version")).toHaveTextContent(/^Web \d+\.\d+\.\d+$/);
  });

  it("says Desktop when it is running in the desktop shell", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    renderAt("/");

    expect(await screen.findByTestId("build-version")).toHaveTextContent(/^Desktop /);
  });

  it("navigates to the privacy policy from the footer link", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(await screen.findByRole("link", { name: "Privacy" }));

    expect(await screen.findByTestId("legal-privacy")).toBeInTheDocument();
  });
});
