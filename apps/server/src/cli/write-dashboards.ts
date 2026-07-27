import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DASHBOARD_DEFINITIONS,
  dashboardFileName,
  renderDashboard,
} from "../observability/dashboards";

/**
 * `pnpm ops:dashboards`. Writes `ops/dashboards/*.json` from the definitions in
 * `src/observability/dashboards.ts`; a test fails if a checked-in file differs.
 */

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../ops/dashboards",
);

await mkdir(directory, { recursive: true });
for (const definition of DASHBOARD_DEFINITIONS) {
  const target = path.join(directory, dashboardFileName(definition));
  await writeFile(target, renderDashboard(definition), "utf8");
  console.warn(`wrote ${target}`);
}
