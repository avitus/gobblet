import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { REDUCED_MOTION_QUERY, useMediaQuery, usePrefersReducedMotion } from "../src/index";

type Listener = () => void;

class FakeMediaQueryList {
  readonly listeners = new Set<Listener>();

  constructor(
    readonly media: string,
    public matches: boolean,
  ) {}

  addEventListener(_type: "change", listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: Listener): void {
    this.listeners.delete(listener);
  }

  set(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

function installMatchMedia(lists: Map<string, FakeMediaQueryList>): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const existing = lists.get(query);
      if (existing !== undefined) {
        return existing;
      }
      const created = new FakeMediaQueryList(query, false);
      lists.set(query, created);
      return created;
    },
  });
}

function Probe({ query }: { query: string }): React.JSX.Element {
  const matches = useMediaQuery(query);
  return <span data-testid="probe">{matches ? "yes" : "no"}</span>;
}

function ReducedMotionProbe(): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  return <span data-testid="reduced">{reduced ? "yes" : "no"}</span>;
}

describe("useMediaQuery", () => {
  it("reports the current match and follows changes", () => {
    const lists = new Map<string, FakeMediaQueryList>();
    lists.set("(min-width: 1024px)", new FakeMediaQueryList("(min-width: 1024px)", true));
    installMatchMedia(lists);

    render(<Probe query="(min-width: 1024px)" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("yes");

    act(() => {
      lists.get("(min-width: 1024px)")?.set(false);
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("no");
  });

  it("unsubscribes when it unmounts", () => {
    const lists = new Map<string, FakeMediaQueryList>();
    const list = new FakeMediaQueryList("(min-width: 640px)", false);
    lists.set("(min-width: 640px)", list);
    installMatchMedia(lists);

    const view = render(<Probe query="(min-width: 640px)" />);
    expect(list.listeners.size).toBe(1);

    view.unmount();

    expect(list.listeners.size).toBe(0);
  });

  it("reports no match when the browser has no matchMedia", () => {
    render(<Probe query="(min-width: 1024px)" />);

    expect(screen.getByTestId("probe")).toHaveTextContent("no");
  });

  it("asks for the documented reduced motion query", () => {
    const lists = new Map<string, FakeMediaQueryList>();
    lists.set(REDUCED_MOTION_QUERY, new FakeMediaQueryList(REDUCED_MOTION_QUERY, true));
    installMatchMedia(lists);

    render(<ReducedMotionProbe />);

    expect(screen.getByTestId("reduced")).toHaveTextContent("yes");
  });
});
