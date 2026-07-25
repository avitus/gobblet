import type { Account, IssuedSession } from "@gobblet/protocol";
import type { CreateGuestResponse } from "@gobblet/protocol";
import type { StoredSession } from "./store";

export function storedSessionFromAccount(account: Account, session: IssuedSession): StoredSession {
  return {
    token: session.sessionToken,
    kind: "account",
    displayName: account.username,
    username: account.username,
  };
}

export function storedSessionFromGuest(guest: CreateGuestResponse): StoredSession {
  return {
    token: guest.sessionToken,
    kind: "guest",
    displayName: guest.displayName,
    username: null,
  };
}
