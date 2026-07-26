import { createDatabase, findUserByUsername, setUserRole } from "@gobblet/db";
import { normalizeUsername } from "@gobblet/protocol";
import { DATABASE_URL } from "../setup/environment";

/**
 * The role, granted the only way it can be: from a process holding the database
 * credentials. The console script `pnpm admin:grant` does exactly this and writes an
 * audit record besides; that record is covered by `apps/server/test/admin-grant.test.ts`,
 * so the browser suite only needs the role itself
 * (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */
export async function grantAdminRole(username: string): Promise<void> {
  const handle = createDatabase({
    connectionString: DATABASE_URL,
    poolMax: 1,
    applicationName: "gobblet-e2e-admin",
  });
  try {
    const user = await findUserByUsername(handle.db, normalizeUsername(username));
    if (!user) {
      throw new Error(`No account is called ${username}`);
    }
    await setUserRole(handle.db, user.id, "admin");
  } finally {
    await handle.close();
  }
}
