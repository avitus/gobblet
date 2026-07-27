import {
  commandAckSchema,
  createGuestResponseSchema,
  matchFoundEventSchema,
} from "@gobblet/protocol";
import type { CommandAck, MatchFoundEvent } from "@gobblet/protocol";
import type { Move, Player } from "@gobblet/game-core";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { LoadMatchHandle, LoadMoveAck, LoadPort } from "./load";

/**
 * The one transport behind the load harness: real guests, real sockets, real
 * matchmaking. It lives here rather than in the command-line entry point so an
 * integration test can drive it against a server it starts itself, at two matches;
 * the same code then runs at whatever scale the host allows.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export type SocketPortOptions = Readonly<{
  baseUrl: string;
  clientVersion: string;
  appEnv: string;
  mode: "casual" | "ranked";
  timeControlSeconds: number;
  /** One budget for connecting, pairing and acknowledging. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}>;

type Seated = Readonly<{
  socket: Socket;
  color: Player;
  matchId: string;
  found: MatchFoundEvent;
}>;

function withTimeout<T>(
  what: string,
  ms: number,
  work: (settle: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out ${what} after ${String(ms)} ms`));
    }, ms);
    work(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Both seats, by colour. Exported because the two cases it refuses, a server that
 * seats two clients as the same colour and a pair that landed in different matches,
 * are worth tests and neither can be produced through a socket on demand.
 */
export function pairSeats<T extends Readonly<{ color: Player; matchId: string }>>(
  seats: readonly T[],
): Readonly<Record<Player, T>> {
  const light = seats.find((seat) => seat.color === "light");
  const dark = seats.find((seat) => seat.color === "dark");
  if (light === undefined || dark === undefined) {
    throw new Error("the two clients were not seated as opposite colours");
  }
  if (light.matchId !== dark.matchId) {
    throw new Error("the two clients were paired into different matches");
  }
  return { light, dark };
}

async function openGuestSocket(options: SocketPortOptions, timeoutMs: number): Promise<Socket> {
  const call = options.fetch ?? globalThis.fetch;
  const response = await call(`${options.baseUrl.replace(/\/+$/, "")}/v1/guests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`guest creation answered ${String(response.status)}`);
  }
  const guest = createGuestResponseSchema.parse(await response.json());

  const socket = io(options.baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });

  try {
    await withTimeout<void>("connecting a socket", timeoutMs, (settle, fail) => {
      socket.once("connect", () => {
        settle();
      });
      socket.once("connect_error", (error: Error) => {
        fail(error);
      });
    });

    await withTimeout<void>("authenticating a session", timeoutMs, (settle) => {
      socket.emit(
        "session:authenticate",
        {
          clientVersion: options.clientVersion,
          appEnv: options.appEnv,
          sessionToken: guest.sessionToken,
        },
        () => {
          settle();
        },
      );
    });
  } catch (error) {
    socket.removeAllListeners();
    socket.disconnect();
    throw error;
  }

  return socket;
}

async function seat(
  options: SocketPortOptions,
  socket: Socket,
  timeoutMs: number,
): Promise<Seated> {
  const found = withTimeout<MatchFoundEvent>("waiting to be paired", timeoutMs, (settle) => {
    socket.once("match:found", (payload: unknown) => {
      settle(matchFoundEventSchema.parse(payload));
    });
  });

  socket.emit("queue:join", {
    mode: options.mode,
    timeControlSeconds: options.timeControlSeconds,
  });

  const event = await found;
  return { socket, color: event.yourColor, matchId: event.snapshot.matchId, found: event };
}

export function createSocketLoadPort(options: SocketPortOptions): LoadPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The queue pairs whoever is waiting, so two matches queueing at once can hand each
  // other's clients to each other. Only the pairing is serialised; the matches then
  // play concurrently, which is the part the target is about.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    now: () => performance.now(),
    openMatch: async (): Promise<LoadMatchHandle> => {
      const sockets: Socket[] = [];
      const close = (): void => {
        for (const socket of sockets) {
          socket.removeAllListeners();
          socket.disconnect();
        }
      };

      try {
        // Settled rather than raced: a client that did connect still has to be closed,
        // or the run leaves sockets holding the server open.
        const opened = await Promise.allSettled([
          openGuestSocket(options, timeoutMs),
          openGuestSocket(options, timeoutMs),
        ]);
        for (const result of opened) {
          if (result.status === "fulfilled") {
            sockets.push(result.value);
          }
        }
        const refused = opened.find((result) => result.status === "rejected");
        if (refused !== undefined) {
          // Every rejection here is thrown by openGuestSocket, which throws Errors.
          throw refused.reason as Error;
        }
        const pairing = queue.then(() =>
          Promise.all(sockets.map((socket) => seat(options, socket, timeoutMs))),
        );
        queue = pairing.catch(() => undefined);
        const seats = await pairing;
        const pair = pairSeats(seats);

        // Counted per seat, not in total: the harness holds both sides, so one
        // match ending is two events. A duplicate is one client told twice.
        const endings = new Map<Player, number>();
        for (const entry of seats) {
          entry.socket.on("match:ended", () => {
            endings.set(entry.color, (endings.get(entry.color) ?? 0) + 1);
          });
        }

        return {
          matchId: pair.light.found.snapshot.matchId,
          snapshot: pair.light.found.snapshot,
          completions: () => Math.max(0, ...endings.values()),
          submit: async (player, move: Move, envelope): Promise<LoadMoveAck> => {
            const ack = await withTimeout<CommandAck>(
              "waiting for a move acknowledgement",
              timeoutMs,
              (settle) => {
                pair[player].socket.emit(
                  "match:move",
                  // `sentAtClient` is transport metadata the server uses for
                  // diagnostics only, so it is stamped here rather than by the plan.
                  { ...envelope, sentAtClient: Date.now(), payload: { move } },
                  (raw: unknown) => {
                    settle(commandAckSchema.parse(raw));
                  },
                );
              },
            );
            return ack.ok
              ? { ok: true, newVersion: ack.newVersion, reason: null }
              : { ok: false, newVersion: null, reason: ack.reason };
          },
          close: () => {
            close();
            return Promise.resolve();
          },
        };
      } catch (error) {
        close();
        throw error;
      }
    },
  };
}
