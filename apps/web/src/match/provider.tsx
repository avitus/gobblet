import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { clientConfig } from "../config";
import { useSessionStore } from "../session/store";
import { MatchSocket } from "./socket";

const SocketContext = createContext<MatchSocket | null>(null);

export type SocketProviderProps = Readonly<{
  socket?: MatchSocket;
  children: ReactNode;
}>;

/**
 * Owns the single real-time connection. The session token is read through a
 * getter so a sign-in later in the session is picked up by the next handshake
 * without rebuilding the socket.
 */
export function SocketProvider({ socket, children }: SocketProviderProps): React.JSX.Element {
  const created = useMemo(
    () =>
      socket ??
      new MatchSocket({
        url: clientConfig.socketUrl,
        clientVersion: clientConfig.clientVersion,
        appEnv: clientConfig.appEnv,
        sessionToken: () => useSessionStore.getState().session?.token ?? null,
      }),
    [socket],
  );

  useEffect(() => {
    // The handshake is the only statement of who the server thinks this connection
    // is, so the seat a screen renders comes from here rather than from the token.
    const unsubscribe = created.subscribe((event) => {
      if (event.type === "session-ready") {
        useSessionStore.getState().actorResolved(event.payload);
      }
    });
    created.connect();
    return () => {
      unsubscribe();
      created.close();
    };
  }, [created]);

  return <SocketContext.Provider value={created}>{children}</SocketContext.Provider>;
}

export function useSocket(): MatchSocket {
  const socket = useContext(SocketContext);
  if (!socket) {
    throw new Error("The real-time client was used outside a SocketProvider");
  }
  return socket;
}
