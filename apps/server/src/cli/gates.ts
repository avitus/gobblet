import { spawn } from "node:child_process";
import path from "node:path";
import { formatGateReport, runGates } from "../ops/gates";

/**
 * `pnpm gates [pull-request|release-candidate]`, the aggregate run of spec section
 * 21. Continuous integration runs its own steps; this is what a release candidate is
 * measured with (docs/adr/0038-quality-gates-are-a-definition-not-a-checklist.md).
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

const requested = process.argv[2];
if (requested !== undefined && requested !== "pull-request" && requested !== "release-candidate") {
  console.error("Usage: gates [pull-request|release-candidate]");
  process.exit(2);
}

const report = await runGates({
  now: () => Date.now(),
  ...(requested === undefined ? {} : { set: requested }),
  run: (command) =>
    new Promise((resolve) => {
      const [executable, ...args] = command;
      console.warn(`\n> ${command.join(" ")}`);
      const child = spawn(executable as string, args, {
        cwd: REPOSITORY_ROOT,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", (error) => {
        resolve({ ok: false, detail: error.message });
      });
      child.on("close", (code) => {
        resolve({
          ok: code === 0,
          detail: code === 0 ? "" : `exited ${String(code)}`,
        });
      });
    }),
});

console.warn(`\n${formatGateReport(report)}`);
process.exit(report.ok ? 0 : 1);
