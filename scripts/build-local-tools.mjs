import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundles = [
  ["../deploy/slop-detector/build.mjs", "../deploy/local/slop-detector-mcp.cjs"],
  ["../deploy/task-review/build.mjs", "../deploy/local/work-review-mcp.cjs"],
  ["../deploy/marketing-calendar/build.mjs", "../deploy/local/marketing-calendar-audit"],
  ["../deploy/observability/build.mjs", "../deploy/observability/observer.cjs"],
];

for (const [builder, output] of bundles) {
  const path = fileURLToPath(new URL(output, import.meta.url));
  if (existsSync(path)) chmodSync(path, 0o755);
  await import(new URL(builder, import.meta.url).href);
  chmodSync(path, 0o555);
}
