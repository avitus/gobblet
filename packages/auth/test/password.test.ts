import { describe, expect, it } from "vitest";
import { DEFAULT_SCRYPT_COST, hashPassword, needsRehash, verifyPassword } from "../src/index";

/** A cheap cost keeps the suite fast; the parameters are what is under test, not the CPU burn. */
const testCost = { N: 1_024, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;

describe("hashPassword", () => {
  it("produces a self-describing hash with its parameters", async () => {
    const stored = await hashPassword("correct-horse-7", testCost);

    const [algorithm, n, r, p, salt, hash] = stored.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(n)).toBe(testCost.N);
    expect(Number(r)).toBe(testCost.r);
    expect(Number(p)).toBe(testCost.p);
    expect(Buffer.from(salt ?? "", "base64url")).toHaveLength(testCost.saltLength);
    expect(Buffer.from(hash ?? "", "base64url")).toHaveLength(testCost.keyLength);
  });

  it("salts every hash, so the same password stores differently", async () => {
    const first = await hashPassword("correct-horse-7", testCost);
    const second = await hashPassword("correct-horse-7", testCost);

    expect(first).not.toBe(second);
    expect(await verifyPassword("correct-horse-7", first)).toBe(true);
    expect(await verifyPassword("correct-horse-7", second)).toBe(true);
  });

  it("defaults to a cost that is expensive on purpose", () => {
    expect(DEFAULT_SCRYPT_COST.N).toBe(32_768);
    expect(DEFAULT_SCRYPT_COST.keyLength).toBe(64);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct-horse-7", testCost);

    expect(await verifyPassword("correct-horse-7", stored)).toBe(true);
    expect(await verifyPassword("correct-horse-8", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("treats visually identical unicode as the same password", async () => {
    // "é" as one code point, then as "e" plus a combining accent.
    const stored = await hashPassword("caf\u00e9-password-1", testCost);

    expect(await verifyPassword("cafe\u0301-password-1", stored)).toBe(true);
  });

  it("verifies a hash stored with a different cost", async () => {
    const stored = await hashPassword("correct-horse-7", {
      N: 2_048,
      r: 8,
      p: 1,
      keyLength: 64,
      saltLength: 32,
    });

    expect(await verifyPassword("correct-horse-7", stored)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["a value with too few fields", "scrypt$1024$8$1$abc"],
    ["an unknown algorithm", "bcrypt$1024$8$1$abc$def"],
    ["a non-numeric cost", "scrypt$many$8$1$abc$def"],
    ["a nonsensical cost", "scrypt$1$8$1$abc$def"],
    ["a cost that is not a power of two", "scrypt$1000$8$1$abc$def"],
    ["a cost beyond the supported ceiling", "scrypt$1073741824$8$1$abc$def"],
    ["a zero parallelism", "scrypt$1024$8$0$abc$def"],
    ["an absurd parallelism", "scrypt$1024$8$99$abc$def"],
    ["a zero block size", "scrypt$1024$0$1$abc$def"],
    ["an absurd block size", "scrypt$1024$99$1$abc$def"],
    ["an empty salt", "scrypt$1024$8$1$$def"],
    ["an empty hash", "scrypt$1024$8$1$abc$"],
    ["a short salt", "scrypt$1024$8$1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw"],
  ])("returns false for %s instead of throwing", async (_name, stored) => {
    expect(await verifyPassword("correct-horse-7", stored)).toBe(false);
  });

  it("surfaces a cost the platform refuses instead of reporting a failed password", async () => {
    await expect(hashPassword("correct-horse-7", { ...testCost, N: 3 })).rejects.toThrow();
  });

  it("rejects a truncated hash, which scrypt would otherwise accept as a prefix", async () => {
    const stored = await hashPassword("correct-horse-7", testCost);
    const truncated = stored.slice(0, -4);

    expect(await verifyPassword("correct-horse-7", truncated)).toBe(false);
  });
});

describe("needsRehash", () => {
  it("is true for a hash below the current cost", async () => {
    expect(needsRehash(await hashPassword("correct-horse-7", testCost))).toBe(true);
  });

  it("is false for a hash at the current cost", async () => {
    const stored = await hashPassword("correct-horse-7", { ...testCost, keyLength: 64 });

    expect(needsRehash(stored, testCost)).toBe(false);
  });

  it("is true for each parameter that regressed", () => {
    const cost = { N: 1_024, r: 8, p: 2, keyLength: 48, saltLength: 16 } as const;
    expect(
      needsRehash("scrypt$512$8$2$c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw", cost),
    ).toBe(true);
    expect(
      needsRehash("scrypt$1024$4$2$c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw", cost),
    ).toBe(true);
    expect(
      needsRehash("scrypt$1024$8$1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw", cost),
    ).toBe(true);
    expect(
      needsRehash(
        "scrypt$1024$8$2$MTIzNDU2Nzg5MDEy$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw",
        cost,
      ),
    ).toBe(true);
  });

  it("is true for a value it cannot parse, so a corrupt row is replaced", () => {
    expect(needsRehash("not-a-hash")).toBe(true);
  });
});
