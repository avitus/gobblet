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
      emit(event: string, payload: unknown): void {
        this.emitted.push(event);
        this.payloads.push(payload);
      },
      payloads: [] as unknown[],
    },
  };
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => transport) }));

const { io } = await import("socket.io-client");
const { SocketProvider, useSocket } = await import("../src/match/provider");
const { useSessionStore } = await import("../src/session/store");

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

  it("reads the stored session token when the handshake asks for it", () => {
    useSessionStore.getState().signedIn({
      token: "session-token",
      kind: "guest",
      displayName: "Guest 1234",
      username: null,
    });

    function Handshake(): null {
      void useSocket().authenticate();
      return null;
    }

    render(
      <SocketProvider>
        <Handshake />
      </SocketProvider>,
    );

    expect(transport.payloads.at(-1)).toMatchObject({ sessionToken: "session-token" });
  });

  it("omits the token when there is no session to send", () => {
    useSessionStore.getState().signedOut();

    function Handshake(): null {
      void useSocket().authenticate();
      return null;
    }

    render(
      <SocketProvider>
        <Handshake />
      </SocketProvider>,
    );

    expect(transport.payloads.at(-1)).not.toHaveProperty("sessionToken");
  });
});
