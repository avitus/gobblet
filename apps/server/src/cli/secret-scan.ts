import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { formatFindings, scanForSecrets } from "../ops/secret-scan";
import type { ScanTarget } from "../ops/secret-scan";

/**
 * `pnpm ops:secrets`, the "no secrets detected" gate of spec section 21.1. It scans
 * what git tracks, because an untracked file cannot leak through a push, and skips
 * anything that is not text.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const MAXIMUM_BYTES = 2_000_000;

const run = promisify(execFile);
const { stdout } = await run("git", ["ls-files", "-z"], {
  cwd: REPOSITORY_ROOT,
  maxBuffer: 64 * 1024 * 1024,
});

const paths = stdout.split("\0").filter((entry) => entry !== "");
const targets: ScanTarget[] = [];

for (const relative of paths) {
  const contents = await readFile(path.join(REPOSITORY_ROOT, relative)).catch(() => null);
  if (contents === null || contents.byteLength > MAXIMUM_BYTES || contents.includes(0)) {
    continue;
  }
  targets.push({ path: relative, contents: contents.toString("utf8") });
}

const findings = scanForSecrets(targets);
console.warn(`Scanned ${String(targets.length)} tracked text files.`);
console.warn(formatFindings(findings));
process.exit(findings.length === 0 ? 0 : 1);
