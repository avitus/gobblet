import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  auditLog,
  emailVerificationTokens,
  guestSessions,
  matchConnectionEvents,
  matchEvents,
  matches,
  profiles,
  ratingAdjustments,
  ratingChanges,
  ratings,
  releaseArtifacts,
  releases,
  userAchievements,
  userSessions,
} from "../src/index";

/**
 * What happens to a dependent row when the row it points at is deleted is decided
 * once, here, and the migrations carry it into the database. A deletion request
 * (spec section 15.6) relies on it, so every rule is stated rather than defaulted.
 */

const TABLES_WITH_REFERENCES: readonly PgTable[] = [
  profiles,
  userSessions,
  emailVerificationTokens,
  guestSessions,
  matches,
  ratings,
  ratingChanges,
  matchEvents,
  userAchievements,
  auditLog,
  ratingAdjustments,
  matchConnectionEvents,
  releases,
  releaseArtifacts,
];

type Reference = Readonly<{ from: string; to: string; onDelete: string | undefined }>;

function referencesOf(table: PgTable): Reference[] {
  return getTableConfig(table).foreignKeys.map((key) => {
    const { columns, foreignTable, foreignColumns } = key.reference();
    return {
      from: `${getTableName(table)}.${columns[0]?.name ?? ""}`,
      to: `${getTableName(foreignTable)}.${foreignColumns[0]?.name ?? ""}`,
      onDelete: key.onDelete,
    };
  });
}

function referencesDeleting(action: string): Reference[] {
  return TABLES_WITH_REFERENCES.flatMap(referencesOf)
    .filter((reference) => reference.onDelete === action)
    .sort((left, right) => left.from.localeCompare(right.from));
}

describe("what the schema does when a referenced row is deleted", () => {
  it("takes everything that belongs to an account or a match with it", () => {
    expect(referencesDeleting("cascade")).toEqual([
      { from: "email_verification_tokens.user_id", to: "users.id", onDelete: "cascade" },
      { from: "match_connection_events.match_id", to: "matches.id", onDelete: "cascade" },
      { from: "match_events.match_id", to: "matches.id", onDelete: "cascade" },
      { from: "profiles.user_id", to: "users.id", onDelete: "cascade" },
      { from: "rating_adjustments.audit_id", to: "audit_log.id", onDelete: "cascade" },
      { from: "rating_adjustments.user_id", to: "users.id", onDelete: "cascade" },
      { from: "rating_changes.match_id", to: "matches.id", onDelete: "cascade" },
      { from: "rating_changes.user_id", to: "users.id", onDelete: "cascade" },
      { from: "ratings.user_id", to: "users.id", onDelete: "cascade" },
      { from: "release_artifacts.release_id", to: "releases.id", onDelete: "cascade" },
      { from: "user_achievements.achievement_id", to: "achievements.id", onDelete: "cascade" },
      { from: "user_achievements.user_id", to: "users.id", onDelete: "cascade" },
      { from: "user_sessions.user_id", to: "users.id", onDelete: "cascade" },
    ]);
  });

  it("empties the mention instead, where the record outlives whom it mentions", () => {
    expect(referencesDeleting("set null")).toEqual([
      { from: "audit_log.admin_user_id", to: "users.id", onDelete: "set null" },
      { from: "guest_sessions.claimed_by_user_id", to: "users.id", onDelete: "set null" },
      { from: "matches.rematch_of_match_id", to: "matches.id", onDelete: "set null" },
      { from: "rating_adjustments.admin_user_id", to: "users.id", onDelete: "set null" },
      { from: "releases.published_by", to: "users.id", onDelete: "set null" },
      { from: "user_achievements.source_match_id", to: "matches.id", onDelete: "set null" },
    ]);
  });

  it("leaves no reference to the database's default rule", () => {
    const undecided = TABLES_WITH_REFERENCES.flatMap(referencesOf).filter(
      (reference) => reference.onDelete === undefined,
    );

    expect(undecided).toEqual([]);
  });
});
