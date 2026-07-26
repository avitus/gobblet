import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  countAuditRecords,
  insertAuditRecord,
  insertUser,
  listAuditRecords,
  listModerationHistory,
  users,
} from "../src/index";
import type { DatabaseHandle, NewAuditLogRow, UserRow } from "../src/index";
import { userFixture } from "./helpers/fixtures";
import { expectQueryToFail, setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterEach(async () => {
  await truncateAll(handle);
});

afterAll(async () => {
  await handle.close();
});

async function createUser(username?: string): Promise<UserRow> {
  return insertUser(
    handle.db,
    username === undefined
      ? userFixture()
      : userFixture({ username, usernameNormalized: username.toLowerCase() }),
  );
}

function auditFixture(overrides: Partial<NewAuditLogRow> = {}): NewAuditLogRow {
  return {
    action: "user-suspended",
    targetType: "user",
    targetId: overrides.targetId ?? randomUUID(),
    before: { status: "active" },
    after: { status: "suspended" },
    reason: "Repeated abandonment of ranked matches.",
    ...overrides,
  };
}

describe("the audit log", () => {
  it("records who acted, on what, and what changed", async () => {
    const admin = await createUser("moderator_one");
    const target = await createUser();

    const written = await insertAuditRecord(
      handle.db,
      auditFixture({
        adminUserId: admin.id,
        targetId: target.id,
        targetLabel: target.username,
      }),
    );

    expect(written.createdAt).toBeInstanceOf(Date);

    const [entry] = await listAuditRecords(handle.db, { limit: 10 });
    expect(entry).toMatchObject({
      id: written.id,
      adminUserId: admin.id,
      adminUsername: "moderator_one",
      action: "user-suspended",
      targetType: "user",
      targetId: target.id,
      targetLabel: target.username,
      before: { status: "active" },
      after: { status: "suspended" },
      reason: "Repeated abandonment of ranked matches.",
    });
  });

  it("accepts the console, which has no account", async () => {
    const target = await createUser();

    await insertAuditRecord(
      handle.db,
      auditFixture({ action: "role-granted", targetId: target.id }),
    );

    const [entry] = await listAuditRecords(handle.db, { limit: 10 });
    expect(entry?.adminUserId).toBeNull();
    expect(entry?.adminUsername).toBeNull();
  });

  it("refuses a record without a reason", async () => {
    const target = await createUser();
    const failure = await expectQueryToFail(() =>
      insertAuditRecord(handle.db, {
        ...auditFixture({ targetId: target.id }),
        reason: null as unknown as string,
      }),
    );

    expect(failure.code).toBe("23502");
  });

  it("pages newest first through records that share a moment", async () => {
    const target = await createUser();
    const sameMoment = new Date("2026-05-01T10:00:00.000Z");
    const ids = await Promise.all(
      [0, 1, 2].map(async () => {
        const row = await insertAuditRecord(
          handle.db,
          auditFixture({ targetId: target.id, createdAt: sameMoment }),
        );
        return row.id;
      }),
    );
    const descending = [...ids].sort().reverse();

    const first = await listAuditRecords(handle.db, { limit: 2 });
    expect(first.map((entry) => entry.id)).toEqual(descending.slice(0, 2));

    const boundary = first[first.length - 1];
    if (boundary === undefined) {
      throw new Error("expected a first page");
    }
    const second = await listAuditRecords(handle.db, {
      limit: 2,
      cursor: { createdAt: boundary.createdAt, id: boundary.id },
    });
    expect(second.map((entry) => entry.id)).toEqual(descending.slice(2));
  });

  it("pages by the moment when the records differ in time", async () => {
    const target = await createUser();
    await insertAuditRecord(
      handle.db,
      auditFixture({ targetId: target.id, createdAt: new Date("2026-05-01T10:00:00.000Z") }),
    );
    const newer = await insertAuditRecord(
      handle.db,
      auditFixture({ targetId: target.id, createdAt: new Date("2026-05-02T10:00:00.000Z") }),
    );

    const page = await listAuditRecords(handle.db, {
      limit: 5,
      cursor: { createdAt: newer.createdAt, id: newer.id },
    });

    expect(page.map((entry) => entry.createdAt.toISOString())).toEqual([
      "2026-05-01T10:00:00.000Z",
    ]);
  });

  it("filters by action and by target", async () => {
    const one = await createUser();
    const other = await createUser();
    await insertAuditRecord(handle.db, auditFixture({ targetId: one.id }));
    await insertAuditRecord(
      handle.db,
      auditFixture({ targetId: other.id, action: "rating-adjusted" }),
    );

    const suspensions = await listAuditRecords(handle.db, { action: "user-suspended", limit: 10 });
    expect(suspensions).toHaveLength(1);
    expect(suspensions[0]?.targetId).toBe(one.id);

    const aboutOther = await listAuditRecords(handle.db, { targetId: other.id, limit: 10 });
    expect(aboutOther.map((entry) => entry.action)).toEqual(["rating-adjusted"]);
  });

  it("reads one account's moderation history and counts the whole log", async () => {
    const one = await createUser();
    const other = await createUser();
    await insertAuditRecord(handle.db, auditFixture({ targetId: one.id }));
    await insertAuditRecord(handle.db, auditFixture({ targetId: other.id }));

    expect(await listModerationHistory(handle.db, one.id, 10)).toHaveLength(1);
    expect(await countAuditRecords(handle.db)).toBe(2);
  });

  it("keeps the record when the administrator's account is deleted", async () => {
    const admin = await createUser();
    const target = await createUser();
    await insertAuditRecord(
      handle.db,
      auditFixture({ adminUserId: admin.id, targetId: target.id }),
    );

    await handle.db.delete(users).where(eq(users.id, admin.id));

    const [entry] = await listAuditRecords(handle.db, { limit: 10 });
    expect(entry?.adminUserId).toBeNull();
    expect(entry?.reason).toBe("Repeated abandonment of ranked matches.");
  });
});
