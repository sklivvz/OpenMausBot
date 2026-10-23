import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundles = [
  ["../deploy/objectives/build.mjs", "../deploy/objectives/controller.mjs"],
  ["../deploy/slop-detector/build.mjs", "../deploy/local/slop-detector-mcp.cjs"],
  ["../deploy/task-review/build.mjs", "../deploy/local/work-review-mcp.cjs"],
  ["../deploy/marketing-calendar/build.mjs", "../deploy/local/marketing-calendar-audit"],
  ["../deploy/marketing-calendar/build-template.mjs", "../deploy/local/newsletter-template-preflight", "../deploy/local/newsletter-template-prepare"],
  ["../deploy/observability/build.mjs", "../deploy/observability/observer.cjs"],
];

for (const [builder, ...outputs] of bundles) {
  const paths = outputs.map(output => fileURLToPath(new URL(output, import.meta.url)));
  for (const path of paths) if (existsSync(path)) chmodSync(path, 0o755);
  await import(new URL(builder, import.meta.url).href);
  for (const path of paths) chmodSync(path, 0o555);
}
