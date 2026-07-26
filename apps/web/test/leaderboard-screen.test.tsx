import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LeaderboardScreen } from "../src/screens/LeaderboardScreen";
import { useSessionStore } from "../src/session/store";
import { renderWithProviders } from "./helpers/render";

function entry(
  rank: number,
  username: string,
  rating: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rank,
    username,
    avatarUrl: null,
    countryCode: "GB",
    rating,
    wins: 9,
    games: 14,
    ratedAt: "2026-07-24T10:00:00.000Z",
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    period: "all-time",
    periodStart: null,
    periodEnd: null,
    generatedAt: "2026-07-25T08:00:00.000Z",
    entries: [entry(1, "ada", 1420), entry(2, "linus", 1380)],
    nextCursor: null,
    you: null,
    ...overrides,
  };
}

describe("the leaderboard screen", () => {
  beforeEach(() => {
    useSessionStore.getState().signedOut();
  });

  it("shows the all-time board first, in rank order", async () => {
    const { calls } = renderWithProviders(<LeaderboardScreen />, {
      routes: { "GET /v1/leaderboards": { body: page() } },
    });

    const table = await screen.findByTestId("leaderboard-table");
    expect(table).toHaveTextContent("ada");
    expect(calls).toEqual(["GET /v1/leaderboards"]);
    expect(
      [...table.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-testid")),
    ).toEqual(["leaderboard-row-ada", "leaderboard-row-linus"]);
    expect(screen.getByText("Every rated account.")).toBeInTheDocument();
  });

  it("asks for the period the reader chose, and names its bounds", async () => {
    const { sent } = renderWithProviders(<LeaderboardScreen />, {
      routes: {
        "GET /v1/leaderboards": () => ({
          body: page({
            period: "weekly",
            periodStart: "2026-07-20T00:00:00.000Z",
            periodEnd: "2026-07-27T00:00:00.000Z",
          }),
        }),
      },
    });

    await screen.findByTestId("leaderboard-table");
    await userEvent.click(screen.getByTestId("period-weekly"));

    await waitFor(() => {
      expect(screen.getByText("2026-07-20 to 2026-07-27, in UTC.")).toBeInTheDocument();
    });
    expect(sent).toHaveLength(2);
  });

  it("shows the reader's own row when it falls outside the page", async () => {
    renderWithProviders(<LeaderboardScreen />, {
      routes: {
        "GET /v1/leaderboards": {
          body: page({ you: entry(482, "grace", 1180) }),
        },
      },
    });

    expect(await screen.findByTestId("your-rank")).toHaveTextContent("482");
    expect(screen.getByTestId("leaderboard-row-grace")).toHaveAttribute("data-you", "true");
  });

  it("marks the reader's own row in place rather than repeating it", async () => {
    renderWithProviders(<LeaderboardScreen />, {
      routes: {
        "GET /v1/leaderboards": {
          body: page({ you: entry(2, "linus", 1380) }),
        },
      },
    });

    await screen.findByTestId("leaderboard-table");
    expect(screen.queryByTestId("your-rank")).not.toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-row-linus")).toHaveAttribute("data-you", "true");
  });

  it("pages with the cursor the previous page returned", async () => {
    let call = 0;
    const { sent } = renderWithProviders(<LeaderboardScreen />, {
      routes: {
        "GET /v1/leaderboards": () => {
          call += 1;
          return call === 1
            ? { body: page({ nextCursor: "1380.9.14.1784889600000.abc" }) }
            : { body: page({ entries: [entry(3, "grace", 1300)] }) };
        },
      },
    });

    await screen.findByTestId("leaderboard-table");
    await userEvent.click(screen.getByTestId("load-more"));

    expect(await screen.findByTestId("leaderboard-row-grace")).toBeInTheDocument();
    expect(sent).toHaveLength(2);
    expect(screen.queryByTestId("load-more")).not.toBeInTheDocument();
  });

  it("says so when nobody has played in the period", async () => {
    renderWithProviders(<LeaderboardScreen />, {
      routes: { "GET /v1/leaderboards": { body: page({ entries: [] }) } },
    });

    expect(await screen.findByTestId("leaderboard-empty")).toBeInTheDocument();
  });

  it("reports a board the server could not read", async () => {
    renderWithProviders(<LeaderboardScreen />, {
      routes: {
        "GET /v1/leaderboards": {
          status: 503,
          body: {
            error: { code: "dependency_unavailable", message: "The board is away", requestId: "r" },
          },
        },
      },
    });

    expect(await screen.findByText("The board is away")).toBeInTheDocument();
  });

  it("links every row to the profile behind it", async () => {
    renderWithProviders(<LeaderboardScreen />, {
      routes: { "GET /v1/leaderboards": { body: page() } },
    });

    expect(await screen.findByRole("link", { name: "ada" })).toHaveAttribute(
      "href",
      "/profile/ada",
    );
  });
});
