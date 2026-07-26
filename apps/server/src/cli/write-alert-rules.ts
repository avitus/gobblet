import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAlertRules } from "../observability/alerts";

/**
 * `pnpm ops:alerts`. Writes `ops/alerts/gobblet.rules.yml` from the definitions in
 * `src/observability/alerts.ts`; a test fails if the checked-in file differs.
 */

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../ops/alerts/gobblet.rules.yml",
);

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, renderAlertRules(), "utf8");
console.warn(`wrote ${target}`);
