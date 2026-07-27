import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDefectVerdict, judgeDefects, parseDefectRegister } from "../src/ops/defects";
import type { Defect } from "../src/ops/defects";

/**
 * The register is a gate, so the parser has to be unforgiving: every way a row can be
 * wrong is an error here, and the real docs/defects.md is parsed and judged so the
 * release gate is measured against the file that ships (appendix P9.4).
 */

const REGISTER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/defects.md",
);

function row(...columns: readonly string[]): string {
  return `| ${columns.join(" | ")} |`;
}

const HEADER = [
  row("ID", "Severity", "Status", "Area", "Description", "Evidence"),
  row("---", "---", "---", "---", "---", "---"),
].join("\n");

function register(...rows: readonly string[]): string {
  return [HEADER, ...rows].join("\n");
}

const OPEN_MEDIUM = row(
  "D-0001",
  "medium",
  "open",
  "web client",
  "The bundle is larger than the warning threshold",
  "The build log",
);

describe("the defect register parser", () => {
  it("reads a row into a defect", () => {
    const defects = parseDefectRegister(register(OPEN_MEDIUM));

    expect(defects).toEqual<readonly Defect[]>([
      {
        id: "D-0001",
        severity: "medium",
        status: "open",
        area: "web client",
        description: "The bundle is larger than the warning threshold",
        evidence: "The build log",
      },
    ]);
  });

  it("ignores prose and the tables that explain the format", () => {
    const markdown = [
      "# Known defects",
      "",
      "| Severity | Meaning |",
      "| --- | --- |",
      "| `critical` | Data loss |",
      "",
      register(OPEN_MEDIUM),
      "",
      "A closing paragraph.",
    ].join("\n");

    expect(parseDefectRegister(markdown)).toHaveLength(1);
  });

  it("refuses a row with the wrong number of columns", () => {
    expect(() => parseDefectRegister(register(row("D-0002", "low", "open", "area")))).toThrow(
      "D-0002 has 4 columns, expected 6",
    );
  });

  it("refuses the same identifier twice", () => {
    expect(() => parseDefectRegister(register(OPEN_MEDIUM, OPEN_MEDIUM))).toThrow(
      "D-0001 appears twice",
    );
  });

  it("refuses an unknown severity", () => {
    const line = row("D-0003", "urgent", "open", "area", "description", "evidence");

    expect(() => parseDefectRegister(register(line))).toThrow(
      "D-0003 has an unknown severity: urgent",
    );
  });

  it("refuses an unknown status", () => {
    const line = row("D-0004", "low", "wontfix", "area", "description", "evidence");

    expect(() => parseDefectRegister(register(line))).toThrow(
      "D-0004 has an unknown status: wontfix",
    );
  });

  it("refuses a row missing its evidence", () => {
    const line = row("D-0005", "low", "open", "area", "description", "");

    expect(() => parseDefectRegister(register(line))).toThrow(
      "D-0005 is missing its area, description or evidence",
    );
  });

  it("refuses an accepted defect that names nobody", () => {
    const line = row("D-0006", "low", "accepted", "area", "We are living with it", "evidence");

    expect(() => parseDefectRegister(register(line))).toThrow(
      "D-0006 is accepted but does not say who accepted it and why",
    );
  });

  it("takes an acceptance that names a person, however it is phrased", () => {
    const line = row(
      "D-0007",
      "low",
      "accepted",
      "area",
      "Accepted for this release by the maintainer: the workaround is obvious",
      "evidence",
    );

    expect(parseDefectRegister(register(line))[0]?.status).toBe("accepted");
  });

  it("refuses an empty register, because an empty file is a missing file", () => {
    expect(() => parseDefectRegister(HEADER)).toThrow("The defect register has no rows");
  });
});

describe("the release gate over the register", () => {
  const defect = (severity: Defect["severity"], status: Defect["status"]): Defect => ({
    id: `D-000${severity.length.toString()}`,
    severity,
    status,
    area: "area",
    description: "description",
    evidence: "evidence",
  });

  it("passes when nothing open is critical or high", () => {
    const verdict = judgeDefects([defect("medium", "open"), defect("low", "accepted")]);

    expect(verdict.ok).toBe(true);
    expect(verdict.total).toBe(2);
    expect(formatDefectVerdict(verdict)).toContain("The release gate passes");
  });

  it("fails on an open critical defect", () => {
    const verdict = judgeDefects([defect("critical", "open")]);

    expect(verdict.ok).toBe(false);
    expect(formatDefectVerdict(verdict)).toContain("Blocking defects:");
  });

  it("fails on a high-severity defect that was merely accepted", () => {
    const verdict = judgeDefects([defect("high", "accepted")]);

    expect(verdict.ok).toBe(false);
    expect(verdict.blocking.map((entry) => entry.severity)).toEqual(["high"]);
  });

  it("forgives a fixed critical defect", () => {
    const verdict = judgeDefects([defect("critical", "fixed")]);

    expect(verdict.ok).toBe(true);
    expect(verdict.open).toHaveLength(0);
  });
});

describe("the register that ships", () => {
  it("parses, and passes the gate of specification section 21.2", async () => {
    const defects = parseDefectRegister(await readFile(REGISTER, "utf8"));
    const verdict = judgeDefects(defects);

    expect(defects.length).toBeGreaterThan(0);
    expect(verdict.blocking).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("gives every defect an identifier in sequence, so none is quietly dropped", async () => {
    const defects = parseDefectRegister(await readFile(REGISTER, "utf8"));

    expect(defects.map((defect) => defect.id)).toEqual(
      defects.map((_, index) => `D-${String(index + 1).padStart(4, "0")}`),
    );
  });
});
