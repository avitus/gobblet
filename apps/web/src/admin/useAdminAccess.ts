import { useMe } from "../api/queries";
import { useSessionStore } from "../session/store";

export type AdminAccess = Readonly<{
  /** `null` until the account is known, so a screen can wait rather than guess. */
  allowed: boolean | null;
  username: string | null;
}>;

/**
 * Whether this reader may see the dashboard. The role is read from the account the
 * server returns, never from anything stored in the browser, and the gate is the
 * same signal the server checks on every request (ADR-0029).
 */
export function useAdminAccess(): AdminAccess {
  const session = useSessionStore((state) => state.session);
  const me = useMe(session?.kind === "account");

  if (session?.kind !== "account") {
    return { allowed: false, username: null };
  }
  if (me.isPending) {
    return { allowed: null, username: null };
  }
  if (me.isError || me.data === undefined) {
    return { allowed: false, username: null };
  }
  return {
    allowed: me.data.account.role === "admin",
    username: me.data.account.username,
  };
}
