import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

/**
 * A thin promise wrapper over socket.io-client. Tests wait for named events with
 * a timeout instead of sleeping, so a missing broadcast fails fast and loudly.
 */
export class TestClient {
  private readonly socket: Socket;

  private readonly received = new Map<string, unknown[]>();

  private readonly waiters = new Map<string, ((value: unknown) => void)[]>();

  constructor(url: string) {
    this.socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    this.socket.onAny((event: string, payload: unknown) => {
      const pending = this.waiters.get(event);
      const next = pending?.shift();
      if (next) {
        next(payload);
        return;
      }
      const seen = this.received.get(event) ?? [];
      seen.push(payload);
      this.received.set(event, seen);
    });
  }

  async connect(): Promise<void> {
    if (this.socket.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out connecting"));
      }, 2_000);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("connect_error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async emit<TAck>(event: string, payload: unknown): Promise<TAck> {
    return new Promise<TAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for the acknowledgement of ${event}`));
      }, 2_000);
      this.socket.emit(event, payload, (response: TAck) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  emitWithoutAck(event: string, payload: unknown): void {
    this.socket.emit(event, payload);
  }

  /**
   * Emits with an acknowledgement nobody waits for, for a frame the test is about to
   * close the socket under. The callback exists so the handler still has one.
   */
  emitIgnoringAck(event: string, payload: unknown): void {
    this.socket.emit(event, payload, () => {});
  }

  async next<T>(event: string, timeoutMs = 2_000): Promise<T> {
    const buffered = this.received.get(event);
    if (buffered && buffered.length > 0) {
      return buffered.shift() as T;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${event}`));
      }, timeoutMs);
      const waiters = this.waiters.get(event) ?? [];
      waiters.push((value) => {
        clearTimeout(timer);
        resolve(value as T);
      });
      this.waiters.set(event, waiters);
    });
  }

  seen(event: string): readonly unknown[] {
    return this.received.get(event) ?? [];
  }

  /** Discards buffered events from test setup so assertions see only new ones. */
  drain(event: string): void {
    this.received.delete(event);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  async waitForDisconnect(timeoutMs = 2_000): Promise<void> {
    if (!this.socket.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for the server to disconnect the socket"));
      }, timeoutMs);
      this.socket.once("disconnect", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}
