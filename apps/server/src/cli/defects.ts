import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatDefectVerdict, judgeDefects, parseDefectRegister } from "../ops/defects";

/**
 * `pnpm ops:defects`, the release gate for "zero known critical or high-severity
 * defects" (docs/adr/0039-the-defect-register-is-a-gate.md). A register that cannot
 * be parsed fails the gate rather than passing it quietly.
 */

const register = path.resolve(import.meta.dirname, "../../../../docs/defects.md");

try {
  const verdict = judgeDefects(parseDefectRegister(await readFile(register, "utf8")));
  console.warn(formatDefectVerdict(verdict));
  process.exit(verdict.ok ? 0 : 1);
} catch (error) {
  console.error(`The defect register could not be read: ${(error as Error).message}`);
  process.exit(2);
}
