/**
 * The defect register of docs/defects.md, read by the release gate
 * (docs/adr/0039-the-defect-register-is-a-gate.md). The parser is strict on purpose:
 * a register that silently skips a row it cannot read would let a critical defect
 * hide behind a typo.
 */

export const DEFECT_SEVERITIES = Object.freeze(["critical", "high", "medium", "low"] as const);
export const DEFECT_STATUSES = Object.freeze(["open", "fixed", "accepted"] as const);

export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export type Defect = Readonly<{
  id: string;
  severity: DefectSeverity;
  status: DefectStatus;
  area: string;
  description: string;
  evidence: string;
}>;

const ID_PATTERN = /^D-\d{4}$/;

function cells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

/**
 * Reads every `D-nnnn` row of the register. Rows of the two explanatory tables above
 * it are not defect rows and are ignored by the identifier pattern; anything that
 * looks like a defect row and is not readable is an error.
 */
export function parseDefectRegister(markdown: string): readonly Defect[] {
  const defects: Defect[] = [];
  const seen = new Set<string>();

  for (const line of markdown.split("\n")) {
    if (!isRow(line)) {
      continue;
    }
    // A line that starts and ends with a pipe always has a first cell, and after
    // the length check below it has six; TypeScript cannot see either.
    const columns = cells(line.trim()) as [string, ...string[]];
    const id = columns[0];
    if (!ID_PATTERN.test(id)) {
      continue;
    }
    if (columns.length !== 6) {
      throw new Error(`${id} has ${String(columns.length)} columns, expected 6`);
    }
    if (seen.has(id)) {
      throw new Error(`${id} appears twice`);
    }
    seen.add(id);

    const severity = DEFECT_SEVERITIES.find((candidate) => candidate === columns[1]);
    if (severity === undefined) {
      throw new Error(`${id} has an unknown severity: ${String(columns[1])}`);
    }
    const status = DEFECT_STATUSES.find((candidate) => candidate === columns[2]);
    if (status === undefined) {
      throw new Error(`${id} has an unknown status: ${String(columns[2])}`);
    }
    const [, , , area, description, evidence] = columns as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (area === "" || description === "" || evidence === "") {
      throw new Error(`${id} is missing its area, description or evidence`);
    }
    // An accepted defect without an argument is an unfixed defect with a nicer word.
    if (status === "accepted" && !/accepted\b[^.]*\bby\b/i.test(description)) {
      throw new Error(`${id} is accepted but does not say who accepted it and why`);
    }

    defects.push({ id, severity, status, area, description, evidence });
  }

  if (defects.length === 0) {
    throw new Error("The defect register has no rows. An empty register is a missing file.");
  }
  return defects;
}

export type DefectVerdict = Readonly<{
  ok: boolean;
  blocking: readonly Defect[];
  open: readonly Defect[];
  total: number;
}>;

/** The rule of section 21.2: nothing open at critical, nothing open at high. */
export function judgeDefects(defects: readonly Defect[]): DefectVerdict {
  const open = defects.filter((defect) => defect.status !== "fixed");
  const blocking = open.filter(
    (defect) => defect.severity === "critical" || defect.severity === "high",
  );
  return { ok: blocking.length === 0, blocking, open, total: defects.length };
}

export function formatDefectVerdict(verdict: DefectVerdict): string {
  const counts = DEFECT_SEVERITIES.map(
    (severity) =>
      `${severity}: ${String(verdict.open.filter((defect) => defect.severity === severity).length)}`,
  ).join(", ");
  const header = `${String(verdict.total)} defects registered, ${String(verdict.open.length)} not fixed (${counts})`;
  if (verdict.ok) {
    return `${header}\nNo open critical or high-severity defect. The release gate passes.`;
  }
  const lines = verdict.blocking.map(
    (defect) => `  ${defect.id} ${defect.severity} ${defect.status}: ${defect.description}`,
  );
  return [header, "Blocking defects:", ...lines].join("\n");
}
