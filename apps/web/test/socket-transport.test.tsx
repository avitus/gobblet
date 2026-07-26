import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { transport } = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    transport: {
      connected: false,
      emitted: [] as string[],
      connect(): void {
        this.connected = true;
      },
      disconnect(): void {
        this.connected = false;
      },
      on(event: string, listener: (...args: unknown[]) => void): void {
        handlers.set(event, [...(handlers.get(event) ?? []), listener]);
      },
      emit(event: string): void {
        this.emitted.push(event);
      },
    },
  };
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => transport) }));

const { io } = await import("socket.io-client");
const { SocketProvider } = await import("../src/match/provider");

describe("the default transport", () => {
  it("builds a reconnecting Socket.IO client and connects it once mounted", () => {
    const view = render(
      <SocketProvider>
        <span>board</span>
      </SocketProvider>,
    );

    expect(io).toHaveBeenCalledWith(
      "http://localhost:4000",
      expect.objectContaining({ autoConnect: false, reconnection: true }),
    );
    expect(transport.connected).toBe(true);

    view.unmount();
    expect(transport.connected).toBe(false);
  });
});
