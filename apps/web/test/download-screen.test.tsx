import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DownloadScreen, guessTarget } from "../src/screens/DownloadScreen";
import { renderWithProviders } from "./helpers/render";

/**
 * The direct-download page of appendix P8.13. It reads the same records the updater
 * reads, so what a visitor downloads by hand and what a running desktop installs
 * are the same build.
 */

const MAC = {
  target: "darwin-aarch64",
  downloadUrl: "https://github.test/gobblet/releases/download/v1.4.0/Gobblet-aarch64.dmg",
  sizeBytes: 11_534_336,
  sha256: "a".repeat(64),
};

const MAC_INTEL = {
  target: "darwin-x86_64",
  downloadUrl: "https://github.test/gobblet/releases/download/v1.4.0/Gobblet-x64.dmg",
  sizeBytes: 12_582_912,
  sha256: "c".repeat(64),
};

const WINDOWS = {
  target: "windows-x86_64",
  downloadUrl: "https://github.test/gobblet/releases/download/v1.4.0/Gobblet-setup.exe",
  sizeBytes: 9_437_184,
  sha256: "b".repeat(64),
};

function releases(artifacts: readonly unknown[] = [MAC, WINDOWS]): unknown {
  return {
    stable: {
      releaseId: "0f1c1a1e-2b3c-4d5e-8f90-1a2b3c4d5e6f",
      version: "1.4.0",
      channel: "stable",
      notes: "Faster board rendering on older machines.",
      paused: false,
      publishedAt: "2026-07-26T10:00:00.000Z",
      artifacts,
    },
    beta: null,
  };
}

describe("the download page", () => {
  it("offers the current build for each platform, with its size and digest", async () => {
    renderWithProviders(<DownloadScreen userAgent="Macintosh; Intel Mac OS X 10_15_7" />, {
      routes: { "GET /v1/releases/latest": { body: releases() } },
    });

    expect(await screen.findByTestId("download-list")).toBeInTheDocument();
    expect(screen.getByTestId("download-link-darwin-aarch64")).toHaveAttribute(
      "href",
      MAC.downloadUrl,
    );
    expect(screen.getByTestId("digest-windows-x86_64")).toHaveTextContent(WINDOWS.sha256);
    expect(screen.getByTestId("download-notes")).toHaveTextContent("Faster board rendering");
  });

  it("puts the visitor's own platform first and leaves the rest in order", async () => {
    renderWithProviders(<DownloadScreen userAgent="Windows NT 10.0; Win64; x64" />, {
      routes: { "GET /v1/releases/latest": { body: releases([MAC, MAC_INTEL, WINDOWS]) } },
    });

    const items = await screen.findAllByTestId(/^download-(darwin|windows)/);
    expect(items.map((item) => item.textContent)).toEqual([
      "Windows, 64-bityour platform",
      "macOS, Apple silicon",
      "macOS, Intel",
    ]);
  });

  it("names a platform this version was not built for", async () => {
    renderWithProviders(<DownloadScreen userAgent="Macintosh; Apple M1" />, {
      routes: { "GET /v1/releases/latest": { body: releases([MAC]) } },
    });

    expect(await screen.findByTestId("download-missing")).toHaveTextContent("Windows");
  });

  it("says so plainly when nothing has been published", async () => {
    renderWithProviders(<DownloadScreen />, {
      routes: { "GET /v1/releases/latest": { body: { stable: null, beta: null } } },
    });

    expect(await screen.findByTestId("download-none")).toBeInTheDocument();
  });

  it("shows the server's refusal rather than an empty page", async () => {
    renderWithProviders(<DownloadScreen />, {
      routes: {
        "GET /v1/releases/latest": {
          status: 503,
          body: { error: { code: "unavailable", message: "The service is down", requestId: "r" } },
        },
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("503");
  });

  it("waits without pretending", () => {
    renderWithProviders(<DownloadScreen />, {
      routes: { "GET /v1/releases/latest": { body: releases() } },
    });

    expect(screen.getByText("Looking up the current version")).toBeInTheDocument();
  });
});

describe("reading the platform from the browser", () => {
  it("recognises the two shapes of macOS and Windows, and guesses Apple silicon", () => {
    expect(guessTarget("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows-x86_64");
    expect(guessTarget("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("darwin-x86_64");
    expect(guessTarget("Mozilla/5.0 (Macintosh; Apple M2 Mac OS X 14_0)")).toBe("darwin-aarch64");
    expect(guessTarget("")).toBe("darwin-aarch64");
  });
});
