import { describe, expect, it } from "vitest";
import {
  accountSchema,
  authResponseSchema,
  checkUsernameRequestSchema,
  checkUsernameResponseSchema,
  claimGuestRequestSchema,
  claimGuestResponseSchema,
  meResponseSchema,
  profileSettingsSchema,
  publicProfileSchema,
  registerRequestSchema,
  signInRequestSchema,
  updateProfileRequestSchema,
  verifyEmailRequestSchema,
  type Account,
  type MeResponse,
  type ProfileSettings,
} from "../src/index";
import { LIGHT_ACTOR_ID } from "./helpers/fixtures";

const account: Account = {
  userId: LIGHT_ACTOR_ID,
  username: "ada",
  email: "ada@example.com",
  emailVerified: false,
  status: "active",
  createdAt: "2026-07-25T10:00:00.000Z",
};

const profile: ProfileSettings = {
  avatarUrl: null,
  countryCode: null,
  presetMessagesMuted: false,
  reactionsMuted: false,
  gameSoundMuted: false,
  reducedMotion: false,
};

const me: MeResponse = {
  account,
  profile,
  casual: { wins: 3, losses: 1, draws: 0, played: 4 },
  ranked: null,
};

describe("accountSchema", () => {
  it("round trips the private account view", () => {
    expect(accountSchema.parse(account)).toEqual(account);
  });

  it("rejects an unknown field, so a leak cannot be added by accident", () => {
    expect(accountSchema.safeParse({ ...account, passwordHash: "x" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(accountSchema.safeParse({ ...account, status: "banned" }).success).toBe(false);
  });
});

describe("registerRequestSchema", () => {
  it("normalises the email and username it accepts", () => {
    expect(
      registerRequestSchema.parse({
        email: " Ada@Example.com ",
        password: "correct-horse-7",
        username: " Ada ",
      }),
    ).toEqual({ email: "ada@example.com", password: "correct-horse-7", username: "Ada" });
  });

  it("accepts an optional display name for the first session", () => {
    const parsed = registerRequestSchema.parse({
      email: "ada@example.com",
      password: "correct-horse-7",
      username: "ada",
      displayName: "  Ada  ",
    });

    expect(parsed.displayName).toBe("Ada");
  });

  it("rejects a weak password and a reserved username", () => {
    expect(
      registerRequestSchema.safeParse({
        email: "ada@example.com",
        password: "password",
        username: "ada",
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        email: "ada@example.com",
        password: "correct-horse-7",
        username: "admin",
      }).success,
    ).toBe(false);
  });
});

describe("signInRequestSchema", () => {
  it("requires both fields and rejects extras", () => {
    expect(signInRequestSchema.safeParse({ email: "ada@example.com" }).success).toBe(false);
    expect(
      signInRequestSchema.safeParse({
        email: "ada@example.com",
        password: "correct-horse-7",
        remember: true,
      }).success,
    ).toBe(false);
  });
});

describe("authResponseSchema", () => {
  it("carries the account and the one-time session token", () => {
    const response = {
      account,
      session: { sessionToken: "opaque-value", expiresAt: "2026-08-24T10:00:00.000Z" },
    };

    expect(authResponseSchema.parse(response)).toEqual(response);
  });

  it("may carry a verification handoff outside production", () => {
    const response = {
      account,
      session: { sessionToken: "opaque-value", expiresAt: "2026-08-24T10:00:00.000Z" },
      emailVerification: { token: "opaque-value", expiresAt: "2026-07-26T10:00:00.000Z" },
    };

    expect(authResponseSchema.parse(response)).toEqual(response);
  });
});

describe("verifyEmailRequestSchema", () => {
  it("requires a token", () => {
    expect(verifyEmailRequestSchema.safeParse({ token: "" }).success).toBe(false);
    expect(verifyEmailRequestSchema.parse({ token: "opaque-value" })).toEqual({
      token: "opaque-value",
    });
  });
});

describe("meResponseSchema", () => {
  it("round trips the account, its settings and its casual record", () => {
    expect(meResponseSchema.parse(me)).toEqual(me);
  });

  it("rejects a negative counter", () => {
    expect(
      meResponseSchema.safeParse({ ...me, casual: { wins: -1, losses: 0, draws: 0, played: 0 } })
        .success,
    ).toBe(false);
  });
});

describe("profileSettingsSchema", () => {
  it("requires every preference to be present in a response", () => {
    expect(profileSettingsSchema.safeParse({ avatarUrl: null, countryCode: null }).success).toBe(
      false,
    );
  });
});

describe("updateProfileRequestSchema", () => {
  it("accepts a single field", () => {
    expect(updateProfileRequestSchema.parse({ reducedMotion: true })).toEqual({
      reducedMotion: true,
    });
  });

  it("normalises what it accepts", () => {
    expect(
      updateProfileRequestSchema.parse({
        avatarUrl: " https://cdn.example.com/a.png ",
        countryCode: " gb ",
      }),
    ).toEqual({ avatarUrl: "https://cdn.example.com/a.png", countryCode: "GB" });
  });

  it("treats null as clearing an optional value", () => {
    expect(updateProfileRequestSchema.parse({ avatarUrl: null, countryCode: null })).toEqual({
      avatarUrl: null,
      countryCode: null,
    });
  });

  it("rejects an empty patch, which would be a silent no-op", () => {
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a username change, because usernames are immutable", () => {
    expect(updateProfileRequestSchema.safeParse({ username: "ada2" }).success).toBe(false);
  });
});

describe("publicProfileSchema", () => {
  it("shows month and year of creation, never the exact date", () => {
    const publicProfile = {
      username: "ada",
      avatarUrl: null,
      countryCode: "GB",
      memberSince: "2026-07",
      casual: { wins: 3, losses: 1, draws: 0, played: 4 },
      ranked: {
        rating: 1216,
        wins: 1,
        losses: 0,
        draws: 0,
        played: 1,
        currentStreak: 1,
        bestStreak: 1,
      },
      rank: 7,
      badges: [
        {
          code: "first-victory",
          name: "First Victory",
          badge: "bronze",
          earnedAt: "2026-07-25T10:07:00.000Z",
        },
      ],
      recentMatches: [],
    };

    expect(publicProfileSchema.parse(publicProfile)).toEqual(publicProfile);
    expect(publicProfileSchema.parse({ ...publicProfile, rank: null }).rank).toBeNull();
    expect(publicProfileSchema.safeParse({ ...publicProfile, rank: 0 }).success).toBe(false);
    expect(
      publicProfileSchema.safeParse({
        ...publicProfile,
        badges: [{ code: "first-victory", name: "First Victory", badge: "bronze", earnedAt: null }],
      }).success,
    ).toBe(false);
    expect(
      publicProfileSchema.safeParse({ ...publicProfile, memberSince: "2026-07-25" }).success,
    ).toBe(false);
    expect(
      publicProfileSchema.safeParse({ ...publicProfile, memberSince: "2026-13" }).success,
    ).toBe(false);
  });

  it("has no field for an email or an identity provider", () => {
    expect(
      publicProfileSchema.safeParse({
        username: "ada",
        avatarUrl: null,
        countryCode: null,
        memberSince: "2026-07",
        casual: { wins: 0, losses: 0, draws: 0, played: 0 },
        ranked: null,
        rank: null,
        badges: [],
        recentMatches: [],
        email: "ada@example.com",
      }).success,
    ).toBe(false);
  });
});

describe("username availability", () => {
  it("accepts a raw candidate, because an unusable name is an answer not an error", () => {
    expect(checkUsernameRequestSchema.parse({ username: "admin" })).toEqual({ username: "admin" });
    expect(checkUsernameRequestSchema.safeParse({ username: "ada-lovelace" }).success).toBe(true);
    expect(checkUsernameRequestSchema.safeParse({ username: "" }).success).toBe(false);
  });

  it("answers with a reason when the name cannot be used", () => {
    expect(
      checkUsernameResponseSchema.parse({
        username: "admin",
        available: false,
        reason: "reserved",
      }),
    ).toEqual({ username: "admin", available: false, reason: "reserved" });
    expect(
      checkUsernameResponseSchema.safeParse({
        username: "ada",
        available: false,
        reason: "rude",
      }).success,
    ).toBe(false);
  });

  it("requires the reason to be explicitly null when the name is free", () => {
    expect(
      checkUsernameResponseSchema.safeParse({ username: "ada", available: true }).success,
    ).toBe(false);
  });
});

describe("guest claim", () => {
  it("requires the credentials that create the account", () => {
    const request = {
      email: "ada@example.com",
      password: "correct-horse-7",
      username: "ada",
    };

    expect(claimGuestRequestSchema.parse(request)).toEqual(request);
    expect(claimGuestRequestSchema.safeParse({ ...request, guestId: LIGHT_ACTOR_ID }).success).toBe(
      false,
    );
  });

  it("reports how many matches moved to the account", () => {
    const response = {
      account,
      session: { sessionToken: "opaque-value", expiresAt: "2026-08-24T10:00:00.000Z" },
      claimedMatches: 2,
    };

    expect(claimGuestResponseSchema.parse(response)).toEqual(response);
    expect(claimGuestResponseSchema.safeParse({ ...response, claimedMatches: -1 }).success).toBe(
      false,
    );
  });
});
