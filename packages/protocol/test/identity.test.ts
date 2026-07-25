import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  avatarUrlSchema,
  countryCodeSchema,
  emailSchema,
  isReservedUsername,
  isUserStatus,
  normalizeEmail,
  normalizeUsername,
  passwordSchema,
  usernameSchema,
} from "../src/index";

describe("normalizeEmail", () => {
  it("trims and lowercases, so capitalisation cannot create a second account", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
  });

  it("keeps plus addressing, which is a legitimate mailbox", () => {
    expect(normalizeEmail("ada+gobblet@example.com")).toBe("ada+gobblet@example.com");
  });
});

describe("emailSchema", () => {
  it("accepts and normalises an ordinary address", () => {
    expect(emailSchema.parse(" Ada@Example.com ")).toBe("ada@example.com");
    expect(emailSchema.parse("ada@mail.example.co.uk")).toBe("ada@mail.example.co.uk");
  });

  it("rejects an address longer than the standard allows", () => {
    expect(emailSchema.safeParse(`${"a".repeat(EMAIL_MAX_LENGTH)}@example.com`).success).toBe(
      false,
    );
  });

  it.each([
    ["an empty value", "   "],
    ["no at sign", "ada.example.com"],
    ["two at signs", "ada@@example.com"],
    ["no domain dot", "ada@example"],
    ["a space", "ada lovelace@example.com"],
    ["no local part", "@example.com"],
    ["an empty domain label", "ada@example..com"],
  ])("rejects %s", (_name, value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts a long passphrase with a letter and a number or symbol", () => {
    expect(passwordSchema.parse("correct-horse-7")).toBe("correct-horse-7");
    expect(passwordSchema.safeParse("correct horse!").success).toBe(true);
  });

  it("keeps the value exactly as typed, including inner whitespace", () => {
    expect(passwordSchema.parse("  spaces  are  fine  1")).toBe("  spaces  are  fine  1");
  });

  it.each([
    ["a short password", "short1!"],
    ["a password past the ceiling", "a1".repeat(PASSWORD_MAX_LENGTH)],
    ["digits with no letter", "1234567890"],
    ["letters with nothing else", "abcdefghijk"],
    ["whitespace only", "              "],
  ])("rejects %s", (_name, value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe("usernameSchema", () => {
  it("accepts letters, digits and underscores after a leading letter", () => {
    expect(usernameSchema.parse("ada")).toBe("ada");
    expect(usernameSchema.parse("  Ada_Lovelace_1815 ")).toBe("Ada_Lovelace_1815");
    expect(usernameSchema.safeParse("a".repeat(USERNAME_MAX_LENGTH)).success).toBe(true);
  });

  it.each([
    ["an empty value", "   "],
    ["a name that is too short", "ad"],
    ["a name that is too long", "a".repeat(USERNAME_MAX_LENGTH + 1)],
    ["a space", "ada lovelace"],
    ["a hyphen", "ada-lovelace"],
    ["a non-ascii letter", "ad\u00e1"],
    ["a cyrillic lookalike", "\u0430da"],
    ["an emoji", "ada\u{1F600}"],
    ["a leading digit", "1815ada"],
    ["a leading underscore", "_ada"],
  ])("rejects %s", (_name, value) => {
    expect(usernameSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a reserved name whatever its capitalisation", () => {
    expect(usernameSchema.safeParse("admin").success).toBe(false);
    expect(usernameSchema.safeParse("Support").success).toBe(false);
    expect(RESERVED_USERNAMES).toContain("moderator");
  });
});

describe("normalizeUsername", () => {
  it("lowercases, so uniqueness is case insensitive", () => {
    expect(normalizeUsername(" AdaLovelace ")).toBe("adalovelace");
  });
});

describe("isReservedUsername", () => {
  it("recognises a reserved name in any capitalisation", () => {
    expect(isReservedUsername(" Admin ")).toBe(true);
    expect(isReservedUsername("ada")).toBe(false);
  });
});

describe("countryCodeSchema", () => {
  it("accepts a two letter code and uppercases it", () => {
    expect(countryCodeSchema.parse(" gb ")).toBe("GB");
  });

  it.each([
    ["one letter", "g"],
    ["three letters", "gbr"],
    ["digits", "12"],
  ])("rejects %s", (_name, value) => {
    expect(countryCodeSchema.safeParse(value).success).toBe(false);
  });
});

describe("avatarUrlSchema", () => {
  it("accepts an https url", () => {
    expect(avatarUrlSchema.parse(" https://cdn.example.com/a.png ")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it.each([
    ["plaintext http", "http://cdn.example.com/a.png"],
    ["a relative path", "/avatars/a.png"],
    ["a data url", "data:image/png;base64,iVBORw0KGgo="],
    ["an over-long url", `https://cdn.example.com/${"a".repeat(500)}.png`],
  ])("rejects %s", (_name, value) => {
    expect(avatarUrlSchema.safeParse(value).success).toBe(false);
  });
});

describe("isUserStatus", () => {
  it("recognises the account statuses and nothing else", () => {
    expect(isUserStatus("active")).toBe(true);
    expect(isUserStatus("suspended")).toBe(true);
    expect(isUserStatus("deleted")).toBe(true);
    expect(isUserStatus("banned")).toBe(false);
    expect(isUserStatus(7)).toBe(false);
  });
});
