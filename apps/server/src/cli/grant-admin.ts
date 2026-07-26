import { loadServerConfig } from "@gobblet/config";
import { createDatabase } from "@gobblet/db";
import { isUserRole } from "@gobblet/protocol";
import { grantRoleByUsername } from "../admin/grant";

/**
 * `pnpm admin:grant <username> "<reason>" [role]`. The first administrator is made
 * here because the dashboard cannot grant a role nobody holds yet, and the grant is
 * audited with no actor, which is exactly what happened (appendix P7.18).
 */

const [username, reason, role = "admin"] = process.argv.slice(2);

if (!username || !reason) {
  console.error('Usage: pnpm admin:grant <username> "<reason>" [player|admin]');
  process.exit(1);
}

if (!isUserRole(role)) {
  console.error(`Unknown role: ${role}`);
  process.exit(1);
}

const config = loadServerConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required to grant a role.");
  process.exit(1);
}

const handle = createDatabase({
  connectionString: config.databaseUrl,
  poolMax: 1,
  applicationName: "gobblet-admin-grant",
});

try {
  const outcome = await grantRoleByUsername(handle.db, {
    username,
    role,
    reason,
    now: Date.now,
  });

  if (!outcome.ok) {
    console.error(
      outcome.reason === "unknown-user"
        ? `No account is named ${username}.`
        : `${username} already holds ${role}.`,
    );
    process.exit(1);
  }

  console.warn(`${outcome.username} now holds ${outcome.role}`);
} finally {
  await handle.close();
}
