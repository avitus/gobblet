import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  canonicalUsername,
  checkEmail,
  checkUsername,
  normalizeEmail,
  normalizeUsername,
} from "../src/index";

describe("normalizeEmail", () => {
  it("trims and lowercases, so capitalisation cannot create a second account", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
  });

  it("keeps plus addressing, which is a legitimate mailbox", () => {
    expect(normalizeEmail("ada+gobblet@example.com")).toBe("ada+gobblet@example.com");
  });
});

describe("checkEmail", () => {
  it("accepts an ordinary address", () => {
    expect(checkEmail("ada@example.com")).toBeNull();
    expect(checkEmail("ada@mail.example.co.uk")).toBeNull();
  });

  it("rejects an empty address", () => {
    expect(checkEmail("   ")).toBe("empty");
  });

  it("rejects an address longer than the standard allows", () => {
    expect(checkEmail(`${"a".repeat(EMAIL_MAX_LENGTH)}@example.com`)).toBe("too-long");
  });

  it.each([
    ["no at sign", "ada.example.com"],
    ["two at signs", "ada@@example.com"],
    ["no domain dot", "ada@example"],
    ["a space", "ada lovelace@example.com"],
    ["no local part", "@example.com"],
    ["an empty domain label", "ada@example..com"],
  ])("rejects %s", (_name, value) => {
    expect(checkEmail(value)).toBe("malformed");
  });
});

describe("normalizeUsername", () => {
  it("lowercases, so uniqueness is case insensitive", () => {
    expect(normalizeUsername(" AdaLovelace ")).toBe("adalovelace");
  });
});

describe("canonicalUsername", () => {
  it("keeps the capitalisation the player chose", () => {
    expect(canonicalUsername("  AdaLovelace ")).toBe("AdaLovelace");
  });
});

describe("checkUsername", () => {
  it("accepts letters, digits and underscores after a leading letter", () => {
    expect(checkUsername("ada")).toBeNull();
    expect(checkUsername("Ada_Lovelace_1815")).toBeNull();
    expect(checkUsername("a".repeat(USERNAME_MAX_LENGTH))).toBeNull();
  });

  it("rejects an empty username", () => {
    expect(checkUsername("   ")).toBe("empty");
  });

  it("rejects a username that is too short or too long", () => {
    expect(checkUsername("ad")).toBe("too-short");
    expect(checkUsername("a".repeat(USERNAME_MAX_LENGTH + 1))).toBe("too-long");
  });

  it.each([
    ["a space", "ada lovelace"],
    ["a hyphen", "ada-lovelace"],
    ["an at sign", "ada@home"],
    ["a non-ascii letter", "adá"],
    ["a cyrillic lookalike", "\u0430da"],
    ["an emoji", "ada\u{1F600}"],
  ])("rejects %s", (_name, value) => {
    expect(checkUsername(value)).toBe("invalid-characters");
  });

  it("rejects a username that does not start with a letter", () => {
    expect(checkUsername("1815ada")).toBe("must-start-with-letter");
    expect(checkUsername("_ada")).toBe("must-start-with-letter");
  });

  it("rejects a reserved name whatever its capitalisation", () => {
    expect(checkUsername("admin")).toBe("reserved");
    expect(checkUsername("Support")).toBe("reserved");
    expect(RESERVED_USERNAMES).toContain("moderator");
  });
});
