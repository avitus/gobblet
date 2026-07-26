import type { SocketTransport } from "../../src/match/socket";

type Handler = (...args: unknown[]) => void;

export type Emitted = Readonly<{
  event: string;
  payload: unknown;
  respond: (response: unknown) => void;
}>;

/**
 * A Socket.IO stand-in. Acknowledgements are answered by the test rather than a
 * server, so the socket client can be exercised without a network or a clock.
 */
export class FakeTransport implements SocketTransport {
  connected = false;

  readonly emitted: Emitted[] = [];

  private readonly handlers = new Map<string, Handler[]>();

  connect(): void {
    this.connected = true;
    this.fire("connect");
  }

  disconnect(): void {
    this.connected = false;
    this.fire("disconnect", "io client disconnect");
  }

  on(event: string, listener: Handler): void {
    const listeners = this.handlers.get(event) ?? [];
    listeners.push(listener);
    this.handlers.set(event, listeners);
  }

  emit(event: string, ...args: unknown[]): void {
    const acknowledge = args[1];
    this.emitted.push({
      event,
      payload: args[0],
      respond: (response: unknown) => {
        if (typeof acknowledge === "function") {
          (acknowledge as (value: unknown) => void)(response);
        }
      },
    });
  }

  /** Delivers a server-sent event to the client, exactly as the transport would. */
  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(event) ?? []) {
      listener(...args);
    }
  }

  /** Answers the oldest emission of an event that has not been answered yet. */
  answer(event: string, response: unknown): void {
    const next = this.emitted.find((entry) => entry.event === event && !this.answered.has(entry));
    if (!next) {
      throw new Error(`nothing is waiting for an answer to ${event}`);
    }
    this.answered.add(next);
    next.respond(response);
  }

  /** Answers every outstanding emission of an event with the same response. */
  answerAll(event: string, response: unknown): void {
    for (const entry of this.emitted) {
      if (entry.event === event && !this.answered.has(entry)) {
        this.answered.add(entry);
        entry.respond(response);
      }
    }
  }

  payloadsFor(event: string): unknown[] {
    return this.emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
  }

  private readonly answered = new WeakSet<Emitted>();
}
