/**
 * The "no secrets detected" gate of spec section 21.1, as a scanner we own so the
 * allowlist can carry a reason per entry (appendix P9.11). Nothing here talks to a
 * service: it reads the files it is given, which is what makes it testable and what
 * lets the same code run in a pull request and in the release gate.
 */

export type SecretRule = Readonly<{
  id: string;
  /** What a match means, in one line, for the report. */
  describes: string;
  pattern: RegExp;
  /** Extra confirmation, used by the entropy rule to keep the noise out. */
  confirm?: (candidate: string) => boolean;
}>;

export type ScanTarget = Readonly<{ path: string; contents: string }>;

export type Finding = Readonly<{
  path: string;
  line: number;
  rule: string;
  describes: string;
  /** The match with its middle removed, so a report never prints a credential. */
  excerpt: string;
}>;

export type AllowEntry = Readonly<{ path: string; rule: string; reason: string }>;

/** Shannon entropy per character, which is what separates a digest from a sentence. */
export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let total = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    total -= probability * Math.log2(probability);
  }
  return total;
}

export const SECRET_RULES: readonly SecretRule[] = Object.freeze([
  {
    id: "private-key-block",
    describes: "A PEM private key block",
    pattern: /-{5}BEGIN (?:[A-Z]+ )?PRIVATE KEY-{5}/g,
  },
  {
    id: "minisign-secret-key",
    describes: "A minisign secret key, which signs desktop updates",
    pattern: /untrusted comment: minisign encrypted secret key/gi,
  },
  {
    id: "aws-access-key",
    describes: "An AWS access key identifier",
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    id: "github-token",
    describes: "A GitHub personal access or installation token",
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  {
    id: "slack-token",
    describes: "A Slack token",
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: "connection-string-password",
    describes: "A database URL carrying a password",
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s:/@]+:[^\s:/@]+@/g,
  },
  {
    id: "sentry-dsn",
    describes: "A Sentry DSN, which embeds a project key",
    pattern: /https:\/\/[0-9a-f]{16,}@[A-Za-z0-9.-]+\/[0-9]+/g,
  },
  {
    id: "assigned-credential",
    describes: "A credential assigned to a name that says what it is",
    pattern:
      /(?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9+/=_-]{16,})["']/gi,
    confirm: (candidate) => /\d/.test(candidate) && entropy(candidate) >= 4.0,
  },
  {
    // Quoted, because an unquoted run of that length in this repository is a path or
    // a hyphenated file name, and a scanner that cries wolf is one nobody runs.
    id: "high-entropy-literal",
    describes: "A long random-looking literal",
    pattern: /["'`]([A-Za-z0-9+=_-]{40,})["'`]/g,
    confirm: (candidate) => entropy(candidate) >= 4.2,
  },
]);

/**
 * Every entry is a decision somebody made once, with the reason next to it. A file
 * is exempt from one rule, never from the scanner.
 */
export const SECRET_ALLOWLIST: readonly AllowEntry[] = Object.freeze([
  {
    path: "apps/desktop/src-tauri/tauri.conf.json",
    rule: "high-entropy-literal",
    reason:
      "The Tauri update verification key. It is the public half: the application needs it compiled in to verify a signature, and publishing it is the point. The private half lives in a secret.",
  },
  {
    path: "pnpm-lock.yaml",
    rule: "high-entropy-literal",
    reason: "Integrity digests of published packages.",
  },
  {
    path: "apps/desktop/src-tauri/Cargo.lock",
    rule: "high-entropy-literal",
    reason: "Checksums of published crates.",
  },
  {
    path: "apps/server/test/secret-scan.test.ts",
    rule: "*",
    reason: "The fixtures this scanner is tested against.",
  },
  {
    path: "apps/server/src/ops/secret-scan.ts",
    rule: "minisign-secret-key",
    reason:
      "The rule that recognises a minisign key, which has to contain the header it looks for. No key is here, only the shape of one.",
  },
  {
    path: "packages/protocol/test/release.test.ts",
    rule: "high-entropy-literal",
    reason: "A sample update signature, which is a public artifact of a signed build.",
  },
  {
    path: "apps/server/test/updates-api.test.ts",
    rule: "high-entropy-literal",
    reason: "A sample update signature, which is a public artifact of a signed build.",
  },
]);

function masked(match: string): string {
  return match.length <= 12
    ? `${match.slice(0, 3)}...`
    : `${match.slice(0, 6)}...${match.slice(-4)}`;
}

function allows(allowlist: readonly AllowEntry[], path: string, rule: string): boolean {
  return allowlist.some(
    (entry) => entry.path === path && (entry.rule === rule || entry.rule === "*"),
  );
}

export function scanForSecrets(
  targets: readonly ScanTarget[],
  allowlist: readonly AllowEntry[] = SECRET_ALLOWLIST,
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const target of targets) {
    const lines = target.contents.split("\n");
    for (const rule of SECRET_RULES) {
      if (allows(allowlist, target.path, rule.id)) {
        continue;
      }
      lines.forEach((line, index) => {
        for (const match of line.matchAll(rule.pattern)) {
          // A rule with a capture group means the credential, not the assignment.
          const candidate = match[1] ?? match[0];
          if (rule.confirm !== undefined && !rule.confirm(candidate)) {
            continue;
          }
          findings.push({
            path: target.path,
            line: index + 1,
            rule: rule.id,
            describes: rule.describes,
            excerpt: masked(candidate),
          });
        }
      });
    }
  }

  return findings;
}

export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return "No secrets detected in the tracked files.";
  }
  return [
    `${String(findings.length)} possible secrets in tracked files:`,
    ...findings.map(
      (finding) =>
        `  ${finding.path}:${String(finding.line)} ${finding.rule}: ${finding.describes} (${finding.excerpt})`,
    ),
    "Move the value into a secret, or add an allowlist entry with a reason in src/ops/secret-scan.ts.",
  ].join("\n");
}
