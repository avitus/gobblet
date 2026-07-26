import { insertProfile, insertUser, listAuditRecords } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { grantRoleByUsername } from "../src/admin/grant";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The console grant of appendix P7.18: the only way the first administrator can
 * exist, audited with no administrator as the actor.
 */

let handle: DatabaseHandle;
let clock: TestClock;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
});

async function createAccount(username: string): Promise<string> {
  const user = await insertUser(handle.db, {
    email: `${username}@example.com`,
    passwordHash: "scrypt$32768$8$1$placeholder$placeholder",
    username,
    usernameNormalized: username.toLowerCase(),
    displayName: username,
  });
  await insertProfile(handle.db, { userId: user.id });
  return user.id;
}

describe("grantRoleByUsername", () => {
  it("grants the role and records the change with no actor", async () => {
    const userId = await createAccount("Ada");

    const outcome = await grantRoleByUsername(handle.db, {
      username: "ADA",
      role: "admin",
      reason: "the first administrator of the deployment",
      now: clock.now,
    });

    expect(outcome).toEqual({ ok: true, userId, username: "Ada", role: "admin" });
    const audit = await listAuditRecords(handle.db, {
      action: undefined,
      targetId: undefined,
      limit: 10,
      cursor: null,
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: "role-granted",
        adminUserId: null,
        adminUsername: null,
        targetType: "user",
        targetId: userId,
        targetLabel: "Ada",
        before: { role: "player" },
        after: { role: "admin" },
        reason: "the first administrator of the deployment",
      }),
    ]);
  });

  it("takes the role away again, audited the same way", async () => {
    await createAccount("grace");
    await grantRoleByUsername(handle.db, {
      username: "grace",
      role: "admin",
      reason: "a temporary administrator",
      now: clock.now,
    });
    clock.advance(1_000);

    const outcome = await grantRoleByUsername(handle.db, {
      username: "grace",
      role: "player",
      reason: "the temporary administrator stepped down",
      now: clock.now,
    });

    expect(outcome).toMatchObject({ ok: true, role: "player" });
    const audit = await listAuditRecords(handle.db, {
      action: "role-granted",
      targetId: undefined,
      limit: 10,
      cursor: null,
    });
    expect(audit.map((entry) => entry.after)).toEqual([{ role: "player" }, { role: "admin" }]);
  });

  it("refuses an account that does not exist", async () => {
    expect(
      await grantRoleByUsername(handle.db, {
        username: "nobody",
        role: "admin",
        reason: "there is nobody to grant it to",
        now: clock.now,
      }),
    ).toEqual({ ok: false, reason: "unknown-user" });
  });

  it("refuses a role the account already holds, so the log stays meaningful", async () => {
    await createAccount("ada");
    await grantRoleByUsername(handle.db, {
      username: "ada",
      role: "admin",
      reason: "the first administrator of the deployment",
      now: clock.now,
    });

    const repeated = await grantRoleByUsername(handle.db, {
      username: "ada",
      role: "admin",
      reason: "granting it a second time",
      now: clock.now,
    });

    expect(repeated).toEqual({ ok: false, reason: "already-held" });
    const audit = await listAuditRecords(handle.db, {
      action: undefined,
      targetId: undefined,
      limit: 10,
      cursor: null,
    });
    expect(audit).toHaveLength(1);
  });
});
