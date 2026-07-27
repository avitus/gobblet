import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECRET_ALLOWLIST,
  SECRET_RULES,
  entropy,
  formatFindings,
  scanForSecrets,
} from "../src/ops/secret-scan";
import type { ScanTarget } from "../src/ops/secret-scan";

/**
 * The scanner is only worth running if it catches what it claims to catch and stays
 * quiet on the things this repository is full of: file paths, hyphenated names and
 * digests of published packages (appendix P9.11). Both halves are asserted here.
 *
 * The fixtures below are invented. secret-scan.ts allowlists this file for that
 * reason, which is also the demonstration that an allowlist entry works.
 */

function file(contents: string, path = "src/example.ts"): readonly ScanTarget[] {
  return [{ path, contents }];
}

describe("entropy", () => {
  it("is zero for a single repeated character", () => {
    expect(entropy("aaaaaaaa")).toBe(0);
  });

  it("is one bit for a fair choice between two characters", () => {
    expect(entropy("abab")).toBe(1);
  });

  it("rises with variety", () => {
    expect(entropy("Xk7Qm2Zp9Lw4Rt6Yb1Nc")).toBeGreaterThan(entropy("aaaabbbbccccddddeeee"));
  });
});

describe("what the scanner catches", () => {
  it("catches a PEM private key block", () => {
    const findings = scanForSecrets(file("-----BEGIN RSA PRIVATE KEY-----"));

    expect(findings.map((finding) => finding.rule)).toEqual(["private-key-block"]);
  });

  it("catches a minisign secret key, which would sign desktop updates", () => {
    const findings = scanForSecrets(file("untrusted comment: minisign encrypted secret key"));

    expect(findings[0]?.rule).toBe("minisign-secret-key");
    expect(findings[0]?.describes).toContain("desktop updates");
  });

  it("catches an AWS access key identifier", () => {
    const findings = scanForSecrets(file('const id = "AKIA' + 'IOSFODNN7EXAMPLE";'));

    expect(findings[0]?.rule).toBe("aws-access-key");
  });

  it("catches a GitHub token", () => {
    const findings = scanForSecrets(file("ghp_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8"));

    expect(findings[0]?.rule).toBe("github-token");
  });

  it("catches a Slack token", () => {
    const findings = scanForSecrets(file("xoxb-" + "9876543210-abcdefghij"));

    expect(findings[0]?.rule).toBe("slack-token");
  });

  it("catches a database URL that carries a password", () => {
    const findings = scanForSecrets(file("postgres://gobblet:hunter2@db.example.com:5432/app"));

    expect(findings[0]?.rule).toBe("connection-string-password");
  });

  it("catches a Sentry DSN", () => {
    const findings = scanForSecrets(file("https://0123456789abcdef0123@o1.ingest.example.com/42"));

    expect(findings[0]?.rule).toBe("sentry-dsn");
  });

  it("catches a credential assigned to a name that says what it is", () => {
    const findings = scanForSecrets(file('const apiKey = "Qw8vB2nR7xL4pT6yH1sK";'));

    expect(findings[0]?.rule).toBe("assigned-credential");
  });

  it("catches a long random-looking literal", () => {
    const findings = scanForSecrets(
      file('const value = "Xk7Qm2Zp9Lw4Rt6Yb1NcVd3Fg5Hj8Km0Pq2Sw4Tz";'),
    );

    expect(findings[0]?.rule).toBe("high-entropy-literal");
  });

  it("reports the line, and never the value", () => {
    const contents = ["first", "second", '  key = "-----BEGIN PRIVATE KEY-----"'].join("\n");
    const findings = scanForSecrets(file(contents));

    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.excerpt).toBe("-----B...----");
  });

  it("shortens a small match to its first characters", () => {
    const findings = scanForSecrets(file("redis://a:b@cache"));

    expect(findings[0]?.rule).toBe("connection-string-password");
    expect(findings[0]?.excerpt).toBe("red...");
  });
});

describe("what the scanner leaves alone", () => {
  const quiet = (contents: string): number => scanForSecrets(file(contents)).length;

  it("leaves a long file path alone", () => {
    expect(quiet("See docs/adr/0036-signing-is-a-workflow-step-that-fails-loudly.md")).toBe(0);
  });

  it("leaves a quoted route alone", () => {
    expect(
      quiet('await inject("/v1/admin/releases/01234567-89ab-cdef-0123-456789abcdef/promote")'),
    ).toBe(0);
  });

  it("leaves a hyphenated test password alone, because it is words", () => {
    expect(quiet('password: "correct-horse-battery-9"')).toBe(0);
  });

  it("leaves a digest of one repeated character alone", () => {
    expect(quiet(`const sha256 = "${"a".repeat(64)}";`)).toBe(0);
  });

  it("leaves an environment variable name alone", () => {
    expect(quiet("GOBBLET_TELEMETRY_PSEUDONYM_SECRET is read from the environment")).toBe(0);
  });
});

describe("the allowlist", () => {
  const secret = 'const key = "Xk7Qm2Zp9Lw4Rt6Yb1NcVd3Fg5Hj8Km0Pq2Sw4Tz";';

  it("exempts a file from the rule it names", () => {
    const findings = scanForSecrets(file(secret, "config.json"), [
      { path: "config.json", rule: "high-entropy-literal", reason: "A public verification key." },
    ]);

    expect(findings).toEqual([]);
  });

  it("does not exempt the same file from another rule", () => {
    const findings = scanForSecrets(file("-----BEGIN PRIVATE KEY-----", "config.json"), [
      { path: "config.json", rule: "high-entropy-literal", reason: "A public verification key." },
    ]);

    expect(findings[0]?.rule).toBe("private-key-block");
  });

  it("exempts every rule when the entry says so", () => {
    const findings = scanForSecrets(file("-----BEGIN PRIVATE KEY-----", "test/fixtures.ts"), [
      { path: "test/fixtures.ts", rule: "*", reason: "Fixtures." },
    ]);

    expect(findings).toEqual([]);
  });

  it("does not exempt a different file", () => {
    const findings = scanForSecrets(file(secret, "other.json"), [
      { path: "config.json", rule: "high-entropy-literal", reason: "A public verification key." },
    ]);

    expect(findings).toHaveLength(1);
  });

  it("gives a reason for every entry, because an unexplained exemption is a hole", () => {
    for (const entry of SECRET_ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.rule === "*" || SECRET_RULES.some((rule) => rule.id === entry.rule)).toBe(true);
    }
  });

  it("keeps the desktop update verification key, and says why it is public", () => {
    const entry = SECRET_ALLOWLIST.find(
      (candidate) => candidate.path === "apps/desktop/src-tauri/tauri.conf.json",
    );

    expect(entry?.reason).toContain("public");
  });
});

describe("the report", () => {
  it("says nothing was found", () => {
    expect(formatFindings([])).toBe("No secrets detected in the tracked files.");
  });

  it("lists each finding and says what to do about it", () => {
    const report = formatFindings(scanForSecrets(file("-----BEGIN PRIVATE KEY-----")));

    expect(report).toContain("1 possible secrets in tracked files:");
    expect(report).toContain("src/example.ts:1 private-key-block");
    expect(report).toContain("add an allowlist entry with a reason");
  });
});

describe("the rules themselves", () => {
  it("do not trip the scanner, so the command it backs can be run", () => {
    const path = "apps/server/src/ops/secret-scan.ts";
    const contents = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../src/ops/secret-scan.ts"),
      "utf8",
    );

    expect(scanForSecrets([{ path, contents }])).toEqual([]);
  });

  it("gives every rule a global pattern, so a second match on a line is not missed", () => {
    for (const rule of SECRET_RULES) {
      expect(rule.pattern.global).toBe(true);
    }
  });

  it("finds both credentials on one line", () => {
    const findings = scanForSecrets(
      file("AKIA" + "IOSFODNN7EXAMPLE and AKIA" + "JKLMNOPQRSTUVWXY"),
    );

    expect(findings).toHaveLength(2);
  });
});
