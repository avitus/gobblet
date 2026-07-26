import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_BADGE_TIERS,
  ACHIEVEMENT_CATALOGUE,
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_RULE_VERSION,
  achievementByCode,
  achievementProgressSchema,
  achievementSchema,
  achievementsResponseSchema,
  isAchievementCode,
  profileBadgeSchema,
} from "../src/index";
import { MATCH_ID } from "./helpers/fixtures";

describe("the achievement catalogue", () => {
  it("holds exactly the eight achievements of section 11.4, in order", () => {
    expect(ACHIEVEMENT_CATALOGUE.map((entry) => entry.code)).toEqual([...ACHIEVEMENT_CODES]);
    expect(ACHIEVEMENT_CATALOGUE).toHaveLength(8);
  });

  it("describes every entry in the shape the wire and the database share", () => {
    for (const entry of ACHIEVEMENT_CATALOGUE) {
      expect(achievementSchema.parse(entry)).toEqual(entry);
      expect(ACHIEVEMENT_BADGE_TIERS).toContain(entry.badge);
      expect(entry.ruleVersion).toBe(ACHIEVEMENT_RULE_VERSION);
      expect(entry.description.endsWith(".")).toBe(true);
    }
  });

  it("is frozen, so a consumer cannot edit the catalogue it was handed", () => {
    expect(Object.isFrozen(ACHIEVEMENT_CATALOGUE)).toBe(true);
  });

  it("answers a lookup for every code", () => {
    for (const code of ACHIEVEMENT_CODES) {
      expect(achievementByCode(code).code).toBe(code);
    }
    expect(achievementByCode("four-ways").name).toBe("Four Ways");
  });

  it("recognises its own codes and nothing else", () => {
    expect(isAchievementCode("century-club")).toBe(true);
    expect(isAchievementCode("Century Club")).toBe(false);
    expect(isAchievementCode(null)).toBe(false);
  });

  it("rejects a badge that is not a tier, because a badge is not an image", () => {
    expect(
      achievementSchema.safeParse({
        ...achievementByCode("uncovered"),
        badge: "/badges/uncovered.png",
      }).success,
    ).toBe(false);
  });
});

describe("achievement progress", () => {
  it("reports an unearned achievement as a null timestamp rather than an absence", () => {
    const unearned = { ...achievementByCode("contender"), earnedAt: null, matchId: null };
    const earned = {
      ...achievementByCode("contender"),
      earnedAt: "2026-07-25T10:07:00.000Z",
      matchId: MATCH_ID,
    };

    expect(achievementProgressSchema.parse(unearned)).toEqual(unearned);
    expect(achievementProgressSchema.parse(earned)).toEqual(earned);
    expect(
      achievementsResponseSchema.parse({ achievements: [unearned, earned] }).achievements,
    ).toHaveLength(2);
  });

  it("rejects progress that omits the earned state or adds a field", () => {
    expect(achievementProgressSchema.safeParse(achievementByCode("on-a-roll")).success).toBe(false);
    expect(achievementsResponseSchema.safeParse({ achievements: [], earnedCount: 0 }).success).toBe(
      false,
    );
  });
});

describe("profileBadgeSchema", () => {
  it("shows earned badges only, so an unearned achievement cannot appear", () => {
    const badge = {
      code: "time-keeper",
      name: "Time Keeper",
      badge: "silver",
      earnedAt: "2026-07-25T10:07:00.000Z",
    };

    expect(profileBadgeSchema.parse(badge)).toEqual(badge);
    expect(profileBadgeSchema.safeParse({ ...badge, earnedAt: null }).success).toBe(false);
    expect(profileBadgeSchema.safeParse({ ...badge, description: "x" }).success).toBe(false);
  });
});
